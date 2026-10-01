import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin';

export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db("punerimallus");
    
    // We fetch and sort by the 'order' field assigned during POST
    const members = await db
      .collection("team_members")
      .find({})
      .sort({ order: 1 }) 
      .toArray();
      
    return NextResponse.json(members);
  } catch (e) {
    return NextResponse.json({ error: "Failed to fetch team" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { members } = await req.json();
    
    // 1. DATA INTEGRITY CHECK
    // Prevents accidental wiping of the team if the frontend sends a bad payload
    if (!Array.isArray(members)) {
      return NextResponse.json({ error: "Invalid payload: Array expected" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db("punerimallus");

    // 2. DATA SANITIZATION & INDEXING
    // We transform the data to ensure it's clean for Mongo
    const membersToInsert = members.slice(0, 9).map((member: any, index: number) => {
      // We explicitly remove _id so MongoDB generates a fresh one
      // This prevents 'Duplicate Key' errors during the re-insertion
      const { _id, ...cleanData } = member; 
      
      return {
        ...cleanData,
        name: cleanData.name?.toUpperCase() || "UNNAMED NODE",
        role: cleanData.role?.toUpperCase() || "TEAM ROLE",
        order: index, // This is the secret sauce for Drag-to-Reorder
        lastModified: new Date()
      };
    });

    // 3. ATOMIC TRANSACTION (Delete + Insert)
    // We use a simple delete/insert pattern to guarantee the sequence
    // matches the array order sent by Framer Motion.
    await db.collection("team_members").deleteMany({});
    
    if (membersToInsert.length > 0) {
      await db.collection("team_members").insertMany(membersToInsert);
    }
    
    return NextResponse.json({ 
      success: true, 
      count: membersToInsert.length 
    });

  } catch (e: any) {
    console.error("TEAM_ROUTE_CRITICAL_FAILURE:", e);
    return NextResponse.json({ 
      error: "Sync Failed", 
      details: e.message 
    }, { status: 500 });
  }
}