import { insertBookingWithAmountFallback } from '@/lib/payments/booking-amount';
import { vi } from 'vitest';
import { FulfilmentDeps, BookingInsert } from '@/lib/payments/fulfil';
import { ReserveRequest } from '@/lib/payments/inventory';
import {
  Allocation,
  GatewayPayment,
  OrderStatus,
  PaymentOrder,
  PointsUnavailableError,
  ReservationLostError,
  SoldOutError,
  TicketLimitError,
} from '@/lib/payments/types';

export function makeOrder(overrides: Partial<PaymentOrder> = {}): PaymentOrder {
  return {
    razorpay_order_id: 'order_1',
    razorpay_payment_id: null,
    user_id: 'user_1',
    payment_type: 'EVENT_TICKET',
    plan: null,
    event_id: 'evt_1',
    cart: [
      { categoryId: 'cat_vip', name: 'VIP', prefix: 'VIP', qty: 2, unitPrice: 500 },
      { categoryId: 'cat_ga', name: 'General', prefix: 'GA', qty: 1, unitPrice: 200 },
    ],
    event_snapshot: { title: 'Onam', memberPoints: 20, nonMemberPoints: 10 },
    points_to_redeem: 0,
    is_member_at_order: false,
    receipt_email: 'buyer@example.com',
    base_amount: 1200,
    amount_paise: 122904,
    currency: 'INR',
    status: 'CREATED',
    status_reason: null,
    processing_started_at: null,
    allocated_tickets: null,
    booking_id: null,
    loyalty_applied: false,
    ledger_recorded: false,
    email_status: 'PENDING',
    email_attempts: 0,
    email_error: null,
    last_emailed_at: null,
    fulfilled_via: null,
    fulfilled_at: null,
    refunded_amount_paise: 0,
    created_at: '2026-09-30T10:00:00.000Z',
    ...overrides,
  };
}

export function payment(overrides: Partial<GatewayPayment> = {}): GatewayPayment {
  return { id: 'pay_1', order_id: 'order_1', status: 'captured', amount: 122904, currency: 'INR', ...overrides };
}

interface Reservation {
  reservationId: string;
  userId: string | null;
  eventId: string | null;
  pointsHeld: number;
  state: 'HELD' | 'CONFIRMED' | 'RELEASED';
  expiresAt: number;
}

/** One row of ticket_numbers: who holds it, and what kind of seat it is. */
export interface Seat {
  res: string;
  bundleRef?: string;
  free?: boolean;
}

export interface WorldCategory {
  capacity: number | null;
  eventId: string;
  /** Numbers already printed on passes before this world started. */
  preHeld?: number;
}

/**
 * In-memory stand-in for Supabase + Razorpay.
 *
 * It mirrors the real system's concurrency semantics on purpose: every reservation body runs to
 * completion without awaiting, exactly like the single Postgres transaction it stands for, so a
 * test that interleaves a hundred buyers exercises the application-level races (claim, confirm,
 * refund-vs-fulfil) rather than races the database would never allow.
 */
