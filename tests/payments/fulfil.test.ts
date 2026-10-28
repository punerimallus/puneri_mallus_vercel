import { describe, expect, it, vi } from 'vitest';
import { applyRefund, fulfilOrder, markOrderFailed } from '@/lib/payments/fulfil';
import { checkout, makeOrder, makeWorld, payment } from './fakes';

/** Checkout then pay, which is the only order of events the system now allows. */
function world(orders = [makeOrder()], payments = [payment()]) {
  const w = makeWorld(orders, payments);
  for (const o of orders) {
    if (o.payment_type === 'EVENT_TICKET' && o.cart && o.status !== 'FULFILLED') checkout(w, o);
  }
  return w;
}

describe('fulfilOrder: event tickets', () => {
  it('issues the reserved passes, a booking and loyalty points for a captured payment', async () => {
    const w = world();
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

  it('records every pass against its category id, so renaming a category cannot orphan it', async () => {
    const w = world();
    const res = await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'CLIENT' }, w.deps);
    const booking = w.bookings.get(res.bookingId!)!;
    expect(booking.tickets_data.map((t) => t.categoryId)).toEqual(['cat_vip', 'cat_vip', 'cat_ga']);
  });

  it('an amount with paise (member discount) is fulfilled even though the booking column is an integer', async () => {
    // Production incident: 1.60 -> 'invalid input syntax for type integer: "1.6"', order paid but never fulfilled.
    const w = world(
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
    const w = world(
      [makeOrder({ base_amount: 1.6, amount_paise: 164, cart: [{ categoryId: 'cat_ga', name: 'General', prefix: 'GA', qty: 1, unitPrice: 1.6 }] })],
      [payment({ amount: 164 })],
    );
    const res = await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'WEBHOOK' }, w.deps);
    expect(res.outcome).toBe('FULFILLED');
    expect(w.bookings.size).toBe(1);
  });

  it('tab closed after paying: the webhook alone delivers the passes', async () => {
    const w = world();
    const res = await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'WEBHOOK' }, w.deps);
    expect(res.outcome).toBe('FULFILLED');
    expect(w.bookings.size).toBe(1);
  });

  it('tab closed and webhook missed: reconcile finds the captured payment without a payment id', async () => {
    const w = world();
    const res = await fulfilOrder('order_1', { source: 'RECONCILE' }, w.deps);
    expect(res.outcome).toBe('FULFILLED');
    expect(w.orders.get('order_1')!.razorpay_payment_id).toBe('pay_1');
  });

  it('browser handler and webhook both arriving: passes are issued exactly once', async () => {
    const w = world();
    const first = await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'CLIENT' }, w.deps);
    const second = await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'WEBHOOK' }, w.deps);
    expect(first.outcome).toBe('FULFILLED');
    expect(second.outcome).toBe('ALREADY_FULFILLED');
    expect(second.bookingId).toBe(first.bookingId);
    expect(w.bookings.size).toBe(1);
    expect(w.loyalty.user_1).toBe(110);
    // The seats were taken once, at checkout, and confirmed once.
    expect(w.inUse('cat_vip')).toBe(12);
  });

  it('simultaneous requests: only one wins the claim', async () => {
    const w = world();
    const results = await Promise.all([
      fulfilOrder('order_1', { paymentId: 'pay_1', source: 'CLIENT' }, w.deps),
      fulfilOrder('order_1', { paymentId: 'pay_1', source: 'WEBHOOK' }, w.deps),
      fulfilOrder('order_1', { source: 'STATUS_POLL' }, w.deps),
    ]);
    expect(results.filter((r) => r.outcome === 'FULFILLED')).toHaveLength(1);
    expect(w.bookings.size).toBe(1);
  });

  it('replaying the verify call (attacker or double click) never issues more passes', async () => {
    const w = world();
    for (let i = 0; i < 5; i++) await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'CLIENT' }, w.deps);
    expect(w.bookings.size).toBe(1);
    expect(w.inUse('cat_vip')).toBe(12);
  });

  it('user closed checkout without paying: nothing is issued and the order stays open', async () => {
    const w = world([makeOrder()], []);
    const res = await fulfilOrder('order_1', { source: 'STATUS_POLL' }, w.deps);
    expect(res.outcome).toBe('NOT_PAID');
    expect(w.orders.get('order_1')!.status).toBe('CREATED');
    expect(w.bookings.size).toBe(0);
  });

  it('failed attempt then successful retry on the same order is fulfilled', async () => {
    const payments = [payment({ id: 'pay_bad', status: 'failed', error_description: 'Card declined' })];
    const w = world([makeOrder()], payments);

    await markOrderFailed('order_1', 'pay_bad', 'Card declined', w.deps);
    expect(w.orders.get('order_1')!.status).toBe('FAILED');

    payments.push(payment({ id: 'pay_good' }));
    const res = await fulfilOrder('order_1', { paymentId: 'pay_good', source: 'WEBHOOK' }, w.deps);
    expect(res.outcome).toBe('FULFILLED');
    expect(w.orders.get('order_1')!.razorpay_payment_id).toBe('pay_good');
  });

  it('a failed payment id still settles if another payment on the order was captured', async () => {
    const w = world([makeOrder()], [payment({ id: 'pay_bad', status: 'failed' }), payment({ id: 'pay_good' })]);
    const res = await fulfilOrder('order_1', { paymentId: 'pay_bad', source: 'WEBHOOK' }, w.deps);
    expect(res.outcome).toBe('FULFILLED');
  });

  it('only-failed payments mark the order FAILED', async () => {
    const w = world([makeOrder()], [payment({ status: 'failed', error_description: 'UPI timeout' })]);
    const res = await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'WEBHOOK' }, w.deps);
    expect(res.outcome).toBe('NOT_PAID');
    expect(w.orders.get('order_1')!.status).toBe('FAILED');
    expect(w.orders.get('order_1')!.status_reason).toBe('UPI timeout');
  });

  it('authorized-but-not-captured payments are captured so Razorpay does not auto-refund them', async () => {
    const w = world([makeOrder()], [payment({ status: 'authorized' })]);
    const res = await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'WEBHOOK' }, w.deps);
    expect(w.deps.capturePayment).toHaveBeenCalledWith('pay_1', 122904, 'INR');
    expect(res.outcome).toBe('FULFILLED');
  });

  it('a payment id belonging to another order is rejected', async () => {
    const w = world([makeOrder()], [payment({ order_id: 'order_other' })]);
    const res = await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'CLIENT' }, w.deps);
    expect(res.outcome).toBe('NOT_PAID');
    expect(w.bookings.size).toBe(0);
  });

  it('a worker that died mid-way is taken over once its claim goes stale', async () => {
    const w = world([makeOrder({ status: 'PROCESSING', processing_started_at: '2026-09-30T10:04:00.000Z' })]);
    expect((await fulfilOrder('order_1', { source: 'RECONCILE' }, w.deps)).outcome).toBe('IN_PROGRESS');
    w.advance(10 * 60 * 1000);
    expect((await fulfilOrder('order_1', { source: 'RECONCILE' }, w.deps)).outcome).toBe('FULFILLED');
  });

  it('a crash mid-fulfilment retries with the SAME seats and numbers', async () => {
    const w = world();
    (w.deps.upsertBooking as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('db down'));

    await expect(fulfilOrder('order_1', { paymentId: 'pay_1', source: 'CLIENT' }, w.deps)).rejects.toThrow('db down');
    expect(w.orders.get('order_1')!.status).toBe('PAID');

    const res = await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'WEBHOOK' }, w.deps);
    expect(res.outcome).toBe('FULFILLED');
    expect(w.inUse('cat_vip')).toBe(12);
    expect(w.bookings.get(res.bookingId!)!.tickets_data[0].ticketNumber).toBe('VIP011');
  });

  it('points earned are credited once; the redeemed ones were already spent by the reservation', async () => {
    const w = world([makeOrder({ points_to_redeem: 60, is_member_at_order: true })]);
    await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'CLIENT' }, w.deps);
    await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'WEBHOOK' }, w.deps);
    expect(w.loyalty.user_1).toBe(100 - 60 + 20);
    expect(w.loyaltyHeld.user_1 ?? 0).toBe(0);
  });

  it('a loyalty failure does not block the passes', async () => {
    const w = world();
    (w.deps.adjustLoyalty as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('rpc missing'));
    const res = await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'CLIENT' }, w.deps);
    expect(res.outcome).toBe('FULFILLED');
  });

  it('event ticket sales reach the ledger too, once', async () => {
    const w = world();
    await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'CLIENT' }, w.deps);
    await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'WEBHOOK' }, w.deps);
    expect(w.deps.recordLedger).toHaveBeenCalledTimes(1);
    expect(w.deps.recordLedger).toHaveBeenCalledWith(expect.anything(), 'pay_1', 'SUCCESS');
  });

  it('unknown orders (e.g. created before this change) are reported, not crashed on', async () => {
    const w = world([]);
    expect((await fulfilOrder('order_x', { paymentId: 'pay_1', source: 'WEBHOOK' }, w.deps)).outcome).toBe('UNKNOWN_ORDER');
  });
});

