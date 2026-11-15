// The coupon migration, executed for real against an in-process PostgreSQL.
//
// The claim this file has to stand up: a coupon limited to ten uses is accepted exactly ten
// times, however many people type it in the same minute. That is not something application code
// can promise — a read-then-write hands it out to everyone who reads before anyone writes — so
// it is enforced under a row lock and tested here rather than reasoned about.
//
// The other half is the giving back. A claim is taken at the same moment as the seats, before
// the buyer ever reaches Razorpay, so every path that returns seats has to return the coupon
// too: an abandoned checkout, the stale-hold sweeper, a refund.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { freshDb, items, seedCategory, seedUser, type Fixture } from './pg';

const MIGRATIONS = join(import.meta.dirname ?? __dirname, '..', '..', 'supabase', 'migrations');
const couponSql = () => readFileSync(join(MIGRATIONS, '20261114_coupons.sql'), 'utf8');

let f: Fixture;

beforeEach(async () => {
  f = await freshDb();
  await f.db.exec(couponSql());
});

afterEach(async () => {
  await f.close();
});

/** A coupon, with sensible defaults for whatever the test is not about. */
const makeCoupon = async (over: Record<string, unknown> = {}): Promise<string> =>
  f.val<string>(
    `insert into coupons (code, event_id, kind, discount_type, discount_value,
                          free_category_id, free_qty, max_uses, per_account_uses, active, expires_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
    [
      over.code ?? 'WELCOME10',
      over.event_id ?? null,
      over.kind ?? 'DISCOUNT',
      over.discount_type ?? (over.kind === 'FREE_TICKET' ? null : 'PERCENT'),
      over.discount_value ?? (over.kind === 'FREE_TICKET' ? null : 10),
      over.free_category_id ?? null,
      over.free_qty ?? null,
      over.max_uses ?? null,
      over.per_account_uses ?? 1,
      over.active ?? true,
      over.expires_at ?? null,
    ],
  );

const claim = (code: string, resId: string, userId: string | null = null, eventId: string | null = 'evt_test') =>
  f.val(`select claim_coupon($1,$2,$3,$4,null) as c`, [code, resId, userId, eventId]);

const claimFails = (code: string, resId: string, userId: string | null = null, eventId: string | null = 'evt_test') =>
  f.fails(`select claim_coupon($1,$2,$3,$4,null)`, [code, resId, userId, eventId]);

const usesOf = (id: string) => f.val<number>('select uses from coupons where id = $1', [id]);

// ==========================================================================================
describe('the migration', () => {
  it('applies and leaves its marker', async () => {
    expect(await f.val<number>(`select count(*) from app_schema_markers where name = 'coupons_v1'`)).toBe(1);
  });

  it('can be run again without complaint', async () => {
    await f.db.exec(couponSql());
    await f.db.exec(couponSql());
    expect(await f.val<number>(`select count(*) from coupons`)).toBe(0);
  });

  it('seeds nothing, so no code exists until an admin makes one', async () => {
    expect(await f.val<number>(`select count(*) from coupons`)).toBe(0);
    expect(await f.val<number>(`select count(*) from coupon_redemptions`)).toBe(0);
  });
});

describe('what the database refuses to store', () => {
  it('insists a code is upper case, so a stray lower-case row can never match', async () => {
    expect(await f.fails(`insert into coupons (code, kind, discount_type, discount_value)
                          values ('welcome10','DISCOUNT','PERCENT',10)`)).toMatch(/check|code/i);
  });

  it('refuses two coupons with the same code', async () => {
    await makeCoupon({ code: 'SAVE20' });
    expect(await f.fails(`insert into coupons (code, kind, discount_type, discount_value)
                          values ('SAVE20','DISCOUNT','PERCENT',5)`)).toMatch(/duplicate|unique/i);
  });

  it('refuses a discount coupon with nothing to discount', async () => {
    expect(await f.fails(`insert into coupons (code, kind) values ('BROKEN','DISCOUNT')`))
      .toMatch(/coupons_discount_shape/);
  });

  it('refuses a free-ticket coupon with no category or no quantity', async () => {
    expect(await f.fails(`insert into coupons (code, kind) values ('BROKEN','FREE_TICKET')`))
      .toMatch(/coupons_free_shape/);
  });

  it('refuses a percentage over a hundred', async () => {
    expect(await f.fails(`insert into coupons (code, kind, discount_type, discount_value)
                          values ('TOOMUCH','DISCOUNT','PERCENT',120)`)).toMatch(/coupons_percent_range/);
  });

  it('refuses a free quantity below one', async () => {
    const cat = await seedCategory(f, { capacity: 10 });
    expect(await f.fails(
      `insert into coupons (code, kind, free_category_id, free_qty) values ('ZERO','FREE_TICKET',$1,0)`, [cat],
    )).toMatch(/free_qty/);
  });
});

// ==========================================================================================
describe('claiming a coupon', () => {
  it('records who took it and counts the use', async () => {
    const id = await makeCoupon({ code: 'SAVE20' });
    const user = await seedUser(f);
    await claim('SAVE20', 'res_1', user);

    expect(await usesOf(id)).toBe(1);
    expect(await f.val(`select count(*) from coupon_redemptions where reservation_id = 'res_1'`)).toBe(1);
    expect(await f.val(`select user_id from coupon_redemptions where reservation_id = 'res_1'`)).toBe(user);
  });

  it('does not care how the buyer typed it', async () => {
    await makeCoupon({ code: 'SAVE20' });
    await claim('  save20  ', 'res_1');
    expect(await f.val(`select count(*) from coupon_redemptions`)).toBe(1);
  });

  it('refuses a code nobody made', async () => {
    expect(await claimFails('NOPE', 'res_1')).toContain('COUPON_UNKNOWN');
  });

  it('refuses one an admin switched off', async () => {
    await makeCoupon({ code: 'OFF', active: false });
    expect(await claimFails('OFF', 'res_1')).toContain('COUPON_INACTIVE');
  });

  it('refuses one past its date', async () => {
    await makeCoupon({ code: 'OLD', expires_at: '2020-01-01T00:00:00Z' });
    expect(await claimFails('OLD', 'res_1')).toContain('COUPON_EXPIRED');
  });

  it('refuses one meant for another event', async () => {
    await makeCoupon({ code: 'OTHER', event_id: 'evt_other' });
    expect(await claimFails('OTHER', 'res_1', null, 'evt_test')).toContain('COUPON_WRONG_EVENT');
  });

  it('lets an all-events coupon work anywhere', async () => {
    await makeCoupon({ code: 'ANY', event_id: null });
    await claim('ANY', 'res_1', null, 'evt_test');
    await claim('ANY', 'res_2', null, 'evt_somewhere_else');
    expect(await f.val(`select count(*) from coupon_redemptions`)).toBe(2);
  });

  it('refuses once its uses are gone', async () => {
    const id = await makeCoupon({ code: 'TWO', max_uses: 2 });
    await claim('TWO', 'res_1');
    await claim('TWO', 'res_2');
    expect(await claimFails('TWO', 'res_3')).toContain('COUPON_EXHAUSTED');
    expect(await usesOf(id)).toBe(2);
  });

  it('lets an uncapped coupon keep going', async () => {
    const id = await makeCoupon({ code: 'OPEN', max_uses: null });
    for (let i = 0; i < 25; i++) await claim('OPEN', `res_${i}`);
    expect(await usesOf(id)).toBe(25);
  });

  it('stops one account using a single-use coupon twice', async () => {
    await makeCoupon({ code: 'ONCE', per_account_uses: 1 });
    const user = await seedUser(f);
    await claim('ONCE', 'res_1', user);
    expect(await claimFails('ONCE', 'res_2', user)).toContain('COUPON_ALREADY_USED:1');
  });

  it('still lets a different account use it', async () => {
    await makeCoupon({ code: 'ONCE', per_account_uses: 1 });
    await claim('ONCE', 'res_1', await seedUser(f));
    await claim('ONCE', 'res_2', await seedUser(f));
    expect(await f.val(`select count(*) from coupon_redemptions`)).toBe(2);
  });

  it('allows the per-account quota an admin set', async () => {
    await makeCoupon({ code: 'TWICE', per_account_uses: 2 });
    const user = await seedUser(f);
    await claim('TWICE', 'res_1', user);
    await claim('TWICE', 'res_2', user);
    expect(await claimFails('TWICE', 'res_3', user)).toContain('COUPON_ALREADY_USED:2');
  });

  it('takes one use when the same checkout asks twice', async () => {
    // The order route can be retried. A replay must answer the same way and not spend a second
    // use on the same reservation.
    const id = await makeCoupon({ code: 'SAVE20', max_uses: 1 });
    await claim('SAVE20', 'res_1');
    await claim('SAVE20', 'res_1');
    await claim('SAVE20', 'res_1');
    expect(await usesOf(id)).toBe(1);
    expect(await f.val(`select count(*) from coupon_redemptions`)).toBe(1);
  });
});

// ==========================================================================================
describe('the usage cap under a rush', () => {
  it('accepts exactly ten of forty people typing a ten-use code', async () => {
    // The whole reason the count lives in the database. Checked and incremented under one lock:
    // an application-side read-then-write would accept all forty.
    const id = await makeCoupon({ code: 'TEN', max_uses: 10 });
    let won = 0;
    let refused = 0;
    for (let i = 0; i < 40; i++) {
      try {
        await claim('TEN', `rush_${i}`, await seedUser(f));
        won++;
      } catch (e) {
        expect(String(e)).toContain('COUPON_EXHAUSTED');
        refused++;
      }
    }
    expect(won).toBe(10);
    expect(refused).toBe(30);
    expect(await usesOf(id)).toBe(10);
    expect(await f.val(`select count(*) from coupon_redemptions`)).toBe(10);
  }, 120_000);

  it('gives exactly one away when it is a single-use code', async () => {
    const id = await makeCoupon({ code: 'ONEONLY', max_uses: 1 });
    let won = 0;
    for (let i = 0; i < 15; i++) {
      try { await claim('ONEONLY', `rush_${i}`, await seedUser(f)); won++; } catch { /* exhausted */ }
    }
    expect(won).toBe(1);
    expect(await usesOf(id)).toBe(1);
  }, 60_000);

  it('never lets the count run past the cap, whatever order things arrive in', async () => {
    const id = await makeCoupon({ code: 'FIVE', max_uses: 5 });
    await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) => claim('FIVE', `par_${i}`)),
    );
    expect(await usesOf(id)).toBe(5);
    expect(await f.val(`select count(*) from coupon_redemptions`)).toBe(5);
  }, 60_000);
});

// ==========================================================================================
describe('giving it back', () => {
  it('returns the use when a checkout is abandoned', async () => {
    const id = await makeCoupon({ code: 'SAVE20', max_uses: 1 });
    await claim('SAVE20', 'res_1');
    expect(await usesOf(id)).toBe(1);

    expect(await f.val(`select release_coupon('res_1')`)).toBe(true);
    expect(await usesOf(id)).toBe(0);
    // And the next person can have it.
    await claim('SAVE20', 'res_2');
    expect(await usesOf(id)).toBe(1);
  });

  it('is harmless to release twice', async () => {
    const id = await makeCoupon({ code: 'SAVE20' });
    await claim('SAVE20', 'res_1');
    expect(await f.val(`select release_coupon('res_1')`)).toBe(true);
    expect(await f.val(`select release_coupon('res_1')`)).toBe(false);
    expect(await usesOf(id)).toBe(0);
  });

  it('is harmless to release a reservation that never had one', async () => {
    expect(await f.val(`select release_coupon('never')`)).toBe(false);
  });

  it('cannot be talked below zero', async () => {
    const id = await makeCoupon({ code: 'SAVE20' });
    await claim('SAVE20', 'res_1');
    await f.db.query(`select release_coupon('res_1')`);
    await f.db.query(`update coupons set uses = 0 where id = $1`, [id]);
    expect(await usesOf(id)).toBe(0);
  });

  it('goes back with the seats when the sweeper takes a stale hold', async () => {
    // The integration that matters: release_order_inventory is the one path every "give it
    // back" funnels through, so the coupon is released there rather than at a dozen call sites.
    const cat = await seedCategory(f, { capacity: 10 });
    const user = await seedUser(f);
    const id = await makeCoupon({ code: 'SAVE20', max_uses: 1 });

    await f.val('select reserve_order_inventory($1,$2,$3::jsonb,0,900,7,2)', ['res_1', user, items([[cat, 2]])]);
    await claim('SAVE20', 'res_1', user);
    expect(await usesOf(id)).toBe(1);

    await f.db.query(`update inventory_reservations set expires_at = now() - interval '1 hour'`);
    expect(await f.val(`select expire_stale_holds()`)).toBe(1);

    expect(await f.val('select count(*) from ticket_numbers')).toBe(0);
    expect(await usesOf(id), 'the coupon should go back on the shelf with the seats').toBe(0);
  });

  it('goes back when an order is refunded', async () => {
    const cat = await seedCategory(f, { capacity: 10 });
    const id = await makeCoupon({ code: 'SAVE20', max_uses: 1 });
    await f.val('select reserve_order_inventory($1,null,$2::jsonb,0,900,7,2)', ['res_1', items([[cat, 1]])]);
    await claim('SAVE20', 'res_1');
    await f.val('select confirm_order_inventory($1)', ['res_1']);

    await f.val('select release_order_inventory($1)', ['res_1']);
    expect(await usesOf(id)).toBe(0);
  });

  it('leaves a confirmed coupon alone while the order stands', async () => {
    const cat = await seedCategory(f, { capacity: 10 });
    const id = await makeCoupon({ code: 'SAVE20' });
    await f.val('select reserve_order_inventory($1,null,$2::jsonb,0,900,7,2)', ['res_1', items([[cat, 1]])]);
    await claim('SAVE20', 'res_1');
    await f.val('select confirm_order_inventory($1)', ['res_1']);
    expect(await usesOf(id)).toBe(1);
  });
});

// ==========================================================================================
describe('recording what it gave away', () => {
  it('ties the claim to the booking and names the free passes', async () => {
    await makeCoupon({ code: 'FREEBIE' });
    await claim('FREEBIE', 'res_1');
    const booking = await f.val<string>(
      `insert into ticket_bookings (event_id, email, amount_paid, tickets_data)
       values ('evt_test','a@b.com',500,'[]'::jsonb) returning id`,
    );

    expect(await f.val(
      `select confirm_coupon($1,$2,$3,$4::jsonb)`,
      ['res_1', booking, 150.5, JSON.stringify(['REGULAR-047'])],
    )).toBe(true);

    const row = await f.one<{ booking_id: string; discount_amount: string; free_numbers: string[] }>(
      `select booking_id, discount_amount, free_numbers from coupon_redemptions where reservation_id = 'res_1'`,
    );
    expect(row!.booking_id).toBe(booking);
    expect(Number(row!.discount_amount)).toBe(150.5);
    expect(row!.free_numbers).toEqual(['REGULAR-047']);
  });

  it('says so when there was no claim to confirm', async () => {
    expect(await f.val(`select confirm_coupon('nothing', null, 0, '[]'::jsonb)`)).toBe(false);
  });

  it('answers who used a code, which is what the box office asks', async () => {
    await makeCoupon({ code: 'SAVE20' });
    const a = await seedUser(f);
    const b = await seedUser(f);
    await claim('SAVE20', 'res_1', a);
    await claim('SAVE20', 'res_2', b);

    expect(await f.val(
      `select count(*) from coupon_redemptions r join coupons c on c.id = r.coupon_id where c.code = 'SAVE20'`,
    )).toBe(2);
  });
});
