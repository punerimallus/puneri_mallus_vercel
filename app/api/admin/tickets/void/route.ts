import { NextResponse } from 'next/server';
import { checkAdminAccess } from '@/lib/admin';
import { supabaseAdmin } from '@/lib/payments/server';
import { asMarkerDb, checkSchema } from '@/lib/payments/schema-check';
import { ticketNumberValue, voidTicketNumber } from '@/lib/payments/inventory';
import { IssuedTicket } from '@/lib/payments/types';

export const dynamic = 'force-dynamic';

/**
 * Void one pass.
 *
 * There was no way to do this before: a partial refund left every pass in the booking valid, and
 * the only lever was refunding the whole order. Voiding a single pass stops it scanning and puts
 * its seat and number straight back on sale.
 *
 * Deliberately NOT a refund: money is Razorpay's business, and an admin may want to void a pass
 * without refunding (a duplicate, a transfer) or refund without voiding. The response says
 * plainly that no money moved.
 */
export async function POST(req: Request) {
  const { isAdmin, user } = await checkAdminAccess();
  if (!user) return NextResponse.json({ error: 'Please log in.' }, { status: 401 });
  if (!isAdmin) return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });

  const db = supabaseAdmin();
  const schema = await checkSchema(asMarkerDb(db));
  if (!schema.ok) return NextResponse.json({ error: schema.error, schemaBehind: true }, { status: 503 });

  const { bookingId, ticketNumber } = await req.json().catch(() => ({}));
  if (!bookingId || !ticketNumber || typeof bookingId !== 'string' || typeof ticketNumber !== 'string') {
    return NextResponse.json({ error: 'bookingId and ticketNumber are required' }, { status: 400 });
  }

  const { data: booking, error: readErr } = await db
    .from('ticket_bookings')
    .select('id, event_id, status, tickets_data, scan_version')
    .eq('id', bookingId)
    .maybeSingle();
  if (readErr) {
    console.error('VOID_READ_ERROR:', readErr.message);
    return NextResponse.json({ error: 'Could not read the booking.' }, { status: 500 });
  }
  if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

  const tickets = (booking.tickets_data || []) as IssuedTicket[];
  const pass = tickets.find((t) => t.ticketNumber === ticketNumber);
  if (!pass) return NextResponse.json({ error: 'That pass is not part of this booking.' }, { status: 404 });
  if (pass.status === 'REFUNDED') return NextResponse.json({ success: true, alreadyVoided: true });

  // Mark the pass dead first: that is what stops it at the gate, and it must hold even if
  // freeing the seat below fails.
  const updated = tickets.map((t) => (t.ticketNumber === ticketNumber ? { ...t, status: 'REFUNDED' as const } : t));
  const { data: written, error: writeErr } = await db
    .from('ticket_bookings')
    .update({ tickets_data: updated, scan_version: (booking.scan_version || 0) + 1 })
    .eq('id', bookingId)
    .eq('scan_version', booking.scan_version || 0)
    .select('id');
  if (writeErr) {
    console.error('VOID_WRITE_ERROR:', writeErr.message);
    return NextResponse.json({ error: 'Could not void that pass.' }, { status: 500 });
  }
  if (!written || written.length !== 1) {
    return NextResponse.json({ error: 'Someone else changed this booking just now. Try again.' }, { status: 409 });
  }

  // Now give the seat and the number back, so the next buyer can have them.
  let seatFreed = false;
  const { data: order } = await db
    .from('payment_orders')
    .select('reservation_id')
    .eq('booking_id', bookingId)
    .limit(1)
    .maybeSingle();

  const reservationId = (order as { reservation_id?: string } | null)?.reservation_id;
  if (reservationId && pass.categoryId) {
    const number = ticketNumberValue(ticketNumber, prefixOf(ticketNumber));
    if (number !== null) {
      try {
        seatFreed = await voidTicketNumber(
          { rpc: (fn, args) => db.rpc(fn, args) },
          reservationId,
          pass.categoryId,
          number,
        );
      } catch (e) {
        console.error('VOID_SEAT_RELEASE_FAILED:', e);
      }
    }
  }

  await db.from('scan_log').insert({
    booking_id: bookingId,
    ticket_number: ticketNumber,
    event_id: booking.event_id,
    admitted: 0,
    action: 'VOID',
    actor_email: user.email ?? null,
    actor_id: user.id,
    actor_role: 'ADMIN',
  });

  return NextResponse.json({
    success: true,
    seatFreed,
    note: seatFreed
      ? 'Pass voided and its seat put back on sale. No money has been refunded.'
      : 'Pass voided. Its seat could not be returned automatically (older booking) — check capacity by hand. No money has been refunded.',
  });
}

/** The non-numeric lead of a pass number, used to read its number off ("GA-013" -> "GA-"). */
function prefixOf(ticketNumber: string): string {
  const m = /^(.*?)(\d+)$/.exec(ticketNumber);
  return m ? m[1] : '';
}