describe('money we cannot deliver against is refunded, not parked', () => {
  it('an amount mismatch is refunded automatically and the admin told', async () => {
    const w = world([makeOrder()], [payment({ amount: 100 })]);
    const res = await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'WEBHOOK' }, w.deps);

    expect(res.outcome).toBe('REFUND_INITIATED');
    expect(res.reason).toMatch(/AMOUNT_MISMATCH/);
    expect(w.orders.get('order_1')!.status).toBe('REFUND_INITIATED');
    expect(w.orders.get('order_1')!.auto_refund_id).toBe('rfnd_pay_1');
    expect(w.refunds).toHaveLength(1);
    expect(w.alerts[0]).toMatch(/^Auto-refunded/);
    expect(w.bookings.size).toBe(0);
  });

  it('gives the seats straight back when it refunds', async () => {
    const w = world([makeOrder()], [payment({ amount: 100 })]);
    expect(w.inUse('cat_vip')).toBe(12); // reserved at checkout
    await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'WEBHOOK' }, w.deps);
    expect(w.inUse('cat_vip')).toBe(10); // and handed back
  });

  it('falls back to asking a human when the automatic refund itself fails', async () => {
    const w = world([makeOrder()], [payment({ amount: 100 })]);
    w.breakRefunds();
    const res = await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'WEBHOOK' }, w.deps);

    expect(res.outcome).toBe('NEEDS_ATTENTION');
    expect(w.orders.get('order_1')!.status).toBe('NEEDS_ATTENTION');
    expect(w.alerts[0]).toMatch(/^ACTION NEEDED/);
  });

  it('does not refund twice or re-alert when the same event arrives again', async () => {
    const w = world([makeOrder()], [payment({ amount: 100 })]);
    await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'WEBHOOK' }, w.deps);
    const again = await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'RECONCILE' }, w.deps);
    expect(again.outcome).toBe('REFUND_INITIATED');
    expect(w.refunds).toHaveLength(1);
    expect(w.alerts).toHaveLength(1);
  });

  it('a reservation that expired before the payment landed is refunded', async () => {
    const w = world();
    // The buyer took 20 minutes in their UPI app; the hold lapsed and the sweeper took it back.
    w.advance(20 * 60 * 1000);
    expect(w.sweepExpired()).toBe(1);

    const res = await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'WEBHOOK' }, w.deps);
    expect(res.outcome).toBe('REFUND_INITIATED');
    expect(res.reason).toBe('RESERVATION_EXPIRED');
    expect(w.refunds).toHaveLength(1);
    expect(w.bookings.size).toBe(0);
  });

  it('an order with no reservation at all (created before this change) is refunded, not silently dropped', async () => {
    const w = makeWorld(); // no checkout(), so no reservation
    const res = await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'WEBHOOK' }, w.deps);
    expect(res.outcome).toBe('REFUND_INITIATED');
    expect(res.reason).toBe('NO_RESERVATION');
  });
});

