import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { createClient } from '@supabase/supabase-js';

// Use Service Role Key for backend storage operations (Deletions)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  try {
    const client = await clientPromise;
    const db = client.db("punerimallus");
    const data = await req.json();

    const { _id, ...body } = data;

    // Strict Data Sanitation
    const sanitizedPartner = {
      name: body.name?.toUpperCase().trim(),
      category: body.category, // e.g. "Executive Council"
      description: body.description,
      perk: body.perk?.toUpperCase().trim(),
      link: body.link?.trim(), // Website
      image: body.image,
      instagram: body.instagram?.replace('@', '').trim(),
      // ADD THIS LINE - It was missing!
      contact: body.contact?.replace(/\D/g, ''),
      whatsapp: body.whatsapp?.replace(/\D/g, ''), // Clean phone number
      updated_at: new Date()
    };

    if (_id) {
      if (!ObjectId.isValid(_id)) {
        return NextResponse.json({ error: "Invalid Ally ID" }, { status: 400 });
      }

      // 1. Fetch the existing partner to check for image replacement
      const oldPartner = await db.collection("partners").findOne({ 
        _id: new ObjectId(_id) 
      });

      // 2. If image changed, purge the old asset from Supabase
      if (oldPartner?.image && body.image && oldPartner.image !== body.image) {
        try {
          const urlParts = oldPartner.image.split('/');
          const fileNameWithParams = urlParts[urlParts.length - 1];
          const fileName = fileNameWithParams.split('?')[0]; // Remove tokens/params

          if (fileName) {
            await supabaseAdmin.storage
              .from('partners')
              .remove([fileName]);
          }
        } catch (storageErr) {
          console.error("PARTNER_ASSET_CLEANUP_WARNING:", storageErr);
        }
      }

      // 3. Update Existing Record
      await db.collection("partners").updateOne(
        { _id: new ObjectId(_id) },
        { $set: sanitizedPartner }
      );

      return NextResponse.json({ message: "Ally intelligence synchronized." });
    } else {
      // 4. Onboard New Ally
      const result = await db.collection("partners").insertOne({
        ...sanitizedPartner,
        created_at: new Date()
      });

      return NextResponse.json({ 
        message: "New Ally integrated into the Grid.", 
        id: result.insertedId 
      });
    }
  } catch (e: any) {
    console.error("PARTNER_MANAGE_CRITICAL_ERROR:", e);
    return NextResponse.json({ error: "Grid synchronization failed" }, { status: 500 });
  }
}