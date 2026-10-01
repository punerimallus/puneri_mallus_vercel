import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { loadOwnedBooking } from '@/lib/payments/booking-access';

export const dynamic = 'force-dynamic';

// The ticket page's data. Only the booking's owner (or an admin) can read it.
export async function GET(req: Request): Promise<NextResponse> {
  try {
    const bid = new URL(req.url).searchParams.get('bid');
    const result = await loadOwnedBooking(bid);
    if (result.error) return result.error;
    const view = result.view;

    // Poster image still lives in MongoDB; fall back gracefully if it can't be read.
    let image: string | null = null;
    try {
      const db = (await clientPromise).db('punerimallus');
      const ev = await db.collection('events').findOne({ _id: new ObjectId(view.eventId) }, { projection: { image: 1 } });
      image = (ev?.image as string) || null;
    } catch { /* poster is optional */ }

    return NextResponse.json({ booking: view, image, baseUrl: (process.env.NEXT_PUBLIC_BASE_URL || '').replace(/\/+$/, '') });
  } catch (error) {
    console.error('Booking Fetch Error:', error);
    return NextResponse.json({ error: 'Failed to retrieve booking' }, { status: 500 });
  }
}
