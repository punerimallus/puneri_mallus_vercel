import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/admin';
import { checkCategoryConfig } from '@/lib/payments/category-config';

export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const isMissingGroupColumn = (e: { code?: string; message?: string } | null) => !!e && (e.code === '42703' || e.code === 'PGRST204' || /group_size/i.test(e.message || ''));

export async function POST(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const { eventId, categories } = await req.json().catch(() => ({}));
    if (!eventId || typeof eventId !== 'string') return NextResponse.json({ error: 'Event is missing.' }, { status: 400 });

    // Read every column so this works whichever optional columns (group_size, released) the database already has.
    const read = await supabaseAdmin.from('event_ticket_categories').select('*').eq('event_id', eventId);
    if (read.error) throw read.error;
    const existing = read.data;
    // Does the database already have the group_size column? (Added by the ticketing SQL script.) With no rows to look at, assume yes:
    // if it is missing, saving a group ticket below answers with a clear message.
    const hasGroupColumn = !existing?.length || 'group_size' in existing[0];

    const check = checkCategoryConfig(categories, (existing || []) as { id: string; name: string; sold: number | null; released?: number | null }[]);
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

    // Without the column, ordinary ticket setups still save exactly as before; only group tickets need it.
    const anyGroup = check.categories.some((c) => c.group_size > 1);
    const writeGroup = hasGroupColumn || anyGroup;
    const rows = check.categories.map(({ group_size, ...c }) => ({ ...c, event_id: eventId, ...(writeGroup ? { group_size } : {}) }));

    if (rows.length) {
      // Rows with an id update in place; new rows (no id) are inserted. Split so Postgres never sees a null id.
      const withId = rows.filter((r) => r.id);
      const withoutId = rows.filter((r) => !r.id).map(({ id: _id, ...r }) => r);
      for (const [batch, label] of [[withId, 'update'], [withoutId, 'insert']] as const) {
        if (!batch.length) continue;
        const { error } = await supabaseAdmin.from('event_ticket_categories').upsert(batch as never[]);
        if (error) {
          if (isMissingGroupColumn(error)) {
            return NextResponse.json({ error: 'Group tickets need a one-time database update first. Run the ticketing SQL script in Supabase, then save again.' }, { status: 409 });
          }
          throw new Error(`${label}: ${error.message}`);
        }
      }
    }

    if (check.remove.length) {
      const { error } = await supabaseAdmin.from('event_ticket_categories').delete().in('id', check.remove.map((r) => r.id));
      if (error) throw error;
    }
    if (check.deactivate.length) {
      const { error } = await supabaseAdmin.from('event_ticket_categories').update({ active: false }).in('id', check.deactivate.map((r) => r.id));
      if (error) throw error;
    }

    return NextResponse.json({
      success: true,
      deleted: check.remove.map((r) => r.name),
      takenOffSale: check.deactivate.map((r) => r.name),
    });
  } catch (error) {
    console.error('Ticket Config Error:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Failed to save configuration' }, { status: 500 });
  }
}
