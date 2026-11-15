import { NextResponse } from 'next/server';
import { checkAdminAccess } from '@/lib/admin';
import { supabaseAdmin } from '@/lib/payments/server';
import { checkCouponInput } from '@/lib/payments/coupons';
import { PaymentInputError } from '@/lib/payments/types';

export const dynamic = 'force-dynamic';

/**
 * Coupons: a code a buyer types at checkout for money off, free passes, or both.
 *
 *   GET    ?eventId=...        the codes that apply to an event, with who has used each
 *   POST   { ...coupon }       create
 *   PATCH  { id, ...fields }   edit, or switch off with { id, active: false }
 *   DELETE { id }              only while nobody has used it
 *
 * The usage cap is NOT enforced here. It is checked and incremented under a row lock by
 * claim_coupon at checkout, because a cap this layer policed would be handed out to everyone
 * who read it before anyone wrote it.
 */

const guard = async () => {
  const { isAdmin, user } = await checkAdminAccess();
  if (!user) return NextResponse.json({ error: 'Please log in.' }, { status: 401 });
  if (!isAdmin) return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });
  return { email: user.email ?? null };
};

const fail = (e: unknown) => {
  if (e instanceof PaymentInputError) return NextResponse.json({ error: e.message }, { status: e.status });
  console.error('[coupons]', e);
  return NextResponse.json({ error: 'Something went wrong. Nothing was changed.' }, { status: 500 });
};

export async function GET(req: Request) {
  const who = await guard();
  if (who instanceof NextResponse) return who;

  const eventId = new URL(req.url).searchParams.get('eventId');
  const db = supabaseAdmin();

  // An all-events coupon (event_id null) applies here too, so both are listed.
  let query = db.from('coupons').select('*').order('created_at', { ascending: false }).limit(200);
  if (eventId) query = query.or(`event_id.eq.${eventId},event_id.is.null`);

  const { data: coupons, error } = await query;
  if (error) return NextResponse.json({ coupons: [], redemptions: [], ready: false });

  // Who used what. Confirmed ones only carry a booking; a row with none is a checkout still
  // open or one that was abandoned before the sweeper got to it.
  const ids = (coupons || []).map((c) => c.id);
  const { data: redemptions } = ids.length
    ? await db
        .from('coupon_redemptions')
        .select('id, coupon_id, email, user_id, booking_id, event_id, discount_amount, free_numbers, created_at, confirmed_at')
        .in('coupon_id', ids)
        .order('created_at', { ascending: false })
        .limit(500)
    : { data: [] };

  return NextResponse.json({ coupons: coupons || [], redemptions: redemptions || [], ready: true });
}

export async function POST(req: Request) {
  const who = await guard();
  if (who instanceof NextResponse) return who;

  try {
    const body = await req.json().catch(() => ({}));
    const db = supabaseAdmin();

    // Categories of the event the coupon is tied to, for the free-ticket choice. An
    // all-events coupon cannot give free tickets, because there is no category to give from.
    const eventId = String(body?.eventId || '').trim();
    const { data: categories } = eventId
      ? await db.from('event_ticket_categories')
          .select('id, name, comp_only, capacity, sold, released')
          .eq('event_id', eventId)
      : { data: [] };

    // isNew: a free-ticket code is also measured against the seats still free, so one that
    // could only ever be born auto-paused is refused here rather than sent out and discovered
    // by the first person who types it.
    const clean = checkCouponInput(body, (categories || []) as never, { isNew: true });
    if (!clean.eventId && clean.freeCategoryId) {
      throw new PaymentInputError('A coupon that gives free tickets has to belong to one event, since the ticket type does.');
    }

    const { data, error } = await db.from('coupons').insert({
      code: clean.code,
      event_id: clean.eventId,
      kind: clean.kind,
      scope: clean.scope,
      discount_type: clean.discountType,
      discount_value: clean.discountValue,
      free_category_id: clean.freeCategoryId,
      free_qty: clean.freeQty,
      max_uses: clean.maxUses,
      per_account_uses: clean.perAccountUses,
      active: clean.active,
      expires_at: clean.expiresAt,
      note: clean.note,
      created_by: who.email,
    }).select('*').single();

    if (error) {
      if (/duplicate key|unique/i.test(error.message)) {
        throw new PaymentInputError(`The code ${clean.code} is already in use. Pick another.`, 409);
      }
      if (/coupons|does not exist/i.test(error.message)) {
        throw new PaymentInputError(
          'Coupons need a one-time database update first. Run supabase/migrations/20261114_coupons.sql, then try again.',
          409,
        );
      }
      throw new Error(error.message);
    }

    return NextResponse.json({ success: true, coupon: data });
  } catch (e) {
    return fail(e);
  }
}

