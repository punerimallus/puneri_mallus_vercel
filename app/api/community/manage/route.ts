import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/admin';
import { getIdentity, ownsDoc, stripAdminFields } from '@/lib/ownership';
import { 
  sendPendingCommunityEmail, 
  sendApprovedCommunityEmail, 
  sendAdminPendingAlert,
  sendRejectedCommunityEmail,
} from '@/lib/mail';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const getFileName = (url: string) => {
  if (!url || !url.includes('community/')) return null;
  const parts = url.split('community/')[1]; 
  return parts.split('?')[0];
};

export async function POST(req: Request) {
  try {
    // Everything here needs a real login. Who is asking comes from the session, never from the request body.
    const who = await getIdentity();
    if (!who) return NextResponse.json({ error: "Please log in." }, { status: 401 });

    const client = await clientPromise;
    const db = client.db("punerimallus");
    const data = await req.json();

    // 🔥 ADDED: REORDER LOGIC (Bulk Update)
    if (data.reorder && Array.isArray(data.newOrder)) {
      const denied = await requireAdmin();
      if (denied) return denied;
      const operations = data.newOrder.map((item: any) => ({
        updateOne: {
          filter: { _id: new ObjectId(item.id) },
          update: { $set: { order: item.order, updatedAt: new Date() } }
        }
      }));
      const result = await db.collection("community_circles").bulkWrite(operations);
      return NextResponse.json({ success: true, message: `Reordered ${result.modifiedCount} nodes` });
    }

    const { _id, isRejected, ...rawBody } = data;
    // Admins may set approval, verification and ordering. Everyone else can only change their own circle's content.
    const body: any = who.isAdmin ? { ...rawBody } : stripAdminFields(rawBody);

    if (body.category) body.category = body.category.toUpperCase();

    if (_id) {
      if (!ObjectId.isValid(_id)) {
        return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
      }

      const oldNode = await db.collection("community_circles").findOne({ 
        _id: new ObjectId(_id) 
      });

      if (!oldNode) return NextResponse.json({ error: "Not found" }, { status: 404 });
      if (!who.isAdmin && !ownsDoc(oldNode as unknown as Record<string, unknown>, who)) {
        return NextResponse.json({ error: "You can only edit your own community." }, { status: 403 });
      }

      if (oldNode) {
        // REJECTION LOGIC
        if (isRejected === true && who.isAdmin) {
          const submitterEmail = oldNode.submittedBy || body.submittedBy;
          if (submitterEmail) {
            await sendRejectedCommunityEmail(submitterEmail, body.title || oldNode.title);
          }
          body.isApproved = false;
        }

        if (body.image || body.imagePaths) {
          const oldImages = new Set([oldNode.image, ...(oldNode.imagePaths || [])].filter(Boolean));
          const newImages = new Set([body.image, ...(body.imagePaths || [])].filter(Boolean));

          const filesToDelete = Array.from(oldImages)
            .filter(url => !newImages.has(url))
            .map(url => getFileName(url))
            .filter(Boolean) as string[];

          if (filesToDelete.length > 0) {
            try {
              await supabaseAdmin.storage.from('community').remove(filesToDelete);
            } catch (err) {
              console.error("ASSET_CLEANUP_WARNING:", err);
            }
          }
        }

        // EMAIL LOGIC: CHECK FOR APPROVAL
        if (!oldNode.isApproved && body.isApproved === true) {
          const submitterEmail = oldNode.submittedBy || body.submittedBy;
          if (submitterEmail) {
            const adminIdentifier = body.approvedBy || "Tribe Moderator"; 
            await sendApprovedCommunityEmail(submitterEmail, body.title || oldNode.title, adminIdentifier, _id);
          }
        }

        // 🔥 ADDED: RE-APPROVAL & SMART NOTIFICATION LOGIC
        // Logic: Notify if it's NOT a draft AND it was previously a Draft OR previously Approved
        const isUserEdit = !who.isAdmin; 
        const shouldNotify = !body.isDraft && (oldNode.isDraft || oldNode.isApproved);

        if (isUserEdit) {
           body.isApproved = false; // Force reset on user edits
        }

        if (shouldNotify && isUserEdit) {
           const submitterEmail = oldNode.submittedBy || body.submittedBy;
           if (submitterEmail) await sendPendingCommunityEmail(submitterEmail, body.title || oldNode.title);
           
           const pendingCount = await db.collection("community_circles").countDocuments({ isApproved: false });
           await sendAdminPendingAlert(body.title || oldNode.title, pendingCount);
        }
      }

      await db.collection("community_circles").updateOne(
        { _id: new ObjectId(_id) },
        { 
          $set: { 
            ...body, 
            isDraft: body.isDraft ?? false,
            updatedAt: new Date() 
          } 
        }
      );
      
      return NextResponse.json({ message: "Node successfully updated" });
    } else {
      // NEW SUBMISSION LOGIC
      const result = await db.collection("community_circles").insertOne({
        ...body,
        userId: who.id,
        isDraft: body.isDraft ?? false,
        isApproved: false, 
        isVerified: false,
        order: 999, // 🔥 ADDED: Default high order
        services: body.services || [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      if (body.submittedBy && !body.isApproved && !body.isDraft) {
        await sendPendingCommunityEmail(body.submittedBy, body.title);

        try {
          const pendingCount = await db.collection("community_circles").countDocuments({ 
            isApproved: false 
          });
          await sendAdminPendingAlert(body.title, pendingCount);
        } catch (adminMailErr) {
          console.error("ADMIN_NOTIFY_ERROR:", adminMailErr);
        }
      }
      
      return NextResponse.json(result);
    }
  } catch (e: any) {
    console.error("COMMUNITY_MANAGE_CRITICAL_ERROR:", e);
    return NextResponse.json({ error: "Storage or database sync failed" }, { status: 500 });
  }
}