import { describe, expect, it } from 'vitest';
import { applyRefund, fulfilOrder } from '@/lib/payments/fulfil';
import { handleWebhookEvent } from '@/lib/payments/webhook';
import { quoteEventCart } from '@/lib/payments/pricing';
import { seatsInUse, seatsLeft } from '@/lib/payments/seats';
import { checkCategoryConfig } from '@/lib/payments/category-config';
import { makeOrder, makeWorld, payment } from './fakes';

const inUse = (w: ReturnType<typeof makeWorld>, id: string) => seatsInUse({ sold: w.sold[id], released: w.released[id] });
const buy = (w: ReturnType<typeof makeWorld>, orderId = 'order_1', paymentId = 'pay_1') => fulfilOrder(orderId, { paymentId, source: 'CLIENT' }, w.deps);

describe('seat counters', () => {
  it('in use is sold minus released, never negative', () => {
    expect(seatsInUse({ sold: 23, released: 5 })).toBe(18);
    expect(seatsInUse({ sold: 3, released: 9 })).toBe(0);
    expect(seatsInUse({ sold: 7 })).toBe(7); // before the seat-release SQL is run
    expect(seatsInUse({ sold: null, released: null })).toBe(0);
    expect(seatsLeft({ capacity: 100, sold: 23, released: 5 })).toBe(82);
    expect(seatsLeft({ capacity: null, sold: 5 })).toBeNull();
  });
});

