import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/admin';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// --- 1. ADD THIS GET FUNCTION TO FIX THE CRASH ---
export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db("punerimallus");
    
    const settings = await db.collection("site_settings").findOne({ type: "social_glimpse" });
    
    // Always return an array so the frontend .map() doesn't fail
    return NextResponse.json(settings?.posts || []);
  } catch (error) {
    console.error("Social Fetch Error:", error);
    return NextResponse.json([], { status: 500 });
  }
}

// --- 2. YOUR EXISTING POST FUNCTION ---
export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const body = await request.json(); 
    const client = await clientPromise;
    const db = client.db("punerimallus");

    // Fetch old glimpse data
    const oldSettings = await db.collection("site_settings").findOne({ type: "social_glimpse" });
    const oldPosts = oldSettings?.posts || [];

    // Identify images to delete
    const newImageUrls = new Set(body.map((post: any) => post.imageUrl));
    const orphans = oldPosts.filter((oldP: any) => oldP.imageUrl && !newImageUrls.has(oldP.imageUrl));

    if (orphans.length > 0) {
      const filesToRemove = orphans.map((o: any) => {
        const fileName = o.imageUrl.split('/').pop();
        return `thumbnail/${fileName}`;
      });

      await supabase.storage.from('events').remove(filesToRemove);
    }

    // Update MongoDB
    await db.collection("site_settings").updateOne(
      { type: "social_glimpse" },
      { $set: { posts: body, updatedAt: new Date() } },
      { upsert: true }
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Social Glimpse Update Error:", error);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}