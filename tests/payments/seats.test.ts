import { describe, expect, it } from 'vitest';
import { applyRefund, fulfilOrder } from '@/lib/payments/fulfil';
import { handleWebhookEvent } from '@/lib/payments/webhook';
import { quoteEventCart } from '@/lib/payments/pricing';
import { seatsInUse, seatsLeft } from '@/lib/payments/seats';
import { checkCategoryConfig } from '@/lib/payments/category-config';
import { SoldOutError } from '@/lib/payments/types';
import { checkout, makeOrder, makeWorld, payment } from './fakes';

const vipCart = (qty = 1) => [{ categoryId: 'cat_vip', name: 'VIP', prefix: 'VIP', qty, unitPrice: 500 }];
const buy = (w: ReturnType<typeof makeWorld>, orderId = 'order_1', paymentId = 'pay_1') =>
  fulfilOrder(orderId, { paymentId, source: 'CLIENT' }, w.deps);

/** Reserve at checkout (as /api/razorpay/order does) and then pay. */
async function checkoutAndBuy(w: ReturnType<typeof makeWorld>, orderId = 'order_1', paymentId = 'pay_1') {
  checkout(w, w.orders.get(orderId)!);
  return buy(w, orderId, paymentId);
}

describe('seat counters', () => {
  it('in use is sold minus released, never negative', () => {
    expect(seatsInUse({ sold: 23, released: 5 })).toBe(18);
    expect(seatsInUse({ sold: 3, released: 9 })).toBe(0);
    expect(seatsInUse({ sold: 7 })).toBe(7);
    expect(seatsInUse({ sold: null, released: null })).toBe(0);
    expect(seatsLeft({ capacity: 100, sold: 23, released: 5 })).toBe(82);
    expect(seatsLeft({ capacity: null, sold: 5 })).toBeNull();
  });
});

describe('seats are taken at checkout, before any money moves', () => {
  it('a full cart is held the moment checkout starts', async () => {
    const w = makeWorld(); // VIP 10 in use, General 41
    checkout(w, w.orders.get('order_1')!);
    expect(w.inUse('cat_vip')).toBe(12);
    expect(w.inUse('cat_ga')).toBe(42);
    // Nothing has been paid or issued yet.
    expect(w.bookings.size).toBe(0);
  });

  it('a sold-out category is refused at checkout, so the buyer is never charged', () => {
    const w = makeWorld();
    const first = makeOrder({ razorpay_order_id: 'o_full', cart: vipCart(40) });
    w.orders.set('o_full', first);
    checkout(w, first, { maxSingle: 100 }); // 10 + 40 = 50, the capacity
    expect(w.inUse('cat_vip')).toBe(50);

    const second = makeOrder({ razorpay_order_id: 'o_late', user_id: 'user_2', cart: vipCart(1) });
    w.orders.set('o_late', second);
    // Previously this succeeded, the buyer paid, and only then did they learn it was sold out.
    expect(() => checkout(w, second, { maxSingle: 100 })).toThrow(SoldOutError);
    expect(w.inUse('cat_vip')).toBe(50);
  });

  it('an abandoned checkout gives its seats back when the hold lapses', () => {
    const w = makeWorld();
    const order = makeOrder({ razorpay_order_id: 'o_abandoned', cart: vipCart(5) });
    w.orders.set('o_abandoned', order);
    checkout(w, order);
    expect(w.inUse('cat_vip')).toBe(15);

    w.advance(16 * 60 * 1000);
    expect(w.sweepExpired()).toBe(1);
    expect(w.inUse('cat_vip')).toBe(10);
  });

  it('confirming a payment turns the hold into issued passes without taking more seats', async () => {
    const w = makeWorld();
    await checkoutAndBuy(w);
    expect(w.inUse('cat_vip')).toBe(12);
    expect(w.inUse('cat_ga')).toBe(42);
    expect(w.reservations.get('res_order_1')!.state).toBe('CONFIRMED');
  });
});

