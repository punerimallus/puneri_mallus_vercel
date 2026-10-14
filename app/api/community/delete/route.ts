// app/api/community/delete/route.ts
import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { createClient } from '@supabase/supabase-js';
import { getIdentity, ownsDoc } from '@/lib/ownership';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const getFileName = (url: string) => {
  if (!url || !url.includes('community/')) return null;
  const parts = url.split('community/'); 
  const fileNameWithParams = parts[1]; 
  return fileNameWithParams.split('?')[0]; 
};

export async function DELETE(req: Request) {
  try {
    // 🔥 THE FIX: Extract 'id' from the URL, not the body
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id || !ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Valid ID required" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db("punerimallus");

    // 1. Fetch node to verify ownership and grab asset list
    const node = await db.collection("community_circles").findOne({ 
      _id: new ObjectId(id) 
    });

    if (!node) {
      return NextResponse.json({ error: "Node not found" }, { status: 404 });
    }

    // Only an admin, or the account that owns this circle, may delete it. The login session decides.
    const who = await getIdentity();
    if (!who) return NextResponse.json({ error: "Please log in." }, { status: 401 });
    if (!who.isAdmin && !ownsDoc(node as unknown as Record<string, unknown>, who)) {
      return NextResponse.json({ error: "You can only delete your own community." }, { status: 403 });
    }

    // 2. Comprehensive Asset Purge from Supabase
    const allAssetUrls = new Set([
      node.image, 
      ...(node.imagePaths || [])
    ].filter(Boolean));

    const filesToDelete = Array.from(allAssetUrls)
      .map(url => getFileName(url))
      .filter(Boolean) as string[];

    if (filesToDelete.length > 0) {
      try {
        const { error: storageError } = await supabaseAdmin.storage
          .from('community')
          .remove(filesToDelete);

        if (storageError) {
          console.error("SUPABASE_STORAGE_PURGE_ERROR:", storageError);
        }
      } catch (err) {
        console.error("ASSET_PURGE_CRITICAL_WARNING:", err);
      }
    }

    // 3. Final Step: Delete from MongoDB
    const result = await db.collection("community_circles").deleteOne({ 
      _id: new ObjectId(id) 
    });

    return NextResponse.json({ 
      message: "Node and associated assets successfully purged",
      deletedCount: result.deletedCount 
    });

  } catch (e: any) {
    console.error("COMMUNITY_DELETE_CRITICAL_ERROR:", e);
    return NextResponse.json({ error: "Dissolution protocol failed" }, { status: 500 });
  }
}