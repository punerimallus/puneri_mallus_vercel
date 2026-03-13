import { NextResponse } from 'next/server';
import clientPromise from "@/lib/mongodb";
import { createClient } from '@supabase/supabase-js';
import { ObjectId } from 'mongodb';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function PATCH(req: Request) {
  try {
    const client = await clientPromise;
    const db = client.db("punerimallus");
    const { id, userEmail, oldPath, newPath, updatedData } = await req.json();

    // Clean old image if a new one is provided
    if (newPath && oldPath && newPath !== oldPath) {
      await supabaseAdmin.storage.from('mallu-mart').remove([oldPath]);
    }

    await db.collection("mallu_mart").updateOne(
      { _id: new ObjectId(id), userEmail: userEmail },
      { $set: { ...updatedData, imagePath: newPath || oldPath } }
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}