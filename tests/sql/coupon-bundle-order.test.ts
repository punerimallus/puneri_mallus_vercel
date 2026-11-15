// The reservation, called exactly the way the order route calls it when a bundle-scoped coupon
// is used: one item for the bundle unit and a SECOND item for the free pass, both in the same
// category. That shape only occurs when a coupon gives a free ticket from the same category a
// bundle draws from — which is precisely the combination that fails in the box office.

import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { freshDb, seedCategory, seedUser, type Fixture } from './pg';
import { reserveInventory, type InventoryDb } from '@/lib/payments/inventory';
import { buildIssuedTickets } from '@/lib/payments/fulfil';
import type { CartLine, PaymentOrder } from '@/lib/payments/types';

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

/** The real client wrapper, pointed at PGlite — including its completeness check. */
const db = (): InventoryDb => ({
  rpc: (fn: string, args: Record<string, unknown>) =>
    f.db.query(
      `select ${fn}($1,$2,$3::jsonb,$4,$5,$6,$7,$8) as d`,
      [args.p_reservation_id, args.p_user_id, JSON.stringify(args.p_items),
       args.p_points, args.p_ttl_seconds, args.p_max_single, 2, args.p_max_bundles],
    ).then((r) => ({ data: (r.rows[0] as { d: unknown }).d as never, error: null }))
     .catch((e: Error) => ({ data: null, error: { message: e.message } })),
});

describe('a bundle plus a free pass from the same category', () => {
  it('reserves both, which is what the order route asks for', async () => {
    const allocations = await reserveInventory(db(), {
      reservationId: 'res_bug',
      userId: user,
      items: [
        { categoryId: cat, qty: 8, bundleRef: 'b1:res_bug:1' },
        { categoryId: cat, qty: 1, free: true },
      ],
      maxSingle: 7,
      maxBundles: 2,
    });

    // 9 seats in total: 8 for the group, 1 given away.
    const seats = allocations.reduce((n, a) => n + a.qty, 0);
    expect(seats).toBe(9);
  });

  it('flags the gift and the group seats apart', async () => {
    await reserveInventory(db(), {
      reservationId: 'res_bug',
      userId: user,
      items: [
        { categoryId: cat, qty: 8, bundleRef: 'b1:res_bug:1' },
        { categoryId: cat, qty: 1, free: true },
      ],
      maxSingle: 7,
      maxBundles: 2,
    });
    expect(await f.val<number>(`select count(*) from ticket_numbers where bundle_ref is not null`)).toBe(8);
    expect(await f.val<number>(`select count(*) from ticket_numbers where free_pass`)).toBe(1);
  });

  it('does not count either against the seven-single allowance', async () => {
    await reserveInventory(db(), {
      reservationId: 'res_bug',
      userId: user,
      items: [
        { categoryId: cat, qty: 8, bundleRef: 'b1:res_bug:1' },
        { categoryId: cat, qty: 1, free: true },
      ],
      maxSingle: 7,
      maxBundles: 2,
    });
    // Nine seats held, none of them "bought singly", so seven singles are still available.
    await expect(reserveInventory(db(), {
      reservationId: 'res_singles',
      userId: user,
      items: [{ categoryId: cat, qty: 7 }],
      maxSingle: 7,
      maxBundles: 2,
    })).resolves.toBeTruthy();
  });
});

describe('the passes those seats become', () => {
  it('issues one group pass and one gift, from nine seats', async () => {
    // The second half of the same bug: fulfilment keyed allocations by category id, so the
    // free pass's allocation replaced the group's, and the group pass was never issued at all.
    const allocations = await reserveInventory(db(), {
      reservationId: 'res_bug',
      userId: user,
      items: [
        { categoryId: cat, qty: 8, bundleRef: 'b1:res_bug:1' },
        { categoryId: cat, qty: 1, free: true },
      ],
      maxSingle: 7,
      maxBundles: 2,
    });

    // The cart as the quote builds it: the group line first, then the coupon's free line.
    const cart: CartLine[] = [
      { categoryId: cat, name: 'Group of 8 (REGULAR)', prefix: 'REGULAR-', qty: 8, unitPrice: 875, numberWidth: 3, bundleId: 'b1', bundleName: 'Group of 8' },
      { categoryId: cat, name: 'REGULAR', prefix: 'REGULAR-', qty: 1, unitPrice: 0, numberWidth: 3, free: true, couponCode: 'BOGOREG' },
    ];
    const tickets = buildIssuedTickets(
      { cart, allocated_tickets: allocations } as unknown as PaymentOrder,
      allocations,
    );

    // Nine SEATS, but two passes: one group QR admitting eight, and the gift on its own.
    expect(tickets).toHaveLength(2);
    expect(tickets[0]).toMatchObject({ group: true, groupSize: 8 });
    expect(tickets[1]).toMatchObject({ free: true, couponCode: 'BOGOREG' });
    expect(tickets[1].groupSize).toBeUndefined();
    // The two passes carry different numbers; the gift takes a seat of its own.
    expect(new Set(tickets.map((t) => t.ticketNumber)).size).toBe(2);
  });
});
