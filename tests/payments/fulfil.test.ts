import { describe, expect, it, vi } from 'vitest';
import { applyRefund, fulfilOrder, markOrderFailed } from '@/lib/payments/fulfil';
import { makeOrder, makeWorld, payment } from './fakes';

describe('fulfilOrder: event tickets', () => {
  it('issues sequential passes, a booking and loyalty points for a captured payment', async () => {
    const w = makeWorld();
    const res = await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'CLIENT' }, w.deps);

    expect(res.outcome).toBe('FULFILLED');
    const booking = w.bookings.get(res.bookingId!)!;
    expect(booking.tickets_data.map((t) => t.ticketNumber)).toEqual(['VIP011', 'VIP012', 'GA042']);
    expect(booking.email).toBe('buyer@example.com');
    expect(booking.amount_paid).toBe(1200);
    expect(w.orders.get('order_1')!.status).toBe('FULFILLED');
    expect(w.orders.get('order_1')!.fulfilled_via).toBe('CLIENT');
    expect(w.loyalty.user_1).toBe(110); // +10 non-member points
  });

  it('an amount with paise (member discount) is fulfilled even though the booking column is an integer', async () => {
    // Production incident: 1.60 -> 'invalid input syntax for type integer: "1.6"', order paid but never fulfilled.
    const w = makeWorld(
      [makeOrder({ base_amount: 424.15, amount_paise: 43430, cart: [{ categoryId: 'cat_ga', name: 'General', prefix: 'GA', qty: 1, unitPrice: 424.15 }] })],
      [payment({ amount: 43430 })],
    );
    const res = await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'WEBHOOK' }, w.deps);

    expect(res.outcome).toBe('FULFILLED');
    expect(w.bookings.get(res.bookingId!)!.amount_paid).toBe(424); // whole rupees in the integer column
    expect(w.orders.get('order_1')!.base_amount).toBe(424.15);     // exact amount kept on the order
    expect(w.orders.get('order_1')!.status).toBe('FULFILLED');
  });

  it('the exact paise case from production (1.60) is fulfilled by the webhook, not left as PAID', async () => {
    const w = makeWorld(
      [makeOrder({ base_amount: 1.6, amount_paise: 164, cart: [{ categoryId: 'cat_ga', name: 'General', prefix: 'GA', qty: 1, unitPrice: 1.6 }] })],
      [payment({ amount: 164 })],
    );
    const res = await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'WEBHOOK' }, w.deps);
    expect(res.outcome).toBe('FULFILLED');
    expect(w.bookings.size).toBe(1);
  });

  it('tab closed after paying: the webhook alone delivers the passes', async () => {
    const w = makeWorld();
    const res = await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'WEBHOOK' }, w.deps);
    expect(res.outcome).toBe('FULFILLED');
    expect(w.bookings.size).toBe(1);
  });

  it('tab closed and webhook missed: reconcile finds the captured payment without a payment id', async () => {
    const w = makeWorld();
    const res = await fulfilOrder('order_1', { source: 'RECONCILE' }, w.deps);
    expect(res.outcome).toBe('FULFILLED');
    expect(w.orders.get('order_1')!.razorpay_payment_id).toBe('pay_1');
  });

  it('browser handler and webhook both arriving: passes are issued exactly once', async () => {
    const w = makeWorld();
    const first = await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'CLIENT' }, w.deps);
    const second = await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'WEBHOOK' }, w.deps);
    expect(first.outcome).toBe('FULFILLED');
    expect(second.outcome).toBe('ALREADY_FULFILLED');
    expect(second.bookingId).toBe(first.bookingId);
    expect(w.deps.allocateTickets).toHaveBeenCalledTimes(1);
    expect(w.bookings.size).toBe(1);
    expect(w.loyalty.user_1).toBe(110);
  });

  it('simultaneous requests: only one wins the claim', async () => {
    const w = makeWorld();
    const results = await Promise.all([
      fulfilOrder('order_1', { paymentId: 'pay_1', source: 'CLIENT' }, w.deps),
      fulfilOrder('order_1', { paymentId: 'pay_1', source: 'WEBHOOK' }, w.deps),
      fulfilOrder('order_1', { source: 'STATUS_POLL' }, w.deps),
    ]);
    expect(results.filter((r) => r.outcome === 'FULFILLED')).toHaveLength(1);
    expect(w.deps.allocateTickets).toHaveBeenCalledTimes(1);
    expect(w.bookings.size).toBe(1);
  });

  it('replaying the verify call (attacker or double click) never issues more passes', async () => {
    const w = makeWorld();
    for (let i = 0; i < 5; i++) await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'CLIENT' }, w.deps);
    expect(w.bookings.size).toBe(1);
    expect(w.sold.cat_vip).toBe(12);
  });

  it('user closed checkout without paying: nothing is issued and the order stays open', async () => {
    const w = makeWorld([makeOrder()], []);
    const res = await fulfilOrder('order_1', { source: 'STATUS_POLL' }, w.deps);
    expect(res.outcome).toBe('NOT_PAID');
    expect(w.orders.get('order_1')!.status).toBe('CREATED');
    expect(w.bookings.size).toBe(0);
  });

  it('failed attempt then successful retry on the same order is fulfilled', async () => {
    const payments = [payment({ id: 'pay_bad', status: 'failed', error_description: 'Card declined' })];
    const w = makeWorld([makeOrder()], payments);

    await markOrderFailed('order_1', 'pay_bad', 'Card declined', w.deps);
    expect(w.orders.get('order_1')!.status).toBe('FAILED');

    payments.push(payment({ id: 'pay_good' }));
    const res = await fulfilOrder('order_1', { paymentId: 'pay_good', source: 'WEBHOOK' }, w.deps);
    expect(res.outcome).toBe('FULFILLED');
    expect(w.orders.get('order_1')!.razorpay_payment_id).toBe('pay_good');
  });

  it('a failed payment id still settles if another payment on the order was captured', async () => {
    const w = makeWorld([makeOrder()], [payment({ id: 'pay_bad', status: 'failed' }), payment({ id: 'pay_good' })]);
    const res = await fulfilOrder('order_1', { paymentId: 'pay_bad', source: 'WEBHOOK' }, w.deps);
    expect(res.outcome).toBe('FULFILLED');
  });

  it('only-failed payments mark the order FAILED', async () => {
    const w = makeWorld([makeOrder()], [payment({ status: 'failed', error_description: 'UPI timeout' })]);
    const res = await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'WEBHOOK' }, w.deps);
    expect(res.outcome).toBe('NOT_PAID');
    expect(w.orders.get('order_1')!.status).toBe('FAILED');
    expect(w.orders.get('order_1')!.status_reason).toBe('UPI timeout');
  });

  it('authorized-but-not-captured payments are captured so Razorpay does not auto-refund them', async () => {
    const w = makeWorld([makeOrder()], [payment({ status: 'authorized' })]);
    const res = await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'WEBHOOK' }, w.deps);
    expect(w.deps.capturePayment).toHaveBeenCalledWith('pay_1', 122904, 'INR');
    expect(res.outcome).toBe('FULFILLED');
  });

  it('amount mismatch is flagged, not fulfilled', async () => {
    const w = makeWorld([makeOrder()], [payment({ amount: 100 })]);
    const res = await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'WEBHOOK' }, w.deps);
    expect(res.outcome).toBe('NEEDS_ATTENTION');
    expect(res.reason).toMatch(/AMOUNT_MISMATCH/);
    expect(w.deps.allocateTickets).not.toHaveBeenCalled();
    expect(w.alerts).toHaveLength(1);
  });

  it('a payment id belonging to another order is rejected', async () => {
    const w = makeWorld([makeOrder()], [payment({ order_id: 'order_other' })]);
    const res = await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'CLIENT' }, w.deps);
    expect(res.outcome).toBe('NOT_PAID');
    expect(w.bookings.size).toBe(0);
  });

  it('sold out between checkout and payment: flagged for refund and admin alerted', async () => {
    const w = makeWorld();
    w.sold.cat_ga = 100;
    const res = await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'WEBHOOK' }, w.deps);
    expect(res.outcome).toBe('NEEDS_ATTENTION');
    expect(res.reason).toMatch(/SOLD_OUT/);
    expect(w.orders.get('order_1')!.status).toBe('NEEDS_ATTENTION');
    expect(w.alerts).toHaveLength(1);
    expect(w.bookings.size).toBe(0);
    // Later calls don't retry the allocation or spam the admin.
    const again = await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'RECONCILE' }, w.deps);
    expect(again.outcome).toBe('NEEDS_ATTENTION');
    expect(w.alerts).toHaveLength(1);
  });

  it('a crash after seats were reserved retries with the SAME seats', async () => {
    const w = makeWorld();
    (w.deps.upsertBooking as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('db down'));

    await expect(fulfilOrder('order_1', { paymentId: 'pay_1', source: 'CLIENT' }, w.deps)).rejects.toThrow('db down');
    expect(w.orders.get('order_1')!.status).toBe('PAID');

    const res = await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'WEBHOOK' }, w.deps);
    expect(res.outcome).toBe('FULFILLED');
    expect(w.deps.allocateTickets).toHaveBeenCalledTimes(1);
    expect(w.sold.cat_vip).toBe(12);
    expect(w.bookings.get(res.bookingId!)!.tickets_data[0].ticketNumber).toBe('VIP011');
  });

  it('a worker that died mid-way is taken over once its claim goes stale', async () => {
    const w = makeWorld([makeOrder({ status: 'PROCESSING', processing_started_at: '2026-09-30T10:04:00.000Z' })]);
    expect((await fulfilOrder('order_1', { source: 'RECONCILE' }, w.deps)).outcome).toBe('IN_PROGRESS');
    w.advance(10 * 60 * 1000);
    expect((await fulfilOrder('order_1', { source: 'RECONCILE' }, w.deps)).outcome).toBe('FULFILLED');
  });

  it('points redeemed are deducted and member points earned, once', async () => {
    const w = makeWorld([makeOrder({ points_to_redeem: 60, is_member_at_order: true })]);
    await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'CLIENT' }, w.deps);
    await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'WEBHOOK' }, w.deps);
    expect(w.loyalty.user_1).toBe(100 - 60 + 20);
  });

  it('a loyalty failure does not block the passes', async () => {
    const w = makeWorld();
    (w.deps.adjustLoyalty as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('rpc missing'));
    const res = await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'CLIENT' }, w.deps);
    expect(res.outcome).toBe('FULFILLED');
  });

  it('unknown orders (e.g. created before this change) are reported, not crashed on', async () => {
    const w = makeWorld([]);
    expect((await fulfilOrder('order_x', { paymentId: 'pay_1', source: 'WEBHOOK' }, w.deps)).outcome).toBe('UNKNOWN_ORDER');
  });
});

