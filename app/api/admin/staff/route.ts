import { NextResponse } from 'next/server';
import { checkAdminAccess, requireAdmin } from '@/lib/admin';
import { supabaseAdmin } from '@/lib/payments/server';
import { asMarkerDb, checkSchema } from '@/lib/payments/schema-check';

export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The gate list: volunteers an admin trusts to scan passes, and nothing else.
 *
 * Only admins can read or change it. A volunteer is identified by the email they sign in with;
 * `event_id` null lets them scan any event, a value ties them to one.
 */
export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const db = supabaseAdmin();
  const schema = await checkSchema(asMarkerDb(db));
  if (!schema.ok) return NextResponse.json({ error: schema.error, schemaBehind: true }, { status: 503 });

  const { data, error } = await db
    .from('event_staff')
    .select('id, email, role, event_id, active, note, added_by, created_at')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('STAFF_LIST_ERROR:', error.message);
    return NextResponse.json({ error: 'Could not load the gate list.' }, { status: 500 });
  }
  return NextResponse.json({ staff: data || [] });
}

export async function POST(req: Request) {
  const { isAdmin, user } = await checkAdminAccess();
  if (!user) return NextResponse.json({ error: 'Please log in.' }, { status: 401 });
  if (!isAdmin) return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });

  const db = supabaseAdmin();
  const schema = await checkSchema(asMarkerDb(db));
  if (!schema.ok) return NextResponse.json({ error: schema.error, schemaBehind: true }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  const eventId = body.eventId ? String(body.eventId) : null;
  const note = body.note ? String(body.note).slice(0, 200) : null;

  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });

  const COLS = 'id, email, role, event_id, active, note, added_by, created_at';

  // Deliberately not an upsert. The unique index is on (lower(email), coalesce(event_id, '*')) —
  // an expression index — and Postgres can only infer an ON CONFLICT target from an index whose
  // definition matches literally, so `onConflict: 'email,event_id'` fails outright. Look the
  // person up the same case-insensitive way the gate does, then update or insert.
  const { data: sameEmail, error: findErr } = await db.from('event_staff').select(COLS).ilike('email', email);
  if (findErr) {
    console.error('STAFF_LOOKUP_ERROR:', findErr.message);
    return NextResponse.json({ error: 'Could not add them to the gate list.' }, { status: 500 });
  }

  // One row per person per scope: a global row and an event-scoped row are different entries.
  const existing = (sameEmail || []).find((r) => (r.event_id ?? null) === eventId);

  if (existing) {
    const { data, error } = await db
      .from('event_staff')
      .update({ role: 'SCANNER', active: true, note })
      .eq('id', existing.id)
      .select(COLS)
      .maybeSingle();
    if (error) {
      console.error('STAFF_REACTIVATE_ERROR:', error.message);
      return NextResponse.json({ error: 'Could not add them to the gate list.' }, { status: 500 });
    }
    return NextResponse.json({ staff: data, alreadyListed: true });
  }

  const { data, error } = await db
    .from('event_staff')
    .insert({ email, role: 'SCANNER', event_id: eventId, active: true, note, added_by: user.email ?? null })
    .select(COLS)
    .maybeSingle();

  if (error) {
    // Two admins adding the same person at the same moment: the index caught the loser.
    if (error.code === '23505') {
      const { data: raced } = await db.from('event_staff').select(COLS).ilike('email', email);
      const row = (raced || []).find((r) => (r.event_id ?? null) === eventId);
      if (row) return NextResponse.json({ staff: row, alreadyListed: true });
    }
    console.error('STAFF_ADD_ERROR:', error.message);
    return NextResponse.json({ error: 'Could not add them to the gate list.' }, { status: 500 });
  }

  return NextResponse.json({ staff: data });
}

/** Turn a volunteer's access off (or back on). Their past scans stay in the log either way. */
export async function PATCH(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const id = String(body.id || '');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (typeof body.active === 'boolean') patch.active = body.active;
  if (body.eventId !== undefined) patch.event_id = body.eventId ? String(body.eventId) : null;
  if (body.note !== undefined) patch.note = body.note ? String(body.note).slice(0, 200) : null;
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 });

  const { error } = await supabaseAdmin().from('event_staff').update(patch).eq('id', id);
  if (error) {
    console.error('STAFF_UPDATE_ERROR:', error.message);
    return NextResponse.json({ error: 'Could not update them.' }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

export async function DELETE(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const { error } = await supabaseAdmin().from('event_staff').delete().eq('id', id);
  if (error) {
    console.error('STAFF_DELETE_ERROR:', error.message);
    return NextResponse.json({ error: 'Could not remove them.' }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
