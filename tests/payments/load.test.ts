// 100 buyers hitting one event at the same moment.
//
// This is the test that would have caught the worst of the old bugs. It drives the real
// fulfilment engine with 100 distinct accounts competing for deliberately scarce stock, then
// replays each payment from several directions at once (browser handler, webhook, status poll,
// reconcile) exactly as production does, refunds a slice of them, abandons another slice, and
// finally checks invariants that must hold no matter how the hundred requests interleaved:
//
//   * nothing is ever oversold
//   * no two live passes share a number
//   * nobody is charged for a seat they did not get (and nobody keeps money we cannot deliver)
//   * the same loyalty points are never spent twice
//   * duplicated fulfilment never issues a second set of passes
//
// Every await in the fake dependencies is a real interleaving point, so the hundred flows are
// genuinely interleaved rather than run one after another.

import { describe, expect, it } from 'vitest';
import { applyRefund, earnedPoints, fulfilOrder } from '@/lib/payments/fulfil';
import { SoldOutError, PointsUnavailableError, TicketLimitError, PaymentOrder } from '@/lib/payments/types';
import { makeOrder, makeWorld, payment, WorldCategory } from './fakes';

const BUYERS = 100;
/** Deliberately less stock than demand, so the race is real. */
const GA_CAPACITY = 90;
const VIP_CAPACITY = 20;

const CATEGORIES: Record<string, WorldCategory> = {
  cat_ga: { capacity: GA_CAPACITY, groupSize: 1, eventId: 'evt_rush' },
  cat_vip: { capacity: VIP_CAPACITY, groupSize: 1, eventId: 'evt_rush' },
};

/** Deterministic pseudo-randomness, so a failure is reproducible. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

interface Buyer {
  userId: string;
  orderId: string;
  paymentId: string;
  categoryId: string;
  qty: number;
  points: number;
  /** How this buyer's payment gets reported to us. */
  routes: ('CLIENT' | 'WEBHOOK' | 'STATUS_POLL' | 'RECONCILE')[];
  abandons: boolean;
  refunds: boolean;
}

function planBuyers(seed = 20261028): Buyer[] {
  const rand = rng(seed);
  return Array.from({ length: BUYERS }, (_, i) => {
    const r = rand();
    const categoryId = r < 0.3 ? 'cat_vip' : 'cat_ga';
    const qty = 1 + Math.floor(rand() * 3); // 1-3 passes
    const routeRoll = rand();
    const routes: Buyer['routes'] =
      routeRoll < 0.4 ? ['CLIENT', 'WEBHOOK']              // the common case: both arrive
      : routeRoll < 0.6 ? ['WEBHOOK']                       // tab closed
      : routeRoll < 0.75 ? ['CLIENT', 'CLIENT', 'WEBHOOK']  // double-click, then the webhook
      : routeRoll < 0.9 ? ['STATUS_POLL', 'WEBHOOK']        // UPI app, page polled
      : ['RECONCILE'];                                      // everything missed it
    return {
      userId: `user_${i}`,
      orderId: `order_${i}`,
      paymentId: `pay_${i}`,
      categoryId,
      qty,
      points: rand() < 0.25 ? 50 : 0,
      routes,
      abandons: rand() < 0.1,
      refunds: rand() < 0.15,
      ...(undefined as unknown as object),
    };
  });
}

function buildWorld(buyers: Buyer[]) {
  const orders: PaymentOrder[] = buyers.map((b) =>
    makeOrder({
      razorpay_order_id: b.orderId,
      user_id: b.userId,
      event_id: 'evt_rush',
      razorpay_payment_id: null,
      points_to_redeem: b.points,
      base_amount: 500 * b.qty,
      amount_paise: 100 * 500 * b.qty,
      cart: [{ categoryId: b.categoryId, name: b.categoryId === 'cat_vip' ? 'VIP' : 'GENERAL', prefix: b.categoryId === 'cat_vip' ? 'VIP' : 'GA', qty: b.qty, unitPrice: 500 }],
      event_snapshot: { title: 'The Rush', memberPoints: 20, nonMemberPoints: 10 },
    }),
  );
  const payments = buyers.map((b) => payment({ id: b.paymentId, order_id: b.orderId, amount: 100 * 500 * b.qty }));
  const w = makeWorld(orders, payments, CATEGORIES);
  // Everyone starts with points, so redemption is contended too.
  for (const b of buyers) w.loyalty[b.userId] = 100;
  return w;
}

