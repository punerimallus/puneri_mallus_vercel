import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function POST(req: Request) {
  try {
    const { eventId, categories } = await req.json();

    // 1. Authenticate the Admin (using your exact existing admin logic)
    const cookieStore = await cookies();
    const supabaseAuth = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { get(name: string) { return cookieStore.get(name)?.value; } } }
    );

    const { data: { user } } = await supabaseAuth.auth.getUser();
    if (!user || !user.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!, 
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Verify they are in the authorized_admins table
    const { data: adminRecord } = await supabaseAdmin
      .from('authorized_admins')
      .select('email')
      .eq('email', user.email)
      .single();

    if (!adminRecord) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    // 2. Format the categories for the database
    const upsertData = categories.map((cat: any) => ({
      ...(cat.id ? { id: cat.id } : {}), // Keep existing ID to update, or omit to create new
      event_id: eventId,
      name: cat.name,
      price: cat.price,
      prefix: cat.prefix,
      capacity: cat.capacity,
      active: true
    }));

    // 3. Save to Supabase
    const { error } = await supabaseAdmin.from('event_ticket_categories').upsert(upsertData);
    if (error) throw error;

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error("Ticket Config Error:", error.message);
    return NextResponse.json({ error: "Failed to save configuration" }, { status: 500 });
  }
}