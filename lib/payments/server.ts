// Production wiring for the payment engine: Supabase, Razorpay, MongoDB and Resend.
// Route handlers import from here; the logic itself lives in fulfil.ts / delivery.ts.

import Razorpay from 'razorpay';
import { insertBookingWithAmountFallback, insertWithWholeRupeeFallback } from './booking-amount';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ObjectId } from 'mongodb';
import clientPromise from '@/lib/mongodb';
import {
  sendAdminPaymentAlert,
  sendEventTicketEmail,
  sendMartSubscriptionEmail,
  sendPremiumMembershipEmail,
} from '@/lib/mail';
import { BookingInsert, FulfilmentDeps, fulfilOrder } from './fulfil';
import { DeliveryDeps, DeliveryOptions, deliverOrderEmail } from './delivery';
import { nextMartExpiry } from './pricing';
import { fetchLogoBase64, generateTicketPdf } from './ticket-pdf';
import { EventSnapshot, FulfilmentSource, GatewayPayment, PaymentOrder, SoldOutError } from './types';

let _supabase: SupabaseClient | null = null;
export function supabaseAdmin(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  }
  return _supabase;
}

let _razorpay: Razorpay | null = null;
export function razorpay(): Razorpay {
  if (!_razorpay) {
    _razorpay = new Razorpay({
      key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID!,
      key_secret: process.env.RAZORPAY_KEY_SECRET!,
    });
  }
  return _razorpay;
}

export function baseUrl(): string {
  return process.env.NEXT_PUBLIC_BASE_URL || 'https://punerimallus.com';
}

function toGatewayPayment(p: Record<string, unknown>): GatewayPayment {
  return {
    id: String(p.id),
    order_id: String(p.order_id ?? ''),
    status: String(p.status),
    amount: Number(p.amount),
    currency: String(p.currency),
    amount_refunded: p.amount_refunded != null ? Number(p.amount_refunded) : undefined,
    error_description: (p.error_description as string | null) ?? null,
  };
}

async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}

export async function getOrder(orderId: string): Promise<PaymentOrder | null> {
  return must(supabaseAdmin().from('payment_orders').select('*').eq('razorpay_order_id', orderId).maybeSingle());
}

export async function updateOrder(orderId: string, patch: Partial<PaymentOrder>): Promise<void> {
  await must(
    supabaseAdmin()
      .from('payment_orders')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('razorpay_order_id', orderId),
  );
}

export async function getEventSnapshot(eventId: string): Promise<EventSnapshot | null> {
  if (!ObjectId.isValid(eventId)) return null;
  const client = await clientPromise;
  const doc = await client.db('punerimallus').collection('events').findOne({ _id: new ObjectId(eventId) });
  if (!doc) return null;
  return {
    title: doc.title,
    date: doc.date,
    time: doc.time,
    location: doc.location,
    memberPoints: Number(doc.memberPoints) || 0,
    nonMemberPoints: Number(doc.nonMemberPoints) || 0,
    memberDiscount: Number(doc.memberDiscount) || 0,
  };
}

const log = (message: string, extra?: unknown) => console.error(`[payments] ${message}`, extra ?? '');

