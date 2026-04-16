import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { createClient } from '@supabase/supabase-js';

// IMPORTANT: Use Service Role Key for administrative deletions
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! 
);

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: "ID required" }, { status: 400 });

    const client = await clientPromise;
    const db = client.db("punerimallus");

    // 1. Find the event to retrieve both poster and logo URLs
    const event = await db.collection("events").findOne({ _id: new ObjectId(id) });

    if (event) {
      const filesToDelete: string[] = [];

      // Extract and add poster to deletion queue
      if (event.image) {
        const posterFileName = event.image.split('/').pop();
        if (posterFileName) filesToDelete.push(`posters/${posterFileName}`);
      }

      // 🔥 NEW: Extract and add category logo to deletion queue
      if (event.categoryLogo) {
        const logoFileName = event.categoryLogo.split('/').pop();
        if (logoFileName) filesToDelete.push(`logos/${logoFileName}`);
      }

      // 2. Perform bulk deletion from Supabase
      if (filesToDelete.length > 0) {
        try {
          await supabase.storage.from('events').remove(filesToDelete);
        } catch (storageErr) {
          console.error("SUPABASE_CLEANUP_ERROR:", storageErr);
          // We continue anyway to ensure the DB record is deleted
        }
      }
    }

    // 3. Delete the document from MongoDB
    const result = await db.collection("events").deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return NextResponse.json({ error: "Node not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: "Event and associated assets removed" });
  } catch (error: any) {
    console.error("DELETE_EVENT_CRITICAL_ERROR:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}