describe(`${BUYERS} buyers at once`, () => {
  it('oversells nothing, duplicates no pass number, and charges nobody for a seat they did not get', async () => {
    const buyers = planBuyers();
    const w = buildWorld(buyers);

    // ---- Phase 1: everyone hits checkout at the same moment -------------------------------
    const reserved: Buyer[] = [];
    const refused: { buyer: Buyer; reason: string }[] = [];

    await Promise.all(
      buyers.map(async (b) => {
        await Promise.resolve(); // let the hundred flows interleave
        try {
          const allocations = w.reserve({
            reservationId: `res_${b.orderId}`,
            userId: b.userId,
            items: [{ categoryId: b.categoryId, qty: b.qty }],
            points: b.points,
            maxSingle: 7,
            maxGroup: 2,
          });
          const order = w.orders.get(b.orderId)!;
          order.reservation_id = `res_${b.orderId}`;
          order.allocated_tickets = allocations;
          reserved.push(b);
        } catch (e) {
          if (e instanceof SoldOutError) refused.push({ buyer: b, reason: 'SOLD_OUT' });
          else if (e instanceof TicketLimitError) refused.push({ buyer: b, reason: 'LIMIT' });
          else if (e instanceof PointsUnavailableError) refused.push({ buyer: b, reason: 'POINTS' });
          else throw e;
        }
      }),
    );

    // Stock is scarce, so somebody must have been turned away — before paying.
    expect(refused.length).toBeGreaterThan(0);
    expect(reserved.length + refused.length).toBe(BUYERS);

    // Nobody who was refused is holding anything.
    for (const { buyer } of refused) {
      expect(w.reservations.has(`res_${buyer.orderId}`)).toBe(false);
      expect(w.orders.get(buyer.orderId)!.reservation_id ?? null).toBeNull();
    }
    // Capacity was never exceeded, even mid-rush.
    expect(w.inUse('cat_ga')).toBeLessThanOrEqual(GA_CAPACITY);
    expect(w.inUse('cat_vip')).toBeLessThanOrEqual(VIP_CAPACITY);

    // ---- Phase 2: the ones who did not abandon pay, and we hear about it from everywhere --
    const paid = reserved.filter((b) => !b.abandons);
    const abandoned = reserved.filter((b) => b.abandons);
    for (const b of abandoned) w.payments.splice(w.payments.findIndex((p) => p.id === b.paymentId), 1);

    await Promise.all(
      paid.flatMap((b) =>
        b.routes.map(async (source) => {
          await Promise.resolve();
          return fulfilOrder(b.orderId, { paymentId: source === 'RECONCILE' || source === 'STATUS_POLL' ? null : b.paymentId, source }, w.deps);
        }),
      ),
    );

    // ---- Phase 3: a slice of them get refunded, some webhooks arriving twice -------------
    const refundedBuyers = paid.filter((b) => b.refunds);
    await Promise.all(
      refundedBuyers.flatMap((b) => [
        applyRefund(b.paymentId, 100 * 500 * b.qty, w.deps),
        applyRefund(b.paymentId, 100 * 500 * b.qty, w.deps), // Razorpay repeats itself
      ]),
    );

    // ---- Phase 4: abandoned holds lapse and go back on sale ------------------------------
    w.advance(16 * 60 * 1000);
    const swept = w.sweepExpired();

    // =======================  Invariants  =================================================

    // 1. Never oversold, at the end as during.
    expect(w.inUse('cat_ga')).toBeLessThanOrEqual(GA_CAPACITY);
    expect(w.inUse('cat_vip')).toBeLessThanOrEqual(VIP_CAPACITY);

    // 2. No two live passes share a number. (The map's own key enforces it; this checks the
    //    bookings the buyers actually hold, which is what is printed on their PDFs.)
    const livePasses = [...w.bookings.values()]
      .filter((bk) => bk.status !== 'REFUNDED')
      .flatMap((bk) => bk.tickets_data.filter((t) => t.status !== 'REFUNDED').map((t) => t.ticketNumber));
    expect(new Set(livePasses).size).toBe(livePasses.length);

    // 3. Every order that paid ended up either delivered or with its money going back. Nothing
    //    is left in a state where we kept the money and issued nothing.
    for (const b of paid) {
      const order = w.orders.get(b.orderId)!;
      expect(['FULFILLED', 'REFUNDED', 'REFUND_INITIATED', 'PARTIALLY_REFUNDED']).toContain(order.status);
      if (order.status === 'FULFILLED') {
        expect(order.booking_id).toBeTruthy();
        const booking = w.bookings.get(order.booking_id!)!;
        expect(booking.tickets_data).toHaveLength(b.qty);
      }
      if (order.status === 'REFUND_INITIATED') {
        // We could not deliver, so the refund must actually have been asked for.
        expect(w.refunds.some((r) => r.paymentId === b.paymentId)).toBe(true);
      }
    }

    // 4. Duplicated fulfilment issued exactly one booking per order.
    const bookingsByOrder = new Map<string, number>();
    for (const bk of w.bookings.values()) {
      bookingsByOrder.set(bk.razorpay_order_id, (bookingsByOrder.get(bk.razorpay_order_id) || 0) + 1);
    }
    for (const count of bookingsByOrder.values()) expect(count).toBe(1);

    // 5. Nobody who abandoned checkout is still holding a seat, and none of them got passes.
    for (const b of abandoned) {
      expect(w.reservations.get(`res_${b.orderId}`)!.state).toBe('RELEASED');
      expect([...w.bookings.values()].some((bk) => bk.razorpay_order_id === b.orderId)).toBe(false);
    }
    expect(swept).toBe(abandoned.length);

    // 6. Loyalty points add up for every single account, and never went negative.
    for (const b of buyers) {
      const order = w.orders.get(b.orderId)!;
      const spent = order.status === 'FULFILLED' ? b.points : 0;
      const earned = order.status === 'FULFILLED' ? earnedPoints(order) : 0;
      expect(w.loyalty[b.userId]).toBe(100 - spent + earned);
      expect(w.loyalty[b.userId]).toBeGreaterThanOrEqual(0);
      // Nothing is left promised to a checkout that is over.
      expect(w.loyaltyHeld[b.userId] ?? 0).toBe(0);
    }

    // 7. Refunded orders gave their seats back and their passes are dead.
    for (const b of refundedBuyers) {
      const order = w.orders.get(b.orderId)!;
      expect(order.status).toBe('REFUNDED');
      expect(w.reservations.get(`res_${b.orderId}`)!.state).toBe('RELEASED');
      if (order.booking_id) expect(w.bookings.get(order.booking_id)!.status).toBe('REFUNDED');
    }

    // 8. Seats in use exactly equal the live passes people hold. No drift either way.
    const expectedInUse = paid
      .filter((b) => w.orders.get(b.orderId)!.status === 'FULFILLED')
      .reduce((sum, b) => sum + b.qty, 0);
    expect(w.inUse('cat_ga') + w.inUse('cat_vip')).toBe(expectedInUse);
    expect(livePasses.length).toBe(expectedInUse);

    // A short report, so the run is legible rather than just green.
    console.log(
      [
        `buyers:            ${BUYERS}`,
        `reserved at once:  ${reserved.length}`,
        `turned away (before paying): ${refused.length} ` +
          `(sold out ${refused.filter((r) => r.reason === 'SOLD_OUT').length}, ` +
          `account cap ${refused.filter((r) => r.reason === 'LIMIT').length}, ` +
          `points held ${refused.filter((r) => r.reason === 'POINTS').length})`,
        `paid:              ${paid.length}`,
        `abandoned:         ${abandoned.length} (holds swept: ${swept})`,
        `refunded:          ${refundedBuyers.length}`,
        `fulfilment calls:  ${paid.reduce((n, b) => n + b.routes.length, 0)} across ${paid.length} orders`,
        `bookings created:  ${w.bookings.size}`,
        `seats in use:      GA ${w.inUse('cat_ga')}/${GA_CAPACITY}, VIP ${w.inUse('cat_vip')}/${VIP_CAPACITY}`,
        `live passes:       ${livePasses.length}`,
      ].join('\n  '),
    );
  });

  it('a hundred buyers chasing the last few seats: exactly the capacity is sold, no more', async () => {
    // One category, 10 seats, 100 people wanting one each. The old code let all 100 pay and then
    // discovered the problem; now 90 are told before any money moves.
    const buyers = Array.from({ length: BUYERS }, (_, i) => ({ userId: `u${i}`, orderId: `o${i}` }));
    const w = makeWorld(
      buyers.map((b) => makeOrder({
        razorpay_order_id: b.orderId, user_id: b.userId, razorpay_payment_id: null, points_to_redeem: 0,
        cart: [{ categoryId: 'cat_tiny', name: 'TINY', prefix: 'T', qty: 1, unitPrice: 100 }],
      })),
      buyers.map((b) => payment({ id: `p_${b.orderId}`, order_id: b.orderId, amount: 122904 })),
      { cat_tiny: { capacity: 10, groupSize: 1, eventId: 'evt_tiny' } },
    );

    let won = 0;
    let lost = 0;
    await Promise.all(
      buyers.map(async (b) => {
        await Promise.resolve();
        try {
          w.reserve({ reservationId: `r_${b.orderId}`, userId: b.userId, items: [{ categoryId: 'cat_tiny', qty: 1 }], maxSingle: 7, maxGroup: 2 });
          won++;
        } catch (e) {
          expect(e).toBeInstanceOf(SoldOutError);
          lost++;
        }
      }),
    );

    expect(won).toBe(10);
    expect(lost).toBe(90);
    expect(w.inUse('cat_tiny')).toBe(10);

    // And the ten winners hold numbers 1..10 with no gaps or repeats.
    const numbers = [...w.numbers.get('cat_tiny')!.keys()].sort((a, b) => a - b);
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('one account opening a hundred tabs cannot get more than its allowance', async () => {
    // The per-account cap used to be checked against committed bookings only, so a user could
    // hold many more than seven by never finishing a checkout.
    const tabs = Array.from({ length: BUYERS }, (_, i) => `tab_${i}`);
    const w = makeWorld(
      [],
      [],
      { cat_big: { capacity: 1000, groupSize: 1, eventId: 'evt_big' } },
    );
    w.loyalty.greedy = 1000;

    let accepted = 0;
    await Promise.all(
      tabs.map(async (id) => {
        await Promise.resolve();
        try {
          w.reserve({ reservationId: id, userId: 'greedy', items: [{ categoryId: 'cat_big', qty: 1 }], maxSingle: 7, maxGroup: 2 });
          accepted++;
        } catch (e) {
          expect(e).toBeInstanceOf(TicketLimitError);
        }
      }),
    );

    expect(accepted).toBe(7);
    expect(w.inUse('cat_big')).toBe(7);
  });

  it('one account spending the same points in a hundred tabs spends them once', async () => {
    const w = makeWorld([], [], { cat_big: { capacity: 1000, groupSize: 1, eventId: 'evt_big' } });
    w.loyalty.saver = 500;

    let accepted = 0;
    await Promise.all(
      Array.from({ length: BUYERS }, (_, i) => `t_${i}`).map(async (id) => {
        await Promise.resolve();
        try {
          w.reserve({ reservationId: id, userId: 'saver', items: [{ categoryId: 'cat_big', qty: 1 }], points: 500, maxSingle: 1000, maxGroup: 2 });
          accepted++;
        } catch (e) {
          expect(e).toBeInstanceOf(PointsUnavailableError);
        }
      }),
    );

    // Exactly one checkout may promise the 500 points.
    expect(accepted).toBe(1);
    expect(w.loyaltyHeld.saver).toBe(500);
    expect(w.loyalty.saver).toBe(500); // not spent until the payment is confirmed
  });
});