describe('fulfilOrder: membership and mart', () => {
  it('activates lifetime membership and records the ledger once', async () => {
    const w = world([makeOrder({ payment_type: 'LIFETIME', plan: 'LIFETIME', cart: null, event_id: null })]);
    await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'CLIENT' }, w.deps);
    await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'WEBHOOK' }, w.deps);
    expect(w.deps.activateMembership).toHaveBeenCalledTimes(1);
    expect(w.deps.recordLedger).toHaveBeenCalledTimes(1);
    expect(w.deps.confirmReservation).not.toHaveBeenCalled();
  });

  it('a second paid lifetime order (two tabs) is refunded automatically', async () => {
    const w = world([
      makeOrder({ razorpay_order_id: 'order_0', payment_type: 'LIFETIME', status: 'FULFILLED', cart: null }),
      makeOrder({ payment_type: 'LIFETIME', cart: null }),
    ]);
    const res = await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'CLIENT' }, w.deps);
    expect(res.outcome).toBe('REFUND_INITIATED');
    expect(res.reason).toBe('DUPLICATE_MEMBERSHIP_PAYMENT');
    expect(w.deps.activateMembership).not.toHaveBeenCalled();
    expect(w.refunds).toHaveLength(1);
  });

  it('activates mart access', async () => {
    const w = world([makeOrder({ payment_type: 'MART', plan: 'YEARLY', cart: null })]);
    const res = await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'CLIENT' }, w.deps);
    expect(res.outcome).toBe('FULFILLED');
    expect(w.deps.activateMart).toHaveBeenCalledTimes(1);
  });
});