describe('fulfilOrder: membership and mart', () => {
  it('activates lifetime membership and records the ledger once', async () => {
    const w = makeWorld([makeOrder({ payment_type: 'LIFETIME', plan: 'LIFETIME', cart: null, event_id: null })]);
    await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'CLIENT' }, w.deps);
    await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'WEBHOOK' }, w.deps);
    expect(w.deps.activateMembership).toHaveBeenCalledTimes(1);
    expect(w.deps.recordLedger).toHaveBeenCalledTimes(1);
    expect(w.deps.allocateTickets).not.toHaveBeenCalled();
  });

  it('a second paid lifetime order (two tabs) is flagged for refund', async () => {
    const w = makeWorld(
      [
        makeOrder({ razorpay_order_id: 'order_0', payment_type: 'LIFETIME', status: 'FULFILLED' }),
        makeOrder({ payment_type: 'LIFETIME', cart: null }),
      ],
    );
    const res = await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'CLIENT' }, w.deps);
    expect(res.outcome).toBe('NEEDS_ATTENTION');
    expect(res.reason).toBe('DUPLICATE_MEMBERSHIP_PAYMENT');
    expect(w.deps.activateMembership).not.toHaveBeenCalled();
  });

  it('activates mart access', async () => {
    const w = makeWorld([makeOrder({ payment_type: 'MART', plan: 'YEARLY', cart: null })]);
    const res = await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'CLIENT' }, w.deps);
    expect(res.outcome).toBe('FULFILLED');
    expect(w.deps.activateMart).toHaveBeenCalledTimes(1);
  });
});

