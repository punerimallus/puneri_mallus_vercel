import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { checkAdminAccess } from '@/lib/admin';
import { resendBooking, supabaseAdmin } from '@/lib/payments/server';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Re-send the passes PDF for a booking. The owner can resend to the booking email
// (once a minute); admins can also send to a corrected address.
export async function POST(req: Request) {
  const { bookingId, email } = await req.json().catch(() => ({}));
  if (!bookingId || typeof bookingId !== 'string') {
    return NextResponse.json({ error: 'bookingId required' }, { status: 400 });
  }

  const cookieStore = await cookies();
  const supabaseAuth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get(name: string) { return cookieStore.get(name)?.value; } } }
  );
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: booking } = await supabaseAdmin().from('ticket_bookings').select('id, user_id').eq('id', bookingId).maybeSingle();
  if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

  const { isAdmin } = await checkAdminAccess();
  if (booking.user_id !== user.id && !isAdmin) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

  let overrideEmail: string | undefined;
  if (email) {
    if (!isAdmin) return NextResponse.json({ error: 'Only admins can change the delivery email' }, { status: 403 });
    if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
    overrideEmail = email.trim().toLowerCase();
  }

  const result = await resendBooking(bookingId, { overrideEmail, minIntervalMs: isAdmin ? undefined : 60_000 });
  const code = result.status === 'SENT' ? 200 : result.status === 'RATE_LIMITED' ? 429 : result.status === 'FAILED' ? 502 : 409;
  return NextResponse.json(result, { status: code });
}
