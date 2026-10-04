import { NextResponse } from 'next/server';
import { loadOwnedBooking } from '@/lib/payments/booking-access';
import { renderBookingPdf } from '@/lib/payments/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Download the same PDF that is emailed. Owner or admin only.
export async function GET(req: Request): Promise<NextResponse> {
  try {
    const bid = new URL(req.url).searchParams.get('bid');
    const result = await loadOwnedBooking(bid);
    if (result.error) return result.error;
    if (result.view.status === 'REFUNDED') return NextResponse.json({ error: 'This booking was refunded.' }, { status: 409 });

    const pdf = await renderBookingPdf(result.view.id);
    if (!pdf) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    return new NextResponse(Buffer.from(pdf.base64, 'base64'), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${pdf.filename}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    console.error('Ticket PDF Error:', error);
    return NextResponse.json({ error: 'Could not create the PDF right now.' }, { status: 500 });
  }
}
