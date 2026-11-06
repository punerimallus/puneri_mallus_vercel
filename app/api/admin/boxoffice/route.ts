import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ObjectId } from 'mongodb';
import clientPromise from '@/lib/mongodb';
import { checkAdminAccess } from '@/lib/admin';
import { goLiveAt, phaseAlert, saleHeadline } from '@/lib/events/sale-phase';

export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: Request) {
  try {
    const { isAdmin } = await checkAdminAccess();
    if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const eventId = searchParams.get('eventId');

    // Case 1: Fetch specific event dashboard data
    if (eventId) {
      const { data: categories } = await supabaseAdmin
        .from('event_ticket_categories')
        .select('*')
        .eq('event_id', eventId)
        .order('price', { ascending: false });

      const { data: bookings } = await supabaseAdmin
        .from('ticket_bookings')
        .select('*')
        .eq('event_id', eventId)
        .order('created_at', { ascending: false });

      let enrichedBookings = bookings || [];

      // Enrich bookings with root profile names
      if (enrichedBookings.length > 0) {
        const userIds = enrichedBookings.map(b => b.user_id).filter(Boolean);
        if (userIds.length > 0) {
          const { data: profiles } = await supabaseAdmin
            .from('profiles')
            .select('id, full_name, phone_number')
            .in('id', userIds);

          enrichedBookings = enrichedBookings.map(b => {
            const profile = profiles?.find(p => p.id === b.user_id);
            return {
              ...b,
              full_name: profile?.full_name || 'Guest Checkout',
              phone: profile?.phone_number || 'N/A'
            };
          });
        }
      }

      // Who admitted whom. scan_log is the append-only record the gate writes on every
      // admission, so this is the only place that can answer "who let them in" — tickets_data
      // keeps the count but not the person. Newest first, and capped: a busy gate writes one
      // row per admission, and the dashboard only needs the recent history per booking.
      const { data: scans } = await supabaseAdmin
        .from('scan_log')
        .select('booking_id, ticket_number, admitted, action, actor_email, actor_role, at')
        .eq('event_id', eventId)
        .order('at', { ascending: false })
        .limit(5000);

      const scansByBooking: Record<string, unknown[]> = {};
      for (const s of scans || []) {
        const key = String(s.booking_id);
        (scansByBooking[key] ||= []).push(s);
      }

      // Complimentary passes. A database without the comp migration simply has none, which is
      // the honest answer and leaves the rest of the dashboard working.
      const { data: grants } = await supabaseAdmin
        .from('comp_ticket_grants')
        .select('*')
        .eq('event_id', eventId)
        .order('created_at', { ascending: false })
        .limit(500);

      const grantByBooking = new Map((grants || []).map((g) => [String(g.booking_id), g]));

      return NextResponse.json({
        categories: categories || [],
        bookings: enrichedBookings.map((b) => {
          const grant = grantByBooking.get(String(b.id));
          return {
            ...b,
            scans: scansByBooking[String(b.id)] || [],
            // Comps have no profile and no payment, so without this they read as "Guest
            // Checkout" with a blank reference — indistinguishable from a broken sale.
            ...(grant ? { full_name: grant.guest_name, comp: grant } : {}),
          };
        }),
        grants: grants || [],
      });
    }

    // Case 2: Fetch all events for the selector
    const client = await clientPromise;
    const db = client.db("punerimallus");
    const events = await db.collection("events")
      .find({ ticketUrl: 'INTERNAL' }) // Only fetch events using our Box Office
      .sort({ date: -1 })
      .toArray();

    return NextResponse.json({
      events: events.map((e) => ({
        ...e,
        goLiveAt: goLiveAt(e.goLiveAt),
        salesHeadline: saleHeadline(e.salesHeadline),
        phaseAlert: phaseAlert(e.phaseAlert),
      })),
    });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * Two different switches, both of which an admin flips from the box office:
 *
 *   { categoryId, active }                  pause or resume one ticket category
 *   { eventId, salesHeadline?, phaseAlert?, goLiveAt? }
 *                                           the phase banner, the next-phase warning, and
 *                                           when the event goes on sale
 *
 * The schedule lives on the MongoDB event document because that is what the public event list
 * reads; see lib/events/sale-phase.ts.
 */
export async function PATCH(req: Request) {
  try {
    const { isAdmin } = await checkAdminAccess();
    if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json().catch(() => ({}));

    if (body?.eventId) {
      const eventId = String(body.eventId);
      if (!ObjectId.isValid(eventId)) return NextResponse.json({ error: 'Unknown event.' }, { status: 400 });

      // Only the keys that were actually sent are written, so setting a headline cannot wipe a
      // schedule and vice versa.
      const patch: Record<string, unknown> = {};
      if ('salesHeadline' in body) patch.salesHeadline = saleHeadline(body.salesHeadline);
      if ('phaseAlert' in body) patch.phaseAlert = phaseAlert(body.phaseAlert);
      if ('goLiveAt' in body) patch.goLiveAt = goLiveAt(body.goLiveAt);
      if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 });

      const client = await clientPromise;
      const result = await client.db('punerimallus').collection('events')
        .updateOne({ _id: new ObjectId(eventId) }, { $set: { ...patch, updated_at: new Date() } });
      if (result.matchedCount === 0) return NextResponse.json({ error: 'Unknown event.' }, { status: 404 });

      return NextResponse.json({ success: true, ...patch });
    }

    const { categoryId, active } = body;
    if (!categoryId) return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 });

    const { error } = await supabaseAdmin
      .from('event_ticket_categories')
      .update({ active })
      .eq('id', categoryId);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