describe('refunds give seats back', () => {
  it('a full refund frees exactly the seats the order took', async () => {
    const w = makeWorld();
    await checkoutAndBuy(w);
    expect(w.inUse('cat_vip')).toBe(12);

    await applyRefund('pay_1', 122904, w.deps);
    expect(w.inUse('cat_vip')).toBe(10);
    expect(w.inUse('cat_ga')).toBe(41);
  });

  it('a repeated refund event does not give the seats back twice', async () => {
    const w = makeWorld();
    await checkoutAndBuy(w);
    await applyRefund('pay_1', 122904, w.deps);
    await applyRefund('pay_1', 122904, w.deps);
    await applyRefund('pay_1', 122904, w.deps);
    expect(w.inUse('cat_vip')).toBe(10);
    expect(w.inUse('cat_ga')).toBe(41);
  });

  it('a partial refund keeps the passes valid and the seats taken', async () => {
    const w = makeWorld();
    await checkoutAndBuy(w);
    await applyRefund('pay_1', 50000, w.deps);
    expect(w.inUse('cat_vip')).toBe(12);
    expect(w.inUse('cat_ga')).toBe(42);
  });

  it('a partial refund followed by the rest releases the seats once, at the full refund', async () => {
    const w = makeWorld();
    await checkoutAndBuy(w);
    await applyRefund('pay_1', 50000, w.deps);
    expect(w.inUse('cat_vip')).toBe(12);
    await applyRefund('pay_1', 122904, w.deps);
    expect(w.inUse('cat_vip')).toBe(10);
    expect(w.orders.get('order_1')!.status).toBe('REFUNDED');
  });

  it('an order refunded before any seats were taken releases nothing', async () => {
    const w = makeWorld([makeOrder({ status: 'PAID', razorpay_payment_id: 'pay_1' })]);
    await applyRefund('pay_1', 122904, w.deps);
    expect(w.inUse('cat_vip')).toBe(10);
    expect(w.inUse('cat_ga')).toBe(41);
  });

  it('a sold-out category opens up again once a refund frees seats', async () => {
    const w = makeWorld();
    const first = makeOrder({ razorpay_order_id: 'o1', cart: vipCart(40) });
    w.orders.set('o1', first);
    w.payments.push(payment({ id: 'p1', order_id: 'o1' }));
    checkout(w, first, { maxSingle: 100 });
    await buy(w, 'o1', 'p1');
    expect(w.inUse('cat_vip')).toBe(50);

    const late = makeOrder({ razorpay_order_id: 'o2', user_id: 'user_2', cart: vipCart(2) });
    w.orders.set('o2', late);
    expect(() => checkout(w, late, { maxSingle: 100 })).toThrow(SoldOutError);

    await applyRefund('p1', 122904, w.deps);
    expect(w.inUse('cat_vip')).toBe(10);
    expect(() => checkout(w, late, { maxSingle: 100 })).not.toThrow();
    expect(w.inUse('cat_vip')).toBe(12);
  });

  it('if giving the seats back fails the passes are still voided and the admin is told', async () => {
    const w = makeWorld();
    const res = await checkoutAndBuy(w);
    (w.deps.releaseReservation as unknown as { mockRejectedValueOnce: (e: Error) => void })
      .mockRejectedValueOnce(new Error('connection reset'));
    await applyRefund('pay_1', 122904, w.deps);
    expect(w.bookings.get(res.bookingId!)!.status).toBe('REFUNDED');
    expect(w.orders.get('order_1')!.status).toBe('REFUNDED');
    expect(w.alerts.some((a) => a.startsWith('Refund: seats not released'))).toBe(true);
  });
});

describe('refunds undo loyalty points', () => {
  it('takes back the points the order earned, once', async () => {
    const w = makeWorld(); // buyer starts on 100, earns 10 (non-member)
    await checkoutAndBuy(w);
    expect(w.loyalty.user_1).toBe(110);
    await applyRefund('pay_1', 122904, w.deps);
    expect(w.loyalty.user_1).toBe(100);
    await applyRefund('pay_1', 122904, w.deps);
    expect(w.loyalty.user_1).toBe(100);
  });

  it('gives back points the buyer spent on the order', async () => {
    const w = makeWorld([makeOrder({ points_to_redeem: 30 })]); // earns 10, spends 30: net -20
    await checkoutAndBuy(w);
    expect(w.loyalty.user_1).toBe(80);
    await applyRefund('pay_1', 122904, w.deps);
    expect(w.loyalty.user_1).toBe(100);
    expect(w.loyaltyHeld.user_1 ?? 0).toBe(0);
  });

  it('a partial refund leaves the points alone', async () => {
    const w = makeWorld();
    await checkoutAndBuy(w);
    await applyRefund('pay_1', 50000, w.deps);
    expect(w.loyalty.user_1).toBe(110);
  });

  it('membership refunds do not touch points or seats', async () => {
    const w = makeWorld([makeOrder({ payment_type: 'LIFETIME', cart: null })]);
    await buy(w);
    await applyRefund('pay_1', 122904, w.deps);
    expect(w.deps.claimLoyaltyReversal).not.toHaveBeenCalled();
    expect(w.deps.releaseReservation).not.toHaveBeenCalled();
  });
});

