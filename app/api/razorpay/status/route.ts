import { NextResponse, after } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { fulfilAndDeliver, getOrder } from '@/lib/payments/server';

export const dynamic = 'force-dynamic';

// Polled by checkout pages when the Razorpay modal closes without a confirmed
// handler, or when verification errored. It asks Razorpay directly, so a user who
// paid is fulfilled even if the webhook hasn't arrived yet.
export async function GET(req: Request) {
  const orderId = new URL(req.url).searchParams.get('orderId');
  if (!orderId) return NextResponse.json({ error: 'orderId required' }, { status: 400 });

  const cookieStore = await cookies();
  const supabaseAuth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get(name: string) { return cookieStore.get(name)?.value; } } }
  );
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    let order = await getOrder(orderId);
    if (!order || order.user_id !== user.id) return NextResponse.json({ error: 'Order not found' }, { status: 404 });

    if (['CREATED', 'FAILED', 'PAID', 'PROCESSING'].includes(order.status)) {
      const result = await fulfilAndDeliver(orderId, null, 'STATUS_POLL', { defer: after });
      order = result.order ?? order;
    }

    return NextResponse.json({
      status: order.status,
      paymentType: order.payment_type,
      bookingId: order.booking_id,
      emailStatus: order.email_status,
      reason: order.status === 'FAILED' || order.status === 'NEEDS_ATTENTION' ? order.status_reason : undefined,
    });
  } catch (e) {
    console.error('[payments] status check failed', orderId, e);
    return NextResponse.json({ status: 'UNKNOWN' }, { status: 200 });
  }
}
