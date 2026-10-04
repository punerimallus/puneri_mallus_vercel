import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { checkAdminAccess } from '@/lib/admin';
import { applyScan, lookupTicket, ScanTicket } from '@/lib/payments/scan';
import { loadBookingView } from '@/lib/payments/server';
import { eventDay } from '@/lib/events/sales';

export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const MAX_RETRIES = 4;
const isMissingColumn = (e: { code?: string; message?: string } | null) => !!e && (e.code === '42703' || /scan_version/i.test(e.message || ''));

async function readBooking(bookingId: string) {
  const withVersion = await supabaseAdmin.from('ticket_bookings').select('tickets_data, status, scan_version').eq('id', bookingId).maybeSingle();
  if (!withVersion.error) return { booking: withVersion.data as { tickets_data: ScanTicket[]; status: string | null; scan_version: number } | null, versioned: true };
  if (!isMissingColumn(withVersion.error)) throw withVersion.error;
  // The scan_version column hasn't been added yet: still scan, just without the extra concurrency guard.
  const plain = await supabaseAdmin.from('ticket_bookings').select('tickets_data, status').eq('id', bookingId).maybeSingle();
  if (plain.error) throw plain.error;
  return { booking: plain.data ? ({ ...plain.data, scan_version: 0 } as { tickets_data: ScanTicket[]; status: string | null; scan_version: number }) : null, versioned: false };
}

/**
 * Gate scanner API (admins only).
 *   { action: 'lookup', bookingId, ticketNumber }            -> what this pass is, nothing changes
 *   { action: 'admit',  bookingId, ticketNumber, count? }    -> let `count` people in (default: everyone still outside)
 * Two staff scanning the same pass at the same moment can't both get in: each write only succeeds
 * if nobody else changed the booking since it was read, and a loser re-reads and re-checks.
 */
export async function POST(req: Request) {
  try {
    const { isAdmin } = await checkAdminAccess();
    if (!isAdmin) return NextResponse.json({ error: 'Only admins can scan tickets.' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const { bookingId, ticketNumber } = body as { bookingId?: string; ticketNumber?: string };
    const action = body.action === 'lookup' ? 'lookup' : 'admit';
    if (!bookingId || !ticketNumber || typeof bookingId !== 'string' || typeof ticketNumber !== 'string') {
      return NextResponse.json({ error: 'Missing scan data' }, { status: 400 });
    }
    const count = body.count === undefined || body.count === null ? undefined : Number(body.count);

    if (action === 'lookup') {
      const view = await loadBookingView(bookingId).catch(() => null);
      if (!view) return NextResponse.json({ error: 'Booking not found. Invalid ticket.' }, { status: 404 });
      if (view.status === 'REFUNDED') return NextResponse.json({ error: 'REFUNDED! This booking was refunded and is no longer valid.' }, { status: 410 });
      const { booking } = await readBooking(bookingId);
      const found = booking ? lookupTicket(booking.tickets_data || [], ticketNumber) : null;
      if (!found) return NextResponse.json({ error: 'Ticket number does not belong to this booking.' }, { status: 404 });
      return NextResponse.json({
        success: true,
        ticketDetails: { ...found.ticket, ...found.progress },
        event: view.event ? { title: view.event.title, date: view.event.date, time: view.event.time, location: view.event.location } : null,
        eventDay: eventDay(view.event?.date),
      });
    }

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const { booking, versioned } = await readBooking(bookingId);
      if (!booking) return NextResponse.json({ error: 'Booking not found. Invalid ticket.' }, { status: 404 });
      if (booking.status === 'REFUNDED') return NextResponse.json({ error: 'REFUNDED! This booking was refunded and is no longer valid.' }, { status: 410 });

      const result = applyScan(booking.tickets_data || [], ticketNumber, count);
      if (!result.ok) {
        const status = result.code === 'NOT_FOUND' ? 404 : result.code === 'REFUNDED' ? 410 : result.code === 'ALREADY_USED' ? 409 : 400;
        return NextResponse.json({ error: result.message, code: result.code, progress: result.progress }, { status });
      }

      let update = supabaseAdmin.from('ticket_bookings').update(versioned ? { tickets_data: result.tickets, scan_version: booking.scan_version + 1 } : { tickets_data: result.tickets }).eq('id', bookingId);
      if (versioned) update = update.eq('scan_version', booking.scan_version);
      const { data: written, error: updateError } = await update.select('id');
      if (updateError) throw updateError;
      if (!versioned || (written && written.length === 1)) {
        return NextResponse.json({
          success: true,
          message: result.progress.remaining === 0 ? 'Ticket Verified! Access Granted.' : `Admitted ${result.admittedNow}. ${result.progress.remaining} still to come.`,
          admittedNow: result.admittedNow,
          ticketDetails: { ...result.ticket, ...result.progress },
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
