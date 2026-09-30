import { vi } from 'vitest';
import { FulfilmentDeps, BookingInsert } from '@/lib/payments/fulfil';
import { Allocation, GatewayPayment, PaymentOrder, SoldOutError } from '@/lib/payments/types';

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

/** In-memory stand-in for Supabase + Razorpay with the same concurrency semantics as the real claim. */
export function makeWorld(initial: PaymentOrder[] = [makeOrder()], payments: GatewayPayment[] = [payment()]) {
  const orders = new Map(initial.map((o) => [o.razorpay_order_id, { ...o }]));
  const bookings = new Map<string, BookingInsert & { id: string; status: string }>();
  const sold: Record<string, number> = { cat_vip: 10, cat_ga: 41 };
  const capacity: Record<string, number> = { cat_vip: 50, cat_ga: 100 };
  const loyalty: Record<string, number> = { user_1: 100 };
  const alerts: string[] = [];
  let now = new Date('2026-09-30T10:05:00.000Z');
  let nextBookingId = 1;

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
    allocateTickets: vi.fn(async (items: { categoryId: string; qty: number }[]) => {
      for (const i of items) {
        if (sold[i.categoryId] + i.qty > capacity[i.categoryId]) throw new SoldOutError(i.categoryId);
      }
      return items.map((i): Allocation => {
        sold[i.categoryId] += i.qty;
        return { categoryId: i.categoryId, qty: i.qty, endSold: sold[i.categoryId] };
      });
    }),
    upsertBooking: vi.fn(async (row: BookingInsert) => {
      const existing = [...bookings.values()].find((b) => b.razorpay_order_id === row.razorpay_order_id);
      if (existing) return existing.id;
      const id = `booking-${nextBookingId++}`;
      bookings.set(id, { ...row, id, status: 'CONFIRMED' });
      return id;
    }),
    setBookingStatus: vi.fn(async (id: string, status: 'CONFIRMED' | 'REFUNDED') => {
      const b = bookings.get(id);
      if (!b) throw new Error(`booking ${id} not found`);
      b.status = status;
    }),
    adjustLoyalty: vi.fn(async (uid: string, delta: number) => {
      loyalty[uid] = Math.max(0, (loyalty[uid] || 0) + delta);
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
    sold,
    capacity,
    loyalty,
    alerts,
    payments,
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
  };
}
