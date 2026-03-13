import { NextResponse } from 'next/server';
import clientPromise from "@/lib/mongodb"; // Adjust path to your clientPromise file

export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db("punerimallus");
    
    const posts = await db.collection("mallu_mart")
      .find({})
      .sort({ isPremium: -1, createdAt: -1 })
      .toArray();
      
    return NextResponse.json(posts);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const client = await clientPromise;
    const db = client.db("punerimallus");
    const body = await req.json();

    const result = await db.collection("mallu_mart").insertOne({
      ...body,
      isPremium: false,
      isVerified: false,
      createdAt: new Date(),
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Post failed" }, { status: 500 });
  }
}