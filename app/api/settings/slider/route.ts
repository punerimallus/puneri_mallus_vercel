import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/admin';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db("punerimallus");
    const settings = await db.collection("site_settings").findOne({ type: "slider" });
    return NextResponse.json(settings || { slides: [] });
  } catch (error) {
    console.error("Slider Fetch Error:", error);
    return NextResponse.json({ error: "Failed to fetch slider settings" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { slides } = await request.json(); // New array of slide objects
    const client = await clientPromise;
    const db = client.db("punerimallus");

    // 1. Fetch old slides to find orphans
    const oldSettings = await db.collection("site_settings").findOne({ type: "slider" });
    const oldSlides = oldSettings?.slides || [];

    // 2. Map new URLs for comparison
    const newMediaUrls = new Set(slides.map((s: any) => s.mediaUrl));

    // 3. Find slides that were in the old list but aren't in the new one
    const orphans = oldSlides.filter((oldS: any) => oldS.mediaUrl && !newMediaUrls.has(oldS.mediaUrl));

    if (orphans.length > 0) {
      const filesToRemove = orphans.map((o: any) => {
        const fileName = o.mediaUrl.split('/').pop();
        // Path matches hero-slider folder in assets bucket
        return `hero-slider/${fileName}`;
      });

      await supabase.storage.from('assets').remove(filesToRemove);
    }

    

    // 4. Update MongoDB
    await db.collection("site_settings").updateOne(
      { type: "slider" },
      { 
        $set: { 
          slides, 
          updatedAt: new Date() 
        } 
      },
      { upsert: true }
    );

    return NextResponse.json({ success: true, message: "Slider synced to cloud" });
  } catch (error) {
    console.error("Slider Save Error:", error);
    return NextResponse.json({ error: "Failed to save slider settings" }, { status: 500 });
  }
}