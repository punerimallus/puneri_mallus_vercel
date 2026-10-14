import React from "react";
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import AdminDock from '@/components/admin/AdminDock';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // 1. AWAIT the cookies promise
  const cookieStore = await cookies();

  // 2. Initialize Supabase Server Client correctly
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          // Use the awaited cookieStore
          return cookieStore.get(name)?.value;
        },
      },
    }
  );

  // 3. Check for active session
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/auth/login?next=/admin');
  }

  // 4. Verify email using a Case-Insensitive, trimmed check
const { data: adminEntry, error } = await supabase
  .from('authorized_admins')
  .select('email')
  // Use .ilike for case-insensitive matching and .trim() for accidental spaces
  .ilike('email', user.email?.trim() || '') 
  .maybeSingle(); 


if (!adminEntry) {
  redirect('/'); 
}

  return (
    <section className="admin-wrapper bg-black min-h-screen pb-28">
      {children}
      <AdminDock email={user.email ?? ''} />
    </section>
  );
}