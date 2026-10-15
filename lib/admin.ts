import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

/**
 * Who is logged in, verified. `getClaims()` checks the login token's signature locally when the project uses
 * asymmetric signing keys (no network call), and falls back to asking Supabase Auth otherwise, so it is never
 * slower or less safe than `getUser()`. It also refreshes an expired session, like `getUser()` does.
 */
export async function getVerifiedUser(supabase: any): Promise<{ id: string; email?: string; phone?: string } | null> {
  if (typeof supabase?.auth?.getClaims === 'function') {
    const { data, error } = await supabase.auth.getClaims();
    const claims = data?.claims;
    if (error || !claims?.sub) return null;
    return { id: String(claims.sub), email: claims.email as string | undefined, phone: claims.phone as string | undefined };
  }
  const { data: { user } } = await supabase.auth.getUser();
  return user ? { id: user.id, email: user.email, phone: user.phone } : null;
}

export async function checkAdminAccess() {
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        // Use getAll to see all cookies
        getAll() {
          return cookieStore.getAll();
        },
        // IMPORTANT: Use setAll to allow the token to refresh
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // This error is fine to ignore in Server Components
          }
        },
      },
    }
  );

  const user = await getVerifiedUser(supabase);
  if (!user) return { isAdmin: false, user: null };

  // Use .ilike for a safer, case-insensitive match
  const { data: adminEntry } = await supabase
    .from('authorized_admins')
    .select('email')
    .ilike('email', user.email || '') 
    .maybeSingle(); 

  return {
    isAdmin: !!adminEntry,
    user
  };
}

/**
 * Guard for admin-only API routes. Returns a ready-made error response when the caller is not
 * logged in (401) or is not in authorized_admins (403), or null when the caller is an admin:
 *
 *   const denied = await requireAdmin();
 *   if (denied) return denied;
 */
export async function requireAdmin(): Promise<NextResponse | null> {
  const { isAdmin, user } = await checkAdminAccess();
  if (!user) return NextResponse.json({ error: 'Please log in.' }, { status: 401 });
  if (!isAdmin) return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });
  return null;
}
