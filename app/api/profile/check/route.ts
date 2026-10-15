import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getIdentity } from '@/lib/ownership';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('id');

    if (!userId) {
      return NextResponse.json({ exists: false, message: "User ID required" }, { status: 400 });
    }

    // A profile (email, phone, membership) can only be read by its owner or an admin.
    const who = await getIdentity();
    if (!who) return NextResponse.json({ exists: false, message: "Please log in." }, { status: 401 });
    if (who.id !== userId && !who.isAdmin) return NextResponse.json({ exists: false, message: "Not allowed." }, { status: 403 });

    // 1. Initialize the Supabase Client
    // We use the Service Role Key here because we are simply reading a profile by ID
    // and we want to bypass RLS in case the user's session isn't fully established yet
    // on the server-side during this specific check.
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY! 
    );

    // 2. Query the 'profiles' table using the UUID
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      // Select the columns you need. We added mart_unlocked and is_member based on earlier logic.
      .select('id, email, phone_number, full_name, is_member, mart_unlocked') 
      .eq('id', userId)
      .maybeSingle(); // maybeSingle returns null if no row is found, without throwing an error

    if (error) {
      throw error;
    }

    // 3. Return the result
    return NextResponse.json({ 
      exists: !!profile,
      profile: profile || null
    });

  } catch (error: any) {
    console.error("Profile Lookup Error (Supabase):", error.message);
    return NextResponse.json({ 
      exists: false, 
      error: "Internal Server Error" 
    }, { status: 500 });
  }
}