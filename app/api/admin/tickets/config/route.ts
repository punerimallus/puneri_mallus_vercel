import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/admin';
import { checkCategoryConfig } from '@/lib/payments/category-config';

export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const { eventId, categories } = await req.json().catch(() => ({}));
    if (!eventId || typeof eventId !== 'string') return NextResponse.json({ error: 'Event is missing.' }, { status: 400 });

    // Read every column so this works whichever optional columns (released) the database already has.
    const read = await supabaseAdmin.from('event_ticket_categories').select('*').eq('event_id', eventId);
    if (read.error) throw read.error;
    const existing = read.data;

    const check = checkCategoryConfig(categories, (existing || []) as { id: string; name: string; sold: number | null; released?: number | null }[]);
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

    const rows = check.categories.map((c) => ({ ...c, event_id: eventId }));

    if (rows.length) {
      // Rows with an id update in place; new rows (no id) are inserted. Split so Postgres never sees a null id.
      const withId = rows.filter((r) => r.id);
      const withoutId = rows.filter((r) => !r.id).map(({ id: _id, ...r }) => r);
      for (const [batch, label] of [[withId, 'update'], [withoutId, 'insert']] as const) {
        if (!batch.length) continue;
        const { error } = await supabaseAdmin.from('event_ticket_categories').upsert(batch as never[]);
        if (error) throw new Error(`${label}: ${error.message}`);
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
