import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { listUserBookings } from '@/lib/payments/server';
import { RATE_RULES, rateKey, rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

// The logged-in customer's own bookings. Never accepts a user id from the request.
export async function GET(req: Request) {
  const cookieStore = await cookies();
  const supabaseAuth = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: { get: (name: string) => cookieStore.get(name)?.value },
  });
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Please log in.' }, { status: 401 });

  const rl = rateLimit(rateKey('readTickets', user.id, req), RATE_RULES.readTickets);
  if (!rl.ok) return NextResponse.json({ error: 'Too many requests.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } });

  const limit = Math.min(Math.max(Number(new URL(req.url).searchParams.get('limit')) || 50, 1), 100);
  try {
    return NextResponse.json({ bookings: await listUserBookings(user.id, limit) });
  } catch (e) {
    console.error('My tickets error:', e);
    return NextResponse.json({ error: 'Could not load your tickets.' }, { status: 500 });
  }
}
