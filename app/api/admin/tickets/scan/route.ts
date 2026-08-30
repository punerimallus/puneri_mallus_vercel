import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  try {
    const { bookingId, ticketNumber } = await req.json();

    if (!bookingId || !ticketNumber) {
      return NextResponse.json({ error: "Missing scan data" }, { status: 400 });
    }

    // 1. Fetch the booking record
    const { data: booking, error } = await supabaseAdmin
      .from('ticket_bookings')
      .select('tickets_data')
      .eq('id', bookingId)
      .single();

    if (error || !booking) {
      return NextResponse.json({ error: "Booking not found. Invalid ticket." }, { status: 404 });
    }

    // 2. Find the specific ticket inside the JSON array
    let ticketFound = false;
    let alreadyScanned = false;

    const updatedTicketsData = booking.tickets_data.map((ticket: any) => {
      if (ticket.ticketNumber === ticketNumber) {
        ticketFound = true;
        if (ticket.status === 'CHECKED_IN') {
          alreadyScanned = true;
        } else {
          // Update status to checked in
          ticket.status = 'CHECKED_IN';
        }
      }
      return ticket;
    });

    if (!ticketFound) {
      return NextResponse.json({ error: "Ticket number does not belong to this booking." }, { status: 404 });
    }

    if (alreadyScanned) {
      return NextResponse.json({ error: "ALREADY SCANNED! This ticket has already been used." }, { status: 409 });
    }

    // 3. Save the updated array back to the database
    const { error: updateError } = await supabaseAdmin
      .from('ticket_bookings')
      .update({ tickets_data: updatedTicketsData })
      .eq('id', bookingId);

    if (updateError) throw updateError;

    return NextResponse.json({ 
      success: true, 
      message: "Ticket Verified! Access Granted.",
      ticketDetails: updatedTicketsData.find((t: any) => t.ticketNumber === ticketNumber)
    });

  } catch (error: any) {
    console.error("Scanner Error:", error);
    return NextResponse.json({ error: "Scanner system failure" }, { status: 500 });
  }
}