describe('refunds give seats back', () => {
  it('a full refund frees exactly the seats the order took', async () => {
    const w = makeWorld(); // VIP sold 10, General sold 41
    await buy(w);
    expect(inUse(w, 'cat_vip')).toBe(12);
    expect(inUse(w, 'cat_ga')).toBe(42);

    await applyRefund('pay_1', 122904, w.deps);
    expect(inUse(w, 'cat_vip')).toBe(10);
    expect(inUse(w, 'cat_ga')).toBe(41);
    expect(w.sold.cat_vip).toBe(12); // the number sequence only ever moves forward
  });

  it('a repeated refund event does not give the seats back twice', async () => {
    const w = makeWorld();
    await buy(w);
    await applyRefund('pay_1', 122904, w.deps);
    await applyRefund('pay_1', 122904, w.deps);
    await applyRefund('pay_1', 122904, w.deps);
    expect(inUse(w, 'cat_vip')).toBe(10);
    expect(inUse(w, 'cat_ga')).toBe(41);
  });

  it('a partial refund keeps the passes valid and the seats taken', async () => {
    const w = makeWorld();
    await buy(w);
    await applyRefund('pay_1', 50000, w.deps);
    expect(inUse(w, 'cat_vip')).toBe(12);
    expect(inUse(w, 'cat_ga')).toBe(42);
  });

  it('a partial refund followed by the rest releases the seats once, at the full refund', async () => {
    const w = makeWorld();
    await buy(w);
    await applyRefund('pay_1', 50000, w.deps);
    expect(inUse(w, 'cat_vip')).toBe(12);
    await applyRefund('pay_1', 122904, w.deps);
    expect(inUse(w, 'cat_vip')).toBe(10);
    expect(w.orders.get('order_1')!.status).toBe('REFUNDED');
  });

  it('an order refunded before any seats were taken releases nothing', async () => {
    const w = makeWorld([makeOrder({ status: 'PAID', razorpay_payment_id: 'pay_1' })]);
    await applyRefund('pay_1', 122904, w.deps);
    expect(inUse(w, 'cat_vip')).toBe(10);
    expect(inUse(w, 'cat_ga')).toBe(41);
    expect(w.released.cat_vip).toBe(0);
  });

  it('ticket numbers are never reused after a refund', async () => {
    const second = makeOrder({ razorpay_order_id: 'order_2', razorpay_payment_id: null });
    const w = makeWorld([makeOrder(), second], [payment(), payment({ id: 'pay_2', order_id: 'order_2' })]);
    const first = await buy(w);
    expect(w.bookings.get(first.bookingId!)!.tickets_data.map((t) => t.ticketNumber)).toEqual(['VIP011', 'VIP012', 'GA042']);

    await applyRefund('pay_1', 122904, w.deps);
    const next = await buy(w, 'order_2', 'pay_2');
    const numbers = w.bookings.get(next.bookingId!)!.tickets_data.map((t) => t.ticketNumber);
    expect(numbers).toEqual(['VIP013', 'VIP014', 'GA043']);
    // ...while the refund really did free capacity: 10 + 2 now held by the second buyer.
    expect(inUse(w, 'cat_vip')).toBe(12);
  });

  it('a sold-out category opens up again once a refund frees seats', async () => {
    const second = makeOrder({
      razorpay_order_id: 'order_2',
      razorpay_payment_id: null,
      cart: [{ categoryId: 'cat_vip', name: 'VIP', prefix: 'VIP', qty: 2, unitPrice: 500 }],
    });
    const w = makeWorld([makeOrder(), second], [payment(), payment({ id: 'pay_2', order_id: 'order_2' })]);
    w.sold.cat_vip = 47; // 3 VIP seats left; the first order takes 2 (->49)
    const first = await buy(w);
    expect(first.outcome).toBe('FULFILLED');

    // Only 1 left now, so a 2-seat order is turned away...
    const refused = await buy(w, 'order_2', 'pay_2');
    expect(refused.outcome).toBe('NEEDS_ATTENTION');
    // ...but after the first buyer is refunded their 2 seats are back, and the next 2-seat order goes through.
    await applyRefund('pay_1', 122904, w.deps);
    expect(inUse(w, 'cat_vip')).toBe(47);
    const third = makeOrder({ razorpay_order_id: 'order_3', razorpay_payment_id: null, cart: second.cart });
    w.orders.set('order_3', { ...third });
    w.payments.push(payment({ id: 'pay_3', order_id: 'order_3' }));
    expect((await buy(w, 'order_3', 'pay_3')).outcome).toBe('FULFILLED');
    expect(inUse(w, 'cat_vip')).toBe(49);
  });

  it('if giving the seats back fails (SQL not run yet) the passes are still voided and the admin is told', async () => {
    const w = makeWorld();
    const res = await buy(w);
    (w.deps.releaseSeats as unknown as { mockRejectedValueOnce: (e: Error) => void }).mockRejectedValueOnce(new Error('function release_order_seats does not exist'));
    await applyRefund('pay_1', 122904, w.deps);
    expect(w.bookings.get(res.bookingId!)!.status).toBe('REFUNDED');
    expect(w.orders.get('order_1')!.status).toBe('REFUNDED');
    expect(w.alerts.some((a) => a.startsWith('Refund: seats not released'))).toBe(true);
  });
});

describe('refunds undo loyalty points', () => {
  it('takes back the points the order earned, once', async () => {
    const w = makeWorld(); // buyer starts on 100, earns 10 (non-member)
    await buy(w);
    expect(w.loyalty.user_1).toBe(110);
    await applyRefund('pay_1', 122904, w.deps);
    expect(w.loyalty.user_1).toBe(100);
    await applyRefund('pay_1', 122904, w.deps);
    expect(w.loyalty.user_1).toBe(100);
  });

  it('gives back points the buyer spent on the order', async () => {
    const w = makeWorld([makeOrder({ points_to_redeem: 30 })]); // earns 10, spends 30: net -20
    await buy(w);
    expect(w.loyalty.user_1).toBe(80);
    await applyRefund('pay_1', 122904, w.deps);
    expect(w.loyalty.user_1).toBe(100);
  });

  it('a partial refund leaves the points alone', async () => {
    const w = makeWorld();
    await buy(w);
    await applyRefund('pay_1', 50000, w.deps);
    expect(w.loyalty.user_1).toBe(110);
  });

  it('membership refunds do not touch points', async () => {
    const w = makeWorld([makeOrder({ payment_type: 'LIFETIME', cart: null })]);
    await buy(w);
    await applyRefund('pay_1', 122904, w.deps);
    expect(w.deps.claimLoyaltyReversal).not.toHaveBeenCalled();
    expect(w.deps.releaseSeats).not.toHaveBeenCalled();
  });
});

