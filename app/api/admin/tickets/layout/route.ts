import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/admin';
import { checkLayout } from '@/lib/events/venue-layout';

export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/** The venue-map SQL has not been run yet. Same shape of answer the group-size check gives. */
const isMissingLayoutSchema = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === '42703' || e.code === '42P01' || e.code === 'PGRST204' || e.code === 'PGRST205' || /zone|event_venue_layouts/i.test(e.message || ''));

const NEEDS_SQL = 'The venue map needs a one-time database update first. Run supabase/migrations/20261030_venue_layout.sql in Supabase, then save again.';

export async function POST(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const { eventId, layout, zones, preset } = await req.json().catch(() => ({}));
    if (!eventId || typeof eventId !== 'string') return NextResponse.json({ error: 'Event is missing.' }, { status: 400 });

    // Only categories that exist may be placed, so a map can never point at a deleted zone.
    const read = await supabaseAdmin.from('event_ticket_categories').select('id').eq('event_id', eventId);
    if (read.error) throw read.error;
    const ids = (read.data || []).map((r) => String(r.id));

    const check = checkLayout(layout, zones, ids);
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

    const saved = await supabaseAdmin.from('event_venue_layouts').upsert({
      event_id: eventId,
      cols: check.layout.cols,
      rows: check.layout.rows,
      features: check.layout.features,
      // Already filtered to http(s) by normalizeLayout, and the column has a check constraint
      // behind it, so a tampered save cannot put a javascript: URL on a public page.
      plan_url: check.layout.planUrl,
      plan_opacity: check.layout.planOpacity,
      preset: typeof preset === 'string' ? preset.slice(0, 32) : null,
      updated_at: new Date().toISOString(),
    });
    if (saved.error) {
      if (isMissingLayoutSchema(saved.error)) return NextResponse.json({ error: NEEDS_SQL }, { status: 409 });
      throw saved.error;
    }

    // Every category is written, including the unplaced ones: clearing a zone has to actually
    // clear it, or a category the admin removed from the map would stay drawn for buyers.
    for (const id of ids) {
      const zone = check.zones[id] || null;
      const { error } = await supabaseAdmin.from('event_ticket_categories').update({ zone }).eq('id', id);
      if (error) {
        if (isMissingLayoutSchema(error)) return NextResponse.json({ error: NEEDS_SQL }, { status: 409 });
        throw error;
      }
    }

    return NextResponse.json({ success: true, placed: Object.keys(check.zones).length, total: ids.length });
  } catch (error) {
    console.error('Venue Layout Error:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Failed to save the venue map' }, { status: 500 });
  }
}
