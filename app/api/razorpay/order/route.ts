import { getRequestUser } from '@/lib/admin';
import { NextResponse } from 'next/server';
import { razorpay, supabaseAdmin, getEventSnapshot, reserveForCheckout, releaseReservation } from '@/lib/payments/server';
import {
  grossUpToPaise,
  martPlanPrice,
  membershipPrice,
  quoteEventCart,
  MAX_GROUP_TICKETS_PER_ACCOUNT,
  MAX_TICKETS_PER_ACCOUNT,
  TicketCategory,
} from '@/lib/payments/pricing';
import { CartLine, EventSnapshot, PaymentInputError, PaymentType } from '@/lib/payments/types';
import { HOLD_TTL_SECONDS, reservationMessage } from '@/lib/payments/inventory';
import { asMarkerDb, checkSchema, SCHEMA_BEHIND_MESSAGE } from '@/lib/payments/schema-check';
import { RATE_RULES, rateKey, rateLimit } from '@/lib/rate-limit';
import { salesStatus } from '@/lib/events/sales';
import { isOldEnough } from '@/lib/dob';
import { groupSizeOf } from '@/lib/payments/groups';
import { normalizeWhatsAppNumber, whatsappEnabled } from '@/lib/whatsapp';
import { randomUUID } from 'crypto';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  return EMAIL_RE.test(v) ? v : null;
}

