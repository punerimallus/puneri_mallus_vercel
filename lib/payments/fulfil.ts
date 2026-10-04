// The one place a paid order turns into tickets / membership / mart access.
//
// It is called from four directions and must give the same result whichever
// arrives first, and no matter how many times it is called:
//   CLIENT       the browser's Razorpay handler (/api/razorpay/verify, /api/tickets/verify)
//   WEBHOOK      Razorpay's server-to-server payment.captured / order.paid
//   STATUS_POLL  the checkout page polling after the modal closed or the handler failed
//   RECONCILE    the daily cron / admin button sweeping orders that slipped through
//
// Nothing here trusts the browser: what was bought comes from the payment_orders
// row written at order creation, and whether it was paid comes from Razorpay's API.

import {
  Allocation,
  FulfilmentSource,
  GatewayPayment,
  IssuedTicket,
  PaymentOrder,
  SoldOutError,
} from './types';
import { groupSizeOf } from './groups';

export const STALE_PROCESSING_MS = 5 * 60 * 1000;
export const MAX_EMAIL_ATTEMPTS = 5;

export interface BookingInsert {
  event_id: string;
  user_id: string | null;
  email: string | null;
  amount_paid: number;
  razorpay_payment_id: string;
  razorpay_order_id: string;
  tickets_data: IssuedTicket[];
}

export interface FulfilmentDeps {
  getOrder(orderId: string): Promise<PaymentOrder | null>;
  getOrderByPaymentId(paymentId: string): Promise<PaymentOrder | null>;
  /** Atomically move a claimable order to PROCESSING. Returns null if someone else holds it or it is done. */
  claimOrder(orderId: string, staleBefore: Date): Promise<PaymentOrder | null>;
  updateOrder(orderId: string, patch: Partial<PaymentOrder>): Promise<void>;

  fetchPayment(paymentId: string): Promise<GatewayPayment>;
  fetchOrderPayments(orderId: string): Promise<GatewayPayment[]>;
  capturePayment(paymentId: string, amount: number, currency: string): Promise<GatewayPayment>;

  allocateTickets(items: { categoryId: string; qty: number }[]): Promise<Allocation[]>;
  /** Insert or, if one already exists for this Razorpay order, return the existing booking id. */
  upsertBooking(row: BookingInsert): Promise<string>;
  setBookingStatus(bookingId: string, status: 'CONFIRMED' | 'REFUNDED'): Promise<void>;
  adjustLoyalty(userId: string, delta: number): Promise<void>;

  hasOtherFulfilledMembership(userId: string, excludingOrderId: string): Promise<boolean>;
  activateMembership(order: PaymentOrder, paymentId: string): Promise<void>;
  activateMart(order: PaymentOrder, paymentId: string): Promise<void>;
  recordLedger(order: PaymentOrder, paymentId: string, status: 'SUCCESS' | 'REFUNDED'): Promise<void>;

  alertAdmin(subject: string, body: string): Promise<void>;
  log(message: string, extra?: unknown): void;
  now(): Date;
}

export type FulfilmentOutcome =
  | 'FULFILLED'          // done now
  | 'ALREADY_FULFILLED'  // done earlier, nothing changed
  | 'IN_PROGRESS'        // another request is fulfilling it; poll status
  | 'NOT_PAID'           // Razorpay has no captured payment for this order
  | 'NEEDS_ATTENTION'    // paid but not deliverable; admin alerted
  | 'REFUNDED'
  | 'UNKNOWN_ORDER';

export interface FulfilmentResult {
  outcome: FulfilmentOutcome;
  order: PaymentOrder | null;
  bookingId?: string | null;
  reason?: string;
}

const CLAIMABLE = new Set(['CREATED', 'FAILED', 'PAID', 'PROCESSING']);

/** Pick the payment that settles an order: captured first, then authorized. */
export function pickSettlingPayment(payments: GatewayPayment[]): GatewayPayment | null {
  return (
    payments.find((p) => p.status === 'captured') ||
    payments.find((p) => p.status === 'authorized') ||
    null
  );
}

export function buildIssuedTickets(order: PaymentOrder, allocations: Allocation[]): IssuedTicket[] {
  const tickets: IssuedTicket[] = [];
  for (const a of allocations) {
    const line = order.cart?.find((l) => l.categoryId === a.categoryId);
    const prefix = line?.prefix ?? '';
    const name = line?.name ?? 'General';
    const groupSize = groupSizeOf(line?.groupSize);
    for (let n = a.endSold - a.qty + 1; n <= a.endSold; n++) {
      tickets.push({ categoryName: name, ticketNumber: `${prefix}${String(n).padStart(3, '0')}`, status: 'ISSUED', ...(groupSize > 1 ? { groupSize } : {}) });
    }
  }
  return tickets;
}

export function loyaltyDelta(order: PaymentOrder): number {
  const snap = order.event_snapshot || {};
  const earned = Number(order.is_member_at_order ? snap.memberPoints : snap.nonMemberPoints) || 0;
  return earned - (order.points_to_redeem || 0);
}

