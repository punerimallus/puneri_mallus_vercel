// Nobody holding the public key may call the ticketing functions directly.
//
// The anon key ships in the browser bundle. Every one of these functions takes seats, gives
// them back, spends a coupon or rewrites a counter, and every one of them is reached through
// the service role in the application — so none of them has any business being callable over
// /rest/v1/rpc by a stranger.
//
// Written because one of them was. 20261028 revoked EXECUTE on the seven-argument
// reserve_order_inventory; 20261115 dropped that signature and created an eight-argument one,
// which was born with EXECUTE to PUBLIC. A revoke that names an argument list does not follow
// the function through a drop-and-create, and nothing noticed for a day.
//
// This runs against the real migrations, so the same mistake cannot be made again quietly.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { freshDb, type Fixture } from './pg';

const ROOT = join(import.meta.dirname ?? __dirname, '..', '..');
const sqlFile = (n: string) => readFileSync(join(ROOT, 'supabase', 'migrations', n), 'utf8');

/** Applied in the order production runs them. */
const MIGRATIONS = [
  '20261106_comp_passes.sql',
  '20261107_access_pass.sql',
  '20261114_coupons.sql',
  '20261115_ticket_bundles.sql',
  '20261116_drop_group_tickets.sql',
  '20261117_bundle_sold_counter.sql',
  '20261118_lock_reserve_function.sql',
];

/** Everything that moves stock, money or a counter. */
const LOCKED = [
  'reserve_order_inventory',
  'release_order_inventory',
  'claim_coupon',
  'release_coupon',
  'refresh_category_counts',
  'refresh_bundle_counts',
  'void_ticket_number',
];

interface Grant { proname: string; args: string; anon_can_run: boolean; user_can_run: boolean }

const readGrants = (f: Fixture) => f.all<Grant>(
  `select p.proname,
          pg_get_function_identity_arguments(p.oid) as args,
          has_function_privilege('anon',          p.oid, 'EXECUTE') as anon_can_run,
          has_function_privilege('authenticated', p.oid, 'EXECUTE') as user_can_run
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any($1)
    order by p.proname`,
  [LOCKED],
);

let f: Fixture;
let grants: Grant[];

beforeAll(async () => {
  f = await freshDb();
  for (const m of MIGRATIONS) await f.db.exec(sqlFile(m));
  grants = await readGrants(f);
}, 120_000);

afterAll(async () => { await f?.close(); });

describe('the ticketing functions are not part of the public API', () => {
  it('found them all, so this cannot pass by finding nothing', () => {
    const names = new Set(grants.map((g) => g.proname));
    for (const fn of LOCKED) expect(names).toContain(fn);
  });

  it('is closed to anyone holding the anon key', () => {
    const open = grants.filter((g) => g.anon_can_run).map((g) => `${g.proname}(${g.args})`);
    expect(open).toEqual([]);
  });

  it('is closed to signed-in users too', () => {
    // Being logged in buys a buyer nothing here: a checkout goes through the server, which uses
    // the service role. A signed-in account calling this directly would be doing it to hold
    // stock it has no intention of paying for.
    const open = grants.filter((g) => g.user_can_run).map((g) => `${g.proname}(${g.args})`);
    expect(open).toEqual([]);
  });

  it('closes EVERY signature, not just the one a revoke happened to name', async () => {
    // The actual failure, reproduced: create an overload the way a future migration might, and
    // confirm re-running the lock catches it. A revoke naming one argument list would not.
    await f.db.exec(`
      create or replace function public.reserve_order_inventory(p_reservation_id text)
      returns text language sql as $$ select 'overload' $$;
    `);
    const before = await readGrants(f);
    expect(before.filter((g) => g.anon_can_run).length).toBeGreaterThan(0);

    await f.db.exec(sqlFile('20261118_lock_reserve_function.sql'));
    const after = await readGrants(f);
    expect(after.filter((g) => g.anon_can_run)).toEqual([]);

    await f.db.exec(`drop function public.reserve_order_inventory(text);`);
  });

  it('is safe to run twice', async () => {
    await f.db.exec(sqlFile('20261118_lock_reserve_function.sql'));
    expect((await readGrants(f)).filter((g) => g.anon_can_run || g.user_can_run)).toEqual([]);
  });

  it('records that it ran', async () => {
    expect(await f.val<number>(
      `select count(*) from app_schema_markers where name = 'reserve_function_locked_v1'`,
    )).toBe(1);
  });
});

describe('without the fix, the hole is real', () => {
  // Proof that this test suite would have caught it: the same migrations, stopping one short.
  it('leaves reserve_order_inventory open to anon', async () => {
    const g = await freshDb();
    try {
      for (const m of MIGRATIONS.filter((n) => n !== '20261118_lock_reserve_function.sql')) {
        await g.db.exec(sqlFile(m));
      }
      const rows = await g.all<Grant>(
        `select p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_run
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'reserve_order_inventory'`,
      );
      expect(rows.some((r) => r.anon_can_run)).toBe(true);
    } finally {
      await g.close();
    }
  }, 120_000);
});
