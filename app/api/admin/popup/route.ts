import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/admin';

const DB_NAME = "punerimallus";
const COLLECTION = "popups";

// Initialize Supabase Admin with SERVICE_ROLE_KEY to bypass RLS for deletion
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! 
);

/**
 * Robust helper to extract filename from Supabase URL
 */
const getFileNameFromUrl = (url: string) => {
  if (!url) return null;
  const parts = url.split('/');
  return parts[parts.length - 1];
};

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const mode = searchParams.get('mode'); 
    const client = await clientPromise;
    const db = client.db(DB_NAME);

    if (mode === 'all') {
      const denied = await requireAdmin();
      if (denied) return denied;
      const allAds = await db.collection(COLLECTION).find({}).sort({ createdAt: -1 }).toArray();
      return NextResponse.json(allAds);
    }

    const activeAd = await db.collection(COLLECTION).findOne({ isActive: true });
    return NextResponse.json({ show: !!activeAd, data: activeAd });
  } catch (error) {
    return NextResponse.json({ error: "Terminal Link Interrupted" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const body = await req.json();
    const client = await clientPromise;
    const db = client.db(DB_NAME);

    const newAd = {
      ...body,
      delay: Number(body.delay) || 3000,
      duration: Number(body.duration) || 10000,
      isActive: true,
      createdAt: new Date(),
    };

    // Global toggle: ensure only one collab is live
    await db.collection(COLLECTION).updateMany({}, { $set: { isActive: false } });
    const result = await db.collection(COLLECTION).insertOne(newAd);

    return NextResponse.json({ success: true, id: result.insertedId });
  } catch (error) {
    return NextResponse.json({ error: "Injection Failed" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const body = await req.json();
    const { id, isActive, delay, duration, title, subtitle, link, imageUrl } = body;
    
    const client = await clientPromise;
    const db = client.db(DB_NAME);

    const existingAd = await db.collection(COLLECTION).findOne({ _id: new ObjectId(id) });
    if (!existingAd) return NextResponse.json({ error: "Ad not found" }, { status: 404 });

    const updateFields: any = {};
    if (typeof isActive !== 'undefined') updateFields.isActive = isActive;
    if (typeof delay !== 'undefined') updateFields.delay = Number(delay);
    if (typeof duration !== 'undefined') updateFields.duration = Number(duration);
    if (title) updateFields.title = title;
    if (subtitle) updateFields.subtitle = subtitle;
    if (link) updateFields.link = link;

    // Handle Image Replacement & Storage Cleanup
    if (imageUrl && existingAd.imageUrl !== imageUrl) {
      updateFields.imageUrl = imageUrl;
      
      const oldFileName = getFileNameFromUrl(existingAd.imageUrl);
      if (oldFileName) {
        await supabaseAdmin.storage.from('ads').remove([oldFileName]);
      }
    }

    // Exclusivity check
    if (isActive === true) {
      await db.collection(COLLECTION).updateMany({ _id: { $ne: new ObjectId(id) } }, { $set: { isActive: false } });
    }

    await db.collection(COLLECTION).updateOne(
      { _id: new ObjectId(id) },
      { $set: updateFields }
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Patch Command Failed" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { id } = await req.json();
    const client = await clientPromise;
    const db = client.db(DB_NAME);

    // 1. Locate ad in terminal to retrieve asset URL before deletion
    const adToDelete = await db.collection(COLLECTION).findOne({ _id: new ObjectId(id) });

    if (adToDelete && adToDelete.imageUrl) {
      const fileName = getFileNameFromUrl(adToDelete.imageUrl);
      if (fileName) {
        // 2. Wipe asset from Supabase Storage
        const { error: storageError } = await supabaseAdmin
          .storage
          .from('ads')
          .remove([fileName]);
          
        if (storageError) console.error("Storage Deletion Warning:", storageError);
      }
    }

    // 3. Purge JSON record from MongoDB
    await db.collection(COLLECTION).deleteOne({ _id: new ObjectId(id) });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Purge Execution Failed" }, { status: 500 });
  }
}