async function needsAttention(
  deps: FulfilmentDeps,
  order: PaymentOrder,
  paymentId: string | null,
  reason: string,
  userMessage: string,
): Promise<FulfilmentResult> {
  await deps.updateOrder(order.razorpay_order_id, { status: 'NEEDS_ATTENTION', status_reason: reason });
  await deps
    .alertAdmin(
      `Payment needs attention: ${order.payment_type} ${order.razorpay_order_id}`,
      `${userMessage}\n\nOrder: ${order.razorpay_order_id}\nPayment: ${paymentId ?? 'n/a'}\nUser: ${order.user_id ?? 'guest'}\nEmail: ${order.receipt_email ?? 'n/a'}\nAmount: ₹${(order.amount_paise / 100).toFixed(2)}\nReason: ${reason}\n\nRefund it from the Razorpay dashboard (the refund webhook will update our records), or fulfil it manually.`,
    )
    .catch((e) => deps.log('ADMIN_ALERT_FAILED', e));
  return { outcome: 'NEEDS_ATTENTION', order: { ...order, status: 'NEEDS_ATTENTION', status_reason: reason }, reason };
}

export async function fulfilOrder(
  orderId: string,
  opts: { paymentId?: string | null; source: FulfilmentSource },
  deps: FulfilmentDeps,
): Promise<FulfilmentResult> {
  const existing = await deps.getOrder(orderId);
  if (!existing) {
    deps.log('FULFIL_UNKNOWN_ORDER', { orderId, source: opts.source });
    return { outcome: 'UNKNOWN_ORDER', order: null };
  }
  if (existing.status === 'FULFILLED') {
    return { outcome: 'ALREADY_FULFILLED', order: existing, bookingId: existing.booking_id };
  }
  if (existing.status === 'REFUNDED' || existing.status === 'PARTIALLY_REFUNDED') {
    return { outcome: 'REFUNDED', order: existing, bookingId: existing.booking_id };
  }
  if (existing.status === 'NEEDS_ATTENTION') {
    return { outcome: 'NEEDS_ATTENTION', order: existing, reason: existing.status_reason ?? undefined };
  }

  // 1. Ask Razorpay what actually happened. Never trust the browser for this.
  let payment: GatewayPayment | null;
  if (opts.paymentId) {
    payment = await deps.fetchPayment(opts.paymentId);
    if (payment.order_id !== orderId) {
      deps.log('FULFIL_PAYMENT_ORDER_MISMATCH', { orderId, paymentId: opts.paymentId, paymentOrder: payment.order_id });
      return { outcome: 'NOT_PAID', order: existing, reason: 'Payment does not belong to this order' };
    }
    // A failed attempt on an order can be followed by a successful one; look at all of them.
    if (payment.status !== 'captured' && payment.status !== 'authorized') {
      payment = pickSettlingPayment(await deps.fetchOrderPayments(orderId)) || payment;
    }
  } else {
    payment = pickSettlingPayment(await deps.fetchOrderPayments(orderId));
  }

  if (!payment || (payment.status !== 'captured' && payment.status !== 'authorized')) {
    if (payment?.status === 'failed' && existing.status === 'CREATED') {
      await deps.updateOrder(orderId, {
        status: 'FAILED',
        status_reason: payment.error_description || 'Payment failed',
        razorpay_payment_id: payment.id,
      });
    }
    return { outcome: 'NOT_PAID', order: existing, reason: payment?.error_description || undefined };
  }

  if (!CLAIMABLE.has(existing.status)) {
    return { outcome: 'IN_PROGRESS', order: existing };
  }

  // 2. Claim it so parallel callers (webhook + browser) don't both fulfil.
  const order = await deps.claimOrder(orderId, new Date(deps.now().getTime() - STALE_PROCESSING_MS));
  if (!order) {
    const latest = await deps.getOrder(orderId);
    if (latest?.status === 'FULFILLED') return { outcome: 'ALREADY_FULFILLED', order: latest, bookingId: latest.booking_id };
    return { outcome: 'IN_PROGRESS', order: latest };
  }

  try {
    // 3. Payments left in "authorized" are auto-refunded by Razorpay after a few days. Capture them.
    if (payment.status === 'authorized') {
      payment = await deps.capturePayment(payment.id, order.amount_paise, order.currency);
    }

    if (payment.amount !== order.amount_paise || payment.currency !== order.currency) {
      return await needsAttention(
        deps,
        order,
        payment.id,
        `AMOUNT_MISMATCH: paid ${payment.amount} ${payment.currency}, expected ${order.amount_paise} ${order.currency}`,
        'The captured amount does not match the order.',
      );
    }

    await deps.updateOrder(orderId, { razorpay_payment_id: payment.id });
    let bookingId: string | null = order.booking_id;

    if (order.payment_type === 'EVENT_TICKET') {
      let allocations = order.allocated_tickets;
      if (!allocations || allocations.length === 0) {
        try {
          allocations = await deps.allocateTickets(
            (order.cart || []).map((l) => ({ categoryId: l.categoryId, qty: l.qty })),
          );
        } catch (e) {
          if (e instanceof SoldOutError) {
            return await needsAttention(
              deps,
              order,
              payment.id,
              `SOLD_OUT: ${e.categoryName}`,
              `"${e.categoryName}" sold out between checkout and payment. The buyer paid but no passes were issued.`,
            );
          }
          throw e;
        }
        // Saved immediately so a crash after this point reuses the same seats instead of taking new ones.
        await deps.updateOrder(orderId, { allocated_tickets: allocations });
      }

      if (!bookingId) {
        bookingId = await deps.upsertBooking({
          event_id: order.event_id!,
          user_id: order.user_id,
          email: order.receipt_email,
          amount_paid: order.base_amount,
          razorpay_payment_id: payment.id,
          razorpay_order_id: orderId,
          tickets_data: buildIssuedTickets(order, allocations),
        });
        await deps.updateOrder(orderId, { booking_id: bookingId });
      }

      if (order.user_id && !order.loyalty_applied) {
        const delta = loyaltyDelta(order);
        try {
          if (delta !== 0) await deps.adjustLoyalty(order.user_id, delta);
          await deps.updateOrder(orderId, { loyalty_applied: true });
        } catch (e) {
          // Points are a perk; don't hold the tickets hostage to them.
          deps.log('LOYALTY_ADJUST_FAILED', { orderId, e });
        }
      }
    } else if (order.payment_type === 'LIFETIME') {
      if (order.user_id && (await deps.hasOtherFulfilledMembership(order.user_id, orderId))) {
        return await needsAttention(
          deps,
          order,
          payment.id,
          'DUPLICATE_MEMBERSHIP_PAYMENT',
          'This user already has an active lifetime membership paid through another order.',
        );
      }
      await deps.activateMembership(order, payment.id);
    } else if (order.payment_type === 'MART') {
      await deps.activateMart(order, payment.id);
    }

    if (order.payment_type !== 'EVENT_TICKET' && !order.ledger_recorded) {
      await deps.recordLedger(order, payment.id, 'SUCCESS');
      await deps.updateOrder(orderId, { ledger_recorded: true });
    }

    const fulfilledAt = deps.now().toISOString();
    await deps.updateOrder(orderId, {
      status: 'FULFILLED',
      status_reason: null,
      fulfilled_via: opts.source,
      fulfilled_at: fulfilledAt,
    });

    return {
      outcome: 'FULFILLED',
      bookingId,
      order: { ...order, status: 'FULFILLED', booking_id: bookingId, razorpay_payment_id: payment.id, fulfilled_via: opts.source, fulfilled_at: fulfilledAt },
    };
  } catch (e) {
    // Leave it claimable. The next webhook retry, status poll or reconcile run picks it up.
    deps.log('FULFIL_ERROR', { orderId, source: opts.source, e });
    await deps
      .updateOrder(orderId, { status: 'PAID', status_reason: `RETRY: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500) })
      .catch(() => undefined);
    throw e;
  }
}

/** Mark an order failed after payment.failed, unless it has already moved on. */
export async function markOrderFailed(orderId: string, paymentId: string | null, reason: string, deps: FulfilmentDeps) {
  const order = await deps.getOrder(orderId);
  if (!order || order.status !== 'CREATED') return;
  await deps.updateOrder(orderId, { status: 'FAILED', status_reason: reason || 'Payment failed', razorpay_payment_id: paymentId });
}

/**
 * Apply a refund reported by Razorpay. A full refund voids event passes so they
 * no longer scan at the gate; membership/mart access is flagged to the admin
 * rather than revoked automatically.
 */
export async function applyRefund(paymentId: string, refundedPaise: number, deps: FulfilmentDeps) {
  const order = await deps.getOrderByPaymentId(paymentId);
  if (!order) {
    deps.log('REFUND_UNKNOWN_PAYMENT', { paymentId });
    return null;
  }
  const full = refundedPaise >= order.amount_paise;
  await deps.updateOrder(order.razorpay_order_id, {
    status: full ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
    refunded_amount_paise: refundedPaise,
    status_reason: `Refunded ₹${(refundedPaise / 100).toFixed(2)}`,
  });

  if (full && order.booking_id) await deps.setBookingStatus(order.booking_id, 'REFUNDED');
  if (full && order.payment_type !== 'EVENT_TICKET' && order.ledger_recorded) {
    await deps.recordLedger(order, paymentId, 'REFUNDED');
  }
  if (order.payment_type !== 'EVENT_TICKET' || !full) {
    await deps
      .alertAdmin(
        `Refund processed: ${order.payment_type} ${order.razorpay_order_id}`,
        `Razorpay refunded ₹${(refundedPaise / 100).toFixed(2)} of ₹${(order.amount_paise / 100).toFixed(2)} for payment ${paymentId}.\n` +
          (order.payment_type === 'EVENT_TICKET'
            ? 'This was a partial refund, so the passes are still valid. Void specific passes manually if needed.'
            : 'Membership / Mart access was NOT revoked automatically. Revoke it from the admin panel if the refund means the user should lose access.'),
      )
      .catch((e) => deps.log('ADMIN_ALERT_FAILED', e));
  }
  return order;
}
