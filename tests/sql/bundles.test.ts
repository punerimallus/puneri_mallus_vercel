// Bundles, executed for real against an in-process PostgreSQL.
//
// A bundle is a purchase option, not a ticket type: "Squad of 5" on REGULAR takes five REGULAR
// seats out of the one REGULAR pool and issues five ordinary REGULAR passes. The claims that
// have to hold are therefore about the POOL and the ALLOWANCES, because those are the two
// things a separate-stock model used to get wrong:
//
//   * bundle seats come out of the category's own capacity, so it cannot be oversold
//   * bundle seats are numbered from the same sequence as everything else
//   * bundle seats do NOT count against the seven-single allowance
//   * bundle UNITS have their own allowance, counted per unit and not per seat

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { freshDb, seedCategory, seedUser, type Fixture } from './pg';
import type { Allocation } from '@/lib/payments/types';

const MIGRATIONS = join(import.meta.dirname ?? __dirname, '..', '..', 'supabase', 'migrations');
const sqlFile = (name: string) => readFileSync(join(MIGRATIONS, name), 'utf8');

let f: Fixture;

beforeEach(async () => {
  f = await freshDb();
  // Bundles redefine release_order_inventory on top of the coupon version, so both go on in
  // the order production will apply them.
  await f.db.exec(sqlFile('20261114_coupons.sql'));
  await f.db.exec(sqlFile('20261115_ticket_bundles.sql'));
});

afterEach(async () => {
  await f.close();
});

/** Items for the reservation, optionally marked as coming from a bundle unit. */
const items = (rows: { categoryId: string; qty: number; bundleRef?: string; free?: boolean }[]) => JSON.stringify(rows);

const reserve = (
  resId: string,
  userId: string | null,
  rows: { categoryId: string; qty: number; bundleRef?: string; free?: boolean }[],
  opts: { maxSingle?: number; maxBundles?: number } = {},
) =>
  f.val<Allocation[]>(
    `select reserve_order_inventory($1,$2,$3::jsonb,0,900,$4,2,$5) as alloc`,
    [resId, userId, items(rows), opts.maxSingle ?? 7, opts.maxBundles ?? 2],
  );

const reserveFails = (
  resId: string,
  userId: string | null,
  rows: { categoryId: string; qty: number; bundleRef?: string; free?: boolean }[],
  opts: { maxSingle?: number; maxBundles?: number } = {},
) =>
  f.fails(`select reserve_order_inventory($1,$2,$3::jsonb,0,900,$4,2,$5)`,
    [resId, userId, items(rows), opts.maxSingle ?? 7, opts.maxBundles ?? 2]);

const makeBundle = async (categoryId: string, over: Record<string, unknown> = {}) =>
  f.val<string>(
    `insert into ticket_bundles (event_id, category_id, name, size, price, max_bundles)
     values ($1,$2,$3,$4,$5,$6) returning id`,
    [over.event_id ?? 'evt_test', categoryId, over.name ?? 'Squad of 5',
     over.size ?? 5, over.price ?? 4500, over.max_bundles ?? null],
  );

const numbersIn = async (categoryId: string) =>
  (await f.all<{ number: number }>(
    `select number from ticket_numbers where category_id = $1 order by number`, [categoryId])).map((r) => r.number);

