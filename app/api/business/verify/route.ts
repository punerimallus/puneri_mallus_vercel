import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { sendBusinessVerificationEmail } from '@/lib/mail';

// 🔥 DISABLE CACHING
export const dynamic = 'force-dynamic';

// Use Service Role to bypass RLS for token checking
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// 1. GET: THIS RUNS WHEN THE USER CLICKS THE LINK IN THEIR EMAIL
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');

  if (!token) return new NextResponse("Missing token", { status: 400 });

  // Find the record and mark it verified
  const { error } = await supabaseAdmin
    .from('directory_owners')
    .update({ is_verified: true, verification_token: null }) // Clear token after use
    .eq('verification_token', token);

  if (error) return new NextResponse("Invalid or expired link", { status: 400 });

  // Return a success screen with a script to try refocusing the original tab and closing/notifying
  return new NextResponse(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Verification Successful</title>
      <style>
        body { margin: 0; padding: 0; background-color: #000; color: #fff; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; }
        .container { text-align: center; background: #09090b; border: 1px solid rgba(255, 255, 255, 0.1); padding: 50px 30px; border-radius: 30px; max-width: 400px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); width: 90%; }
        .icon { width: 80px; height: 80px; background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.2); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; box-shadow: 0 0 30px rgba(34, 197, 94, 0.2); }
        .icon svg { width: 40px; height: 40px; color: #22c55e; }
        h1 { color: #fff; font-size: 24px; font-weight: 900; text-transform: uppercase; font-style: italic; letter-spacing: -0.5px; margin: 0 0 10px; }
        p.subtitle { color: #a1a1aa; font-size: 14px; line-height: 1.6; margin: 0 0 30px; }
        .instruction { background: rgba(34, 197, 94, 0.1); border: 1px dashed rgba(34, 197, 94, 0.3); padding: 15px; border-radius: 12px; }
        .instruction p { color: #22c55e; font-size: 13px; font-weight: bold; margin: 0; text-transform: uppercase; letter-spacing: 1px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="icon">
          <!-- Green Checkmark SVG -->
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
        </div>
        <h1>Identity Verified!</h1>
        <p class="subtitle">Your email address has been successfully confirmed.</p>
        <div class="instruction">
          <p>Switching back to your original tab automatically...</p>
        </div>
      </div>
      <script>
        // Attempt to bring the user back to their original window/tab after 1 second
        setTimeout(() => {
          window.focus();
          // Some modern browsers block automatic window closing unless opened by script, 
          // but focusing helps pull the original tab forward if it's open side-by-side.
        }, 1000);
      </script>
    </body>
    </html>
  `, { headers: { 'Content-Type': 'text/html' } });
}

// 2. POST: THIS RUNS WHEN THE FRONTEND REQUESTS A LINK
export async function POST(req: Request) {
  try {
    const { userId, fullName, phone, businessName, email, source } = await req.json();
    
    // Generate a secure random string
    const token = crypto.randomBytes(32).toString('hex');

    // Upsert the UNVERIFIED record into the database
    await supabaseAdmin.from('directory_owners').upsert({
      user_id: userId,
      full_name: fullName,
      phone_number: phone,
      business_name: businessName,
      verified_email: email,
      source: source,
      is_verified: false,
      verification_token: token
    }, { onConflict: 'user_id, source' });

    // Generate the click link
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const verifyLink = `${baseUrl}/api/business/verify?token=${token}`;

    // Trigger the Resend email function
    await sendBusinessVerificationEmail(email, verifyLink, businessName);
    
    console.log("TESTING LINK (Click this in your terminal):", verifyLink);

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}