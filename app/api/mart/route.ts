import { NextResponse } from 'next/server';
import clientPromise from "@/lib/mongodb";
import { createClient } from '@supabase/supabase-js';
import { ObjectId } from 'mongodb';
import { 
  sendMartPendingEmail, 
  sendMartLiveEmail, 
  sendMartRejectedEmail,
  sendAdminMartAlert,
  sendMartVerificationPendingEmail, 
  sendAdminVerificationAlert,
  sendMartVerificationSuccessEmail // 🔥 Added for verification approval
} from "@/lib/mail";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * 1. GET: FETCH ALL LISTINGS
 */
export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db("punerimallus");
    
    // Sort by: Manual Order > Verified > Premium > Newest
    const items = await db.collection("mallu_mart")
      .find({})
      .sort({ order: 1, isVerified: -1, isPremium: -1, createdAt: -1 })
      .toArray();

    return NextResponse.json(items);
  } catch (e) {
    return NextResponse.json({ error: "Fetch failed" }, { status: 500 });
  }
}

/**
 * 2. POST: CREATE A NEW LISTING
 */
export async function POST(req: Request) {
  try {
    const data = await req.json();
    const client = await clientPromise;
    const db = client.db("punerimallus");

    if (data.category) data.category = data.category.toUpperCase();

    const result = await db.collection("mallu_mart").insertOne({
      ...data,
      isApproved: false, 
      isVerified: false,
      isPremium: false,
      verificationStatus: null,
      isDraft: data.isDraft ?? false,
      order: 999, 
      createdAt: new Date(),
      updatedAt: new Date()
    });

    if (!data.isDraft) {
      if (data.userEmail) {
        await sendMartPendingEmail(data.userEmail, data.name);
      }
      await sendAdminMartAlert(data.name, data.category);
    }

    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: "Creation failed" }, { status: 500 });
  }
}

/**
 * 3. PATCH: UPDATE / AUDIT / VERIFY
 */
export async function PATCH(req: Request) {
  try {
    const client = await clientPromise;
    const db = client.db("punerimallus");
    const body = await req.json();

    // --- CASE A: BULK REORDER ---
    if (body.reorder && Array.isArray(body.newOrder)) {
      const operations = body.newOrder.map((item: any) => ({
        updateOne: {
          filter: { _id: new ObjectId(item.id) },
          update: { $set: { order: item.order, updatedAt: new Date() } }
        }
      }));
      const result = await db.collection("mallu_mart").bulkWrite(operations);
      return NextResponse.json({ success: true, message: `Reordered ${result.modifiedCount} items` });
    }

    const { id, userEmail, updatedData, isVerified, isPremium, isApproved, isRejected, verificationDocs, auditType } = body;

    // --- CASE B: ADMIN AUDIT (Approval / Verification / Premium) ---
    if (id && (isVerified !== undefined || isPremium !== undefined || isApproved !== undefined || isRejected === true)) {
      const updateFields: any = { updatedAt: new Date() };
      
      if (isVerified !== undefined) {
        updateFields.isVerified = isVerified;
        updateFields.verificationStatus = isVerified ? 'VERIFIED' : null;

        // 🔥 Trigger Success Email on Verification Approval
        if (isVerified === true) {
          const item = await db.collection("mallu_mart").findOne({ _id: new ObjectId(id) });
          if (item?.userEmail) {
            await sendMartVerificationSuccessEmail(item.userEmail, item.name);
          }
        }
      }
      
      if (isPremium !== undefined) updateFields.isPremium = isPremium;
      
      if (isRejected === true) {
        updateFields.isApproved = false;
        const item = await db.collection("mallu_mart").findOne({ _id: new ObjectId(id) });
        if (item?.userEmail) await sendMartRejectedEmail(item.userEmail, item.name);
      } 
      else if (isApproved !== undefined) {
        updateFields.isApproved = isApproved;
        if (isApproved === true) {
          const item = await db.collection("mallu_mart").findOne({ _id: new ObjectId(id) });
          if (item?.userEmail) await sendMartLiveEmail(item.userEmail, item.name);
        }
      }

      await db.collection("mallu_mart").updateOne({ _id: new ObjectId(id) }, { $set: updateFields });
      return NextResponse.json({ success: true, message: "Admin audit synced" });
    }

    // --- CASE C: USER SUBMITTING VERIFICATION REQUEST ---
    if (id && userEmail && verificationDocs && auditType === 'SUBMIT_VERIFICATION') {
      const existing = await db.collection("mallu_mart").findOne({ 
        _id: new ObjectId(id), 
        userEmail: userEmail 
      });

      if (!existing) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

      await db.collection("mallu_mart").updateOne(
        { _id: new ObjectId(id) },
        { 
          $set: { 
            verificationDocs: verificationDocs,
            verificationStatus: 'PENDING',
            updatedAt: new Date()
          } 
        }
      );

      await sendMartVerificationPendingEmail(userEmail, existing.name);
      await sendAdminVerificationAlert(existing.name);

      return NextResponse.json({ success: true, message: "Verification files submitted" });
    }

    // --- CASE D: USER EDIT (Standard) ---
    if (!userEmail || !updatedData) {
      return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
    }

    const existing = await db.collection("mallu_mart").findOne({ 
      _id: new ObjectId(id), 
      userEmail: userEmail 
    });

    if (!existing) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { _id: _, ...cleanData } = updatedData;
    if (cleanData.category) cleanData.category = cleanData.category.toUpperCase();

    const shouldNotify = !cleanData.isDraft && (existing.isDraft || existing.isApproved);

    await db.collection("mallu_mart").updateOne(
      { _id: new ObjectId(id), userEmail: userEmail },
      { 
        $set: { 
          ...cleanData,
          isApproved: false, 
          isDraft: cleanData.isDraft ?? false,
          updatedAt: new Date() 
        } 
      }
    );

    if (shouldNotify) {
      await sendMartPendingEmail(userEmail, cleanData.name || existing.name);
      await sendAdminMartAlert(cleanData.name || existing.name, cleanData.category || existing.category);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("PATCH_ERROR:", error);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}

/**
 * 4. DELETE: REMOVE LISTING
 */
export async function DELETE(req: Request) {
  try {
    const client = await clientPromise;
    const db = client.db("punerimallus");
    const { id, userEmail } = await req.json();

    const query: any = { _id: new ObjectId(id) };
    if (userEmail) query.userEmail = userEmail;

    const post = await db.collection("mallu_mart").findOne(query);
    if (!post) return NextResponse.json({ error: "Unauthorized or not found" }, { status: 401 });

    const posterPaths = post.imagePaths || (post.imagePath ? [post.imagePath] : []);
    const verificationPaths = post.verificationDocs ? Object.values(post.verificationDocs) : [];
    
    const allFiles = [...posterPaths, ...verificationPaths].map(path => {
        if (typeof path === 'string' && path.includes('/')) return path.split('/').pop();
        return path;
    }).filter(Boolean);
    
    if (allFiles.length > 0) {
      await supabaseAdmin.storage.from('mallu-mart').remove(allFiles);
    }

    await db.collection("mallu_mart").deleteOne({ _id: new ObjectId(id) });
    
    // 🔥 Cleanup complete: Removed "Node" and "Purged"
    return NextResponse.json({ message: "Business and associated documents removed successfully" });
  } catch (error) {
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}