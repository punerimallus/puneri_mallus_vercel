import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! 
);

// Helper to extract filename from Supabase URL
const getFileName = (url: string) => {
  if (!url) return null;
  return url.split('/').pop();
};

export async function POST(request: Request) {
  try {
    const client = await clientPromise;
    const db = client.db("punerimallus");
    const data = await request.json();

    const { _id, ...eventData } = data;

    const sanitizedEvent = {
      ...eventData,
      category: eventData.category?.trim().toUpperCase() || 'GENERAL',
      title: eventData.title?.trim().toUpperCase(),
      location: eventData.location?.trim().toUpperCase(),
      // Ensure categoryLogo is included in the set
      categoryLogo: eventData.categoryLogo || '',
      updated_at: new Date()
    };

    if (_id) {
      const oldEvent = await db.collection("events").findOne({ _id: new ObjectId(_id) });

      if (oldEvent) {
        const filesToDelete: string[] = [];

        // 1. Cleanup Old Poster if changed
        if (oldEvent.image && oldEvent.image !== sanitizedEvent.image) {
          const posterFile = getFileName(oldEvent.image);
          if (posterFile) filesToDelete.push(`posters/${posterFile}`);
        }

        // 2. 🔥 NEW: Cleanup Old Category Logo if changed
        if (oldEvent.categoryLogo && oldEvent.categoryLogo !== sanitizedEvent.categoryLogo) {
          const logoFile = getFileName(oldEvent.categoryLogo);
          if (logoFile) filesToDelete.push(`logos/${logoFile}`);
        }

        // Execute Supabase removal
        if (filesToDelete.length > 0) {
          await supabase.storage.from('events').remove(filesToDelete);
        }
      }

      await db.collection("events").updateOne(
        { _id: new ObjectId(_id) },
        { $set: sanitizedEvent }
      );
      return NextResponse.json({ success: true, message: "Event Updated" });
    } else {
      const result = await db.collection("events").insertOne({
        ...sanitizedEvent,
        created_at: new Date()
      });
      return NextResponse.json({ success: true, id: result.insertedId });
    }
  } catch (error: any) {
    console.error("EVENT_MANAGE_ERROR:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * GET: Checks for events with a date greater than NOW for Navbar Zap indicators
 */
export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db("punerimallus");
    
    const now = new Date().toISOString();
    
    // Safety check for navbar "Live" signals
    const upcoming = await db.collection("events").findOne({
      $or: [
        { featured: true }, // Often featured events are what we want to signal
        { date: { $gte: now } }
      ]
    });

    return NextResponse.json({ hasUpcoming: !!upcoming });
  } catch (error) {
    console.error("API_SIGNAL_CHECK_ERROR:", error);
    return NextResponse.json({ hasUpcoming: false });
  }
}