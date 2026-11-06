import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { checkAdminAccess } from '@/lib/admin';
import { ACCESS_PASS, checkCompDeletable, checkCompRequest, compAdmits, compReservationId, isAccessPass, isCompReservation, type CompCategory } from '@/lib/payments/comp';
import { buildIssuedTickets } from '@/lib/payments/fulfil';
import { reservationMessage, voidTicketNumber } from '@/lib/payments/inventory';
import { fulfilmentDeps, releaseReservation, reserveForCheckout, resendBooking, supabaseAdmin } from '@/lib/payments/server';
import { PaymentInputError, type PaymentOrder } from '@/lib/payments/types';
import { MAX_GROUP_TICKETS_PER_ACCOUNT, MAX_TICKETS_PER_ACCOUNT } from '@/lib/payments/pricing';

export const dynamic = 'force-dynamic';

/**
 * Complimentary passes - real tickets, no payment.
 *
 *   GET    ?eventId=...  the grants already issued for an event
 *   POST   { eventId, guestName, guestEmail, guestPhone, reason, note, items }
 *   DELETE { bookingId }  take a grant back: passes dead, seats returned, register row gone
 *
 * The seats come from the same reservation the public checkout uses, so a comp can never
 * oversell a category and can never be handed a pass number someone has already paid for. If
 * anything after the reservation fails the hold is released again: a guest list is not worth
 * leaving stock stranded until the sweeper notices.
 */

export async function GET(req: Request) {
  const { isAdmin } = await checkAdminAccess();
  if (!isAdmin) return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });

  const eventId = new URL(req.url).searchParams.get('eventId');
  if (!eventId) return NextResponse.json({ error: 'Event is missing.' }, { status: 400 });

  const { data, error } = await supabaseAdmin()
    .from('comp_ticket_grants')
    .select('*')
    .eq('event_id', eventId)
    .order('created_at', { ascending: false })
    .limit(500);

  // A database that has not had the comp migration run yet must not break the dashboard this
  // sits on: the rest of the box office works perfectly well with no grants table.
  if (error) return NextResponse.json({ grants: [], ready: false });
  return NextResponse.json({ grants: data || [], ready: true });
}

/**
 * Make sure this event has an ACCESS PASS category, and return it.
 *
 * Idempotent: called every time the comp form opens, and it must not pile up duplicates. The
 * category is `active` so the reservation will issue from it, and `comp_only` so the public
 * booking page never lists it — without that second flag it would sit on the page at zero
 * rupees and anyone could help themselves.
 */
