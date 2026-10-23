import { getRequestUser } from '@/lib/admin';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // 1. Authenticate the User making the request
    const user = await getRequestUser();

    if (!user || !user.email) {
      return NextResponse.json({ error: "Unauthorized access" }, { status: 401 });
    }

    // 2. Initialize Service Role Client for DB checks/reads
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY! 
    );

    // 3. SECURE ADMIN CHECK: Query the authorized_admins table
    const { data: adminRecord, error: adminError } = await supabaseAdmin
      .from('authorized_admins')
      .select('email')
      .eq('email', user.email)
      .single();

    if (adminError || !adminRecord) {
      console.warn(`SECURITY ALERT: Unauthorized football data access attempt by ${user.email}`);
      return NextResponse.json({ error: "Forbidden: Master Admin Access Required" }, { status: 403 });
    }

    // 4. Fetch all registered football teams, newest first
    const { data: teams, error: teamsError } = await supabaseAdmin
      .from('football_teams')
      .select('*')
      .order('created_at', { ascending: false });

    if (teamsError) throw teamsError;

    // Return the array of teams
    return NextResponse.json(teams || []);

  } catch (e: any) {
    console.error("Supabase Football Fetch Error:", e.message);
    return NextResponse.json({ error: "Failed to fetch records" }, { status: 500 });
  }
}