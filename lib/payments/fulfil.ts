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
  OrderStatus,
  PaymentOrder,
  ReservationLostError,

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
  /**
   * Write only if the order is still in one of `expected`. Returns false if it has moved on —
   * which is how a refund that lands mid-fulfilment stops us declaring the order FULFILLED.
   */
  updateOrderIfStatus(orderId: string, expected: OrderStatus[], patch: Partial<PaymentOrder>): Promise<boolean>;

  fetchPayment(paymentId: string): Promise<GatewayPayment>;
  fetchOrderPayments(orderId: string): Promise<GatewayPayment[]>;
  capturePayment(paymentId: string, amount: number, currency: string): Promise<GatewayPayment>;
  /**
   * Refund a payment we cannot deliver against. Must be idempotent for a given order: the same
   * call twice returns the same refund rather than refunding twice.
   */
  refundPayment(paymentId: string, amountPaise: number, reason: string): Promise<{ id: string } | null>;

  /** Turn this order's held seats and points into issued ones. Throws ReservationLostError if the hold is gone. */
  confirmReservation(reservationId: string): Promise<{ alreadyConfirmed: boolean; pointsSpent: number }>;
  /** Give an order's seats back and undo its reserved/spent points. Idempotent. */
  releaseReservation(reservationId: string): Promise<number>;

  /** Insert or, if one already exists for this Razorpay order, return the existing booking id. */
  upsertBooking(row: BookingInsert): Promise<string>;
  setBookingStatus(bookingId: string, status: 'CONFIRMED' | 'REFUNDED'): Promise<void>;
  adjustLoyalty(userId: string, delta: number): Promise<void>;
  /** Atomically mark an order's points as reversed. True only for the first caller, so a repeated refund event cannot reverse twice. */
  claimLoyaltyReversal(orderId: string): Promise<boolean>;

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
  | 'NEEDS_ATTENTION'    // paid but not deliverable, and we could not refund it either
  | 'REFUND_INITIATED'   // paid but not deliverable, so the money is on its way back
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

  // Walk the cart, not the allocations: the database hands categories back in id order (it locks
  // them that way to avoid deadlocks), and the buyer's passes should be listed in the order they
  // chose them, the same order the receipt and the PDF use.
  const byCategory = new Map(allocations.map((a) => [a.categoryId, a]));
  const ordered: Allocation[] = [];
  for (const line of order.cart || []) {
    const a = byCategory.get(line.categoryId);
    if (a) {
      ordered.push(a);
      byCategory.delete(line.categoryId);
    }
  }
  // Anything allocated that is no longer in the cart still gets its passes.
  ordered.push(...byCategory.values());

  for (const a of ordered) {
    const line = order.cart?.find((l) => l.categoryId === a.categoryId);
    const prefix = line?.prefix ?? '';
    const name = line?.name ?? 'General';
    const groupSize = groupSizeOf(line?.groupSize);
    // Every pass in a category is the same width, fixed from its capacity at checkout.
    const width = Math.max(3, Math.floor(Number(line?.numberWidth)) || 0);
    // The reservation always records the exact numbers it took; there is no other source.
    const numbers = a.numbers ?? [];
    for (const n of numbers) {
      tickets.push({
        // Stored so prices and voiding key off the category itself; renaming a category can no
        // longer leave a pass unpriced.
        categoryId: a.categoryId,
        categoryName: name,
        ticketNumber: `${prefix}${String(n).padStart(width, '0')}`,
        status: 'ISSUED',
        ...(groupSize > 1 ? { groupSize } : {}),
      });
    }
  }
  return tickets;
}

/**
 * Points EARNED by an order. The points a buyer redeems are handled by the inventory
 * reservation (held at checkout, spent on confirmation, returned on refund), so they are
 * deliberately not part of this — counting them in both places is how a refund could
 * double-credit someone.
 */
export function earnedPoints(order: PaymentOrder): number {
  const snap = order.event_snapshot || {};
  return Number(order.is_member_at_order ? snap.memberPoints : snap.nonMemberPoints) || 0;
}

/**
 * Money was taken for something we cannot deliver.
 *
 * This used to set NEEDS_ATTENTION, email an admin and stop — leaving captured money sitting
 * there until somebody noticed and refunded it by hand. Now we ask Razorpay to refund it
 * straight away and only fall back to "a human must look at this" if the refund itself fails.
 * Any seats or points the order was holding are given back either way.
 */
