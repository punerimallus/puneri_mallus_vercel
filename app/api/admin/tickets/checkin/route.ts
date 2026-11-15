import { NextResponse } from 'next/server';
import { checkAdminAccess } from '@/lib/admin';
import { supabaseAdmin } from '@/lib/payments/server';
import { admitEveryone, applyScan, type ScanTicket } from '@/lib/payments/scan';

export const dynamic = 'force-dynamic';

const MAX_RETRIES = 4;

/**
 * Check somebody in by hand, from the box office.
 *
 * The gate scanner needs a QR, and a QR needs the pass. On the night a steady trickle of people
 * arrive without one: the email never came, the phone is dead, the screenshot is of somebody
 * else's pass. Until now the only answer was to turn them away or wave them through unrecorded,
 * and an unrecorded entry is worse than no gate at all — the pass still reads valid afterwards,
 * so whoever turns up with it later gets in on it too.
 *
 *   { bookingId, ticketNumber, count? }   admit from one pass (count defaults to everyone left)
 *   { bookingId, all: true }              admit everyone still outside on the whole booking
 *
 * Deliberately a separate endpoint from /api/gate/scan rather than a flag on it:
 *
 *   * the gate route's rule is that NOTHING is admitted without a verified signature, and that
 *     rule is worth keeping absolute — a tampered client should gain nothing there
 *   * this one is admin-only. A volunteer on the door cannot reach it, so "my QR did not
 *     arrive" cannot be used on the least experienced person at the gate
 *   * every row it writes is marked MANUAL, so the morning after it is clear which entries
 *     were vouched for by an organiser rather than scanned
 *
 * It keeps the gate's concurrency guard: the same scan_version compare-and-set, so a check-in
 * here and a scan at the door a second apart can never both admit the same person.
 */
export async function POST(req: Request) {
  try {
    const { isAdmin, user } = await checkAdminAccess();
    if (!user) return NextResponse.json({ error: 'Please log in.' }, { status: 401 });
    if (!isAdmin) return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const bookingId = typeof body?.bookingId === 'string' ? body.bookingId : '';
    const ticketNumber = typeof body?.ticketNumber === 'string' ? body.ticketNumber : '';
    const all = body?.all === true;
    const count = body?.count === undefined || body?.count === null ? undefined : Number(body.count);

    if (!bookingId) return NextResponse.json({ error: 'Which booking?' }, { status: 400 });
    if (!all && !ticketNumber) return NextResponse.json({ error: 'Which pass?' }, { status: 400 });

    const db = supabaseAdmin();

    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      const { data: booking, error: readErr } = await db
        .from('ticket_bookings')
        // Exactly the columns this needs, and no more. `full_name` is NOT one of them: the
        // ledger shows a buyer's name from their profile, not from the booking, and asking
        // ticket_bookings for it made every check-in fail with "Could not read the booking".
        .select('id, event_id, status, tickets_data, scan_version')
        .eq('id', bookingId)
        .maybeSingle();
      if (readErr) {
        console.error('CHECKIN_READ_ERROR:', readErr.message);
        return NextResponse.json({ error: 'Could not read the booking.' }, { status: 500 });
      }
      if (!booking) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 });
      if (booking.status === 'REFUNDED') {
        return NextResponse.json({ error: 'This booking was refunded. Nobody on it can be admitted.' }, { status: 410 });
      }

      const current = (booking.tickets_data || []) as ScanTicket[];
      const now = new Date();

      let tickets: ScanTicket[];
      let admitted: { ticketNumber: string; count: number }[];

      if (all) {
        // One pass already scanned at the door is a normal thing to find here, not an error,
        // so admitEveryone skips those and lets the rest in.
        const bulk = admitEveryone(current, now);
        tickets = bulk.tickets;
        admitted = bulk.admitted;
      } else {
        // allowPartial: this is an admin standing in front of the person. Splitting a group is
        // exactly what they need when three of eight have turned up.
        const result = applyScan(current, ticketNumber, count, now, { allowPartial: true });
        if (!result.ok) {
          const status =
            result.code === 'NOT_FOUND' ? 404
            : result.code === 'REFUNDED' ? 410
            : result.code === 'ALREADY_USED' ? 409
            : 400;
          return NextResponse.json({ error: result.message, code: result.code, progress: result.progress }, { status });
        }
        tickets = result.tickets;
        admitted = [{ ticketNumber, count: result.admittedNow }];
      }

      if (admitted.length === 0) {
        return NextResponse.json({ error: 'Everyone on this booking is already inside.', code: 'ALREADY_USED' }, { status: 409 });
      }

      const { data: written, error: writeErr } = await db
        .from('ticket_bookings')
        .update({ tickets_data: tickets, scan_version: (booking.scan_version || 0) + 1 })
        .eq('id', bookingId)
        .eq('scan_version', booking.scan_version || 0)
        .select('id');
      if (writeErr) {
        console.error('CHECKIN_WRITE_ERROR:', writeErr.message);
        return NextResponse.json({ error: 'Could not check them in.' }, { status: 500 });
      }

      // Somebody else changed this booking between the read and the write — most likely a
      // scanner at the door. Read it again and re-decide against what they did.
      if (!written || written.length !== 1) continue;

      // One row per pass, matching the gate, so "who let them in" has the same shape however
      // they came through. Never allowed to fail the admission itself.
      const people = admitted.reduce((n, a) => n + a.count, 0);
      await db
        .from('scan_log')
        .insert(
          admitted.map((a) => ({
            booking_id: bookingId,
            ticket_number: a.ticketNumber,
            event_id: booking.event_id,
            admitted: a.count,
            action: 'MANUAL',
            actor_email: user.email ?? null,
            actor_id: user.id,
            actor_role: 'ADMIN',
            signed: false,
          })),
        )
        .then(({ error }) => {
          if (error) console.error('SCAN_LOG_FAILED:', error.message);
        });

      const names = admitted.map((a) => a.ticketNumber).join(', ');
      return NextResponse.json({
        success: true,
        admittedNow: people,
        passes: admitted,
        tickets,
        message:
          admitted.length === 1
            ? `${names} checked in by hand — ${people} ${people === 1 ? 'person' : 'people'} admitted.`
            : `${people} admitted by hand on ${admitted.length} passes (${names}).`,
      });
    }

    return NextResponse.json({ error: 'This booking is being scanned right now. Try again.' }, { status: 503 });
  } catch (error) {
    console.error('CHECKIN_ERROR:', error);
    return NextResponse.json({ error: 'Could not check them in.' }, { status: 500 });
  }
}
