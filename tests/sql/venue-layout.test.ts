// The venue-map migration, executed for real against an in-process PostgreSQL.
//
// The point of these is the CONSTRAINTS. The code already filters a plan URL on the way in and
// on the way out, but that filter is one `if` away from being bypassed by a future caller, so
// the database has to refuse an unsafe address itself. The same goes for the grid bounds: the
// editor clamps them, and the table must not depend on the editor having done so.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { freshDb, seedCategory, type Fixture } from './pg';

const VENUE_MIGRATION = join(import.meta.dirname ?? __dirname, '..', '..', 'supabase', 'migrations', '20261030_venue_layout.sql');
const sql = () => readFileSync(VENUE_MIGRATION, 'utf8');

let f: Fixture;

beforeEach(async () => {
  f = await freshDb();
  await f.db.exec(sql());
});

afterEach(async () => {
  await f.close();
});

describe('the venue-map migration', () => {
  it('applies on top of the ticketing schema and leaves its marker', async () => {
    expect(await f.val<number>(`select count(*) from app_schema_markers where name = 'venue_layout_v1'`)).toBe(1);
  });

  it('can be run again without complaint', async () => {
    await f.db.exec(sql());
    await f.db.exec(sql());
    expect(await f.val<number>(`select count(*) from app_schema_markers where name = 'venue_layout_v1'`)).toBe(1);
  });

  it('adds the zone column to the categories that already exist', async () => {
    const id = await seedCategory(f, { name: 'VIP' });
    expect(await f.val(`select zone from event_ticket_categories where id = $1`, [id])).toBeNull();
  });

  it('stores and returns a painted zone unchanged', async () => {
    const id = await seedCategory(f, { name: 'VIP' });
    const zone = { cells: [[0, 0], [1, 0], [1, 1]], color: '#e11d48' };
    await f.db.query(`update event_ticket_categories set zone = $1 where id = $2`, [JSON.stringify(zone), id]);
    expect(await f.val(`select zone from event_ticket_categories where id = $1`, [id])).toEqual(zone);
  });

  it('leaves an unmapped category selling exactly as before', async () => {
    // The whole feature is opt-in: a null zone must not disturb the row at all.
    const id = await seedCategory(f, { name: 'GENERAL', capacity: 100 });
    const row = await f.one<{ zone: unknown; capacity: number; sold: number }>(
      `select zone, capacity, sold from event_ticket_categories where id = $1`, [id],
    );
    expect(row).toMatchObject({ zone: null, capacity: 100, sold: 0 });
  });
});

describe('event_venue_layouts', () => {
  const insert = (cols: string, values: string) =>
    `insert into event_venue_layouts (event_id, ${cols}) values ('evt_test', ${values})`;

  it('starts empty, and takes a layout with sensible defaults', async () => {
    expect(await f.val<number>('select count(*) from event_venue_layouts')).toBe(0);
    await f.db.exec(`insert into event_venue_layouts (event_id) values ('evt_test')`);
    const row = await f.one<{ cols: number; rows: number; features: unknown; plan_url: null; plan_opacity: number }>(
      `select cols, rows, features, plan_url, plan_opacity from event_venue_layouts where event_id = 'evt_test'`,
    );
    expect(row).toMatchObject({ cols: 12, rows: 16, features: [], plan_url: null, plan_opacity: 45 });
  });

  it('holds one layout per event', async () => {
    await f.db.exec(`insert into event_venue_layouts (event_id) values ('evt_test')`);
    const err = await f.fails(`insert into event_venue_layouts (event_id) values ('evt_test')`);
    expect(err).toMatch(/duplicate key|unique/i);
  });

  it('refuses a grid outside the range the renderer can draw', async () => {
    expect(await f.fails(insert('cols', '0'))).toMatch(/cols_check/);
    expect(await f.fails(insert('cols', '99'))).toMatch(/cols_check/);
    expect(await f.fails(insert('rows', '2'))).toMatch(/rows_check/);
    expect(await f.fails(insert('rows', '40'))).toMatch(/rows_check/);
  });

  it('refuses fixtures that are not a list', async () => {
    expect(await f.fails(insert('features', `'{"kind":"stage"}'::jsonb`))).toMatch(/features_check/);
    expect(await f.fails(insert('features', `'"stage"'::jsonb`))).toMatch(/features_check/);
    await f.db.exec(insert('features', `'[{"kind":"stage","x":0,"y":0,"w":12,"h":2}]'::jsonb`));
  });

  it('refuses an opacity that would hide the zones or overexpose the plan', async () => {
    expect(await f.fails(insert('plan_opacity', '0'))).toMatch(/opacity_check/);
    expect(await f.fails(insert('plan_opacity', '101'))).toMatch(/opacity_check/);
  });

  // The security control. The plan URL is written into an <image> on a public page, so the
  // table itself must refuse anything that is not a real http(s) address.
  it('refuses a plan address that is not http(s)', async () => {
    for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:image/svg+xml,<svg/>', 'file:///etc/passwd', '//evil.example.com/x.png', 'ftp://x/y.png']) {
      expect(await f.fails(insert('plan_url', `'${bad}'`))).toMatch(/plan_url_check/);
    }
  });

  it('accepts an ordinary uploaded plan, and no plan at all', async () => {
    await f.db.exec(insert('plan_url', `'https://bhfrgcphqmbocplfcvbg.supabase.co/storage/v1/object/public/events/venues/plan-1.png'`));
    await f.db.exec(`insert into event_venue_layouts (event_id, plan_url) values ('evt_other', null)`);
    expect(await f.val<number>('select count(*) from event_venue_layouts')).toBe(2);
  });

  it('is behind row level security, readable by anyone and writable only by an admin', async () => {
    expect(await f.val<boolean>(
      `select relrowsecurity from pg_class where relname = 'event_venue_layouts'`,
    )).toBe(true);
    const policies = await f.all<{ polname: string; polcmd: string }>(
      `select polname, polcmd from pg_policy where polrelid = 'public.event_venue_layouts'::regclass order by polname`,
    );
    expect(policies).toHaveLength(2);
    // 'r' is SELECT, '*' is ALL.
    expect(policies.map((p) => p.polcmd).sort()).toEqual(['*', 'r']);
  });
});