export function makeWorld(
  initial: PaymentOrder[] = [makeOrder()],
  payments: GatewayPayment[] = [payment()],
  categories: Record<string, WorldCategory> = {
    cat_vip: { capacity: 50, eventId: 'evt_1', preHeld: 10 },
    cat_ga: { capacity: 100, eventId: 'evt_1', preHeld: 41 },
  },
) {
  const orders = new Map(initial.map((o) => [o.razorpay_order_id, { ...o }]));
  const bookings = new Map<string, BookingInsert & { id: string; status: string }>();
  const reservations = new Map<string, Reservation>();
  /**
   * categoryId -> number -> the seat, as ticket_numbers stores it. The number is the unique key
   * of the real table; `bundleRef` and `free` are what the two per-account allowances count.
   */
  const numbers = new Map<string, Map<number, Seat>>();
  const loyalty: Record<string, number> = { user_1: 100 };
  const loyaltyHeld: Record<string, number> = {};
  const alerts: string[] = [];
  const refunds: { paymentId: string; amount: number; reason: string }[] = [];
  let now = new Date('2026-09-30T10:05:00.000Z');
  let nextBookingId = 1;
  let refundShouldFail = false;

  for (const [id, cat] of Object.entries(categories)) {
    const m = new Map<number, Seat>();
    for (let n = 1; n <= (cat.preHeld || 0); n++) m.set(n, { res: `legacy-${id}` });
    numbers.set(id, m);
    if (cat.preHeld) {
      reservations.set(`legacy-${id}`, {
        reservationId: `legacy-${id}`,
        userId: null,
        eventId: cat.eventId,
        pointsHeld: 0,
        state: 'CONFIRMED',
        expiresAt: Infinity,
      });
    }
  }

  const held = (categoryId: string) => numbers.get(categoryId) ?? new Map<number, Seat>();
  /** Seats in use, which is what the `sold` column now reports. */
  const inUse = (categoryId: string) => held(categoryId).size;

  const sweepExpired = () => {
    let n = 0;
    for (const r of [...reservations.values()]) {
      if (r.state === 'HELD' && r.expiresAt < now.getTime()) {
        releaseReservation(r.reservationId);
        n++;
      }
    }
    return n;
  };

  /** Mirrors reserve_order_inventory: one indivisible step, or it throws and changes nothing. */
  function reserve(req: ReserveRequest): Allocation[] {
    if (reservations.has(req.reservationId)) {
      const mine: Allocation[] = [];
      for (const [categoryId, m] of numbers) {
        const ns = [...m.entries()].filter(([, s]) => s.res === req.reservationId).map(([n]) => n).sort((a, b) => a - b);
        if (ns.length) mine.push({ categoryId, qty: ns.length, endSold: inUse(categoryId), numbers: ns });
      }
      return mine;
    }

    const items = req.items.filter((i) => i.qty > 0);
    if (items.length === 0) throw new Error('EMPTY_CART');
    const eventId = categories[items[0].categoryId]?.eventId ?? null;

    // Everything below must either all happen or none of it; build up and only then commit.
    const take: { categoryId: string; ns: number[]; bundleRef?: string; free?: boolean }[] = [];
    for (const i of [...items].sort((a, b) => a.categoryId.localeCompare(b.categoryId))) {
      const cat = categories[i.categoryId];
      if (!cat) throw new Error(`UNKNOWN_CATEGORY:${i.categoryId}`);
      if (cat.eventId !== eventId) throw new Error('MIXED_EVENT_CART');
      const m = held(i.categoryId);
      if (cat.capacity != null && m.size + i.qty > cat.capacity) throw new SoldOutError(i.categoryId);
      const ns: number[] = [];
      for (let n = 1; ns.length < i.qty; n++) if (!m.has(n)) ns.push(n);
      take.push({ categoryId: i.categoryId, ns, bundleRef: i.bundleRef, free: i.free === true });
    }

    // Per-account limits, counted over held AND issued, exactly like the SQL.
    if (req.userId && eventId) {
      let singles = 0;
      const bundleRefs = new Set<string>();
      const countSeat = (seat: Pick<Seat, 'bundleRef' | 'free'>) => {
        if (seat.bundleRef) bundleRefs.add(seat.bundleRef);
        else if (!seat.free) singles += 1;
      };
      for (const [categoryId, m] of numbers) {
        if (categories[categoryId]?.eventId !== eventId) continue;
        for (const [, seat] of m) {
          const r = reservations.get(seat.res);
          if (r?.userId === req.userId) countSeat(seat);
        }
      }
      for (const t of take) t.ns.forEach(() => countSeat(t));
      if (singles > req.maxSingle) throw new TicketLimitError('SINGLE', req.maxSingle);
      const maxBundles = req.maxBundles ?? 2;
      if (bundleRefs.size > maxBundles) throw new TicketLimitError('BUNDLES', maxBundles);
    }

    const points = Math.max(0, Math.floor(req.points || 0));
    if (points > 0) {
      if (!req.userId) throw new PointsUnavailableError(0);
      const available = Math.max(0, (loyalty[req.userId] || 0) - (loyaltyHeld[req.userId] || 0));
      if (available < points) throw new PointsUnavailableError(available);
    }

    // Commit.
    reservations.set(req.reservationId, {
      reservationId: req.reservationId,
      userId: req.userId,
      eventId,
      pointsHeld: points,
      state: 'HELD',
      expiresAt: now.getTime() + (req.ttlSeconds ?? 900) * 1000,
    });
    if (points > 0 && req.userId) loyaltyHeld[req.userId] = (loyaltyHeld[req.userId] || 0) + points;

    const out: Allocation[] = [];
    for (const t of take) {
      const m = held(t.categoryId);
      t.ns.forEach((n) => m.set(n, { res: req.reservationId, bundleRef: t.bundleRef, free: t.free }));
      numbers.set(t.categoryId, m);
      out.push({ categoryId: t.categoryId, qty: t.ns.length, endSold: m.size, numbers: t.ns });
    }
    return out;
  }

  function confirmReservation(reservationId: string) {
    const r = reservations.get(reservationId);
    if (!r) throw new ReservationLostError(reservationId);
    if (r.state === 'CONFIRMED') return { alreadyConfirmed: true, pointsSpent: r.pointsHeld };
    if (r.state === 'RELEASED') throw new ReservationLostError(reservationId);
    r.state = 'CONFIRMED';
    if (r.pointsHeld > 0 && r.userId) {
      loyalty[r.userId] = Math.max(0, (loyalty[r.userId] || 0) - r.pointsHeld);
      loyaltyHeld[r.userId] = Math.max(0, (loyaltyHeld[r.userId] || 0) - r.pointsHeld);
    }
    return { alreadyConfirmed: false, pointsSpent: r.pointsHeld };
  }

  function releaseReservation(reservationId: string): number {
    const r = reservations.get(reservationId);
    if (!r || r.state === 'RELEASED') return 0;
    let freed = 0;
    for (const [, m] of numbers) {
      for (const [n, seat] of [...m.entries()]) {
        if (seat.res === reservationId) {
          m.delete(n);
          freed++;
        }
      }
    }
    if (r.pointsHeld > 0 && r.userId) {
      if (r.state === 'CONFIRMED') loyalty[r.userId] = (loyalty[r.userId] || 0) + r.pointsHeld;
      else loyaltyHeld[r.userId] = Math.max(0, (loyaltyHeld[r.userId] || 0) - r.pointsHeld);
    }
    r.state = 'RELEASED';
    return freed;
  }

  const deps: FulfilmentDeps = {
    getOrder: vi.fn(async (id: string) => (orders.has(id) ? { ...orders.get(id)! } : null)),
    getOrderByPaymentId: vi.fn(async (pid: string) => {
      const o = [...orders.values()].find((x) => x.razorpay_payment_id === pid);
      return o ? { ...o } : null;
    }),
    claimOrder: vi.fn(async (id: string, staleBefore: Date) => {
      const o = orders.get(id);
      if (!o) return null;
      const stale = o.status === 'PROCESSING' && o.processing_started_at && new Date(o.processing_started_at) < staleBefore;
      if (!['CREATED', 'FAILED', 'PAID'].includes(o.status) && !stale) return null;
      o.status = 'PROCESSING';
      o.processing_started_at = now.toISOString();
      return { ...o };
    }),
    updateOrder: vi.fn(async (id: string, patch: Partial<PaymentOrder>) => {
      Object.assign(orders.get(id)!, patch);
    }),
    updateOrderIfStatus: vi.fn(async (id: string, expected: OrderStatus[], patch: Partial<PaymentOrder>) => {
      const o = orders.get(id);
      if (!o || !expected.includes(o.status)) return false;
      Object.assign(o, patch);
      return true;
    }),
    fetchPayment: vi.fn(async (pid: string) => {
      const p = payments.find((x) => x.id === pid);
      if (!p) throw new Error('payment not found');
      return { ...p };
    }),
    fetchOrderPayments: vi.fn(async (oid: string) => payments.filter((p) => p.order_id === oid).map((p) => ({ ...p }))),
    capturePayment: vi.fn(async (pid: string) => {
      const p = payments.find((x) => x.id === pid)!;
      p.status = 'captured';
      return { ...p };
    }),
    refundPayment: vi.fn(async (paymentId: string, amount: number, reason: string) => {
      if (refundShouldFail) throw new Error('razorpay refund unavailable');
      // Idempotent per payment, like a receipt-keyed refund.
      const existing = refunds.find((r) => r.paymentId === paymentId);
      if (existing) return { id: `rfnd_${paymentId}` };
      refunds.push({ paymentId, amount, reason });
      return { id: `rfnd_${paymentId}` };
    }),
    confirmReservation: vi.fn(async (reservationId: string) => confirmReservation(reservationId)),
    releaseReservation: vi.fn(async (reservationId: string) => releaseReservation(reservationId)),
    // Behaves like production: ticket_bookings.amount_paid is an INTEGER column, so a fractional amount is
    // rejected exactly as Postgres does ("invalid input syntax for type integer"). Goes through the same
    // fallback the real wiring uses, so a regression to a plain insert fails the tests.
    upsertBooking: vi.fn(async (row: BookingInsert) => {
      const existing = [...bookings.values()].find((b) => b.razorpay_order_id === row.razorpay_order_id);
      if (existing) return existing.id;
      const { data, error } = await insertBookingWithAmountFallback<BookingInsert, { id: string }>(row, async (r) => {
        if (!Number.isInteger(r.amount_paid)) {
          return { data: null, error: { message: `invalid input syntax for type integer: "${r.amount_paid}"`, code: '22P02' } };
        }
        const id = `booking-${nextBookingId++}`;
        bookings.set(id, { ...r, id, status: 'CONFIRMED' });
        return { data: { id }, error: null };
      });
      if (error || !data) throw new Error(error?.message || 'insert failed');
      return data.id;
    }),
    setBookingStatus: vi.fn(async (id: string, status: 'CONFIRMED' | 'REFUNDED') => {
      const b = bookings.get(id);
      if (!b) throw new Error(`booking ${id} not found`);
      b.status = status;
    }),
    adjustLoyalty: vi.fn(async (uid: string, delta: number) => {
      loyalty[uid] = Math.max(0, (loyalty[uid] || 0) + delta);
    }),
    claimLoyaltyReversal: vi.fn(async (orderId: string) => {
      const o = orders.get(orderId);
      if (!o || !o.loyalty_applied || o.loyalty_reversed) return false;
      o.loyalty_reversed = true;
      return true;
    }),
    hasOtherFulfilledMembership: vi.fn(async (uid: string, exclude: string) =>
      [...orders.values()].some((o) => o.user_id === uid && o.payment_type === 'LIFETIME' && o.status === 'FULFILLED' && o.razorpay_order_id !== exclude),
    ),
    activateMembership: vi.fn(async () => undefined),
    activateMart: vi.fn(async () => undefined),
    recordLedger: vi.fn(async () => undefined),
    alertAdmin: vi.fn(async (subject: string) => {
      alerts.push(subject);
    }),
    log: vi.fn(),
    now: () => now,
  };

  return {
    deps,
    orders,
    bookings,
    reservations,
    numbers,
    loyalty,
    loyaltyHeld,
    alerts,
    refunds,
    payments,
    categories,
    inUse,
    /** The checkout-time reservation, as /api/razorpay/order performs it. */
    reserve,
    releaseReservation,
    sweepExpired,
    /** Make the next automatic refund fail, to test the fallback to "a human must look". */
    breakRefunds(broken = true) {
      refundShouldFail = broken;
    },
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
  };
}

/**
 * Set up an order the way checkout now does: reserve first, then record what was reserved on
 * the order. Returns the reservation id.
 */
export function checkout(
  world: ReturnType<typeof makeWorld>,
  order: PaymentOrder,
  opts: { points?: number; maxSingle?: number; maxBundles?: number; ttlSeconds?: number } = {},
): string {
  const reservationId = `res_${order.razorpay_order_id}`;
  const allocations = world.reserve({
    reservationId,
    userId: order.user_id,
    items: (order.cart || []).map((l) => ({ categoryId: l.categoryId, qty: l.qty })),
    points: opts.points ?? order.points_to_redeem ?? 0,
    ttlSeconds: opts.ttlSeconds,
    maxSingle: opts.maxSingle ?? 7,
  });
  const stored = world.orders.get(order.razorpay_order_id);
  if (stored) {
    stored.reservation_id = reservationId;
    stored.allocated_tickets = allocations;
  }
  return reservationId;
}