async function cannotDeliver(
  deps: FulfilmentDeps,
  order: PaymentOrder,
  paymentId: string | null,
  reason: string,
  userMessage: string,
): Promise<FulfilmentResult> {
  // Whatever happens with the money, stop holding inventory nobody is getting.
  if (order.reservation_id) {
    await deps.releaseReservation(order.reservation_id).catch((e) => deps.log('RELEASE_AFTER_FAILURE_FAILED', { orderId: order.razorpay_order_id, e }));
  }

  let refundId: string | null = null;
  let refundError: string | null = null;
  if (paymentId) {
    try {
      const refund = await deps.refundPayment(paymentId, order.amount_paise, reason);
      refundId = refund?.id ?? null;
    } catch (e) {
      refundError = e instanceof Error ? e.message : String(e);
      deps.log('AUTO_REFUND_FAILED', { orderId: order.razorpay_order_id, paymentId, reason, e });
    }
  }

  const status: OrderStatus = refundId ? 'REFUND_INITIATED' : 'NEEDS_ATTENTION';
  const at = deps.now().toISOString();
  await deps.updateOrder(order.razorpay_order_id, {
    status,
    status_reason: reason,
    ...(refundId ? { auto_refund_id: refundId, auto_refund_at: at } : {}),
  });

  const money = refundId
    ? `We refunded it automatically. Razorpay refund id: ${refundId} (it reaches the buyer in 5-7 working days).`
    : `AUTOMATIC REFUND FAILED${refundError ? ` (${refundError})` : ''} — refund this from the Razorpay dashboard yourself.`;

  await deps
    .alertAdmin(
      `${refundId ? 'Auto-refunded' : 'ACTION NEEDED'}: ${order.payment_type} ${order.razorpay_order_id}`,
      `${userMessage}\n\n${money}\n\nOrder: ${order.razorpay_order_id}\nPayment: ${paymentId ?? 'n/a'}\nUser: ${order.user_id ?? 'guest'}\nEmail: ${order.receipt_email ?? 'n/a'}\nAmount: ₹${(order.amount_paise / 100).toFixed(2)}\nReason: ${reason}`,
    )
    .catch((e) => deps.log('ADMIN_ALERT_FAILED', e));

  return {
    outcome: refundId ? 'REFUND_INITIATED' : 'NEEDS_ATTENTION',
    order: { ...order, status, status_reason: reason, auto_refund_id: refundId },
    reason,
  };
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
  if (existing.status === 'REFUND_INITIATED') {
    return { outcome: 'REFUND_INITIATED', order: existing, reason: existing.status_reason ?? undefined };
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
      return await cannotDeliver(
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
      // The seats, the numbers and the redeemed points were all taken at checkout, before the
      // buyer ever saw Razorpay. All that is left is to make the hold permanent — so "sold out
      // between checkout and payment" is no longer a thing that can happen.
      const reservationId = order.reservation_id;
      const allocations = order.allocated_tickets;

      if (!reservationId || !allocations || allocations.length === 0) {
        return await cannotDeliver(
          deps,
          order,
          payment.id,
          'NO_RESERVATION',
          'This order has no seat reservation, so no passes could be issued. It was most likely created before the reservation change was deployed.',
        );
      }

      try {
        await deps.confirmReservation(reservationId);
      } catch (e) {
        if (e instanceof ReservationLostError) {
          return await cannotDeliver(
            deps,
            order,
            payment.id,
            'RESERVATION_EXPIRED',
            'The seats this order was holding had already been given back by the time the payment arrived, so no passes could be issued.',
          );
        }
        throw e;
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

      // Only the points this order EARNED. The ones it redeemed were spent by confirming the
      // reservation just above.
      if (order.user_id && !order.loyalty_applied) {
        const earned = earnedPoints(order);
        try {
          if (earned !== 0) await deps.adjustLoyalty(order.user_id, earned);
          await deps.updateOrder(orderId, { loyalty_applied: true });
        } catch (e) {
          // Points are a perk; don't hold the tickets hostage to them.
          deps.log('LOYALTY_ADJUST_FAILED', { orderId, e });
        }
      }
    } else if (order.payment_type === 'LIFETIME') {
      if (order.user_id && (await deps.hasOtherFulfilledMembership(order.user_id, orderId))) {
        return await cannotDeliver(
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

    // Every sale reaches the ledger, event tickets included. They used to be skipped, which
    // left ticket revenue invisible to the admin ledger and impossible to reconcile.
    if (!order.ledger_recorded) {
      await deps.recordLedger(order, payment.id, 'SUCCESS');
      await deps.updateOrder(orderId, { ledger_recorded: true });
    }

    const fulfilledAt = deps.now().toISOString();
    // Guarded: if a refund (or anything else) moved this order while we were working, we must
    // not stamp it FULFILLED over the top. An unguarded write here could mark a refunded order
    // as fulfilled and leave its passes scannable.
    const stamped = await deps.updateOrderIfStatus(orderId, ['PROCESSING'], {
      status: 'FULFILLED',
      status_reason: null,
      fulfilled_via: opts.source,
      fulfilled_at: fulfilledAt,
    });

    if (!stamped) {
      const latest = await deps.getOrder(orderId);
      deps.log('FULFIL_RACED', { orderId, source: opts.source, status: latest?.status });
      if (latest?.status === 'REFUNDED' || latest?.status === 'PARTIALLY_REFUNDED' || latest?.status === 'REFUND_INITIATED') {
        return { outcome: 'REFUNDED', order: latest, bookingId, reason: latest.status_reason ?? undefined };
      }
      if (latest?.status === 'FULFILLED') {
        return { outcome: 'ALREADY_FULFILLED', order: latest, bookingId: latest.booking_id ?? bookingId };
      }
      return { outcome: 'IN_PROGRESS', order: latest, bookingId };
    }

    return {
      outcome: 'FULFILLED',
      bookingId,
      order: { ...order, status: 'FULFILLED', booking_id: bookingId, razorpay_payment_id: payment.id, fulfilled_via: opts.source, fulfilled_at: fulfilledAt },
    };
  } catch (e) {
    // Leave it claimable. The next webhook retry, status poll or reconcile run picks it up.
    // Guarded, so a refund that landed while we were failing is not overwritten with PAID.
    deps.log('FULFIL_ERROR', { orderId, source: opts.source, e });
    await deps
      .updateOrderIfStatus(orderId, ['PROCESSING'], {
        status: 'PAID',
        status_reason: `RETRY: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500),
      })
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
 * A fully refunded ticket order frees its seats (so they can be sold again) and undoes its points: the points it earned are
 * taken back and any the buyer spent are returned. Each is done at most once, however many times Razorpay repeats the event.
 * Voiding the passes does not depend on this, so a failure here is logged and reported to the admin, never thrown.
 */
async function giveBackSeatsAndPoints(order: PaymentOrder, deps: FulfilmentDeps) {
  // Releasing the reservation frees the seats AND returns the points the buyer redeemed, in one
  // transaction, exactly once however many times Razorpay repeats the refund event.
  if (order.reservation_id) {
    try {
      const released = await deps.releaseReservation(order.reservation_id);
      if (released > 0) deps.log('SEATS_RELEASED', { orderId: order.razorpay_order_id, released });
    } catch (e) {
      deps.log('SEATS_RELEASE_FAILED', { orderId: order.razorpay_order_id, e });
      await deps
        .alertAdmin(
          `Refund: seats not released for ${order.razorpay_order_id}`,
          'The passes were voided, but their seats could not be given back to the category count. Check the reservation ' +
            `${order.reservation_id} and release it by hand if needed.`,
        )
        .catch(() => undefined);
    }
  } else {
    deps.log('REFUND_WITHOUT_RESERVATION', { orderId: order.razorpay_order_id });
  }

  // Separately, take back the points the order EARNED. (The redeemed ones came back above.)
  if (!order.user_id || !order.loyalty_applied) return;
  try {
    if (!(await deps.claimLoyaltyReversal(order.razorpay_order_id))) return;
    try {
      const earned = earnedPoints(order);
      if (earned !== 0) await deps.adjustLoyalty(order.user_id, -earned);
    } catch (e) {
      // Un-claim so a retry can try again rather than silently skipping the reversal.
      await deps.updateOrder(order.razorpay_order_id, { loyalty_reversed: false }).catch(() => undefined);
      throw e;
    }
  } catch (e) {
    deps.log('LOYALTY_REVERSAL_FAILED', { orderId: order.razorpay_order_id, e });
  }
}

/**
 * Apply a refund reported by Razorpay. A full refund voids event passes so they
 * no longer scan at the gate; membership/mart access is flagged to the admin
 * rather than revoked automatically.
 */
export async function applyRefund(paymentId: string, refundedPaise: number, deps: FulfilmentDeps, orderIdHint?: string | null) {
  // The payment id is only written onto the order during fulfilment, so a refund of a payment
  // that never got that far used to find nothing, log a line and be recorded as handled — the
  // webhook was then never retried and the refund vanished from our records. Fall back to the
  // order id the event carries, and if even that finds nothing, THROW: the caller must return
  // 5xx so Razorpay retries instead of us silently dropping it.
  let order = await deps.getOrderByPaymentId(paymentId);
  if (!order && orderIdHint) order = await deps.getOrder(orderIdHint);

  if (!order) {
    deps.log('REFUND_UNKNOWN_PAYMENT', { paymentId, orderIdHint });
    await deps
      .alertAdmin(
        `Refund for a payment we do not recognise: ${paymentId}`,
        `Razorpay reported a refund of ₹${(refundedPaise / 100).toFixed(2)} for payment ${paymentId}` +
          `${orderIdHint ? ` (order ${orderIdHint})` : ''}, but no matching order exists here.\n\n` +
          'Nothing was changed. Reconcile this against the Razorpay dashboard by hand.',
      )
      .catch((e) => deps.log('ADMIN_ALERT_FAILED', e));
    throw new Error(`REFUND_UNKNOWN_PAYMENT:${paymentId}`);
  }
  const full = refundedPaise >= order.amount_paise;
  await deps.updateOrder(order.razorpay_order_id, {
    status: full ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
    refunded_amount_paise: refundedPaise,
    status_reason: `Refunded ₹${(refundedPaise / 100).toFixed(2)}`,
  });

  if (full && order.booking_id) await deps.setBookingStatus(order.booking_id, 'REFUNDED');
  if (full && order.payment_type === 'EVENT_TICKET') await giveBackSeatsAndPoints(order, deps);
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
