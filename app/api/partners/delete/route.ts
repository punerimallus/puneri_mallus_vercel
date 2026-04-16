import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { createClient } from '@supabase/supabase-js';

// Use Service Role Key for backend admin operations (bypasses RLS)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id || !ObjectId.isValid(id)) {
      return NextResponse.json({ error: "A valid Partner ID is required" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db("punerimallus");

    // 1. Fetch the partner to identify assets before database removal
    const partner = await db.collection("partners").findOne({ 
      _id: new ObjectId(id) 
    });

    if (!partner) {
      return NextResponse.json({ error: "Ally not found in grid" }, { status: 404 });
    }

    // 2. Purge the image asset from Supabase 'partners' bucket
    const imageUrl = partner.image || partner.logoUrl;
    if (imageUrl) {
      try {
        // Extract filename accurately by removing potential query params (?t=...)
        const urlParts = imageUrl.split('/');
        const fileNameWithParams = urlParts[urlParts.length - 1];
        const fileName = fileNameWithParams.split('?')[0];

        if (fileName) {
          await supabaseAdmin.storage
            .from('partners')
            .remove([fileName]);
        }
      } catch (storageErr) {
        console.error("PARTNER_ASSET_PURGE_WARNING:", storageErr);
        // Continue to delete the DB record even if asset removal fails
      }
    }

    // 3. Terminate the record in MongoDB
    const result = await db.collection("partners").deleteOne({ 
      _id: new ObjectId(id) 
    });

    if (result.deletedCount === 0) {
      return NextResponse.json({ error: "Dissolution failed" }, { status: 500 });
    }

    return NextResponse.json({ message: "Ally connection dissolved and assets removed." });

  } catch (e: any) {
    console.error("PARTNER_DELETE_CRITICAL_ERROR:", e);
    return NextResponse.json({ error: "System failure during dissolution" }, { status: 500 });
  }
}