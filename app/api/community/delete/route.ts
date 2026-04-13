import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// 🔥 IMPROVED: More robust filename extraction
const getFileName = (url: string) => {
  if (!url || !url.includes('community/')) return null;
  // This handles URLs even if they have folders or complex structures
  const parts = url.split('community/'); 
  const fileNameWithParams = parts[1]; // Get everything after 'community/'
  return fileNameWithParams.split('?')[0]; // Strip query params like ?v=123
};

export async function DELETE(req: Request) {
  try {
    const { id, userEmail } = await req.json();

    // Basic Validation
    if (!id || !ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Valid ID required" }, { status: 400 });
    }
    if (!userEmail) {
      return NextResponse.json({ error: "User authentication required" }, { status: 401 });
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

    // 🔒 SECURE Bouncer Check
    // We lowercase both to prevent "Unauthorized" errors caused by typos
    const owner = node.submittedBy?.toLowerCase();
    const requester = userEmail?.toLowerCase();

    if (!owner || owner !== requester) {
      console.log(`[AUTH_FAIL] Owner: ${owner}, Requester: ${requester}`);
      return NextResponse.json(
        { error: "Unauthorized access: You don't own this node" }, 
        { status: 403 }
      );
    }

    // 2. Comprehensive Asset Purge from Supabase
    // Collect main image and gallery images into a unique set
    const allAssetUrls = new Set([
      node.image, 
      ...(node.imagePaths || [])
    ].filter(Boolean));

    const filesToDelete = Array.from(allAssetUrls)
      .map(url => getFileName(url))
      .filter(Boolean) as string[];

    if (filesToDelete.length > 0) {
      try {
        // We use supabaseAdmin here because client-side tokens don't usually have Delete permissions
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