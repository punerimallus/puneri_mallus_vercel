// The test-account purge script, run for real against PostgreSQL.
//
// It is a delete script pointed at live tables, so "it looked right" is not good enough. The
// case that matters most is the last one: hand-deleting seats without recounting is what left
// REGULAR showing 62 sold against 52 real seats, hiding ten sellable tickets. If the recount
// in part 5 is ever dropped, that test fails.

import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { freshDb, seedCategory, seedUser, type Fixture } from './pg';

const ROOT = join(import.meta.dirname ?? __dirname, '..', '..');
const sqlFile = (p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');
const SCRIPT = sqlFile(['scripts', 'purge-test-account.sql']);

/** Just the DO block, with the account id and the money switch substituted. */
function purgeBlock(acct: string, keepMoney = true): string {
  const start = SCRIPT.indexOf('do $purge$');
  const end = SCRIPT.indexOf('$purge$;', start) + '$purge$;'.length;
  expect(start).toBeGreaterThan(-1);
  return SCRIPT.slice(start, end)
    .replace(/acct       uuid    := '[^']+'/, `acct       uuid    := '${acct}'`)
    .replace(/keep_money boolean := true/, `keep_money boolean := ${keepMoney}`);
}

let f: Fixture;
let cat: string;
let acct: string;
let other: string;

beforeEach(async () => {
  f = await freshDb();
  await f.db.exec(sqlFile(['supabase', 'migrations', '20261114_coupons.sql']));
  await f.db.exec(sqlFile(['supabase', 'migrations', '20261115_ticket_bundles.sql']));
  cat = await seedCategory(f, { name: 'REGULAR', prefix: 'REGULAR-', capacity: 78 });
  acct = await seedUser(f);
  other = await seedUser(f);
});

/** A buyer with held seats, a booking and a reservation — what a test purchase leaves behind. */
async function purchase(user: string, resId: string, qty: number) {
  await f.db.query(
    `select reserve_order_inventory($1, $2, $3::jsonb, 0, 900, 7, 2, 2)`,
    [resId, user, JSON.stringify([{ categoryId: cat, qty }])],
  );
  await f.db.query(`select confirm_order_inventory($1)`, [resId]);
  const bookingId = await f.val<string>(
    `insert into ticket_bookings (event_id, user_id, email, tickets_data, amount_paid, status)
     values ('evt_test', $1, 'tester@example.com', $2::jsonb, 100, 'CONFIRMED')
     returning id`,
    [user, JSON.stringify(Array.from({ length: qty }, (_, i) => ({
      categoryName: 'REGULAR', ticketNumber: `REGULAR-00${i + 1}`, status: 'ISSUED',
    })))],
  );
  return bookingId;
}

describe('purging a test account', () => {
  it('removes its seats, booking and reservation', async () => {
    await purchase(acct, 'res_test', 3);
    await f.db.exec(purgeBlock(acct));

    expect(await f.val<number>(`select count(*) from ticket_numbers where user_id = $1`, [acct])).toBe(0);
    expect(await f.val<number>(`select count(*) from ticket_bookings where user_id = $1`, [acct])).toBe(0);
    expect(await f.val<number>(`select count(*) from inventory_reservations where user_id = $1`, [acct])).toBe(0);
  });

  it('PUTS THE SEATS BACK ON SALE — the whole point of the recount', async () => {
    // Seven, not ten: the per-account cap refuses an eighth single, which is itself a hint
    // that the production cart holding ten REGULAR must have been a bundle.
    await purchase(acct, 'res_test', 7);
    expect(await f.val<number>(`select sold from event_ticket_categories where id = $1`, [cat])).toBe(7);

    await f.db.exec(purgeBlock(acct));

    // Without the recount this would still read 7, and seven seats nobody holds would stay
    // off sale — the exact drift seen on REGULAR in production.
    expect(await f.val<number>(`select sold from event_ticket_categories where id = $1`, [cat])).toBe(0);
    expect(await f.val<number>(`select count(*) from ticket_numbers where category_id = $1`, [cat])).toBe(0);
  });

  it('leaves every other buyer completely alone', async () => {
    await purchase(other, 'res_keep', 4);
    await purchase(acct, 'res_test', 2);

    await f.db.exec(purgeBlock(acct));

    expect(await f.val<number>(`select count(*) from ticket_numbers where user_id = $1`, [other])).toBe(4);
    expect(await f.val<number>(`select count(*) from ticket_bookings where user_id = $1`, [other])).toBe(1);
    // and the counter reflects exactly the seats the other buyer still holds
    expect(await f.val<number>(`select sold from event_ticket_categories where id = $1`, [cat])).toBe(4);
  });

  it('keeps the money trail by default', async () => {
    await purchase(acct, 'res_test', 1);
    await f.db.query(
      `insert into payment_orders (razorpay_order_id, user_id, payment_type, status, amount_paise, base_amount)
       values ('order_test', $1, 'EVENT_TICKET', 'FULFILLED', 10200, 100)`, [acct],
    );
    await f.db.exec(purgeBlock(acct, true));
    expect(await f.val<number>(`select count(*) from payment_orders where user_id = $1`, [acct])).toBe(1);
  });

  it('removes the money trail only when explicitly told to', async () => {
    await purchase(acct, 'res_test', 1);
    await f.db.query(
      `insert into payment_orders (razorpay_order_id, user_id, payment_type, status, amount_paise, base_amount)
       values ('order_test', $1, 'EVENT_TICKET', 'FULFILLED', 10200, 100)`, [acct],
    );
    await f.db.exec(purgeBlock(acct, false));
    expect(await f.val<number>(`select count(*) from payment_orders where user_id = $1`, [acct])).toBe(0);
  });

  it('hands a coupon back when the only claim on it was the test account', async () => {
    // The bug this replaces burnt a live code: the claim row was deleted and `uses` left at 1,
    // so the coupon read "used up" with nothing recording a use and no way to undo it.
    const coupon = await f.val<string>(
      `insert into coupons (code, kind, scope, free_category_id, free_qty, max_uses, active)
       values ('TESTCODE', 'FREE_TICKET', 'INDIVIDUAL', $1, 1, 1, true) returning id`, [cat],
    );
    await f.db.query(
      `insert into coupon_redemptions (coupon_id, reservation_id, user_id) values ($1, 'res_test', $2)`,
      [coupon, acct],
    );
    await f.db.query(`update coupons set uses = 1 where id = $1`, [coupon]);

    await f.db.exec(purgeBlock(acct));

    expect(await f.val<number>(`select uses from coupons where id = $1`, [coupon])).toBe(0);
    expect(await f.val<number>(`select count(*) from coupon_redemptions where coupon_id = $1`, [coupon])).toBe(0);
  });

  it('leaves a coupon somebody else used alone', async () => {
    const coupon = await f.val<string>(
      `insert into coupons (code, kind, scope, free_category_id, free_qty, max_uses, active)
       values ('SHARED', 'FREE_TICKET', 'INDIVIDUAL', $1, 1, 5, true) returning id`, [cat],
    );
    await f.db.query(
      `insert into coupon_redemptions (coupon_id, reservation_id, user_id) values ($1, 'res_other', $2)`,
      [coupon, other],
    );
    await f.db.query(`update coupons set uses = 1 where id = $1`, [coupon]);

    await f.db.exec(purgeBlock(acct));

    expect(await f.val<number>(`select uses from coupons where id = $1`, [coupon])).toBe(1);
  });

  it('clears points the deleted orders had earned or were holding', async () => {
    await f.db.query(`update profiles set loyalty_points = 400, loyalty_points_held = 50 where id = $1`, [acct]);
    await purchase(acct, 'res_test', 1);
    await f.db.exec(purgeBlock(acct));
    const p = await f.one<{ loyalty_points: number; loyalty_points_held: number }>(
      `select loyalty_points, loyalty_points_held from profiles where id = $1`, [acct],
    );
    expect(p).toMatchObject({ loyalty_points: 0, loyalty_points_held: 0 });
  });

  it('runs cleanly on an account that has nothing', async () => {
    await purchase(other, 'res_keep', 2);
    await f.db.exec(purgeBlock(acct));
    expect(await f.val<number>(`select sold from event_ticket_categories where id = $1`, [cat])).toBe(2);
  });

  it('can be run twice', async () => {
    await purchase(acct, 'res_test', 3);
    await f.db.exec(purgeBlock(acct));
    await f.db.exec(purgeBlock(acct));
    expect(await f.val<number>(`select sold from event_ticket_categories where id = $1`, [cat])).toBe(0);
  });
});
