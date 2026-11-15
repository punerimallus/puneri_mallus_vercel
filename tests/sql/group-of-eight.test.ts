// A group of EIGHT, on purpose.
//
// Eight is bigger than the seven-pass personal allowance, so if the two limits were ever
// confused with each other — counting group seats as singles — not one of these would pass.
// Every case below is something a buyer can actually do in the box office.

import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { freshDb, seedCategory, seedUser, type Fixture } from './pg';
import { reserveInventory, releaseInventory, type InventoryDb } from '@/lib/payments/inventory';
import { TicketLimitError, SoldOutError } from '@/lib/payments/types';

const ROOT = join(import.meta.dirname ?? __dirname, '..', '..');
const sqlFile = (n: string) => readFileSync(join(ROOT, 'supabase', 'migrations', n), 'utf8');

let f: Fixture;
let cat: string;
let user: string;

beforeEach(async () => {
  f = await freshDb();
  await f.db.exec(sqlFile('20261114_coupons.sql'));
  await f.db.exec(sqlFile('20261115_ticket_bundles.sql'));
  cat = await seedCategory(f, { name: 'REGULAR', prefix: 'REGULAR-', capacity: 78, price: 1049 });
  user = await seedUser(f);
});

/** The real client wrapper pointed at PGlite. Each function takes its own arguments. */
const db = (): InventoryDb => ({
  rpc: (fn: string, args: Record<string, unknown>) => {
    const call = fn === 'reserve_order_inventory'
      ? {
          sql: `select ${fn}($1,$2,$3::jsonb,$4,$5,$6,$7,$8) as d`,
          params: [args.p_reservation_id, args.p_user_id, JSON.stringify(args.p_items),
                   args.p_points, args.p_ttl_seconds, args.p_max_single, 2, args.p_max_bundles],
        }
      : { sql: `select ${fn}($1) as d`, params: [args.p_reservation_id] };
    return f.db.query(call.sql, call.params)
      .then((r) => ({ data: (r.rows[0] as { d: unknown }).d as never, error: null }))
      .catch((e: Error) => ({ data: null, error: { message: e.message } }));
  },
});

/** One group of eight, as the order route sends it. */
const BUNDLE_ID = '11111111-2222-3333-4444-555555555555';

const groupOfEight = (resId: string, unit = 1) =>
  reserveInventory(db(), {
    reservationId: resId,
    userId: user,
    items: [{ categoryId: cat, qty: 8, bundleRef: `${BUNDLE_ID}:${resId}:${unit}` }],
    maxSingle: 7,
    maxBundles: 2,
  });

const seatsHeld = () => f.val<number>(`select count(*) from ticket_numbers where user_id = $1`, [user]);

describe('a group of eight', () => {
  it('is bought in one go, although eight is more than the personal allowance of seven', async () => {
    const alloc = await groupOfEight('res_g1');
    expect(alloc[0].numbers).toHaveLength(8);
    expect(await seatsHeld()).toBe(8);
  });

  it('leaves the buyer all seven of their individual passes as well', async () => {
    await groupOfEight('res_g1');
    await reserveInventory(db(), {
      reservationId: 'res_singles',
      userId: user,
      items: [{ categoryId: cat, qty: 7 }],
      maxSingle: 7,
      maxBundles: 2,
    });
    // Fifteen seats to one account, and correctly so: eight bought as one decision, seven as seven.
    expect(await seatsHeld()).toBe(15);
  });

  it('refuses the eighth individual pass even while holding a group', async () => {
    await groupOfEight('res_g1');
    await reserveInventory(db(), {
      reservationId: 'res_singles', userId: user,
      items: [{ categoryId: cat, qty: 7 }], maxSingle: 7, maxBundles: 2,
    });
    await expect(reserveInventory(db(), {
      reservationId: 'res_one_more', userId: user,
      items: [{ categoryId: cat, qty: 1 }], maxSingle: 7, maxBundles: 2,
    })).rejects.toBeInstanceOf(TicketLimitError);
  });

  it('allows a second group — sixteen seats — but refuses a third', async () => {
    await groupOfEight('res_g1');
    await groupOfEight('res_g2');
    expect(await seatsHeld()).toBe(16);

    await expect(groupOfEight('res_g3')).rejects.toBeInstanceOf(TicketLimitError);
    expect(await seatsHeld()).toBe(16);
  });

  it('numbers its seats from the same run as everything else', async () => {
    await reserveInventory(db(), {
      reservationId: 'res_first', userId: await seedUser(f),
      items: [{ categoryId: cat, qty: 3 }], maxSingle: 7, maxBundles: 2,
    });
    const alloc = await groupOfEight('res_g1');
    expect(alloc[0].numbers).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('gives all eight seats back when the payment never happens', async () => {
    await groupOfEight('res_g1');
    await releaseInventory(db(), 'res_g1');
    expect(await seatsHeld()).toBe(0);
    // And the counter agrees, so the seats are genuinely on sale again.
    expect(await f.val<number>(`select sold from event_ticket_categories where id = $1`, [cat])).toBe(0);
  });

  it('is refused whole when the category cannot seat all eight', async () => {
    const tight = await seedCategory(f, { name: 'TIGHT', prefix: 'T-', capacity: 5 });
    await expect(reserveInventory(db(), {
      reservationId: 'res_tight', userId: user,
      items: [{ categoryId: tight, qty: 8, bundleRef: `${BUNDLE_ID}:res_tight:1` }],
      maxSingle: 7, maxBundles: 2,
    })).rejects.toBeInstanceOf(SoldOutError);
    // Nothing partially taken: five seats would be a broken group.
    expect(await f.val<number>(`select count(*) from ticket_numbers where category_id = $1`, [tight])).toBe(0);
  });

  it('carries a free pass alongside without either counting against the other', async () => {
    await reserveInventory(db(), {
      reservationId: 'res_g1', userId: user,
      items: [
        { categoryId: cat, qty: 8, bundleRef: `${BUNDLE_ID}:res_g1:1` },
        { categoryId: cat, qty: 1, free: true },
      ],
      maxSingle: 7, maxBundles: 2,
    });
    expect(await seatsHeld()).toBe(9);
    // Still entitled to all seven singles: nine seats held, none of them "bought singly".
    await expect(reserveInventory(db(), {
      reservationId: 'res_singles', userId: user,
      items: [{ categoryId: cat, qty: 7 }], maxSingle: 7, maxBundles: 2,
    })).resolves.toBeTruthy();
    expect(await seatsHeld()).toBe(16);
  });

  it('counts two groups as two units however many seats they hold', async () => {
    await groupOfEight('res_g1');
    await groupOfEight('res_g2');
    const units = await f.val<number>(
      `select count(distinct bundle_ref) from ticket_numbers where user_id = $1 and bundle_ref is not null`,
      [user],
    );
    expect(units).toBe(2);
  });
});
