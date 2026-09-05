import { NextResponse } from 'next/server';
import clientPromise from "@/lib/mongodb";
import { createClient } from '@supabase/supabase-js';
import { ObjectId } from 'mongodb';
import { cookies } from 'next/headers';
import { 
  sendMartPendingEmail, 
  sendMartLiveEmail, 
  sendMartRejectedEmail,
  sendAdminMartAlert,
  sendMartVerificationPendingEmail, 
  sendAdminVerificationAlert,
  sendMartVerificationSuccessEmail
} from "@/lib/mail";

export const dynamic = 'force-dynamic';
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

    // Always force isVerified to false on new submissions!
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

    if (data.userId) {
      await supabaseAdmin
        .from('directory_owners')
        .upsert({ 
          user_id: data.userId,
          source: 'MALLU_MART',
          status: data.isDraft ? 'SAVED_AS_DRAFT' : (data.emailVerified ? 'SUBMITTED_FOR_PUBLISHING' : 'PENDING_VERIFICATION')
        }, { onConflict: 'user_id, source' });
    }

    // Only send the admin emails right away if their EMAIL is already verified
    if (!data.isDraft && data.emailVerified) {
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

    // --- ADMIN AUDIT ---
    if (id && (isVerified !== undefined || isPremium !== undefined || isApproved !== undefined || isRejected === true)) {
      const updateFields: any = { updatedAt: new Date() };
      
      if (isVerified !== undefined) {
        updateFields.isVerified = isVerified;
        updateFields.verificationStatus = isVerified ? 'VERIFIED' : null;
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
          // 🔥 PASSING THE ID HERE FOR THE LIVE EMAIL LINK
          if (item?.userEmail) await sendMartLiveEmail(item.userEmail, item.name, item._id.toString());
        }
      }

      await db.collection("mallu_mart").updateOne({ _id: new ObjectId(id) }, { $set: updateFields });
      return NextResponse.json({ success: true, message: "Admin audit synced" });
    }

    if (!id) return NextResponse.json({ error: "Missing ID" }, { status: 400 });
    const existing = await db.collection("mallu_mart").findOne({ _id: new ObjectId(id) });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const authHeader = req.headers.get('cookie') || '';
    const isAdmin = authHeader.includes('admin_token');
    
    // Master Key Ownership Check
    const isOwner = (userEmail && existing.userEmail === userEmail) || (updatedData?.userId && existing.userId === updatedData.userId);

    if (!isAdmin && !isOwner) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // --- USER SUBMITTING VERIFICATION REQUEST ---
    if (verificationDocs && auditType === 'SUBMIT_VERIFICATION') {
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
      await sendMartVerificationPendingEmail(existing.userEmail || userEmail, existing.name);
      await sendAdminVerificationAlert(existing.name);
      return NextResponse.json({ success: true, message: "Verification files submitted" });
    }

    // --- USER EDIT (Standard) ---
    if (!updatedData) return NextResponse.json({ error: "Missing parameters" }, { status: 400 });

    const { _id: _, ...cleanData } = updatedData;
    if (cleanData.category) cleanData.category = cleanData.category.toUpperCase();

    const shouldNotify = !cleanData.isDraft && (existing.isDraft || existing.isApproved);

    // Never let a standard user edit change the isVerified status!
    await db.collection("mallu_mart").updateOne(
      { _id: new ObjectId(id) },
      { 
        $set: { 
          ...cleanData,
          isApproved: false, 
          isVerified: existing.isVerified, 
          isDraft: cleanData.isDraft ?? false,
          updatedAt: new Date() 
        } 
      }
    );

    const targetUserId = updatedData?.userId || existing.userId;
    if (targetUserId) {
      await supabaseAdmin
        .from('directory_owners')
        .upsert({ 
          user_id: targetUserId,
          source: 'MALLU_MART',
          status: cleanData.isDraft ? 'SAVED_AS_DRAFT' : 'SUBMITTED_FOR_PUBLISHING' 
        }, { onConflict: 'user_id, source' });
    }

    if (shouldNotify && cleanData.emailVerified) {
      await sendMartPendingEmail(existing.userEmail || userEmail, cleanData.name || existing.name);
      await sendAdminMartAlert(cleanData.name || existing.name, cleanData.category || existing.category);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("PATCH_ERROR:", error);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}

/**
 * 4. DELETE: REMOVE LISTING (OWNERS & ADMINS)
 */
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const adminEmail = searchParams.get('adminEmail');
    const userEmail = searchParams.get('userEmail');
    const userId = searchParams.get('userId');

    if (!id || !ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Valid ID required" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db("punerimallus");

    const post = await db.collection("mallu_mart").findOne({ _id: new ObjectId(id) });
    if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });

    let isAdmin = false;
    if (adminEmail) {
      const { data: adminRecord } = await supabaseAdmin
        .from('authorized_admins')
        .select('email')
        .eq('email', adminEmail)
        .maybeSingle();
      
      if (adminRecord) isAdmin = true;
    }

    const isOwner = (userEmail && post.userEmail === userEmail) || (userId && post.userId === userId);

    if (!isAdmin && !isOwner) {
      console.log("❌ DELETE BLOCKED - Not Admin & Not Owner");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const posterPaths = post.imagePaths || (post.imagePath ? [post.imagePath] : []);
    const verificationPaths = post.verificationDocs ? Object.values(post.verificationDocs) : [];
    
    const allFiles = [...posterPaths, ...verificationPaths].map(path => {
        if (typeof path === 'string' && path.includes('/')) return path.split('/').pop();
        return path;
    }).filter(Boolean) as string[];
    
    if (allFiles.length > 0) {
      try {
        await supabaseAdmin.storage.from('mallu-mart').remove(allFiles);
      } catch (err) {
        console.error("SUPABASE_STORAGE_PURGE_ERROR:", err);
      }
    }

    await db.collection("mallu_mart").deleteOne({ _id: new ObjectId(id) });
    
    return NextResponse.json({ message: "Business removed successfully" });
  } catch (error) {
    console.error("MART_DELETE_CRITICAL_ERROR:", error);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}