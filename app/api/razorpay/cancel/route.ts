import { NextResponse } from 'next/server';
import { getRequestUser } from '@/lib/admin';
import { getOrder, releaseReservation, supabaseAdmin, updateOrderIfStatus } from '@/lib/payments/server';
import { RATE_RULES, rateKey, rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * The buyer closed the Razorpay window without paying.
 *
 * Their seats are already reserved, and would sit there until the 15-minute hold lapsed. During
 * a rush that is a lot of stock held by people who have walked away, so the checkout page tells
 * us as soon as the window closes and we put the seats straight back on sale.
 *
 * Deliberately cautious: it only releases an order that is still CREATED and belongs to the
 * caller. If a payment did go through (a UPI app completing after the window closed) the order
 * will no longer be CREATED, and this does nothing — the status poll and webhook take over.
 */
export async function POST(req: Request) {
  const user = await getRequestUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const limit = rateLimit(rateKey('createOrder', user.id, req), RATE_RULES.createOrder);
  if (!limit.ok) return NextResponse.json({ released: false }, { status: 429 });

  const { orderId } = await req.json().catch(() => ({}));
  if (!orderId || typeof orderId !== 'string') {
    return NextResponse.json({ error: 'orderId required' }, { status: 400 });
  }

  const order = await getOrder(orderId);
  if (!order || order.user_id !== user.id) {
    // Same answer as a missing order, so order ids cannot be probed.
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }

  // Only an untouched order. Anything else means money may be in flight.
  if (order.status !== 'CREATED') {
    return NextResponse.json({ released: false, status: order.status });
  }

  const moved = await updateOrderIfStatus(orderId, ['CREATED'], {
    status: 'FAILED',
    status_reason: 'Checkout closed without paying',
  });
  if (!moved) return NextResponse.json({ released: false, status: 'CHANGED' });

  let released = 0;
  if (order.reservation_id) {
    try {
      released = await releaseReservation(order.reservation_id);
    } catch (e) {
      console.error('CANCEL_RELEASE_FAILED:', e);
      // The sweeper will get it; never fail the request over this.
    }
  }

  // Keep the order's own record straight for the admin screens.
  await supabaseAdmin()
    .from('payment_orders')
    .update({ seats_released: true })
    .eq('razorpay_order_id', orderId);

  return NextResponse.json({ released: true, seats: released });
}
