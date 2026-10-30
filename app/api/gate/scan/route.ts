import { NextResponse } from 'next/server';
import { checkAdminAccess } from '@/lib/admin';
import { applyScan, lookupTicket, ScanTicket } from '@/lib/payments/scan';
import { loadBookingView, supabaseAdmin } from '@/lib/payments/server';
import { canScanEvent, partialAdmitAllowed, resolveGateActor, StaffDb } from '@/lib/payments/staff';
import { unsignedPassesAllowed, verifyTicketSignature } from '@/lib/payments/ticket-signature';
import { eventDay, scanWindow } from '@/lib/events/sales';
import { RATE_RULES, rateKey, rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const MAX_RETRIES = 4;

/**
 * Gate scanner API, for admins and the volunteers an admin has added.
 *
 *   { action: 'lookup', bookingId, ticketNumber, sig }         -> what this pass is, nothing changes
 *   { action: 'admit',  bookingId, ticketNumber, sig, count? } -> let `count` people in
 *
 * What changed, and why:
 *   - Scanning no longer requires being a full admin, so a volunteer on the door is not handed
 *     the whole admin panel.
 *   - A pass only admits anyone within its own event's gate window, so last month's pass (or
 *     another event's) is refused instead of admitting cleanly.
 *   - The QR signature is checked, so a hand-made code is rejected.
 *   - Every admission is written to scan_log with who did it.
 *   - The `scan_version` concurrency guard is now required rather than silently skipped: two
 *     staff scanning the same group pass at once can never both admit the same people.
 */
export async function POST(req: Request) {
  try {
    const { isAdmin, user } = await checkAdminAccess();
    if (!user) return NextResponse.json({ error: 'Please log in.' }, { status: 401 });

    const db = supabaseAdmin();
    const actor = await resolveGateActor(db as unknown as StaffDb, user, isAdmin);
    if (!actor) {
      return NextResponse.json({ error: 'You are not on the gate list for this event.' }, { status: 403 });
    }

    const limit = rateLimit(rateKey('scan', user.id, req), RATE_RULES.scan);
    if (!limit.ok) {
      return NextResponse.json(
        { error: 'Scanning too fast. Wait a second and scan again.' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
      );
    }

    const body = await req.json().catch(() => ({}));
    const { bookingId, ticketNumber, sig } = body as { bookingId?: string; ticketNumber?: string; sig?: string };
    const action = body.action === 'lookup' ? 'lookup' : 'admit';
    if (!bookingId || !ticketNumber || typeof bookingId !== 'string' || typeof ticketNumber !== 'string') {
      return NextResponse.json({ error: 'Missing scan data' }, { status: 400 });
    }
    const count = body.count === undefined || body.count === null ? undefined : Number(body.count);

    // Is this QR really ours?
    const signature = verifyTicketSignature(bookingId, ticketNumber, sig);
    if (signature === 'INVALID') {
      return NextResponse.json({ error: 'This QR code is not valid. Do not admit.', code: 'BAD_SIGNATURE' }, { status: 403 });
    }
    if (signature === 'UNSIGNED' && !unsignedPassesAllowed()) {
      return NextResponse.json(
        { error: 'This pass predates signed QR codes and strict mode is on. Check them in by hand.', code: 'UNSIGNED' },
        { status: 403 },
      );
    }

    const view = await loadBookingView(bookingId).catch(() => null);
    if (!view) return NextResponse.json({ error: 'Booking not found. Invalid ticket.' }, { status: 404 });
    if (view.status === 'REFUNDED') {
      return NextResponse.json({ error: 'REFUNDED! This booking was refunded and is no longer valid.' }, { status: 410 });
    }

    // A volunteer scoped to one event cannot admit anyone to a different one.
    if (!canScanEvent(actor, view.eventId)) {
      return NextResponse.json({ error: 'This pass is for a different event than the one you are on.', code: 'WRONG_EVENT' }, { status: 403 });
    }

    const window = scanWindow(view.event?.date, view.event?.time);
    const gate = {
      window,
      eventDay: eventDay(view.event?.date),
      signed: signature === 'VALID',
    };

    if (action === 'lookup') {
      const booking = await readBooking(db, bookingId);
      const found = booking ? lookupTicket(booking.tickets_data || [], ticketNumber) : null;
      if (!found) return NextResponse.json({ error: 'Ticket number does not belong to this booking.' }, { status: 404 });
      return NextResponse.json({
        success: true,
        ticketDetails: { ...found.ticket, ...found.progress },
        event: view.event
          ? { title: view.event.title, date: view.event.date, time: view.event.time, location: view.event.location }
          : null,
        gate,
        // canAdmitPartial drives the UI: a volunteer is never shown the "some are missing"
        // route at all, rather than being offered it and refused. The server enforces it
        // regardless, so a tampered client gains nothing.
        actor: { role: actor.role, email: actor.email, canAdmitPartial: partialAdmitAllowed(actor) },
      });
    }

    // Outside the event's own gate window, anyone on the gate — admin or volunteer — is asked to
    // confirm rather than refused. The window exists to stop a pass for a DIFFERENT day being
    // waved through by accident, which a deliberate confirmation still prevents; blocking
    // volunteers outright only meant the one person actually standing at the door could not do
    // their job when a date was off by a few hours.
    if (window !== 'OPEN' && body.override !== true) {
      const why =
        window === 'EARLY'
          ? 'This pass is for an event that has not started yet. Confirm you still want to admit.'
          : window === 'CLOSED'
            ? 'This pass is for an event that is already over. Confirm you still want to admit.'
            : 'This event has no readable date, so the gate cannot check the time. Confirm you still want to admit.';
      return NextResponse.json({ error: why, code: `GATE_${window}`, needsOverride: true, gate }, { status: 409 });
    }

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const booking = await readBooking(db, bookingId);
      if (!booking) return NextResponse.json({ error: 'Booking not found. Invalid ticket.' }, { status: 404 });
      if (booking.status === 'REFUNDED') {
        return NextResponse.json({ error: 'REFUNDED! This booking was refunded and is no longer valid.' }, { status: 410 });
      }

      const result = applyScan(booking.tickets_data || [], ticketNumber, count, new Date(), {
        allowPartial: partialAdmitAllowed(actor),
      });
      if (!result.ok) {
        const status =
          result.code === 'NOT_FOUND' ? 404
          : result.code === 'REFUNDED' ? 410
          : result.code === 'ALREADY_USED' ? 409
          : result.code === 'PARTIAL_NOT_ALLOWED' ? 403
          : 400;
        return NextResponse.json({ error: result.message, code: result.code, progress: result.progress, gate }, { status });
      }

      const { data: written, error: updateError } = await db
        .from('ticket_bookings')
        .update({ tickets_data: result.tickets, scan_version: booking.scan_version + 1 })
        .eq('id', bookingId)
        .eq('scan_version', booking.scan_version)
        .select('id');
      if (updateError) throw updateError;

      if (written && written.length === 1) {
        // Append-only record of who admitted whom. Never allowed to fail the admission itself.
        await db
          .from('scan_log')
          .insert({
            booking_id: bookingId,
            ticket_number: ticketNumber,
            event_id: view.eventId,
            admitted: result.admittedNow,
            action: 'ADMIT',
            actor_email: actor.email,
            actor_id: actor.userId,
            actor_role: actor.role,
            signed: signature === 'VALID',
          })
          .then(({ error }) => {
            if (error) console.error('SCAN_LOG_FAILED:', error.message);
          });

        return NextResponse.json({
          success: true,
          message:
            result.progress.remaining === 0
              ? 'Ticket Verified! Access Granted.'
              : `Admitted ${result.admittedNow}. ${result.progress.remaining} still to come.`,
          admittedNow: result.admittedNow,
          ticketDetails: { ...result.ticket, ...result.progress },
          gate,
        });
      }
      // Someone else scanned this booking a moment ago: loop to re-read and re-check against their change.
    }
    return NextResponse.json({ error: 'The scanner is busy. Please scan again.' }, { status: 503 });
  } catch (error) {
    console.error('Scanner Error:', error);
    return NextResponse.json({ error: 'Scanner system failure' }, { status: 500 });
  }
}

type BookingRow = { tickets_data: ScanTicket[]; status: string | null; scan_version: number };

/**
 * Reads the passes and the version they were read at.
 *
 * There used to be a fallback here for a database without `scan_version`, which quietly dropped
 * the guard that stops two gates admitting the same people. The migration is now required, so a
 * missing column is a real error.
 */
async function readBooking(db: ReturnType<typeof supabaseAdmin>, bookingId: string): Promise<BookingRow | null> {
  const { data, error } = await db
    .from('ticket_bookings')
    .select('tickets_data, status, scan_version')
    .eq('id', bookingId)
    .maybeSingle();
  if (error) throw error;
  return (data as BookingRow | null) ?? null;
}