describe('everything that counts seats uses seats in use', () => {
  const cats = (over: Record<string, unknown> = {}) => [{ id: 'c1', name: 'VIP', prefix: 'VIP', price: 500, capacity: 100, sold: 60, released: 0, group_size: 1, active: true, ...over }];
  const quote = (qty: number, over: Record<string, unknown> = {}) =>
    quoteEventCart({ cart: { c1: qty }, categories: cats(over), isLoggedIn: true, isMember: false, memberDiscountPercent: 0, pointsToRedeem: 0, loyaltyBalance: 0, previouslyBought: 0, previouslyBoughtGroups: 0 });

  it('checkout sees freed seats as available', () => {
    expect(quote(3).lines[0].qty).toBe(3);
    expect(() => quote(1, { sold: 100 })).toThrow(/sold out/i);
  });

  it('the legacy sold-minus-released formula still holds for databases mid-migration', () => {
    expect(() => quote(1, { sold: 100, released: 0 })).toThrow(/sold out/i);
    expect(quote(1, { sold: 100, released: 40 }).lines[0].qty).toBe(1);
  });

  it('admin can lower capacity down to the seats really held, not the all-time issued count', () => {
    const existing = [{ id: 'c1', name: 'VIP', sold: 3, released: 0, issued_total: 23 }];
    const row = (capacity: number) => [{ id: 'c1', name: 'VIP', price: 500, prefix: 'VIP', capacity }];
    expect(checkCategoryConfig(row(3), existing)).toMatchObject({ ok: true });
    expect(checkCategoryConfig(row(2), existing)).toMatchObject({ ok: false });
  });

  it('a category that ever issued a pass is taken off sale, not deleted, even when every seat was refunded', () => {
    // `sold` reads 0 now that every pass was refunded; issued_total is what remembers.
    const existing = [{ id: 'c1', name: 'VIP', sold: 0, released: 0, issued_total: 5 }];
    const res = checkCategoryConfig([], existing);
    expect(res).toMatchObject({ ok: true });
    if (res.ok) {
      expect(res.deactivate.map((c) => c.id)).toEqual(['c1']);
      expect(res.remove).toEqual([]);
    }
  });

  it('a category that never issued anything can still be deleted outright', () => {
    const res = checkCategoryConfig([], [{ id: 'c1', name: 'VIP', sold: 0, released: 0, issued_total: 0 }]);
    if (res.ok) {
      expect(res.remove.map((c) => c.id)).toEqual(['c1']);
      expect(res.deactivate).toEqual([]);
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
    await checkoutAndBuy(w);
    expect([w.inUse('cat_vip'), w.inUse('cat_ga'), w.loyalty.user_1]).toEqual([12, 42, 110]);

    await handleWebhookEvent(refundEvent(50000), deps);       // partial: nothing is released
    expect([w.inUse('cat_vip'), w.inUse('cat_ga'), w.loyalty.user_1]).toEqual([12, 42, 110]);

    await handleWebhookEvent(refundEvent(122904), deps);      // the rest: everything comes back
    expect([w.inUse('cat_vip'), w.inUse('cat_ga'), w.loyalty.user_1]).toEqual([10, 41, 100]);

    await handleWebhookEvent(refundEvent(122904), deps);      // Razorpay repeats itself: no change
    expect([w.inUse('cat_vip'), w.inUse('cat_ga'), w.loyalty.user_1]).toEqual([10, 41, 100]);
  });
});

describe('ticket numbers: lowest free number, never a duplicate', () => {
  /** Five buyers take one VIP each, in an empty category. */
  const fiveBuyers = () => {
    const orders = [1, 2, 3, 4, 5].map((i) =>
      makeOrder({ razorpay_order_id: `o${i}`, user_id: `user_${i}`, razorpay_payment_id: null, cart: vipCart(1) }),
    );
    const w = makeWorld(
      orders,
      orders.map((o, i) => payment({ id: `p${i + 1}`, order_id: o.razorpay_order_id })),
      { cat_vip: { capacity: 50, groupSize: 1, eventId: 'evt_1' }, cat_ga: { capacity: 100, groupSize: 1, eventId: 'evt_1' } },
    );
    const numberOf = async (i: number) => {
      const r = await checkoutAndBuy(w, `o${i}`, `p${i}`);
      return w.bookings.get(r.bookingId!)!.tickets_data[0].ticketNumber;
    };
    const addBuyer = (id: string, paymentId: string, qty = 1) => {
      const o = makeOrder({ razorpay_order_id: id, user_id: `user_${id}`, razorpay_payment_id: null, cart: vipCart(qty) });
      w.orders.set(id, o);
      w.payments.push(payment({ id: paymentId, order_id: id }));
      return o;
    };
    return { w, numberOf, addBuyer };
  };

  it('VIP001..VIP005 sold, the last one cancels: the next buyer gets VIP005 again', async () => {
    const { w, numberOf, addBuyer } = fiveBuyers();
    expect([await numberOf(1), await numberOf(2), await numberOf(3), await numberOf(4), await numberOf(5)])
      .toEqual(['VIP001', 'VIP002', 'VIP003', 'VIP004', 'VIP005']);

    await applyRefund('p5', 122904, w.deps);
    addBuyer('o6', 'p6');
    const r = await checkoutAndBuy(w, 'o6', 'p6');
    expect(w.bookings.get(r.bookingId!)!.tickets_data[0].ticketNumber).toBe('VIP005');
  });

  it('a middle ticket cancels: the next buyer gets that number, not VIP006 and not a duplicate', async () => {
    const { w, numberOf, addBuyer } = fiveBuyers();
    for (let i = 1; i <= 5; i++) await numberOf(i);
    await applyRefund('p2', 122904, w.deps);

    addBuyer('o6', 'p6');
    const r = await checkoutAndBuy(w, 'o6', 'p6');
    expect(w.bookings.get(r.bookingId!)!.tickets_data[0].ticketNumber).toBe('VIP002');

    const held = [...w.bookings.values()].filter((b) => b.status !== 'REFUNDED').flatMap((b) => b.tickets_data.map((t) => t.ticketNumber));
    expect(new Set(held).size).toBe(held.length);
    expect(held.sort()).toEqual(['VIP001', 'VIP002', 'VIP003', 'VIP004', 'VIP005']);
  });

  it('a partial refund keeps its numbers held', async () => {
    const { w, numberOf, addBuyer } = fiveBuyers();
    for (let i = 1; i <= 5; i++) await numberOf(i);
    await applyRefund('p3', 50000, w.deps); // partial: the pass is still valid
    addBuyer('o6', 'p6');
    const r = await checkoutAndBuy(w, 'o6', 'p6');
    expect(w.bookings.get(r.bookingId!)!.tickets_data[0].ticketNumber).toBe('VIP006');
  });

  it('a cart of several passes fills the gaps first, in order', async () => {
    const { w, numberOf, addBuyer } = fiveBuyers();
    for (let i = 1; i <= 5; i++) await numberOf(i);
    await applyRefund('p2', 122904, w.deps);
    await applyRefund('p4', 122904, w.deps);
    addBuyer('o6', 'p6', 3);
    const r = await checkoutAndBuy(w, 'o6', 'p6');
    expect(w.bookings.get(r.bookingId!)!.tickets_data.map((t) => t.ticketNumber)).toEqual(['VIP002', 'VIP004', 'VIP006']);
  });

  it('an abandoned checkout does not keep its numbers out of circulation', async () => {
    const { w, addBuyer } = fiveBuyers();
    const abandoned = addBuyer('o_gone', 'p_gone', 2);
    checkout(w, abandoned); // holds VIP001, VIP002 and walks away
    expect(w.inUse('cat_vip')).toBe(2);

    w.advance(16 * 60 * 1000);
    w.sweepExpired();

    addBuyer('o7', 'p7');
    const r = await checkoutAndBuy(w, 'o7', 'p7');
    expect(w.bookings.get(r.bookingId!)!.tickets_data[0].ticketNumber).toBe('VIP001');
  });
});