export async function POST(req: Request) {
  // Tracked outside the try so a failure anywhere after reserving can hand the seats back.
  let reservationId: string | null = null;

  try {
    const body = await req.json();
    const { paymentType, plan, cart, eventId, pointsToRedeem = 0 } = body;

    const user = await getRequestUser();
    if (!user) return NextResponse.json({ error: 'Please log in to continue.' }, { status: 401 });

    // Stops a script minting Razorpay orders (and reservation rows) in a loop.
    const limit = rateLimit(rateKey('createOrder', user.id, req), RATE_RULES.createOrder);
    if (!limit.ok) {
      return NextResponse.json(
        { error: 'Too many checkout attempts. Please wait a moment and try again.' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
      );
    }

    const db = supabaseAdmin();

    // Refuse to take money at all if the database is behind the code, rather than running in a
    // half-working mode where seats are not really reserved.
    const schema = await checkSchema(asMarkerDb(db));
    if (!schema.ok) {
      console.error('SCHEMA_BEHIND:', schema.error);
      return NextResponse.json({ error: SCHEMA_BEHIND_MESSAGE }, { status: 503 });
    }

    const { data: profile } = await db
      .from('profiles')
      .select('email, is_member, loyalty_points, loyalty_points_held, mart_unlocked, phone_number, dob')
      .eq('id', user.id)
      .maybeSingle();

    // Pricing comes from app_settings. If we cannot read it we must NOT fall back to the
    // hardcoded defaults: that would quietly sell at the wrong price and bypass the admin's
    // "membership closed" switch. Refuse instead.
    const { data: settings, error: settingsErr } = await db.from('app_settings').select('*').limit(1).single();
    if (settingsErr || !settings) {
      console.error('APP_SETTINGS_UNREADABLE:', settingsErr?.message);
      return NextResponse.json(
        { error: 'Checkout is briefly unavailable (could not read current pricing). Nothing has been charged.' },
        { status: 503 },
      );
    }

    let type: PaymentType;
    let basePrice: number;
    let martPlan: string | null = null;
    let lines: CartLine[] | null = null;
    let eventSnapshot: EventSnapshot | null = null;
    let pointsApplied = 0;
    let allocations: unknown = null;
    // WhatsApp copy of the tickets: only when the buyer opted in, the feature is configured, and the profile has a valid mobile.
    // The number always comes from the verified profile phone, never from the request.
    const whatsappTo = body.whatsappOptIn === true && whatsappEnabled() ? normalizeWhatsAppNumber(profile?.phone_number) : null;
    const whatsappFields = paymentType === 'EVENT_TICKET' && whatsappTo ? { whatsapp_opt_in: true, whatsapp_to: whatsappTo } : {};
    let receiptEmail = cleanEmail(body.email) || cleanEmail(body.invoiceEmail) || cleanEmail(profile?.email) || cleanEmail(user.email);

    if (paymentType === 'LIFETIME') {
      if (profile?.is_member) throw new PaymentInputError('You are already a lifetime member.', 409);
      // Admin switch (Admin → Payments). Hiding the button is not enough: the server refuses new orders too.
      if (settings?.membership_enabled === false) {
        throw new PaymentInputError('Membership sign-ups are closed right now. Please check back soon.', 403);
      }
      // Membership is for ages 16 and over. The sign-up and membership forms already ask for a birth date; this makes the
      // rule hold even if someone skips the form and calls the API directly.
      if (!isOldEnough(profile?.dob)) {
        throw new PaymentInputError('Membership is open from age 16. Please add a valid birth date in your profile first.', 403);
      }
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

      const sales = salesStatus(eventSnapshot.date, eventSnapshot.time);
      if (sales === 'CLOSED') {
        throw new PaymentInputError('Ticket sales for this event have closed.', 409);
      }
      // An unreadable date used to leave sales open forever. Fail closed and make it visible.
      if (sales === 'UNKNOWN') {
        console.error('EVENT_DATE_UNPARSEABLE:', { eventId, date: eventSnapshot.date, time: eventSnapshot.time });
        throw new PaymentInputError('This event is not open for booking yet. Please contact us if you think this is wrong.', 409);
      }

      const { data: categories } = await db.from('event_ticket_categories').select('*').eq('event_id', eventId);
      if (!categories || categories.length === 0) throw new PaymentInputError('Categories not found', 404);

      // A fast, friendly pre-check against what this account already has. The real limit is
      // enforced inside the reservation, which also counts passes being held by another open
      // checkout — two tabs can no longer both slip past it.
      const { data: existingBookings } = await db
        .from('ticket_bookings')
        .select('tickets_data, status')
        .eq('event_id', eventId)
        .eq('user_id', user.id);
      const heldTickets = (existingBookings || [])
        .filter((b) => b.status !== 'REFUNDED')
        .flatMap((b) => (b.tickets_data || []) as { groupSize?: number; status?: string }[])
        .filter((t) => t.status !== 'REFUNDED');
      const previouslyBoughtGroups = heldTickets.filter((t) => groupSizeOf(t.groupSize) > 1).length;
      const previouslyBought = heldTickets.length - previouslyBoughtGroups;

      // Points already promised to another open checkout of theirs are not available here.
      const availablePoints = Math.max(0, (profile?.loyalty_points || 0) - (profile?.loyalty_points_held || 0));

      const quote = quoteEventCart({
        cart,
        categories: categories as TicketCategory[],
        isLoggedIn: true,
        isMember: !!profile?.is_member,
        memberDiscountPercent: eventSnapshot.memberDiscount || 0,
        pointsToRedeem,
        loyaltyBalance: availablePoints,
        previouslyBought,
        previouslyBoughtGroups,
      });
      lines = quote.lines;
      pointsApplied = quote.pointsApplied;
      basePrice = quote.total;
      receiptEmail = cleanEmail(body.email) || receiptEmail;
      if (!receiptEmail) throw new PaymentInputError('A valid email is required to deliver your passes.');

      // THE important change: take the seats, the ticket numbers and the points now, before the
      // buyer is sent to Razorpay. If this throws, nobody has been charged a paisa.
      reservationId = randomUUID();
      allocations = await reserveForCheckout({
        reservationId,
        userId: user.id,
        items: lines.map((l) => ({ categoryId: l.categoryId, qty: l.qty })),
        points: pointsApplied,
        ttlSeconds: HOLD_TTL_SECONDS,
        maxSingle: MAX_TICKETS_PER_ACCOUNT,
        maxGroup: MAX_GROUP_TICKETS_PER_ACCOUNT,
      });
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
    const orderRow = {
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
      reservation_id: reservationId,
      allocated_tickets: allocations,
      ...whatsappFields,
    };
    const { error: insertErr } = await db.from('payment_orders').insert(orderRow);
    if (insertErr) {
      // Without this row we could not fulfil the payment, so don't let the user pay.
      console.error('PAYMENT_ORDER_RECORD_ERROR:', insertErr);
      return NextResponse.json({ error: 'Could not start checkout. Please try again.' }, { status: 500 });
    }

    reservationId = null; // Handed over to the order; no longer ours to roll back.

    return NextResponse.json({
      ...order,
      pointsApplied,
      baseAmount: basePrice,
      /** When the held seats are given back if the payment never completes. */
      holdExpiresAt: type === 'EVENT_TICKET' ? new Date(Date.now() + HOLD_TTL_SECONDS * 1000).toISOString() : undefined,
    });
  } catch (error: unknown) {
    // Anything that went wrong after reserving must give the seats and points straight back,
    // or an abandoned attempt would hold inventory until the sweeper caught up.
    if (reservationId) {
      await releaseReservation(reservationId).catch((e) => console.error('RESERVATION_ROLLBACK_FAILED:', e));
    }

    // Sold out / per-account limit / points held elsewhere: all expected, all before payment.
    const expected = reservationMessage(error);
    if (expected) return NextResponse.json({ error: expected.message }, { status: expected.status });

    if (error instanceof PaymentInputError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('RAZORPAY_ORDER_ERROR:', error);
    return NextResponse.json({ error: 'Failed to create order' }, { status: 500 });
  }
}