describe('refunds', () => {
  it('a full refund voids the passes so they no longer scan', async () => {
    const w = world();
    const res = await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'CLIENT' }, w.deps);
    await applyRefund('pay_1', 122904, w.deps);
    expect(w.orders.get('order_1')!.status).toBe('REFUNDED');
    expect(w.bookings.get(res.bookingId!)!.status).toBe('REFUNDED');
    expect((await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'WEBHOOK' }, w.deps)).outcome).toBe('REFUNDED');
  });

  it('a partial refund keeps passes valid and alerts the admin', async () => {
    const w = world();
    const res = await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'CLIENT' }, w.deps);
    await applyRefund('pay_1', 50000, w.deps);
    expect(w.orders.get('order_1')!.status).toBe('PARTIALLY_REFUNDED');
    expect(w.bookings.get(res.bookingId!)!.status).toBe('CONFIRMED');
    expect(w.alerts.some((a) => a.startsWith('Refund processed'))).toBe(true);
  });

  it('membership refunds are flagged, not silently revoked', async () => {
    const w = world([makeOrder({ payment_type: 'LIFETIME', cart: null })]);
    await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'CLIENT' }, w.deps);
    await applyRefund('pay_1', 122904, w.deps);
    expect(w.deps.recordLedger).toHaveBeenLastCalledWith(expect.anything(), 'pay_1', 'REFUNDED');
    expect(w.alerts.some((a) => a.startsWith('Refund processed'))).toBe(true);
  });

  it('a refund for a payment we have never seen is raised, not quietly swallowed', async () => {
    const w = world();
    // The old code logged a line and reported "handled", so Razorpay never retried and the
    // refund disappeared from our records entirely.
    await expect(applyRefund('pay_unknown', 10000, w.deps)).rejects.toThrow(/REFUND_UNKNOWN_PAYMENT/);
    expect(w.alerts.some((a) => a.includes('do not recognise'))).toBe(true);
  });

  it('finds the order by its order id when the payment id was never recorded', async () => {
    const w = world();
    // Paid, but fulfilment never ran, so razorpay_payment_id is still null on the order.
    const order = await applyRefund('pay_1', 122904, w.deps, 'order_1');
    expect(order?.razorpay_order_id).toBe('order_1');
    expect(w.orders.get('order_1')!.status).toBe('REFUNDED');
  });
});

describe('a refund landing mid-fulfilment cannot be overwritten', () => {
  it('does not stamp FULFILLED over a refund that arrived while we were working', async () => {
    const w = world();
    // The refund webhook lands after the claim but before the final status write.
    (w.deps.upsertBooking as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      const o = w.orders.get('order_1')!;
      o.status = 'REFUNDED';
      o.refunded_amount_paise = 122904;
      return 'booking-raced';
    });

    const res = await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'CLIENT' }, w.deps);

    // Previously the unguarded final write turned this into FULFILLED, leaving a refunded
    // order with live, scannable passes.
    expect(res.outcome).toBe('REFUNDED');
    expect(w.orders.get('order_1')!.status).toBe('REFUNDED');
  });

  it('reports ALREADY_FULFILLED if another worker finished first', async () => {
    const w = world();
    (w.deps.upsertBooking as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      const o = w.orders.get('order_1')!;
      o.status = 'FULFILLED';
      o.booking_id = 'booking-other';
      return 'booking-other';
    });
    const res = await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'CLIENT' }, w.deps);
    expect(res.outcome).toBe('ALREADY_FULFILLED');
    expect(res.bookingId).toBe('booking-other');
  });
});

describe('a booking is never issued with fewer passes than were paid for', () => {
  it('refunds rather than issuing a booking with no passes at all', async () => {
    const w = world();
    // An allocation that lost its numbers: the reservation says 2 seats, but none are recorded.
    w.orders.get('order_1')!.allocated_tickets = [{ categoryId: 'cat_vip', qty: 2, endSold: 12, numbers: [] }];

    const res = await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'WEBHOOK' }, w.deps);

    // Without the guard this produced a FULFILLED order and a PDF containing zero tickets.
    expect(res.outcome).toBe('REFUND_INITIATED');
    expect(res.reason).toMatch(/ALLOCATION_INCOMPLETE/);
    expect(w.bookings.size).toBe(0);
    expect(w.refunds).toHaveLength(1);
  });

  it('refunds when only some of the numbers are recorded', async () => {
    const w = world();
    // Paid for 2, but only one number survived.
    w.orders.get('order_1')!.allocated_tickets = [{ categoryId: 'cat_vip', qty: 2, endSold: 12, numbers: [11] }];

    const res = await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'WEBHOOK' }, w.deps);
    expect(res.outcome).toBe('REFUND_INITIATED');
    expect(res.reason).toMatch(/1 of 2 numbers/);
    expect(w.bookings.size).toBe(0);
  });

  it('issues normally when every seat has its number', async () => {
    const w = world();
    const res = await fulfilOrder('order_1', { paymentId: 'pay_1', source: 'WEBHOOK' }, w.deps);
    expect(res.outcome).toBe('FULFILLED');
    expect(w.bookings.get(res.bookingId!)!.tickets_data).toHaveLength(3);
  });
});