export const fulfilmentDeps: FulfilmentDeps = {
  getOrder,
  updateOrder,

  async getOrderByPaymentId(paymentId) {
    return must(
      supabaseAdmin().from('payment_orders').select('*').eq('razorpay_payment_id', paymentId).limit(1).maybeSingle(),
    );
  },

  async claimOrder(orderId, staleBefore) {
    const now = new Date().toISOString();
    const rows = await must(
      supabaseAdmin()
        .from('payment_orders')
        .update({ status: 'PROCESSING', processing_started_at: now, updated_at: now })
        .eq('razorpay_order_id', orderId)
        .or(`status.in.(CREATED,FAILED,PAID),and(status.eq.PROCESSING,processing_started_at.lt."${staleBefore.toISOString()}")`)
        .select('*'),
    );
    return (rows as PaymentOrder[] | null)?.[0] ?? null;
  },

  async fetchPayment(paymentId) {
    return toGatewayPayment((await razorpay().payments.fetch(paymentId)) as unknown as Record<string, unknown>);
  },

  async fetchOrderPayments(orderId) {
    const res = await razorpay().orders.fetchPayments(orderId);
    return (res.items as unknown as Record<string, unknown>[]).map(toGatewayPayment);
  },

  async capturePayment(paymentId, amount, currency) {
    try {
      return toGatewayPayment(
        (await razorpay().payments.capture(paymentId, amount, currency)) as unknown as Record<string, unknown>,
      );
    } catch (e) {
      // Someone (Razorpay auto-capture, a parallel call) captured it first. Re-read and carry on.
      const latest = await fulfilmentDeps.fetchPayment(paymentId);
      if (latest.status === 'captured') return latest;
      throw e;
    }
  },

  async allocateTickets(items) {
    const { data, error } = await supabaseAdmin().rpc('allocate_tickets', { p_items: items });
    if (error) {
      const m = /SOLD_OUT:(.*)/.exec(error.message);
      if (m) throw new SoldOutError(m[1].trim());
      throw new Error(error.message);
    }
    return data;
  },

  async upsertBooking(row: BookingInsert) {
    const db = supabaseAdmin();
    const existing = await must(
      db.from('ticket_bookings').select('id').eq('razorpay_order_id', row.razorpay_order_id).limit(1).maybeSingle(),
    );
    if (existing) return (existing as { id: string }).id;
    const { data, error } = await insertBookingWithAmountFallback<BookingInsert, { id: string }>(row, (r) =>
      db.from('ticket_bookings').insert(r).select('id').single(),
    );
    if (error) {
      if (error.code === '23505') {
        const again = await must(
          db.from('ticket_bookings').select('id').eq('razorpay_order_id', row.razorpay_order_id).limit(1).single(),
        );
        return (again as { id: string }).id;
      }
      throw new Error(error.message);
    }
    return data!.id;
  },

  async setBookingStatus(bookingId, status) {
    const db = supabaseAdmin();
    const booking = await must(db.from('ticket_bookings').select('tickets_data').eq('id', bookingId).single());
    const tickets = ((booking as { tickets_data: { status: string }[] | null }).tickets_data || []).map((t) => ({
      ...t,
      status: status === 'REFUNDED' ? 'REFUNDED' : t.status,
    }));
    await must(db.from('ticket_bookings').update({ status, tickets_data: tickets }).eq('id', bookingId));
  },

  async adjustLoyalty(userId, delta) {
    await must(supabaseAdmin().rpc('adjust_loyalty_points', { p_user_id: userId, p_delta: Math.round(delta) }));
  },

  async hasOtherFulfilledMembership(userId, excludingOrderId) {
    const { count, error } = await supabaseAdmin()
      .from('payment_orders')
      .select('razorpay_order_id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('payment_type', 'LIFETIME')
      .eq('status', 'FULFILLED')
      .neq('razorpay_order_id', excludingOrderId);
    if (error) throw new Error(error.message);
    return (count || 0) > 0;
  },

  async activateMembership(order, paymentId) {
    const db = supabaseAdmin();
    await must(db.from('profiles').update({ is_member: true, mart_unlocked: true }).eq('id', order.user_id));
    const updated = await must(
      db.from('memberships').update({ status: 'ACTIVE', payment_id: paymentId }).eq('user_id', order.user_id).select('user_id'),
    );
    if (!updated || (updated as unknown[]).length === 0) {
      await must(
        db.from('memberships').insert({ user_id: order.user_id, email: order.receipt_email, status: 'ACTIVE', payment_id: paymentId }),
      );
    }
  },

  async activateMart(order, paymentId) {
    const db = supabaseAdmin();
    const current = (await must(
      db.from('mart_subscriptions').select('expires_at, last_payment_id, plan').eq('user_id', order.user_id).maybeSingle(),
    )) as { expires_at: string | null; last_payment_id: string | null; plan: string | null } | null;

    // Already applied by an earlier attempt that crashed before marking the order fulfilled.
    if (current?.last_payment_id === paymentId) return;

    const expiresAt = nextMartExpiry(order.plan, current?.expires_at ?? null, new Date());
    await must(
      db.from('mart_subscriptions').upsert(
        {
          user_id: order.user_id,
          plan: order.plan,
          status: 'ACTIVE',
          expires_at: expiresAt ? expiresAt.toISOString() : null,
          last_payment_id: paymentId,
        },
        { onConflict: 'user_id' },
      ),
    );
    await must(db.from('profiles').update({ mart_unlocked: true }).eq('id', order.user_id));
  },

  async recordLedger(order, paymentId, status) {
    const db = supabaseAdmin();
    if (status === 'REFUNDED') {
      await must(db.from('payments').update({ status: 'REFUNDED' }).eq('razorpay_payment_id', paymentId));
      return;
    }
    const existing = await must(
      db.from('payments').select('razorpay_payment_id').eq('razorpay_payment_id', paymentId).limit(1).maybeSingle(),
    );
    if (existing) return;
    const profile = (await must(
      db.from('profiles').select('email, phone_number').eq('id', order.user_id).maybeSingle(),
    )) as { email: string | null; phone_number: string | null } | null;
    const ledgerRow = {
      user_id: order.user_id,
      email: order.receipt_email || profile?.email,
      phone_number: profile?.phone_number || '',
      razorpay_order_id: order.razorpay_order_id,
      razorpay_payment_id: paymentId,
      payment_type: order.payment_type,
      plan: order.plan || 'NONE',
      amount: order.base_amount,
      status: 'SUCCESS',
    };
    const { error: ledgerErr } = await insertWithWholeRupeeFallback(ledgerRow, 'amount', (r) =>
      db.from('payments').insert(r).select('razorpay_payment_id').maybeSingle(),
    );
    if (ledgerErr) throw new Error(ledgerErr.message);
  },

  async alertAdmin(subject, body) {
    await sendAdminPaymentAlert(subject, body);
  },

  log,
  now: () => new Date(),
};

async function buildAndSendTickets(
  bookingId: string,
  to: string,
  tickets: { categoryName: string; ticketNumber: string; unitPrice: number }[],
  event: EventSnapshot | null,
  pointsApplied: number,
  totalAmount: number,
  payment?: { orderId?: string | null; paymentId?: string | null; totalPaidPaise?: number | null; paidAt?: Date | string | null },
) {
  const logo = await fetchLogoBase64(baseUrl());
  const pdf = await generateTicketPdf({
    bookingId,
    purchaserEmail: to,
    event,
    tickets,
    pointsApplied,
    logoBase64: logo,
    baseUrl: baseUrl(),
    payment,
  });
  // The email states what was actually charged (including the gateway fee) when we know it.
  const paid = payment?.totalPaidPaise ? payment.totalPaidPaise / 100 : totalAmount;
  await sendEventTicketEmail(to, bookingId, tickets, paid, pdf, event);
}

export const deliveryDeps: DeliveryDeps = {
  getOrder,
  updateOrder,

  async sendTicketEmail(order, to) {
    const booking = (await must(
      supabaseAdmin().from('ticket_bookings').select('id, tickets_data').eq('id', order.booking_id).single(),
    )) as { id: string; tickets_data: { categoryName: string; ticketNumber: string }[] };
    const priceByName = new Map((order.cart || []).map((l) => [l.name, l.unitPrice]));
    const tickets = (booking.tickets_data || []).map((t) => ({ ...t, unitPrice: priceByName.get(t.categoryName) ?? 0 }));
    await buildAndSendTickets(booking.id, to, tickets, order.event_snapshot, order.points_to_redeem, order.base_amount, {
      orderId: order.razorpay_order_id,
      paymentId: order.razorpay_payment_id,
      totalPaidPaise: order.amount_paise,
      paidAt: order.fulfilled_at,
    });
  },

  async sendMembershipEmail(to, orderId, paymentId) {
    await sendPremiumMembershipEmail(to, orderId, paymentId);
  },

  async sendMartEmail(to, plan, orderId, paymentId) {
    await sendMartSubscriptionEmail(to, plan, orderId, paymentId);
  },

  async markBookingEmail(bookingId, status, attempts, at) {
    await must(
      supabaseAdmin()
        .from('ticket_bookings')
        .update({ email_status: status, email_attempts: attempts, last_emailed_at: at })
        .eq('id', bookingId),
    );
  },

  log,
  now: () => new Date(),
};

/**
 * Fulfil, then send the email. Used by every entry point. Pass `defer` (Next's
 * `after`) from request handlers so the PDF + email run after the response is
 * sent: the browser isn't kept waiting and Razorpay's 5s webhook timeout isn't hit.
 */
export async function fulfilAndDeliver(
  orderId: string,
  paymentId: string | null,
  source: FulfilmentSource,
  opts: { defer?: (task: () => Promise<unknown>) => void } = {},
) {
  const result = await fulfilOrder(orderId, { paymentId, source }, fulfilmentDeps);
  let email: Awaited<ReturnType<typeof deliverOrderEmail>> | null = null;
  if (result.outcome === 'FULFILLED' || result.outcome === 'ALREADY_FULFILLED') {
    const send = () =>
      deliverOrderEmail(orderId, deliveryDeps).catch((e) => {
        log('EMAIL_DELIVERY_CRASH', e);
        return { status: 'FAILED' as const, error: String(e) };
      });
    if (opts.defer) opts.defer(send);
    else email = await send();
  }
  return { ...result, email };
}

export async function resendOrderEmail(orderId: string, opts: DeliveryOptions) {
  return deliverOrderEmail(orderId, deliveryDeps, { force: true, ...opts });
}

/**
 * Resend passes for a booking. Bookings made through the new flow go through
 * their payment_orders row; older bookings are rebuilt from the booking itself.
 */
export async function resendBooking(bookingId: string, opts: { overrideEmail?: string; minIntervalMs?: number } = {}) {
  const db = supabaseAdmin();
  const order = (await must(
    db.from('payment_orders').select('razorpay_order_id').eq('booking_id', bookingId).limit(1).maybeSingle(),
  )) as { razorpay_order_id: string } | null;
  if (order) {
    const res = await resendOrderEmail(order.razorpay_order_id, opts);
    if (res.status === 'SENT' && opts.overrideEmail) {
      await must(db.from('ticket_bookings').update({ email: opts.overrideEmail }).eq('id', bookingId));
    }
    return res;
  }

  const booking = (await must(db.from('ticket_bookings').select('*').eq('id', bookingId).maybeSingle())) as {
    id: string;
    email: string | null;
    event_id: string;
    amount_paid: number;
    status?: string;
    last_emailed_at?: string | null;
    email_attempts?: number;
    tickets_data: { categoryName: string; ticketNumber: string }[];
  } | null;
  if (!booking) return { status: 'NOT_READY' as const };
  if (booking.status === 'REFUNDED') return { status: 'NOT_READY' as const, error: 'Booking was refunded' };
  if (opts.minIntervalMs && booking.last_emailed_at && Date.now() - new Date(booking.last_emailed_at).getTime() < opts.minIntervalMs) {
    return { status: 'RATE_LIMITED' as const };
  }
  const to = (opts.overrideEmail || booking.email || '').trim();
  if (!to) return { status: 'SKIPPED' as const };

  const categories = ((await must(db.from('event_ticket_categories').select('name, price').eq('event_id', booking.event_id))) ||
    []) as { name: string; price: number }[];
  const priceByName = new Map(categories.map((c) => [c.name, c.price]));
  const tickets = (booking.tickets_data || []).map((t) => ({ ...t, unitPrice: priceByName.get(t.categoryName) ?? 0 }));
  const attempts = (booking.email_attempts || 0) + 1;
  const at = new Date().toISOString();
  try {
    await buildAndSendTickets(booking.id, to, tickets, await getEventSnapshot(booking.event_id), 0, booking.amount_paid);
    await deliveryDeps.markBookingEmail(booking.id, 'SENT', attempts, at);
    if (opts.overrideEmail) await must(db.from('ticket_bookings').update({ email: to }).eq('id', booking.id));
    return { status: 'SENT' as const };
  } catch (e) {
    await deliveryDeps.markBookingEmail(booking.id, 'FAILED', attempts, at).catch(() => undefined);
    return { status: 'FAILED' as const, error: e instanceof Error ? e.message : String(e) };
  }
}
