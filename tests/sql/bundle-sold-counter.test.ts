// `ticket_bundles.sold` — how many units of a group offer are out.
//
// It is not just a number on the admin card. `bundlesLeft()` is max_bundles minus this, and
// that is what refuses the sale once a limited run is gone. If it never moves, a "only 2 of
// these" offer can be sold for ever.

import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { freshDb, seedCategory, seedUser, type Fixture } from './pg';

const ROOT = join(import.meta.dirname ?? __dirname, '..', '..');
const sqlFile = (n: string) => readFileSync(join(ROOT, 'supabase', 'migrations', n), 'utf8');

let f: Fixture;
let cat: string;
let bundle: string;

beforeEach(async () => {
  f = await freshDb();
  await f.db.exec(sqlFile('20261114_coupons.sql'));
  await f.db.exec(sqlFile('20261115_ticket_bundles.sql'));
  await f.db.exec(sqlFile('20261117_bundle_sold_counter.sql'));
  cat = await seedCategory(f, { name: 'REGULAR', prefix: 'REGULAR-', capacity: 78, price: 1025 });
  bundle = await f.val<string>(
    `insert into ticket_bundles (event_id, category_id, name, size, price, max_bundles)
     values ('evt_test', $1, 'Group of 8', 8, 8200, 2) returning id`, [cat],
  );
});

const buy = async (resId: string, unit = 1, user?: string) => {
  const who = user ?? await seedUser(f);
  await f.db.query(
    `select reserve_order_inventory($1,$2,$3::jsonb,0,900,7,2,2)`,
    [resId, who, JSON.stringify([{ categoryId: cat, qty: 8, bundleRef: `${bundle}:${resId}:${unit}` }])],
  );
  return who;
};

const sold = () => f.val<number>(`select sold from ticket_bundles where id = $1`, [bundle]);

describe('selling a group ticket', () => {
  it('counts the unit as sold as soon as the seats are held', async () => {
    await buy('res_1');
    expect(await sold()).toBe(1);
  });

  it('counts the second one too', async () => {
    await buy('res_1');
    await buy('res_2');
    expect(await sold()).toBe(2);
  });

  it('still reads right after the payment is confirmed', async () => {
    await buy('res_1');
    await f.db.query(`select confirm_order_inventory($1)`, ['res_1']);
    expect(await sold()).toBe(1);
  });

  it('gives the unit back when the buyer never pays', async () => {
    await buy('res_1');
    expect(await sold()).toBe(1);
    await f.db.query(`select release_order_inventory($1)`, ['res_1']);
    expect(await sold()).toBe(0);
  });

  it('stops the limited run from overselling', async () => {
    // Two is the whole run. The third must find nothing left to buy.
    await buy('res_1');
    await buy('res_2');
    const left = await f.val<number>(
      `select max_bundles - sold from ticket_bundles where id = $1`, [bundle],
    );
    expect(left).toBe(0);
  });

  it('is unaffected by ordinary seats in the same category', async () => {
    const user = await seedUser(f);
    await f.db.query(
      `select reserve_order_inventory($1,$2,$3::jsonb,0,900,7,2,2)`,
      ['res_single', user, JSON.stringify([{ categoryId: cat, qty: 3 }])],
    );
    expect(await sold()).toBe(0);
  });

  it('counts units, not seats', async () => {
    await buy('res_1');
    // Eight seats are held, but that is one group.
    expect(await f.val<number>(`select count(*) from ticket_numbers where bundle_ref is not null`)).toBe(8);
    expect(await sold()).toBe(1);
  });
});