// ==========================================================================================
describe('the migration', () => {
  it('applies on top of the others and leaves its marker', async () => {
    expect(await f.val<number>(`select count(*) from app_schema_markers where name = 'ticket_bundles_v1'`)).toBe(1);
  });

  it('can be run again without complaint', async () => {
    await f.db.exec(sqlFile('20261115_ticket_bundles.sql'));
    expect(await f.val<number>(`select count(*) from ticket_bundles`)).toBe(0);
  });

  it('leaves exactly one version of the reservation function behind', async () => {
    // `create or replace` matches on the argument list, so adding a parameter would otherwise
    // leave the old seven-argument version in place and every existing call would keep hitting
    // it — bundle-blind, and counting bundle seats against the single-pass cap.
    //
    // It also has to be exactly one for the compatibility below to work at all: with both the
    // old seven-argument version and this one present, a call naming p_max_group would match
    // both and Postgres would refuse it as ambiguous.
    expect(await f.val<number>(
      `select count(*) from pg_proc where proname = 'reserve_order_inventory'`,
    )).toBe(1);
  });

  it('accepts a call from the PREVIOUS deploy, which names p_max_group', async () => {
    // Supabase RPC resolves by argument name. The deployed code sends p_max_group and knows
    // nothing about bundles; if this stopped resolving, running the migration would take
    // checkout down until the deploy landed. Both shapes have to work at once.
    const cat = await seedCategory(f, { capacity: 20 });
    const alloc = await f.val<Allocation[]>(
      `select reserve_order_inventory(
         p_reservation_id => $1, p_user_id => null, p_items => $2::jsonb,
         p_points => 0, p_ttl_seconds => 900, p_max_single => 7, p_max_group => 2
       ) as a`,
      ['res_old_code', items([{ categoryId: cat, qty: 2 }])],
    );
    expect(alloc[0].numbers).toEqual([1, 2]);
  });

  it('accepts a call from the NEW deploy, which names p_max_bundles', async () => {
    const cat = await seedCategory(f, { capacity: 20 });
    const alloc = await f.val<Allocation[]>(
      `select reserve_order_inventory(
         p_reservation_id => $1, p_user_id => null, p_items => $2::jsonb,
         p_points => 0, p_ttl_seconds => 900, p_max_single => 7, p_max_bundles => 2
       ) as a`,
      ['res_new_code', items([{ categoryId: cat, qty: 2 }])],
    );
    expect(alloc[0].numbers).toEqual([1, 2]);
  });

  it('still caps bundles when the old parameter is the only one given', async () => {
    // The vestigial parameter must be IGNORED, not quietly used as the bundle cap. An old
    // call saying "p_max_group => 9" must not buy anyone a ninth bundle.
    const cat = await seedCategory(f, { capacity: 100 });
    const b = await makeBundle(cat, { size: 2, price: 100 });
    const user = await seedUser(f);
    for (let unit = 1; unit <= 2; unit += 1) {
      await f.val(
        `select reserve_order_inventory(
           p_reservation_id => $1, p_user_id => $2, p_items => $3::jsonb,
           p_points => 0, p_ttl_seconds => 900, p_max_single => 7, p_max_group => 9
         )`,
        [`res_u${unit}`, user, items([{ categoryId: cat, qty: 2, bundleRef: `${b}:res_u${unit}:1` }])],
      );
    }
    const third = await f.fails(
      `select reserve_order_inventory(
         p_reservation_id => $1, p_user_id => $2, p_items => $3::jsonb,
         p_points => 0, p_ttl_seconds => 900, p_max_single => 7, p_max_group => 9
       )`,
      ['res_u3', user, items([{ categoryId: cat, qty: 2, bundleRef: `${b}:res_u3:1` }])],
    );
    expect(third).toContain('LIMIT_BUNDLES:2');
  });

  it('refuses a bundle too small to be one', async () => {
    const cat = await seedCategory(f, { capacity: 50 });
    expect(await f.fails(
      `insert into ticket_bundles (event_id, category_id, name, size, price) values ('e',$1,'Pair',1,100)`, [cat],
    )).toMatch(/size/);
  });
});

