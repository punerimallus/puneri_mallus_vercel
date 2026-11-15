// The free-pass exemption is gated on a redeemed coupon, and on nothing else.
//
// Free seats skip the seven-per-account allowance. That is correct for a gift and a hole for
// anything else, so the question this file answers is: can a seat become free WITHOUT a coupon
// having been claimed? The flag has exactly one origin — the coupon branch of quoteEventCart —
// and these tests are what stop a later change quietly giving it a second one.
//
// With no coupon in play the rules are the plain ones: at most seven individual passes and at
// most two bundles, per account, per event.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { quoteEventCart, type TicketBundle, type TicketCategory } from '@/lib/payments/pricing';
import { freshDb, seedCategory, seedUser, type Fixture } from '../sql/pg';

const MIGRATIONS = join(import.meta.dirname ?? __dirname, '..', '..', 'supabase', 'migrations');
const sqlFile = (name: string) => readFileSync(join(MIGRATIONS, name), 'utf8');

const CATS: TicketCategory[] = [
  { id: 'ga', name: 'General', prefix: 'GA-', price: 1000, capacity: 200, sold: 0, active: true },
];
const SQUAD: TicketBundle = {
  id: 'b1', category_id: 'ga', name: 'Squad of 5', size: 5, price: 4500, max_bundles: 10, sold: 0, active: true,
};

const base = {
  categories: CATS,
  bundles: [SQUAD],
  isLoggedIn: true,
  isMember: false,
  memberDiscountPercent: 0,
  pointsToRedeem: 0,
  loyaltyBalance: 0,
  previouslyBought: 0,
};

const quote = (over: Record<string, unknown> = {}) => quoteEventCart({ ...base, cart: {}, ...over } as never);

// ==========================================================================================
describe('without a coupon, nothing is ever free', () => {
  it('marks no line free for an ordinary cart', () => {
    const q = quote({ cart: { ga: 3 } });
    expect(q.lines.every((l) => !l.free)).toBe(true);
    expect(q.coupon).toBeNull();
    expect(q.couponDiscount).toBe(0);
  });

  it('marks no line free for a cart of bundles', () => {
    const q = quote({ bundleCart: { b1: 2 } });
    expect(q.lines.every((l) => !l.free)).toBe(true);
  });

  it('cannot be talked into it through the cart object', () => {
    // The cart is { categoryId: qty } and nothing else is read from it. A client inventing
    // extra keys gets them rejected as categories, not honoured as flags.
    expect(() => quote({ cart: { ga: 1, free: 1 } })).toThrow(/Invalid category/);
    expect(() => quote({ cart: { ga: 1, __proto__: 1 } })).not.toThrow();
    expect(quote({ cart: { ga: 1, __proto__: 1 } }).lines.every((l) => !l.free)).toBe(true);
  });

  it('cannot be talked into it through the bundle object', () => {
    expect(() => quote({ bundleCart: { free: 1 } })).toThrow(/Invalid bundle/);
  });
});

describe('without a coupon, the plain allowances apply', () => {
  it('refuses an eighth individual pass', () => {
    expect(quote({ cart: { ga: 7 } }).lines[0].qty).toBe(7);
    expect(() => quote({ cart: { ga: 8 } })).toThrow(/Limit Exceeded/);
  });

  it('refuses an eighth counting what the account already holds', () => {
    expect(() => quote({ cart: { ga: 3 }, previouslyBought: 5 })).toThrow(/Limit Exceeded/);
  });
});

// ==========================================================================================
describe('the database agrees, which is where the count actually happens', () => {
  let f: Fixture;

  beforeEach(async () => {
    f = await freshDb();
    await f.db.exec(sqlFile('20261114_coupons.sql'));
    await f.db.exec(sqlFile('20261115_ticket_bundles.sql'));
  });
  afterEach(async () => { await f.close(); });

  const reserve = (
    resId: string,
    userId: string | null,
    rows: { categoryId: string; qty: number; bundleRef?: string; free?: boolean }[],
  ) =>
    f.val(`select reserve_order_inventory($1,$2,$3::jsonb,0,900,7,2) as a`,
      [resId, userId, JSON.stringify(rows)]);

  const reserveFails = (
    resId: string,
    userId: string | null,
    rows: { categoryId: string; qty: number; bundleRef?: string; free?: boolean }[],
  ) =>
    f.fails(`select reserve_order_inventory($1,$2,$3::jsonb,0,900,7,2)`,
      [resId, userId, JSON.stringify(rows)]);

  it('flags a seat free only when the item says so', async () => {
    const cat = await seedCategory(f, { capacity: 50 });
    await reserve('plain', await seedUser(f), [{ categoryId: cat, qty: 2 }]);
    expect(await f.val(`select count(*) from ticket_numbers where free_pass`)).toBe(0);
  });

  it('holds the seven-pass line for a buyer with no coupon', async () => {
    const cat = await seedCategory(f, { capacity: 100 });
    const user = await seedUser(f);
    await reserve('r1', user, [{ categoryId: cat, qty: 7 }]);
    expect(await reserveFails('r2', user, [{ categoryId: cat, qty: 1 }])).toContain('LIMIT_SINGLE:7');
  });

  it('holds the two-bundle line for a buyer with no coupon', async () => {
    const cat = await seedCategory(f, { capacity: 100 });
    const bundleId = await f.val<string>(
      `insert into ticket_bundles (event_id, category_id, name, size, price)
       values ('evt_test',$1,'Squad',5,4500) returning id`, [cat],
    );
    const user = await seedUser(f);
    await reserve('b1', user, [{ categoryId: cat, qty: 5, bundleRef: `${bundleId}:1` }]);
    await reserve('b2', user, [{ categoryId: cat, qty: 5, bundleRef: `${bundleId}:2` }]);
    expect(await reserveFails('b3', user, [{ categoryId: cat, qty: 5, bundleRef: `${bundleId}:3` }]))
      .toContain('LIMIT_BUNDLES:2');
  });

  it('counts a seat against the cap the moment it is not flagged', async () => {
    // The exemption is the flag and only the flag. Same seats, same buyer, opposite outcome.
    const cat = await seedCategory(f, { capacity: 100 });
    const atLimit = await seedUser(f);
    await reserve('base', atLimit, [{ categoryId: cat, qty: 7 }]);
    expect(await reserveFails('more', atLimit, [{ categoryId: cat, qty: 1 }])).toContain('LIMIT_SINGLE:7');
    await reserve('gift', atLimit, [{ categoryId: cat, qty: 1, free: true }]);
    expect(await f.val(`select count(*) from ticket_numbers where user_id = $1`, [atLimit])).toBe(8);
  });
});
