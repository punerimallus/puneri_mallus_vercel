// Voiding a group pass.
//
// A group is one QR over several seats, and the box office voids by PASS. If voiding freed only
// the seat whose number the pass carries, the other seven would be stranded: held by nobody,
// never on sale again, and still counted against the group offer's run. All or nothing.

import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { freshDb, seedCategory, seedUser, type Fixture } from './pg';

const ROOT = join(import.meta.dirname ?? __dirname, '..', '..');
const sqlFile = (n: string) => readFileSync(join(ROOT, 'supabase', 'migrations', n), 'utf8');

let f: Fixture;
let cat: string;
let bundleId: string;
const RES = 'res_group';

beforeEach(async () => {
  f = await freshDb();
  await f.db.exec(sqlFile('20261114_coupons.sql'));
  await f.db.exec(sqlFile('20261115_ticket_bundles.sql'));
  await f.db.exec(sqlFile('20261117_bundle_sold_counter.sql'));
  cat = await seedCategory(f, { name: 'REGULAR', prefix: 'REGULAR-', capacity: 78, price: 1025 });
  bundleId = await f.val<string>(
    `insert into ticket_bundles (event_id, category_id, name, size, price, max_bundles)
     values ('evt_test', $1, 'Group of 8', 8, 8200, 2) returning id`, [cat],
  );
  const user = await seedUser(f);
  await f.db.query(
    `select reserve_order_inventory($1,$2,$3::jsonb,0,900,7,2,2)`,
    [RES, user, JSON.stringify([{ categoryId: cat, qty: 8, bundleRef: `${bundleId}:${RES}:1` }])],
  );
  await f.db.query(`select confirm_order_inventory($1)`, [RES]);
});

/** The route's rule: every seat sharing the voided seat's bundle reference goes back. */
async function seatsOfGroup(number: number): Promise<number[]> {
  const ref = await f.val<string | null>(
    `select bundle_ref from ticket_numbers where category_id = $1 and number = $2`, [cat, number],
  );
  if (!ref) return [number];
  return f.val<number[]>(
    `select coalesce(array_agg(number order by number), '{}')
       from ticket_numbers where category_id = $1 and reservation_id = $2 and bundle_ref = $3`,
    [cat, RES, ref],
  );
}

const voidSeat = (n: number) =>
  f.db.query(`select void_ticket_number($1, $2, $3)`, [RES, cat, n]);

describe('voiding a group pass', () => {
  it('finds all eight seats from the one the pass names', async () => {
    expect(await seatsOfGroup(1)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('puts every one of them back on sale', async () => {
    for (const n of await seatsOfGroup(1)) await voidSeat(n);

    expect(await f.val<number>(`select count(*) from ticket_numbers where category_id = $1`, [cat])).toBe(0);
    // The counter agrees, so the seats are genuinely sellable again.
    expect(await f.val<number>(`select sold from event_ticket_categories where id = $1`, [cat])).toBe(0);
  });

  it('gives the group offer its unit back', async () => {
    expect(await f.val<number>(`select sold from ticket_bundles where id = $1`, [bundleId])).toBe(1);
    for (const n of await seatsOfGroup(1)) await voidSeat(n);
    expect(await f.val<number>(`select sold from ticket_bundles where id = $1`, [bundleId])).toBe(0);
  });

  it('would strand seven seats if only the named one were freed', async () => {
    // The bug this guards against, written out: void seat 1 alone and seven remain held by a
    // booking that no longer has a pass for them.
    await voidSeat(1);
    expect(await f.val<number>(`select count(*) from ticket_numbers where category_id = $1`, [cat])).toBe(7);
    expect(await f.val<number>(`select sold from ticket_bundles where id = $1`, [bundleId])).toBe(1);
  });

  it('leaves an ordinary seat alone', async () => {
    const other = await seedUser(f);
    await f.db.query(
      `select reserve_order_inventory($1,$2,$3::jsonb,0,900,7,2,2)`,
      ['res_single', other, JSON.stringify([{ categoryId: cat, qty: 1 }])],
    );
    // Seat 9 carries no bundle reference, so it stands for itself.
    expect(await seatsOfGroup(9)).toEqual([9]);
  });
});