// ==========================================================================================
describe('a bundle draws from the category it belongs to', () => {
  it('takes its seats out of the one shared pool', async () => {
    const cat = await seedCategory(f, { capacity: 20, name: 'REGULAR', prefix: 'REGULAR-' });
    const bundle = await makeBundle(cat);
    const user = await seedUser(f);

    await reserve('r1', user, [{ categoryId: cat, qty: 5, bundleRef: `${bundle}:1` }]);

    expect(await f.val(`select sold from event_ticket_categories where id = $1`, [cat])).toBe(5);
    expect(await f.val(`select count(*) from ticket_numbers where category_id = $1`, [cat])).toBe(5);
  });

  it('numbers them from the same sequence as everything else', async () => {
    const cat = await seedCategory(f, { capacity: 20, name: 'REGULAR', prefix: 'REGULAR-' });
    const bundle = await makeBundle(cat);

    // Two individual buyers first, then a bundle.
    await reserve('solo1', await seedUser(f), [{ categoryId: cat, qty: 1 }]);
    await reserve('solo2', await seedUser(f), [{ categoryId: cat, qty: 1 }]);
    const alloc = await reserve('bundle1', await seedUser(f), [{ categoryId: cat, qty: 5, bundleRef: `${bundle}:1` }]);

    expect(alloc[0].numbers).toEqual([3, 4, 5, 6, 7]);
    expect(await numbersIn(cat)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('cannot oversell the category', async () => {
    const cat = await seedCategory(f, { capacity: 6, name: 'REGULAR', prefix: 'REGULAR-' });
    const bundle = await makeBundle(cat);
    await reserve('b1', await seedUser(f), [{ categoryId: cat, qty: 5, bundleRef: `${bundle}:1` }]);
    // One seat left, a second bundle of five cannot fit.
    expect(await reserveFails('b2', await seedUser(f), [{ categoryId: cat, qty: 5, bundleRef: `${bundle}:2` }]))
      .toContain('SOLD_OUT:REGULAR');
  });

  it('competes with individual buyers for the same last seats', async () => {
    const cat = await seedCategory(f, { capacity: 5, name: 'REGULAR', prefix: 'REGULAR-' });
    const bundle = await makeBundle(cat);
    await reserve('solo', await seedUser(f), [{ categoryId: cat, qty: 1 }]);
    expect(await reserveFails('b1', await seedUser(f), [{ categoryId: cat, qty: 5, bundleRef: `${bundle}:1` }]))
      .toContain('SOLD_OUT:REGULAR');
  });

  it('marks every seat it took with its own unit reference', async () => {
    const cat = await seedCategory(f, { capacity: 20 });
    const bundle = await makeBundle(cat);
    await reserve('r1', await seedUser(f), [{ categoryId: cat, qty: 5, bundleRef: `${bundle}:1` }]);
    expect(await f.val(`select count(*) from ticket_numbers where bundle_ref = $1`, [`${bundle}:1`])).toBe(5);
  });

  it('leaves ordinary seats unmarked', async () => {
    const cat = await seedCategory(f, { capacity: 20 });
    await reserve('r1', await seedUser(f), [{ categoryId: cat, qty: 2 }]);
    expect(await f.val(`select count(*) from ticket_numbers where bundle_ref is null`)).toBe(2);
  });
});

// ==========================================================================================
describe('the allowances', () => {
  it('does not count bundle seats against the seven-single cap', async () => {
    // The whole point of the separate allowance: a Squad of 5 is one decision, not five, and
    // charging it against a seven-ticket cap would make a second squad impossible.
    const cat = await seedCategory(f, { capacity: 100 });
    const bundle = await makeBundle(cat);
    const user = await seedUser(f);

    await reserve('b1', user, [{ categoryId: cat, qty: 5, bundleRef: `${bundle}:1` }]);
    await reserve('b2', user, [{ categoryId: cat, qty: 5, bundleRef: `${bundle}:2` }]);
    // Ten bundle seats held, and the buyer can still take their seven singles.
    await reserve('s1', user, [{ categoryId: cat, qty: 7 }]);

    expect(await f.val(`select count(*) from ticket_numbers where user_id = $1`, [user])).toBe(17);
  });

  it('still enforces the single cap on ordinary seats', async () => {
    const cat = await seedCategory(f, { capacity: 100 });
    const user = await seedUser(f);
    await reserve('s1', user, [{ categoryId: cat, qty: 7 }]);
    expect(await reserveFails('s2', user, [{ categoryId: cat, qty: 1 }])).toContain('LIMIT_SINGLE:7');
  });

  it('caps how many bundle units one account may hold', async () => {
    const cat = await seedCategory(f, { capacity: 100 });
    const bundle = await makeBundle(cat);
    const user = await seedUser(f);

    await reserve('b1', user, [{ categoryId: cat, qty: 5, bundleRef: `${bundle}:1` }], { maxBundles: 2 });
    await reserve('b2', user, [{ categoryId: cat, qty: 5, bundleRef: `${bundle}:2` }], { maxBundles: 2 });
    expect(await reserveFails('b3', user, [{ categoryId: cat, qty: 5, bundleRef: `${bundle}:3` }], { maxBundles: 2 }))
      .toContain('LIMIT_BUNDLES:2');
  });

  it('counts units, not seats, so a big bundle is still one unit', async () => {
    const cat = await seedCategory(f, { capacity: 100 });
    const bundle = await makeBundle(cat, { size: 20 });
    const user = await seedUser(f);
    await reserve('b1', user, [{ categoryId: cat, qty: 20, bundleRef: `${bundle}:1` }], { maxBundles: 1 });
    expect(await f.val(`select count(*) from ticket_numbers where user_id = $1`, [user])).toBe(20);
    expect(await reserveFails('b2', user, [{ categoryId: cat, qty: 20, bundleRef: `${bundle}:2` }], { maxBundles: 1 }))
      .toContain('LIMIT_BUNDLES:1');
  });

  it('lets a different account buy its own bundles', async () => {
    const cat = await seedCategory(f, { capacity: 100 });
    const bundle = await makeBundle(cat);
    await reserve('b1', await seedUser(f), [{ categoryId: cat, qty: 5, bundleRef: `${bundle}:1` }], { maxBundles: 1 });
    await reserve('b2', await seedUser(f), [{ categoryId: cat, qty: 5, bundleRef: `${bundle}:2` }], { maxBundles: 1 });
    expect(await f.val(`select count(*) from ticket_numbers`)).toBe(10);
  });

  it('counts one cart holding a bundle and singles on both allowances separately', async () => {
    const cat = await seedCategory(f, { capacity: 100 });
    const bundle = await makeBundle(cat);
    const user = await seedUser(f);
    await reserve('mix', user, [
      { categoryId: cat, qty: 5, bundleRef: `${bundle}:1` },
      { categoryId: cat, qty: 2 },
    ], { maxSingle: 7, maxBundles: 1 });
    expect(await f.val(`select count(*) from ticket_numbers where user_id = $1`, [user])).toBe(7);
    expect(await f.val(`select count(*) from ticket_numbers where bundle_ref is null and user_id = $1`, [user])).toBe(2);
  });
});

// ==========================================================================================
describe('giving a bundle back', () => {
  it('returns the seats to the category', async () => {
    const cat = await seedCategory(f, { capacity: 20, name: 'REGULAR', prefix: 'REGULAR-' });
    const bundle = await makeBundle(cat);
    await reserve('r1', await seedUser(f), [{ categoryId: cat, qty: 5, bundleRef: `${bundle}:1` }]);
    expect(await f.val(`select sold from event_ticket_categories where id = $1`, [cat])).toBe(5);

    await f.val(`select release_order_inventory('r1')`);
    expect(await f.val(`select sold from event_ticket_categories where id = $1`, [cat])).toBe(0);
    expect(await f.val(`select count(*) from ticket_numbers`)).toBe(0);
  });

  it('puts the bundle unit back on sale', async () => {
    const cat = await seedCategory(f, { capacity: 20 });
    const bundle = await makeBundle(cat, { max_bundles: 1 });
    await reserve('r1', await seedUser(f), [{ categoryId: cat, qty: 5, bundleRef: `${bundle}:1` }]);
    await f.val(`select refresh_bundle_counts($1)`, [bundle]);
    expect(await f.val(`select sold from ticket_bundles where id = $1`, [bundle])).toBe(1);

    await f.val(`select release_order_inventory('r1')`);
    expect(await f.val(`select sold from ticket_bundles where id = $1`, [bundle])).toBe(0);
  });

  it('frees the numbers for the next buyer, lowest first', async () => {
    const cat = await seedCategory(f, { capacity: 20, name: 'REGULAR', prefix: 'REGULAR-' });
    const bundle = await makeBundle(cat);
    await reserve('solo', await seedUser(f), [{ categoryId: cat, qty: 1 }]);
    await reserve('b1', await seedUser(f), [{ categoryId: cat, qty: 5, bundleRef: `${bundle}:1` }]);
    await f.val(`select release_order_inventory('b1')`);

    const next = await reserve('solo2', await seedUser(f), [{ categoryId: cat, qty: 1 }]);
    expect(next[0].numbers).toEqual([2]);
  });

  it('counts the bundle unit correctly after a release and a resale', async () => {
    const cat = await seedCategory(f, { capacity: 50 });
    const bundle = await makeBundle(cat);
    await reserve('b1', await seedUser(f), [{ categoryId: cat, qty: 5, bundleRef: `${bundle}:1` }]);
    await f.val(`select release_order_inventory('b1')`);
    await reserve('b2', await seedUser(f), [{ categoryId: cat, qty: 5, bundleRef: `${bundle}:2` }]);
    await f.val(`select refresh_bundle_counts($1)`, [bundle]);
    expect(await f.val(`select sold from ticket_bundles where id = $1`, [bundle])).toBe(1);
  });
});

// ==========================================================================================
describe('nothing about ordinary buying changed', () => {
  it('still sells, numbers and caps exactly as before for a cart with no bundle', async () => {
    const cat = await seedCategory(f, { capacity: 10, name: 'GEN', prefix: 'GEN-' });
    const user = await seedUser(f);
    const alloc = await reserve('r1', user, [{ categoryId: cat, qty: 3 }]);
    expect(alloc[0].numbers).toEqual([1, 2, 3]);
    expect(await f.val(`select sold from event_ticket_categories where id = $1`, [cat])).toBe(3);
    expect(await f.val(`select count(*) from ticket_numbers where bundle_ref is not null`)).toBe(0);
  });

  it('still refuses to oversell', async () => {
    const cat = await seedCategory(f, { capacity: 2, name: 'TINY', prefix: 'T-' });
    await reserve('r1', null, [{ categoryId: cat, qty: 2 }]);
    expect(await reserveFails('r2', null, [{ categoryId: cat, qty: 1 }])).toContain('SOLD_OUT:TINY');
  });

  it('is still idempotent for a replayed reservation', async () => {
    const cat = await seedCategory(f, { capacity: 10 });
    await reserve('same', null, [{ categoryId: cat, qty: 2 }]);
    await reserve('same', null, [{ categoryId: cat, qty: 2 }]);
    expect(await f.val(`select count(*) from ticket_numbers`)).toBe(2);
  });
});

describe('a free pass does not spend the buyer\'s allowance', () => {
  // A gift is not the buyer buying. Refusing an order because a coupon's free pass pushed them
  // over the seven-ticket cap is the wrong answer, so free seats are excluded from it — in the
  // database, over a flag on the seat itself, because that is where the count happens.
  it('lets a buyer at their limit still receive one', async () => {
    const cat = await seedCategory(f, { capacity: 100 });
    const user = await seedUser(f);

    await reserve('s1', user, [{ categoryId: cat, qty: 7 }]);
    // Seven is the cap, and an eighth bought seat is refused...
    expect(await reserveFails('s2', user, [{ categoryId: cat, qty: 1 }])).toContain('LIMIT_SINGLE:7');
    // ...but a gift goes through.
    await reserve('gift', user, [{ categoryId: cat, qty: 2, free: true }]);

    expect(await f.val(`select count(*) from ticket_numbers where user_id = $1`, [user])).toBe(9);
    expect(await f.val(`select count(*) from ticket_numbers where user_id = $1 and free_pass`, [user])).toBe(2);
  });

  it('still refuses an eighth BOUGHT seat after a gift', async () => {
    // The exemption runs one way only: the gift does not raise what may be purchased.
    const cat = await seedCategory(f, { capacity: 100 });
    const user = await seedUser(f);
    await reserve('gift', user, [{ categoryId: cat, qty: 3, free: true }]);
    await reserve('s1', user, [{ categoryId: cat, qty: 7 }]);
    expect(await reserveFails('s2', user, [{ categoryId: cat, qty: 1 }])).toContain('LIMIT_SINGLE:7');
  });

  it('takes real seats out of the category all the same', async () => {
    // Free to the buyer, not free to the house: a gift is still a body through the door.
    const cat = await seedCategory(f, { capacity: 3, name: 'TINY', prefix: 'T-' });
    await reserve('gift', await seedUser(f), [{ categoryId: cat, qty: 3, free: true }]);
    expect(await f.val(`select sold from event_ticket_categories where id = $1`, [cat])).toBe(3);
    expect(await reserveFails('late', await seedUser(f), [{ categoryId: cat, qty: 1 }])).toContain('SOLD_OUT:TINY');
  });

  it('leaves bought seats unflagged', async () => {
    const cat = await seedCategory(f, { capacity: 20 });
    await reserve('r1', await seedUser(f), [{ categoryId: cat, qty: 2 }]);
    expect(await f.val(`select count(*) from ticket_numbers where free_pass`)).toBe(0);
  });

  it('counts a cart of bought, bundled and free seats on the right allowances', async () => {
    const cat = await seedCategory(f, { capacity: 100 });
    const bundle = await makeBundle(cat);
    const user = await seedUser(f);
    await reserve('mix', user, [
      { categoryId: cat, qty: 7 },
      { categoryId: cat, qty: 5, bundleRef: `${bundle}:1` },
      { categoryId: cat, qty: 2, free: true },
    ], { maxSingle: 7, maxBundles: 2 });

    const counts = await f.one<{ singles: number; bundled: number; free: number }>(
      `select count(*) filter (where bundle_ref is null and not free_pass)::int as singles,
              count(*) filter (where bundle_ref is not null)::int as bundled,
              count(*) filter (where free_pass)::int as free
         from ticket_numbers where user_id = $1`, [user],
    );
    expect(counts).toEqual({ singles: 7, bundled: 5, free: 2 });
  });
});
