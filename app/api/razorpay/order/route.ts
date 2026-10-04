import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { razorpay, supabaseAdmin, getEventSnapshot } from '@/lib/payments/server';
import {
  grossUpToPaise,
  martPlanPrice,
  membershipPrice,
  quoteEventCart,
  TicketCategory,
} from '@/lib/payments/pricing';
import { CartLine, EventSnapshot, PaymentInputError, PaymentType } from '@/lib/payments/types';
import { salesStatus } from '@/lib/events/sales';
import { groupSizeOf } from '@/lib/payments/groups';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  return EMAIL_RE.test(v) ? v : null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { paymentType, plan, cart, eventId, pointsToRedeem = 0 } = body;

    const cookieStore = await cookies();
    const supabaseAuth = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { get(name: string) { return cookieStore.get(name)?.value; } } }
    );
    const { data: { user } } = await supabaseAuth.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Please log in to continue.' }, { status: 401 });

    const db = supabaseAdmin();
    const { data: profile } = await db
      .from('profiles')
      .select('email, is_member, loyalty_points, mart_unlocked')
      .eq('id', user.id)
      .maybeSingle();

    const { data: settings, error } = await db.from('app_settings').select('*').limit(1).single();
    if (error) {
      console.error("Failed to fetch settings from DB. Falling back to default pricing.", error.message);
    }

    let type: PaymentType;
    let basePrice: number;
    let martPlan: string | null = null;
    let lines: CartLine[] | null = null;
    let eventSnapshot: EventSnapshot | null = null;
    let pointsApplied = 0;
    let receiptEmail = cleanEmail(body.email) || cleanEmail(body.invoiceEmail) || cleanEmail(profile?.email) || cleanEmail(user.email);

    if (paymentType === 'LIFETIME') {
      if (profile?.is_member) throw new PaymentInputError('You are already a lifetime member.', 409);
      type = 'LIFETIME';
      basePrice = membershipPrice(settings);
    } else if (paymentType === 'MART') {
      if (profile?.is_member) throw new PaymentInputError('Your lifetime membership already includes Mallu Mart.', 409);
      const { data: sub } = await db
        .from('mart_subscriptions')
        .select('plan, status')
        .eq('user_id', user.id)
        .maybeSingle();
      if (sub?.plan === 'LIFETIME' && sub?.status === 'ACTIVE') {
        throw new PaymentInputError('You already have lifetime Mallu Mart access.', 409);
      }
      const quote = martPlanPrice(settings, plan);
      type = 'MART';
      martPlan = quote.plan;
      basePrice = quote.price;
    } else if (paymentType === 'EVENT_TICKET') {
      if (!cart || !eventId || typeof eventId !== 'string') throw new PaymentInputError('Missing ticket data');
      type = 'EVENT_TICKET';

      eventSnapshot = await getEventSnapshot(eventId);
      if (!eventSnapshot) throw new PaymentInputError('Event not found', 404);
      if (salesStatus(eventSnapshot.date, eventSnapshot.time) === 'CLOSED') {
        throw new PaymentInputError('Ticket sales for this event have closed.', 409);
      }

      const { data: categories } = await db.from('event_ticket_categories').select('*').eq('event_id', eventId);
      if (!categories || categories.length === 0) throw new PaymentInputError('Categories not found', 404);

      // Global cap is per ROOT user, not per email.
      const { data: existingBookings } = await db
        .from('ticket_bookings')
        .select('tickets_data, status')
        .eq('event_id', eventId)
        .eq('user_id', user.id);
      // Single tickets and group tickets have separate per-account limits.
      const heldTickets = (existingBookings || [])
        .filter((b) => b.status !== 'REFUNDED')
        .flatMap((b) => (b.tickets_data || []) as { groupSize?: number; status?: string }[])
        .filter((t) => t.status !== 'REFUNDED');
      const previouslyBoughtGroups = heldTickets.filter((t) => groupSizeOf(t.groupSize) > 1).length;
      const previouslyBought = heldTickets.length - previouslyBoughtGroups;

      const quote = quoteEventCart({
        cart,
        categories: categories as TicketCategory[],
        isLoggedIn: true,
        isMember: !!profile?.is_member,
        memberDiscountPercent: eventSnapshot.memberDiscount || 0,
        pointsToRedeem,
        loyaltyBalance: profile?.loyalty_points || 0,
        previouslyBought,
        previouslyBoughtGroups,
      });
      lines = quote.lines;
      pointsApplied = quote.pointsApplied;
      basePrice = quote.total;
      receiptEmail = cleanEmail(body.email) || receiptEmail;
      if (!receiptEmail) throw new PaymentInputError('A valid email is required to deliver your passes.');
    } else {
      // FOOTBALL registration no longer takes payment; anything else is not a product we sell.
      throw new PaymentInputError('Unsupported payment type');
    }

    const amountInPaise = grossUpToPaise(basePrice);
    if (amountInPaise < 100) throw new PaymentInputError('Amount too low (Min ₹1)');

    const order = await razorpay().orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: `rcpt_${type}_${Date.now()}`.slice(0, 40),
      // Notes travel with every webhook, which helps when tracing a payment in the Razorpay dashboard.
      notes: { paymentType: type, plan: martPlan || plan || 'NONE', userId: user.id, eventId: eventId || '' },
    });

    // The server's own record of what this order is for. Fulfilment reads this, never the browser.
    const { error: insertErr } = await db.from('payment_orders').insert({
      razorpay_order_id: order.id,
      user_id: user.id,
      payment_type: type,
      plan: type === 'LIFETIME' ? 'LIFETIME' : martPlan,
      event_id: type === 'EVENT_TICKET' ? eventId : null,
      cart: lines,
      event_snapshot: eventSnapshot,
      points_to_redeem: pointsApplied,
      is_member_at_order: !!profile?.is_member,
      receipt_email: receiptEmail,
      base_amount: basePrice,
      amount_paise: amountInPaise,
      currency: 'INR',
      status: 'CREATED',
    });
    if (insertErr) {
      // Without this row we could not fulfil the payment, so don't let the user pay.
      console.error('PAYMENT_ORDER_RECORD_ERROR:', insertErr);
      return NextResponse.json({ error: 'Could not start checkout. Please try again.' }, { status: 500 });
    }

    return NextResponse.json({ ...order, pointsApplied, baseAmount: basePrice });
  } catch (error: unknown) {
    if (error instanceof PaymentInputError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("RAZORPAY_ORDER_ERROR:", error);
    return NextResponse.json({ error: 'Failed to create order' }, { status: 500 });
  }
}