export async function PUT(req: Request) {
  const { isAdmin, user } = await checkAdminAccess();
  if (!user) return NextResponse.json({ error: 'Please log in.' }, { status: 401 });
  if (!isAdmin) return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });

  try {
    const body = await req.json().catch(() => ({}));
    const eventId = String(body?.eventId || '').trim();
    if (!eventId) return NextResponse.json({ error: 'Event is missing.' }, { status: 400 });

    const db = supabaseAdmin();
    const { data: existing, error: readError } = await db
      .from('event_ticket_categories')
      .select('id, name, prefix, price, capacity, active, group_size, comp_only')
      .eq('event_id', eventId);
    if (readError) {
      if (/comp_only/i.test(readError.message)) {
        return NextResponse.json(
          { error: 'Access passes need a one-time database update first. Run supabase/migrations/20261107_access_pass.sql in Supabase, then try again.' },
          { status: 409 },
        );
      }
      throw new Error(readError.message);
    }

    const found = (existing || []).find((c) => isAccessPass(c as CompCategory));
    if (found) return NextResponse.json({ category: found, created: false });

    const capacity = Math.max(1, Math.min(10_000, Math.floor(Number(body?.capacity)) || ACCESS_PASS.defaultCapacity));
    const { data: created, error: writeError } = await db
      .from('event_ticket_categories')
      .insert({
        event_id: eventId,
        name: ACCESS_PASS.name,
        prefix: ACCESS_PASS.prefix,
        price: ACCESS_PASS.price,
        capacity,
        active: true,
        comp_only: true,
      })
      .select('id, name, prefix, price, capacity, active, group_size, comp_only')
      .single();
    if (writeError) throw new Error(writeError.message);

    return NextResponse.json({ category: created, created: true });
  } catch (e) {
    console.error('[comp] access pass failed:', e);
    return NextResponse.json({ error: 'Could not create the access pass category.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const { isAdmin, user } = await checkAdminAccess();
  if (!user) return NextResponse.json({ error: 'Please log in.' }, { status: 401 });
  if (!isAdmin) return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });

  const db = supabaseAdmin();
  const issuedBy = user.email || user.id;
  let reservationId: string | null = null;

  try {
    const body = await req.json().catch(() => ({}));
    const eventId = String(body?.eventId || '').trim();
    if (!eventId) return NextResponse.json({ error: 'Event is missing.' }, { status: 400 });

    const { data: categories, error: catError } = await db
      .from('event_ticket_categories')
      .select('*')
      .eq('event_id', eventId);
    if (catError) throw new Error(catError.message);

    const clean = checkCompRequest(body, (categories || []) as CompCategory[]);

    // --- Seats ----------------------------------------------------------------------------
    // userId is deliberately null: a comp is issued to a guest by name, not against anyone's
    // account, so the per-account ticket limits do not apply and no loyalty balance moves.
    reservationId = compReservationId(randomUUID());
    const allocations = await reserveForCheckout({
      reservationId,
      userId: null,
      items: clean.lines.map((l) => ({ categoryId: l.categoryId, qty: l.qty })),
      points: 0,
      maxSingle: MAX_TICKETS_PER_ACCOUNT,
      maxGroup: MAX_GROUP_TICKETS_PER_ACCOUNT,
    });

    // Nothing is being paid for, so the hold has no reason to exist past this moment.
    await fulfilmentDeps.confirmReservation(reservationId);

    const tickets = buildIssuedTickets(
      { cart: clean.lines, allocated_tickets: allocations } as unknown as PaymentOrder,
      allocations,
    );

    // If the guest already has an account, hang the booking off it so the passes turn up in
    // their My Tickets alongside anything they bought. Without this the ticket page refuses
    // them (loadOwnedBooking matches on user_id) and the PDF in their inbox is all they have.
    // Note this is the BOOKING's owner only: the seats were reserved with no user, so a comp
    // still does not eat into what that account is allowed to buy.
    const { data: profile } = await db
      .from('profiles')
      .select('id')
      .ilike('email', clean.guestEmail)
      .limit(1)
      .maybeSingle();

    // --- The booking ----------------------------------------------------------------------
    // Same table and same shape as a sold booking, so the gate and the PDF need no special
    // case. The razorpay ids stay null: no money changed hands, and inventing a reference
    // would make the ledger look like it did.
    const { data: booking, error: bookingError } = await db
      .from('ticket_bookings')
      .insert({
        event_id: eventId,
        user_id: profile?.id ?? null,
        email: clean.guestEmail,
        amount_paid: 0,
        razorpay_order_id: null,
        razorpay_payment_id: null,
        tickets_data: tickets,
        status: 'CONFIRMED',
        source: 'COMP',
        issued_by: issuedBy,
      })
      .select('id')
      .single();
    if (bookingError) {
      if (/source|issued_by/i.test(bookingError.message)) {
        throw new PaymentInputError(
          'Complimentary passes need a one-time database update first. Run supabase/migrations/20261106_comp_passes.sql in Supabase, then try again.',
          409,
        );
      }
      throw new Error(bookingError.message);
    }

    const bookingId = booking!.id as string;

    // --- The register ---------------------------------------------------------------------
    // Written after the booking exists so it can never point at passes that were not issued.
    const { error: grantError } = await db.from('comp_ticket_grants').insert({
      booking_id: bookingId,
      event_id: eventId,
      guest_name: clean.guestName,
      guest_email: clean.guestEmail,
      guest_phone: clean.guestPhone,
      reason: clean.reason,
      note: clean.note,
      passes: clean.passes,
      admits: compAdmits(clean.lines),
      face_value: clean.faceValue,
      issued_by: issuedBy,
    });
    // The passes are real and scannable whether or not the register row landed. Throwing away
    // a valid booking over a bookkeeping failure is the worse outcome, so this is logged.
    if (grantError) console.error('[comp] grant row failed:', grantError.message);

    // --- Delivery ---------------------------------------------------------------------------
    // resendBooking already covers a booking with no payment_orders row: it rebuilds the PDF
    // from the booking and the category prices, which is exactly what a comp is.
    const delivery = await resendBooking(bookingId).catch((e) => ({
      status: 'FAILED' as const,
      error: e instanceof Error ? e.message : String(e),
    }));

    return NextResponse.json({
      success: true,
      bookingId,
      passes: tickets.length,
      ticketNumbers: tickets.map((t) => t.ticketNumber),
      admits: compAdmits(clean.lines),
      faceValue: clean.faceValue,
      delivery: delivery.status,
      registered: !grantError,
      linkedToAccount: !!profile?.id,
    });
  } catch (e) {
    // Give the seats straight back. Without this a failed grant holds stock for fifteen
    // minutes, during a sale, which is the one time it cannot be spared.
    if (reservationId) await releaseReservation(reservationId).catch(() => undefined);

    const reservation = reservationMessage(e);
    if (reservation) return NextResponse.json({ error: reservation.message }, { status: reservation.status });
    if (e instanceof PaymentInputError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('[comp] issue failed:', e);
    return NextResponse.json({ error: 'Could not issue those passes. Nothing was given out.' }, { status: 500 });
  }
}


/**
 * Take a grant back.
 *
 * A comp is the one booking an admin creates by hand, so it is the one they will sometimes
 * create wrongly - the wrong guest, the wrong category, a test row left on a live event. There
 * was no way to undo it: the single-pass void button finds its reservation through
 * payment_orders, and a comp has no row there, so it would kill the pass and leave the seat
 * stranded.
 *
 * This deletes the booking outright rather than voiding it, which for a comp is the honest
 * thing: no money moved, so there is no receipt to preserve, and a grant that should not exist
 * should not sit in the register for ever. A SALE is refused here (see checkCompDeletable) -
 * that record has to stay.
 *
 * Order matters, because any step can fail:
 *   1. kill the passes in place   - the gate stops honouring them even if the rest fails
 *   2. hand the numbers back      - a stranded seat is recoverable; a reissued number is not
 *   3. write the audit rows       - scan_log has no foreign key, so it outlives the booking
 *   4. delete the booking         - comp_ticket_grants cascades away with it
 *
 * Doing 4 first would mean a failure at 2 burns the seats with nothing left to find them by.
 * Doing 2 before 1 would mean a failure at 4 leaves a live pass sharing its number with
 * whoever buys next. Safe to run twice: the second run finds nothing to do and still removes
 * the booking.
 */
export async function DELETE(req: Request) {
  const { isAdmin, user } = await checkAdminAccess();
  if (!user) return NextResponse.json({ error: 'Please log in.' }, { status: 401 });
  if (!isAdmin) return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });

  const db = supabaseAdmin();

  try {
    const body = await req.json().catch(() => ({}));
    const bookingId = String(body?.bookingId || '').trim();
    if (!bookingId) return NextResponse.json({ error: 'Which grant? bookingId is missing.' }, { status: 400 });

    const { data: booking, error: readError } = await db
      .from('ticket_bookings')
      .select('id, event_id, email, source, tickets_data, scan_version')
      .eq('id', bookingId)
      .maybeSingle();
    if (readError) throw new Error(readError.message);

    const plan = checkCompDeletable(booking);
    const passes = (booking!.tickets_data || []) as { ticketNumber?: string; status?: string }[];

    // Who it was, read before the cascade takes that row away with the booking.
    const { data: grant } = await db
      .from('comp_ticket_grants')
      .select('guest_name')
      .eq('booking_id', bookingId)
      .maybeSingle();
    const who = (grant as { guest_name?: string } | null)?.guest_name || booking!.email || 'that guest';

    // --- 1. The passes stop working ---------------------------------------------------------
    // Guarded on scan_version so this cannot race the gate: if a volunteer is admitting this
    // very pass, one of the two loses and is told to look again.
    if (plan.live > 0) {
      const dead = passes.map((t) => ({ ...t, status: 'REFUNDED' as const }));
      const { data: written, error: writeError } = await db
        .from('ticket_bookings')
        .update({ tickets_data: dead, scan_version: (booking!.scan_version || 0) + 1 })
        .eq('id', bookingId)
        .eq('scan_version', booking!.scan_version || 0)
        .select('id');
      if (writeError) throw new Error(writeError.message);
      if (!written || written.length !== 1) {
        return NextResponse.json(
          { error: 'Someone scanned or changed this grant a moment ago. Reload and try again.' },
          { status: 409 },
        );
      }
    }

    // --- 2. The seats go back on sale -------------------------------------------------------
    // A comp booking does not store its reservation id anywhere, so it is read off the number
    // row. That read says which seat to free but NOT who should be holding it, so reading an
    // id and handing it straight back to void_ticket_number would make that function's
    // reservation check vacuous - it would free seat (category, number) whoever owns it. If
    // the seat has been resold since (a delete that half-finished, an admin on a stale page)
    // that would take a paying buyer's seat and leave their printed number pointing nowhere.
    // Hence the explicit test: only a comp's own hold may be released from here.
    let seatsFreed = 0;
    const notOurs: string[] = [];
    for (const pass of plan.freeable) {
      const { data: held } = await db
        .from('ticket_numbers')
        .select('reservation_id')
        .eq('category_id', pass.categoryId)
        .eq('number', pass.number)
        .maybeSingle();
      const reservationId = (held as { reservation_id?: string } | null)?.reservation_id;
      if (!reservationId) continue; // already freed, by an earlier attempt or the void button
      if (!isCompReservation(reservationId)) {
        notOurs.push(pass.ticketNumber);
        continue;
      }
      try {
        const freed = await voidTicketNumber(
          { rpc: (fn, args) => db.rpc(fn, args) },
          reservationId,
          pass.categoryId,
          pass.number,
        );
        if (freed) seatsFreed += 1;
      } catch (e) {
        console.error('[comp] seat release failed:', pass.ticketNumber, e);
      }
    }

    // --- 3. The trail -----------------------------------------------------------------------
    // Not 'VOID': that is one pass dying inside a booking that still exists, and reading this
    // log back it matters which happened. Attendance counts ADMIT rows only, so neither
    // disturbs the figures.
    if (plan.live > 0) {
      const { error: logError } = await db.from('scan_log').insert(
        passes
          .filter((t) => String(t?.status || 'ISSUED').toUpperCase() !== 'REFUNDED')
          .map((t) => ({
            booking_id: bookingId,
            ticket_number: String(t?.ticketNumber || ''),
            event_id: booking!.event_id,
            admitted: 0,
            action: 'COMP_DELETE',
            actor_email: user.email ?? null,
            actor_id: user.id,
            actor_role: 'ADMIN',
          })),
      );
      // The grant is still going. Losing the trail is bad; refusing to undo a wrong comp
      // because the trail would not write is worse.
      if (logError) console.error('[comp] delete not logged:', logError.message);
    }

    // --- 4. The record ----------------------------------------------------------------------
    const { error: deleteError } = await db.from('ticket_bookings').delete().eq('id', bookingId);
    if (deleteError) throw new Error(deleteError.message);

    const gone = plan.live + plan.alreadyVoided;
    const notes = [`${gone} pass${gone === 1 ? '' : 'es'} for ${who} deleted`];
    notes.push(seatsFreed > 0 ? `${seatsFreed} seat${seatsFreed === 1 ? '' : 's'} back on sale` : 'no seats needed returning');
    if (notOurs.length > 0) notes.push(`${notOurs.join(', ')} had already been resold, so those seats were left alone`);
    if (plan.unfreeable.length > 0) notes.push(`check capacity by hand for ${plan.unfreeable.join(', ')}`);
    if (plan.admitted > 0) notes.push(`${plan.admitted} had already been scanned in - that stays in the gate log`);

    return NextResponse.json({
      success: true,
      deleted: gone,
      seatsFreed,
      admitted: plan.admitted,
      unfreeable: plan.unfreeable,
      resold: notOurs,
      note: `${notes.join('. ')}.`,
    });
  } catch (e) {
    if (e instanceof PaymentInputError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('[comp] delete failed:', e);
    return NextResponse.json({ error: 'Could not delete that grant. Nothing was changed.' }, { status: 500 });
  }
}
