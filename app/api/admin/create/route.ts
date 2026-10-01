import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendAdminAccessEmail } from '@/lib/mail';
import { requireAdmin } from '@/lib/admin';

// 🔥 CRITICAL: We use the SERVICE_ROLE_KEY here to bypass RLS and create users 
// without logging out the current admin who is making the request.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // Do NOT leak this to the frontend
);

// Simple crypto generator for the temporary passcode
const generateTempPassword = () => {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
  return Array.from(crypto.getRandomValues(new Uint32Array(12)))
    .map((x) => chars[x % chars.length])
    .join('');
};

export async function POST(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { email } = await req.json();

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const tempPassword = generateTempPassword();

    // 1. Create the user in Supabase Auth securely
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: email,
      password: tempPassword,
      email_confirm: true, // Auto-confirm so they can log in immediately
    });

    if (authError) throw authError;

    // 2. Add them to the authorized_admins table
    const { error: dbError } = await supabaseAdmin.from('authorized_admins').insert({
      id: authData.user.id,
      email: email,
      role: 'admin',
      requires_password_change: true 
    });

    // 🔥 Safety Check: If DB insert fails, delete the auth user to prevent ghost accounts
    if (dbError) {
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      throw dbError;
    }

    // 3. Send the secure email via Nodemailer
    await sendAdminAccessEmail(email, tempPassword);

    return NextResponse.json({ success: true, message: "Admin created and email sent." });

  } catch (error: any) {
    console.error("Admin Creation Error:", error);
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}