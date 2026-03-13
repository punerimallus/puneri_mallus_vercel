import { NextResponse } from 'next/server';
import clientPromise from "@/lib/mongodb";
import { createClient } from '@supabase/supabase-js';
import { ObjectId } from 'mongodb';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // Required to bypass RLS for deletion
);

export async function DELETE(req: Request) {
  try {
    const client = await clientPromise;
    const db = client.db("punerimallus");
    const { id, imagePath, userEmail } = await req.json();

    // 1. Ownership Check
    const post = await db.collection("mallu_mart").findOne({ 
      _id: new ObjectId(id), 
      userEmail: userEmail 
    });

    if (!post) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // 2. Clear Supabase Storage
    if (imagePath) {
      await supabaseAdmin.storage.from('mallu-mart').remove([imagePath]);
    }

    // 3. Clear MongoDB Document
    await db.collection("mallu_mart").deleteOne({ _id: new ObjectId(id) });

    return NextResponse.json({ message: "Cleaned up successfully" });
  } catch (error) {
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}