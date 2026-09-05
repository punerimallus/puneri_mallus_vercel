import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { 
  sendBusinessVerificationEmail, 
  sendMartPendingEmail, 
  sendAdminMartAlert 
} from '@/lib/mail';

// 🔥 DISABLE CACHING
export const dynamic = 'force-dynamic';

// Use Service Role to bypass RLS for token checking
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// 1. GET: THIS RUNS WHEN THE USER CLICKS THE LINK IN THEIR EMAIL AT THE END
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');

  if (!token) return new NextResponse("Missing token", { status: 400 });

  // Find the record by token
  const { data: ownerRecord, error: fetchError } = await supabaseAdmin
    .from('directory_owners')
    .select('*')
    .eq('verification_token', token)
    .maybeSingle();

  if (fetchError || !ownerRecord) {
    return new NextResponse("Invalid or expired verification link", { status: 400 });
  }

  // Update Supabase tracker to verified (Email Verification ONLY)
  await supabaseAdmin
    .from('directory_owners')
    .update({ 
      is_verified: true, 
      verification_token: null,
      status: 'SUBMITTED_FOR_PUBLISHING' 
    }) 
    .eq('verification_token', token);

  // Trigger the pending emails directly using the ownerRecord data
  try {
     await sendMartPendingEmail(ownerRecord.verified_email, ownerRecord.business_name);
     await sendAdminMartAlert(ownerRecord.business_name, "Directory");
  } catch(e) {
     console.error("Failed to send post-verification emails", e);
  }

  // Return a clean, professional success screen
  return new NextResponse(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Business Listing Verified & Submitted</title>
      <style>
        body { margin: 0; padding: 0; background-color: #030303; color: #fff; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; }
        .container { text-align: center; background: #09090b; border: 1px solid rgba(255, 255, 255, 0.1); padding: 50px 30px; border-radius: 30px; max-width: 420px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.8); width: 90%; }
        .icon { width: 80px; height: 80px; background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.2); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; box-shadow: 0 0 30px rgba(34, 197, 94, 0.2); }
        .icon svg { width: 40px; height: 40px; color: #22c55e; }
        h1 { color: #fff; font-size: 22px; font-weight: 900; text-transform: uppercase; font-style: italic; letter-spacing: -0.5px; margin: 0 0 10px; }
        p.subtitle { color: #a1a1aa; font-size: 14px; line-height: 1.6; margin: 0 0 25px; }
        .badge { background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); padding: 15px; border-radius: 12px; }
        .badge p { color: #22c55e; font-size: 12px; font-weight: bold; margin: 0; text-transform: uppercase; letter-spacing: 1px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="icon">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
        </div>
        <h1>Listing Submitted!</h1>
        <p class="subtitle">Your email address has been confirmed and your business listing is now successfully in review by our team.</p>
        <div class="badge">
          <p>You can now close this tab</p>
        </div>
      </div>
      <script>
        setTimeout(() => {
          window.focus();
        }, 1000);
      </script>
    </body>
    </html>
  `, { headers: { 'Content-Type': 'text/html' } });
}

// 2. POST: THIS RUNS WHEN THE USER HITS PUBLISH AND NEEDS A VERIFICATION LINK SENT
export async function POST(req: Request) {
  try {
    const { userId, fullName, phone, businessName, email, source } = await req.json();
    
    // Generate a secure random verification token
    const token = crypto.randomBytes(32).toString('hex');

    // Upsert the record into directory_owners with the token and pending verification status
    await supabaseAdmin.from('directory_owners').upsert({
      user_id: userId,
      full_name: fullName,
      phone_number: phone,
      business_name: businessName,
      verified_email: email,
      source: source,
      is_verified: false,
      verification_token: token,
      status: 'PENDING_VERIFICATION'
    }, { onConflict: 'user_id, source' });

    // Generate the click link pointing to this route
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const verifyLink = `${baseUrl}/api/business/verify?token=${token}`;

    // Send the verification email to the user
    await sendBusinessVerificationEmail(email, verifyLink, businessName);
    
    console.log("TESTING LINK (Click this in your terminal):", verifyLink);

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}