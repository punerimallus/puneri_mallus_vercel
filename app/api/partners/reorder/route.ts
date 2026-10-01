import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { requireAdmin } from '@/lib/admin';

export async function POST(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const updates = await req.json(); // Array of { _id, order }
    
    if (!Array.isArray(updates)) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db('punerimallus');
    
    // Process all updates in parallel
    const bulkOps = updates.map((update: any) => ({
      updateOne: {
        filter: { _id: new ObjectId(update._id) },
        update: { $set: { order: update.order } }
      }
    }));

    if (bulkOps.length > 0) {
      await db.collection('partners').bulkWrite(bulkOps);
    }

    return NextResponse.json({ success: true, message: "Order updated successfully" });
  } catch (error: any) {
    console.error("REORDER ERROR:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}