export async function PATCH(req: Request) {
  const who = await guard();
  if (who instanceof NextResponse) return who;

  try {
    const body = await req.json().catch(() => ({}));
    const id = String(body?.id || '').trim();
    if (!id) throw new PaymentInputError('Which coupon?');

    const db = supabaseAdmin();
    const { data: existing } = await db.from('coupons').select('*').eq('id', id).maybeSingle();
    if (!existing) throw new PaymentInputError('That coupon no longer exists.', 404);

    // Switching a coupon off is the emergency lever and takes no other argument.
    if (Object.keys(body).length === 2 && 'active' in body) {
      const { error } = await db.from('coupons')
        .update({ active: body.active !== false, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw new Error(error.message);
      return NextResponse.json({ success: true });
    }

    const { data: categories } = existing.event_id
      ? await db.from('event_ticket_categories')
          .select('id, name, comp_only, capacity, sold, released')
          .eq('event_id', existing.event_id)
      : { data: [] };

    const clean = checkCouponInput({
      ...existing,
      eventId: existing.event_id,
      discountType: existing.discount_type,
      discountValue: existing.discount_value,
      freeCategoryId: existing.free_category_id,
      freeQty: existing.free_qty,
      maxUses: existing.max_uses,
      perAccountUses: existing.per_account_uses,
      expiresAt: existing.expires_at,
      ...body,
    }, (categories || []) as { id: string; name: string; comp_only?: boolean }[]);

    // The code is what people have been given. Changing it on a coupon already in circulation
    // silently breaks every copy of it that is out there.
    if (clean.code !== existing.code && (existing.uses || 0) > 0) {
      throw new PaymentInputError('That code has already been used, so it cannot be renamed. Switch it off and make a new one.');
    }
    if (clean.maxUses !== null && clean.maxUses < (existing.uses || 0)) {
      throw new PaymentInputError(`It has already been used ${existing.uses} times, so the total cannot go below that.`);
    }

    const { data: saved, error } = await db.from('coupons').update({
      code: clean.code,
      kind: clean.kind,
      scope: clean.scope,
      discount_type: clean.discountType,
      discount_value: clean.discountValue,
      free_category_id: clean.freeCategoryId,
      free_qty: clean.freeQty,
      max_uses: clean.maxUses,
      per_account_uses: clean.perAccountUses,
      active: clean.active,
      expires_at: clean.expiresAt,
      note: clean.note,
      updated_at: new Date().toISOString(),
    }).eq('id', id).select('*').maybeSingle();
    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true, coupon: saved });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: Request) {
  const who = await guard();
  if (who instanceof NextResponse) return who;

  try {
    const body = await req.json().catch(() => ({}));
    const id = String(body?.id || '').trim();
    if (!id) throw new PaymentInputError('Which coupon?');

    const db = supabaseAdmin();
    const { data: existing } = await db.from('coupons').select('code, uses').eq('id', id).maybeSingle();
    if (!existing) throw new PaymentInputError('That coupon no longer exists.', 404);

    // Deleting would take its redemption rows with it, and with them the record of what was
    // given away and to whom. Switching it off stops it working and keeps the history.
    if ((existing.uses || 0) > 0) {
      throw new PaymentInputError(
        `${existing.code} has been used ${existing.uses} time${existing.uses === 1 ? '' : 's'}. Switch it off instead — deleting it would erase the record of who used it.`,
        409,
      );
    }

    const { error } = await db.from('coupons').delete().eq('id', id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ success: true });
  } catch (e) {
    return fail(e);
  }
}
