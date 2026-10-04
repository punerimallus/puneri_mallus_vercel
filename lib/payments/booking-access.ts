import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { checkAdminAccess } from '@/lib/admin';
import { loadBookingView } from './server';

/**
 * Loads a booking only for its owner or an admin. Everyone else gets the same
 * "not found" as a missing booking, so booking IDs can't be probed.
 */
export type OwnedBooking =
  | { error: NextResponse; view?: undefined }
  | { error?: undefined; view: Omit<NonNullable<Awaited<ReturnType<typeof loadBookingView>>>, 'userId'> };

export async function loadOwnedBooking(bookingId: string | null): Promise<OwnedBooking> {
  if (!bookingId) return { error: NextResponse.json({ error: 'Booking ID missing' }, { status: 400 }) };

  const cookieStore = await cookies();
  const supabaseAuth = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: { get: (name: string) => cookieStore.get(name)?.value },
  });
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: 'Please log in to view your tickets.' }, { status: 401 }) };

  const view = await loadBookingView(bookingId);
  const { isAdmin } = await checkAdminAccess();
  if (!view || (view.userId !== user.id && !isAdmin)) {
    return { error: NextResponse.json({ error: 'Booking not found' }, { status: 404 }) };
  }
  const { userId: _omit, ...safe } = view;
  return { view: safe };
}
