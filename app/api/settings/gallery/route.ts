import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/admin';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // Use Service Role Key for backend deletions
);

export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db("punerimallus");
    
    const settings = await db.collection("site_settings").findOne({ type: "archive_gallery" });
    
    return NextResponse.json({ 
      events: settings?.events || [],
      // 🔥 NEW: Fetch global display settings
      displayMode: settings?.displayMode || 'MIX', 
      featuredEventId: settings?.featuredEventId || null
    });
  } catch (error: any) {
    console.error("Gallery Fetch Error:", error);
    return NextResponse.json({ events: [], error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    // 🔥 NEW: Extract display settings from the request
    const { events, displayMode, featuredEventId } = await request.json();
    
    if (!Array.isArray(events)) {
      return NextResponse.json({ error: "Invalid data format" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db("punerimallus");

    // Fetch current gallery to identify orphans for deletion
    const oldSettings = await db.collection("site_settings").findOne({ type: "archive_gallery" });
    const oldEvents = oldSettings?.events || [];

    // Flatten images from old and new events
    const oldImages = oldEvents.flatMap((e: any) => e.images || []);
    const newImageUrls = new Set(events.flatMap((e: any) => e.images || []));
    
    const orphans = oldImages.filter((oldUrl: string) => !newImageUrls.has(oldUrl));

    if (orphans.length > 0) {
      const filesToRemove = orphans.map((url: string) => {
        // Extract the exact path after '/assets/'
        const parts = url.split('/assets/');
        return parts.length > 1 ? parts[1] : url.split('/').pop();
      });

      // Clean up orphaned images from Supabase
      await supabase.storage.from('assets').remove(filesToRemove);
    }

    // Update MongoDB
    await db.collection("site_settings").updateOne(
      { type: "archive_gallery" },
      { 
        $set: { 
          events: events, 
          // 🔥 NEW: Save the global display settings
          displayMode: displayMode || 'MIX',
          featuredEventId: featuredEventId || null,
          updatedAt: new Date() 
        } 
      },
      { upsert: true }
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Gallery Post Error:", error);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}