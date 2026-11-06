import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { checkAdminAccess } from '@/lib/admin';
import { goLiveAt, isSaleLive, phaseAlert, saleHeadline } from '@/lib/events/sale-phase';

// Define the interface locally
interface TribeEvent {
  date: string;
  time: string;
  [key: string]: any;
}

/**
 * The public event list.
 *
 * An event with a `goLiveAt` in the future is left out entirely rather than returned with a
 * flag: this response is what the home page, the events page and the booking page all read, and
 * a flag the browser is trusted to honour is an announcement anyone can read out of devtools
 * before it is meant to be public.
 *
 * `?scope=admin` returns everything, for the admin screens that have to see what is scheduled.
 * It is checked server side, so asking for it without being an admin simply gets the public list.
 */
export async function GET(request: Request) {
  try {
    const client = await clientPromise;
    const db = client.db("punerimallus");

    const wantsAll = new URL(request.url).searchParams.get('scope') === 'admin';
    const showAll = wantsAll ? (await checkAdminAccess()).isAdmin : false;

    // 1. Fetch data with a fallback to an empty array
    const events = (await db.collection("events").find({}).toArray() as unknown as TribeEvent[]) || [];

    const now = new Date();

    const processedEvents = events
      .map((event) => {
        // 2. Combine date and time to check if event has passed
        const eventDateTime = new Date(`${event.date} ${event.time}`);
        const live = isSaleLive(event.goLiveAt, now);

        return {
          ...event,
          // If date is invalid, we default to true to keep it visible
          isUpcoming: isNaN(eventDateTime.getTime()) ? true : eventDateTime >= now,
          // Normalised so every reader sees the same shape, however it was stored.
          goLiveAt: goLiveAt(event.goLiveAt),
          salesHeadline: saleHeadline(event.salesHeadline),
          phaseAlert: phaseAlert(event.phaseAlert),
          isSaleLive: live,
        };
      })
      .filter((event) => showAll || event.isSaleLive);

    return NextResponse.json(processedEvents);
  } catch (error: any) {
    console.error("GET_EVENTS_ERROR:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
