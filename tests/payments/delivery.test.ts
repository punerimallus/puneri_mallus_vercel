import { describe, expect, it, vi } from 'vitest';
import { deliverOrderEmail, DeliveryDeps } from '@/lib/payments/delivery';
import { PaymentOrder } from '@/lib/payments/types';
import { makeOrder } from './fakes';

function world(order: PaymentOrder) {
  const o = { ...order };
  let now = new Date('2026-09-30T10:00:00Z');
  const deps: DeliveryDeps = {
    getOrder: vi.fn(async () => ({ ...o })),
    updateOrder: vi.fn(async (_id, patch) => void Object.assign(o, patch)),
    sendTicketEmail: vi.fn(async () => undefined),
    sendMembershipEmail: vi.fn(async () => undefined),
    sendMartEmail: vi.fn(async () => undefined),
    markBookingEmail: vi.fn(async () => undefined),
    log: vi.fn(),
    now: () => now,
  };
  return { o, deps, advance: (ms: number) => (now = new Date(now.getTime() + ms)) };
}

const fulfilled = makeOrder({ status: 'FULFILLED', booking_id: 'b1', razorpay_payment_id: 'pay_1' });

describe('deliverOrderEmail', () => {
  it('sends once and records it', async () => {
    const w = world(fulfilled);
    expect((await deliverOrderEmail('order_1', w.deps)).status).toBe('SENT');
    expect((await deliverOrderEmail('order_1', w.deps)).status).toBe('ALREADY_SENT');
    expect(w.deps.sendTicketEmail).toHaveBeenCalledTimes(1);
    expect(w.deps.markBookingEmail).toHaveBeenCalledWith('b1', 'SENT', 1, expect.any(String));
  });

  it('records a failed send so it can be retried, then succeeds on retry', async () => {
    const w = world(fulfilled);
    (w.deps.sendTicketEmail as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Resend 500'));
    const first = await deliverOrderEmail('order_1', w.deps);
    expect(first.status).toBe('FAILED');
    expect(w.o.email_status).toBe('FAILED');
    expect(w.o.email_error).toMatch(/Resend 500/);
    expect((await deliverOrderEmail('order_1', w.deps)).status).toBe('SENT');
    expect(w.o.email_attempts).toBe(2);
  });

  it('stops automatic retries after 5 attempts but still allows a manual resend', async () => {
    const w = world({ ...fulfilled, email_status: 'FAILED', email_attempts: 5 });
    expect((await deliverOrderEmail('order_1', w.deps)).status).toBe('GAVE_UP');
    expect((await deliverOrderEmail('order_1', w.deps, { force: true })).status).toBe('SENT');
  });

  it('does not email for unpaid, refunded or flagged orders', async () => {
    for (const status of ['CREATED', 'NEEDS_ATTENTION', 'REFUNDED'] as const) {
      const w = world({ ...fulfilled, status });
      expect((await deliverOrderEmail('order_1', w.deps, { force: true })).status).toBe('NOT_READY');
    }
  });

  it('rate-limits user resends', async () => {
    const w = world({ ...fulfilled, email_status: 'SENT', last_emailed_at: '2026-09-30T09:59:40Z' });
    expect((await deliverOrderEmail('order_1', w.deps, { force: true, minIntervalMs: 60_000 })).status).toBe('RATE_LIMITED');
    w.advance(60_000);
    expect((await deliverOrderEmail('order_1', w.deps, { force: true, minIntervalMs: 60_000 })).status).toBe('SENT');
  });

  it('admin can resend to a corrected email', async () => {
    const w = world(fulfilled);
    await deliverOrderEmail('order_1', w.deps, { force: true, overrideEmail: 'fixed@example.com' });
    expect(w.deps.sendTicketEmail).toHaveBeenCalledWith(expect.anything(), 'fixed@example.com');
    expect(w.o.receipt_email).toBe('fixed@example.com');
  });

  it('marks SKIPPED when there is no address at all', async () => {
    const w = world({ ...fulfilled, receipt_email: null });
    expect((await deliverOrderEmail('order_1', w.deps)).status).toBe('SKIPPED');
  });

  it('sends the right email per product', async () => {
    const m = world({ ...fulfilled, payment_type: 'LIFETIME', booking_id: null });
    await deliverOrderEmail('order_1', m.deps);
    expect(m.deps.sendMembershipEmail).toHaveBeenCalledWith('buyer@example.com', 'order_1', 'pay_1');
    const mart = world({ ...fulfilled, payment_type: 'MART', plan: 'YEARLY', booking_id: null });
    await deliverOrderEmail('order_1', mart.deps);
    expect(mart.deps.sendMartEmail).toHaveBeenCalledWith('buyer@example.com', 'YEARLY', 'order_1', 'pay_1');
  });
});
