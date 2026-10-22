import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { createClient } from '@supabase/supabase-js';
import { getIdentity } from '@/lib/ownership';

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('id');

    if (!userId) {
      return NextResponse.json({ error: "User ID required" }, { status: 400 });
    }

    // You can delete your own account. Nobody else's: an admin removing someone is the only exception.
    const who = await getIdentity();
    if (!who) return NextResponse.json({ error: "Please log in." }, { status: 401 });
    if (who.id !== userId && !who.isAdmin) {
      return NextResponse.json({ error: "You can only delete your own account." }, { status: 403 });
    }

    // 1. Initialize Supabase Admin
    // Use SERVICE_ROLE_KEY (Never expose this on the frontend!)
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY! 
    );

    // 2. Delete the user from Supabase Auth FIRST
    // If this fails, we want to keep the MongoDB profile for debugging
    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    
    if (authError) {
      console.error("Supabase Auth Deletion Failed:", authError);
      return NextResponse.json({ error: "Auth deletion failed" }, { status: 500 });
    }

    // 3. Connect to MongoDB and wipe the social profile
    const client = await clientPromise;
    const db = client.db("punerimallus");
    
    await db.collection("profiles").deleteOne({ supabase_id: userId });

    // Their directory listings and communities live in MongoDB, which has no foreign keys,
    // so remove them here. Matched by account id only (an email match could hit someone else's listing).
    await Promise.all([
      db.collection("mallu_mart").deleteMany({ userId }),
      db.collection("community_circles").deleteMany({ userId }),
    ]);


    return NextResponse.json({ 
      success: true, 
      message: "Tribe member and Auth account permanently removed." 
    });

  } catch (error: any) {
    console.error("Critical Deletion Error:", error);
    return NextResponse.json({ error: "An internal error occurred during deletion" }, { status: 500 });
  }
}