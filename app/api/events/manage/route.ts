import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(request: Request) {
  try {
    const client = await clientPromise;
    const db = client.db("punerimallus");
    const data = await request.json();

    const { _id, ...eventData } = data;

    // SANITIZATION LOGIC
    const sanitizedEvent = {
      ...eventData,
      category: eventData.category?.trim().toUpperCase() || 'GENERAL',
      title: eventData.title?.trim().toUpperCase(),
      location: eventData.location?.trim().toUpperCase(),
      updated_at: new Date()
    };

    if (_id) {
      // 1. Fetch existing event to check for image replacement
      const oldEvent = await db.collection("events").findOne({ _id: new ObjectId(_id) });

      // 2. Cleanup Supabase if a new image was uploaded
      if (oldEvent?.image && oldEvent.image !== sanitizedEvent.image) {
        const fileName = oldEvent.image.split('/').pop();
        if (fileName) {
          await supabase.storage.from('events').remove([`posters/${fileName}`]);
        }
      }

      // 3. Update MongoDB
      await db.collection("events").updateOne(
        { _id: new ObjectId(_id) },
        { $set: sanitizedEvent }
      );
      return NextResponse.json({ success: true, message: "Event Intelligence Updated" });
    } else {
      // CREATE NEW
      const result = await db.collection("events").insertOne({
        ...sanitizedEvent,
        created_at: new Date()
      });
      return NextResponse.json({ success: true, id: result.insertedId, message: "Event Published to Tribe" });
    }
  } catch (error: any) {
    console.error("EVENT_MANAGE_ERROR:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db("punerimallus");
    
    // Check if any document exists where isUpcoming is true
    const upcoming = await db.collection("events").findOne({ isUpcoming: true });

    return NextResponse.json({ hasUpcoming: !!upcoming });
  } catch (error) {
    return NextResponse.json({ hasUpcoming: false }, { status: 500 });
  }
}