describe('everything that counts seats uses seats in use', () => {
  const cats = (over: Record<string, unknown> = {}) => [{ id: 'c1', name: 'VIP', prefix: 'VIP', price: 500, capacity: 100, sold: 100, released: 40, group_size: 1, active: true, ...over }];
  const quote = (qty: number, over: Record<string, unknown> = {}) =>
    quoteEventCart({ cart: { c1: qty }, categories: cats(over), isLoggedIn: true, isMember: false, memberDiscountPercent: 0, pointsToRedeem: 0, loyaltyBalance: 0, previouslyBought: 0, previouslyBoughtGroups: 0 });

  it('checkout sees refunded seats as available', () => {
    expect(quote(3).lines[0].qty).toBe(3);
    expect(() => quote(1, { sold: 100, released: 0 })).toThrow(/sold out/i);
  });

  it('without the released column everything behaves exactly as before', () => {
    expect(() => quote(1, { released: undefined })).toThrow(/sold out/i);
    expect(quote(1, { released: undefined, sold: 50 }).lines[0].qty).toBe(1);
  });

  it('admin can lower capacity down to the seats really held, not the all-time sold count', () => {
    const existing = [{ id: 'c1', name: 'VIP', sold: 23, released: 20 }];
    const row = (capacity: number) => [{ id: 'c1', name: 'VIP', price: 500, prefix: 'VIP', capacity }];
    expect(checkCategoryConfig(row(3), existing)).toMatchObject({ ok: true });
    expect(checkCategoryConfig(row(2), existing)).toMatchObject({ ok: false });
  });

  it('a category that ever sold is taken off sale, not deleted, even when every seat was refunded', () => {
    const existing = [{ id: 'c1', name: 'VIP', sold: 5, released: 5 }];
    const res = checkCategoryConfig([], existing);
    expect(res).toMatchObject({ ok: true });
    if (res.ok) {
      expect(res.deactivate.map((c) => c.id)).toEqual(['c1']);
      expect(res.remove).toEqual([]);
    }
  });
});

describe('through the real Razorpay refund notification', () => {
  const refundEvent = (refunded: number) => ({
    event: 'refund.processed',
    payload: {
      refund: { entity: { id: 'rfnd_1', payment_id: 'pay_1', amount: refunded } },
      payment: { entity: { id: 'pay_1', order_id: 'order_1', status: 'captured', amount: 122904, amount_refunded: refunded } },
    },
  });

  it('buy, part-refund, refund the rest, repeat the notice: seats and points end up exactly where they started', async () => {
    const w = makeWorld();
    const deps = { ...w.deps, fulfil: async () => ({ outcome: 'FULFILLED' }) } as never;
    await buy(w);
    expect([inUse(w, 'cat_vip'), inUse(w, 'cat_ga'), w.loyalty.user_1]).toEqual([12, 42, 110]);

    await handleWebhookEvent(refundEvent(50000), deps);       // partial: nothing is released
    expect([inUse(w, 'cat_vip'), inUse(w, 'cat_ga'), w.loyalty.user_1]).toEqual([12, 42, 110]);

    await handleWebhookEvent(refundEvent(122904), deps);      // the rest: everything comes back
    expect([inUse(w, 'cat_vip'), inUse(w, 'cat_ga'), w.loyalty.user_1]).toEqual([10, 41, 100]);

    await handleWebhookEvent(refundEvent(122904), deps);      // Razorpay repeats itself: no change
    expect([inUse(w, 'cat_vip'), inUse(w, 'cat_ga'), w.loyalty.user_1]).toEqual([10, 41, 100]);
  });
});
