import { NextResponse } from 'next/server';
import { getRequestUser } from '@/lib/admin';
import { supabaseAdmin } from '@/lib/payments/server';
import { applyCoupon, couponError, normalizeCode, type Coupon, type CouponCategory } from '@/lib/payments/coupons';
import { seatsLeft } from '@/lib/payments/seats';
import { PaymentInputError } from '@/lib/payments/types';
import { RATE_RULES, rateKey, rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * What a coupon would be worth on this cart — WITHOUT claiming it.
 *
 * The cart needs to show the offer before the buyer commits, but a preview must never spend a
 * use: somebody typing codes to see what sticks would otherwise burn a limited coupon without
 * buying anything. So this reads, checks and prices, and the real claim happens inside the
 * order route under a row lock.
 *
 * The consequence is a small race — a coupon can be exhausted between the preview and the
 * payment — and that is the right way round. The buyer sees "fully used up" at Pay instead of
 * being quietly charged full price.
 */
export async function POST(req: Request) {
  try {
    // Logged in only. The checkout is, and an open endpoint here is a way to test codes in
    // bulk against the database for free.
    const user = await getRequestUser();
    if (!user) return NextResponse.json({ error: 'Please log in to use a coupon.' }, { status: 401 });

    // Guessing codes is the obvious attack on a coupon system, so it is rate limited like the
    // checkout it belongs to.
    const limit = rateLimit(rateKey('couponPreview', user.id, req), RATE_RULES.createOrder);
    if (!limit.ok) {
      return NextResponse.json(
        { error: 'Too many tries. Please wait a moment.' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
      );
    }

    const body = await req.json().catch(() => ({}));
    const code = normalizeCode(body?.code);
    const eventId = String(body?.eventId || '').trim();
    if (!code) throw new PaymentInputError('Enter a coupon code.');
    if (!eventId) throw new PaymentInputError('Event is missing.');

    const db = supabaseAdmin();
    const { data: coupon, error } = await db
      .from('coupons').select('*').eq('code', code).maybeSingle();
    if (error) {
      if (/coupons|does not exist/i.test(error.message)) {
        throw new PaymentInputError('Coupons are not set up yet.', 409);
      }
      throw new Error(error.message);
    }

    // Everything claim_coupon would refuse, checked here too so the buyer hears it now rather
    // than at Pay. The authoritative check is still the one under the lock.
    const refuse = (raised: string) => {
      const friendly = couponError(raised);
      throw friendly ?? new PaymentInputError('That coupon cannot be used.', 409);
    };
    if (!coupon) refuse('COUPON_UNKNOWN');
    if (!coupon!.active) refuse('COUPON_INACTIVE');
    if (coupon!.expires_at && new Date(coupon!.expires_at) <= new Date()) refuse('COUPON_EXPIRED');
    if (coupon!.event_id && coupon!.event_id !== eventId) refuse('COUPON_WRONG_EVENT');
    if (coupon!.max_uses != null && (coupon!.uses || 0) >= coupon!.max_uses) refuse('COUPON_EXHAUSTED');

    const { count: mine } = await db
      .from('coupon_redemptions')
      .select('id', { count: 'exact', head: true })
      .eq('coupon_id', coupon!.id)
      .eq('user_id', user.id);
    if ((mine ?? 0) >= (coupon!.per_account_uses || 1)) {
      refuse(`COUPON_ALREADY_USED:${coupon!.per_account_uses || 1}`);
    }

    // Priced against the cart as it stands, so the buyer sees the real figure rather than a
    // percentage they have to apply themselves.
    const { data: categories } = await db
      .from('event_ticket_categories').select('*').eq('event_id', eventId);
    const { data: bundleOffers } = await db
      .from('ticket_bundles').select('id, category_id, size, price, active').eq('event_id', eventId);

    const cart = (body?.cart && typeof body.cart === 'object') ? body.cart as Record<string, number> : {};
    const bundleCart = (body?.bundles && typeof body.bundles === 'object') ? body.bundles as Record<string, number> : {};

    let subtotal = 0;
    for (const [categoryId, qty] of Object.entries(cart)) {
      const cat = (categories || []).find((c) => String(c.id) === categoryId);
      if (cat && Number(qty) > 0) subtotal += Number(cat.price) * Number(qty);
    }
    let bundleUnits = 0;
    for (const [bundleId, units] of Object.entries(bundleCart)) {
      const b = (bundleOffers || []).find((x) => String(x.id) === bundleId);
      if (b && Number(units) > 0) {
        subtotal += Number(b.price) * Number(units);
        bundleUnits += Number(units);
      }
    }

    if (subtotal <= 0) throw new PaymentInputError('Add a ticket to your cart before applying a coupon.');

    const offer = applyCoupon(
      coupon as Coupon,
      subtotal,
      (categories || []) as CouponCategory[],
      (c) => seatsLeft(c),
      bundleUnits,
    );

    return NextResponse.json({
      ok: true,
      code,
      summary: offer?.summary ?? '',
      discount: offer?.discount ?? 0,
      freePasses: offer?.freePasses ?? 0,
      freeName: offer?.freeLines[0]?.name ?? null,
    });
  } catch (e) {
    if (e instanceof PaymentInputError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('[coupon preview]', e);
    return NextResponse.json({ error: 'Could not check that coupon.' }, { status: 500 });
  }
}
