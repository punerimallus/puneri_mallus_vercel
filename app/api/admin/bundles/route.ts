import { NextResponse } from 'next/server';
import { checkAdminAccess } from '@/lib/admin';
import { supabaseAdmin } from '@/lib/payments/server';
import { checkBundleInput, type BundleCategory } from '@/lib/payments/bundles';
import { PaymentInputError } from '@/lib/payments/types';

export const dynamic = 'force-dynamic';

/**
 * Bundle offers: several seats of one category, sold together at a bundle price.
 *
 *   GET    ?eventId=...                    the offers on an event, with how many are gone
 *   POST   { eventId, categoryId, name, size, price, maxBundles }
 *   PATCH  { id, ...fields }               edit, or pause with { id, active: false }
 *   DELETE { id }                          only while nothing has been sold
 *
 * A bundle is a purchase option, not a ticket type: its seats come out of the category's own
 * capacity and are issued as ordinary passes of that category. Nothing here creates stock.
 */

const guard = async () => {
  const { isAdmin, user } = await checkAdminAccess();
  if (!user) return NextResponse.json({ error: 'Please log in.' }, { status: 401 });
  if (!isAdmin) return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });
  return null;
};

const fail = (e: unknown) => {
  if (e instanceof PaymentInputError) return NextResponse.json({ error: e.message }, { status: e.status });
  console.error('[bundles]', e);
  return NextResponse.json({ error: 'Something went wrong. Nothing was changed.' }, { status: 500 });
};

export async function GET(req: Request) {
  const denied = await guard();
  if (denied) return denied;

  const eventId = new URL(req.url).searchParams.get('eventId');
  if (!eventId) return NextResponse.json({ error: 'Event is missing.' }, { status: 400 });

  const db = supabaseAdmin();
  const { data, error } = await db
    .from('ticket_bundles')
    .select('*')
    .eq('event_id', eventId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  // A database without the bundle migration must not break the box office it sits on.
  if (error) return NextResponse.json({ bundles: [], ready: false });
  return NextResponse.json({ bundles: data || [], ready: true });
}

export async function POST(req: Request) {
  const denied = await guard();
  if (denied) return denied;

  try {
    const body = await req.json().catch(() => ({}));
    const eventId = String(body?.eventId || '').trim();
    if (!eventId) throw new PaymentInputError('Event is missing.');

    const db = supabaseAdmin();
    const { data: categories, error: catError } = await db
      .from('event_ticket_categories')
      .select('id, name, price, capacity, sold, released, active, comp_only')
      .eq('event_id', eventId);
    if (catError) throw new Error(catError.message);

    // isNew: a group is also measured against the seats still free, so one that could only ever
    // be born auto-paused is refused here with a sentence instead of created and greyed out.
    const clean = checkBundleInput(body, (categories || []) as BundleCategory[], { isNew: true });

    const { data, error } = await db
      .from('ticket_bundles')
      .insert({
        event_id: eventId,
        category_id: clean.categoryId,
        name: clean.name,
        size: clean.size,
        price: clean.price,
        max_bundles: clean.maxBundles,
        active: clean.active,
      })
      .select('*')
      .single();
    if (error) {
      if (/ticket_bundles|does not exist/i.test(error.message)) {
        throw new PaymentInputError(
          'Bundles need a one-time database update first. Run supabase/migrations/20261115_ticket_bundles.sql, then try again.',
          409,
        );
      }
      throw new Error(error.message);
    }

    return NextResponse.json({ success: true, bundle: data });
  } catch (e) {
    return fail(e);
  }
}

export async function PATCH(req: Request) {
  const denied = await guard();
  if (denied) return denied;

  try {
    const body = await req.json().catch(() => ({}));
    const id = String(body?.id || '').trim();
    if (!id) throw new PaymentInputError('Which bundle?');

    const db = supabaseAdmin();
    const { data: existing, error: readError } = await db
      .from('ticket_bundles').select('*').eq('id', id).maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!existing) throw new PaymentInputError('That bundle no longer exists.', 404);

    // Pausing is its own thing and needs none of the other checks: an admin stopping sales in
    // a hurry should not be argued with about the price.
    if (Object.keys(body).length === 2 && 'active' in body) {
      const { error } = await db.from('ticket_bundles')
        .update({ active: body.active !== false, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw new Error(error.message);
      return NextResponse.json({ success: true });
    }

    const { data: categories } = await db
      .from('event_ticket_categories')
      .select('id, name, price, capacity, active, comp_only')
      .eq('event_id', existing.event_id);

    const clean = checkBundleInput({ ...existing, categoryId: existing.category_id, maxBundles: existing.max_bundles, ...body },
      (categories || []) as BundleCategory[]);

    // Shrinking the unit cap below what is already sold would make the counter read as
    // oversold and the offer impossible to reason about.
    if (clean.maxBundles !== null && clean.maxBundles < (existing.sold || 0)) {
      throw new PaymentInputError(`${existing.sold} of these have already been sold, so the limit cannot go below that.`);
    }
    // Changing the size after seats have gone out would mean two different bundles sharing one
    // name and one counter.
    if ((existing.sold || 0) > 0 && clean.size !== existing.size) {
      throw new PaymentInputError('Some of these have already sold, so the number of tickets in the bundle cannot change. Make a new bundle instead.');
    }

    const { data: saved, error } = await db.from('ticket_bundles').update({
      category_id: clean.categoryId,
      name: clean.name,
      size: clean.size,
      price: clean.price,
      max_bundles: clean.maxBundles,
      active: clean.active,
      updated_at: new Date().toISOString(),
    }).eq('id', id).select('*').maybeSingle();
    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true, bundle: saved });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: Request) {
  const denied = await guard();
  if (denied) return denied;

  try {
    const body = await req.json().catch(() => ({}));
    const id = String(body?.id || '').trim();
    if (!id) throw new PaymentInputError('Which bundle?');

    const db = supabaseAdmin();
    const { data: existing } = await db.from('ticket_bundles').select('sold, name').eq('id', id).maybeSingle();
    if (!existing) throw new PaymentInputError('That bundle no longer exists.', 404);

    // Deleting an offer somebody bought would orphan the seats it sold: they would stay issued
    // with a reference pointing at nothing, and the buyer's passes would lose their origin.
    // Pausing is the right move there, and the message says so.
    if ((existing.sold || 0) > 0) {
      throw new PaymentInputError(
        `"${existing.name}" has already sold ${existing.sold}. Pause it instead — deleting it would detach the passes already issued.`,
        409,
      );
    }

    const { error } = await db.from('ticket_bundles').delete().eq('id', id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ success: true });
  } catch (e) {
    return fail(e);
  }
}
