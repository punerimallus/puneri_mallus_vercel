import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { getIdentity, isLive, ownsDoc, publicView, visibleDocs } from '@/lib/ownership';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    const client = await clientPromise;
    const db = client.db("punerimallus");

    // Case 1: Fetch a specific Circle by ID
    if (id) {
      if (!ObjectId.isValid(id)) {
        return NextResponse.json({ error: "Invalid ID format" }, { status: 400 });
      }
      const circle = await db.collection("community_circles").findOne({ 
        _id: new ObjectId(id) 
      });
      if (!circle) return NextResponse.json({ error: "Node not found" }, { status: 404 });
      // Unpublished circles are only visible to their owner and to admins.
      const who = await getIdentity();
      if (who?.isAdmin || ownsDoc(circle as unknown as Record<string, unknown>, who)) return NextResponse.json(circle);
      if (!isLive(circle as unknown as Record<string, unknown>)) return NextResponse.json({ error: "Node not found" }, { status: 404 });
      return NextResponse.json(publicView(circle as unknown as Record<string, unknown>));
    }

    // Case 2: the grid. The `admin=true` flag no longer unlocks anything by itself: what you see depends on who you are.
    const circles = await db.collection("community_circles")
      .find({})
      /**
       * 🔥 THE FIX: REORDERING SORT
       * 1. order: 1 -> Follows your Drag & Drop sequence
       * 2. isVerified: -1 -> Keeps verified badge nodes prominent
       * 3. title: 1 -> Alphabetical fallback
       */
      .sort({ 
        order: 1, 
        isVerified: -1, 
        title: 1 
      }) 
      .toArray();
      
    const who = await getIdentity();
    return NextResponse.json(visibleDocs(circles as unknown as Record<string, unknown>[], who));
  } catch (e: any) {
    console.error("COMMUNITY_API_ERROR:", e);
    return NextResponse.json({ error: "Failed to sync with grid" }, { status: 500 });
  }
}