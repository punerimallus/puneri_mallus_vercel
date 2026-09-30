import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import clientPromise from '@/lib/mongodb';
import { checkAdminAccess } from '@/lib/admin';

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

      return NextResponse.json({ 
        categories: categories || [], 
        bookings: enrichedBookings 
      });
    }

    // Case 2: Fetch all events for the selector
    const client = await clientPromise;
    const db = client.db("punerimallus");
    const events = await db.collection("events")
      .find({ ticketUrl: 'INTERNAL' }) // Only fetch events using our Box Office
      .sort({ date: -1 })
      .toArray();

    return NextResponse.json({ events });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const { isAdmin } = await checkAdminAccess();
    if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { categoryId, active } = await req.json();
    
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