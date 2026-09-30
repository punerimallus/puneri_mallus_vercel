// Email delivery for fulfilled orders, tracked separately from fulfilment so a
// Resend outage never blocks tickets from being issued, and failed sends are
// retried by the reconcile job or re-sent on request.

import { MAX_EMAIL_ATTEMPTS } from './fulfil';
import { PaymentOrder } from './types';

export interface DeliveryDeps {
  getOrder(orderId: string): Promise<PaymentOrder | null>;
  updateOrder(orderId: string, patch: Partial<PaymentOrder>): Promise<void>;
  sendTicketEmail(order: PaymentOrder, to: string): Promise<void>;
  sendMembershipEmail(to: string, orderId: string, paymentId: string): Promise<void>;
  sendMartEmail(to: string, plan: string, orderId: string, paymentId: string): Promise<void>;
  markBookingEmail(bookingId: string, status: 'SENT' | 'FAILED', attempts: number, at: string): Promise<void>;
  log(message: string, extra?: unknown): void;
  now(): Date;
}

export type DeliveryStatus = 'SENT' | 'FAILED' | 'SKIPPED' | 'ALREADY_SENT' | 'NOT_READY' | 'RATE_LIMITED' | 'GAVE_UP';

export interface DeliveryOptions {
  /** Send even if it was already delivered (user or admin asked for a resend). */
  force?: boolean;
  /** Send to a different address, e.g. the buyer typed their email wrong. */
  overrideEmail?: string;
  /** Refuse if the last send was more recent than this. */
  minIntervalMs?: number;
}

export async function deliverOrderEmail(
  orderId: string,
  deps: DeliveryDeps,
  opts: DeliveryOptions = {},
): Promise<{ status: DeliveryStatus; error?: string }> {
  const order = await deps.getOrder(orderId);
  if (!order || order.status !== 'FULFILLED') return { status: 'NOT_READY' };
  if (order.email_status === 'SENT' && !opts.force) return { status: 'ALREADY_SENT' };
  if (!opts.force && order.email_attempts >= MAX_EMAIL_ATTEMPTS) return { status: 'GAVE_UP' };

  if (opts.minIntervalMs && order.last_emailed_at) {
    const since = deps.now().getTime() - new Date(order.last_emailed_at).getTime();
    if (since < opts.minIntervalMs) return { status: 'RATE_LIMITED' };
  }

  const to = (opts.overrideEmail || order.receipt_email || '').trim();
  if (!to) {
    await deps.updateOrder(orderId, { email_status: 'SKIPPED', email_error: 'No receipt email on file' });
    return { status: 'SKIPPED' };
  }

  const attempts = (order.email_attempts || 0) + 1;
  const at = deps.now().toISOString();
  try {
    const paymentId = order.razorpay_payment_id || '';
    if (order.payment_type === 'EVENT_TICKET') await deps.sendTicketEmail(order, to);
    else if (order.payment_type === 'LIFETIME') await deps.sendMembershipEmail(to, orderId, paymentId);
    else if (order.payment_type === 'MART') await deps.sendMartEmail(to, order.plan || '', orderId, paymentId);

    await deps.updateOrder(orderId, {
      email_status: 'SENT',
      email_attempts: attempts,
      email_error: null,
      last_emailed_at: at,
      ...(opts.overrideEmail ? { receipt_email: to } : {}),
    });
    if (order.booking_id) await deps.markBookingEmail(order.booking_id, 'SENT', attempts, at).catch(() => undefined);
    return { status: 'SENT' };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    deps.log('EMAIL_DELIVERY_FAILED', { orderId, attempts, error });
    await deps.updateOrder(orderId, {
      email_status: 'FAILED',
      email_attempts: attempts,
      email_error: error.slice(0, 500),
      last_emailed_at: at,
    });
    if (order.booking_id) await deps.markBookingEmail(order.booking_id, 'FAILED', attempts, at).catch(() => undefined);
    return { status: 'FAILED', error };
  }
}