describe('refunds', () => {
  it('a full refund voids the passes so they no longer scan', async () => {
    const w = makeWorld();
    const res = await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'CLIENT' }, w.deps);
    await applyRefund('pay_1', 122904, w.deps);
    expect(w.orders.get('order_1')!.status).toBe('REFUNDED');
    expect(w.bookings.get(res.bookingId!)!.status).toBe('REFUNDED');
    expect((await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'WEBHOOK' }, w.deps)).outcome).toBe('REFUNDED');
  });

  it('a partial refund keeps passes valid and alerts the admin', async () => {
    const w = makeWorld();
    const res = await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'CLIENT' }, w.deps);
    await applyRefund('pay_1', 50000, w.deps);
    expect(w.orders.get('order_1')!.status).toBe('PARTIALLY_REFUNDED');
    expect(w.bookings.get(res.bookingId!)!.status).toBe('CONFIRMED');
    expect(w.alerts.some((a) => a.startsWith('Refund processed'))).toBe(true);
  });

  it('membership refunds are flagged, not silently revoked', async () => {
    const w = makeWorld([makeOrder({ payment_type: 'LIFETIME', cart: null })]);
    await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'CLIENT' }, w.deps);
    await applyRefund('pay_1', 122904, w.deps);
    expect(w.deps.recordLedger).toHaveBeenLastCalledWith(expect.anything(), 'pay_1', 'REFUNDED');
    expect(w.alerts.some((a) => a.startsWith('Refund processed'))).toBe(true);
  });
});
