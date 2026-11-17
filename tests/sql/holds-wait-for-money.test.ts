// Seats come back when nobody paid, and stay put while the money might still arrive.
//
// Both halves are real incidents:
//
//   17 Nov  a group checkout's payment failed, the browser never said so, and eleven REGULAR
//           seats sat held long past their expiry.
//   14 Nov  order_TzwewUnX87HTKb — a buyer PAID ₹1074.35, her hold was swept, and fulfilment
//           then refunded her because the seats were gone.
//
// Sweeping faster fixes the first and worsens the second, so the sweeper now reads the ORDER
// to tell them apart. These tests pin that rule, both ways round.

import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { freshDb, seedUser, type Fixture } from './pg';

const ROOT = join(import.meta.dirname ?? __dirname, '..', '..');
const sqlFile = (n: string) => readFileSync(join(ROOT, 'supabase', 'migrations', n), 'utf8');

const EVENT = 'evt_test';
const OFFER = '4a027302-6dd3-4141-a891-8bdbf069d3bb';

let f: Fixture;
let cat: string;
let user: string;

beforeEach(async () => {
  f = await freshDb();
  for (const m of [
    '20261114_coupons.sql',
    '20261115_ticket_bundles.sql',
    '20261116_drop_group_tickets.sql',
    '20261117_bundle_sold_counter.sql',
    '20261118_lock_reserve_function.sql',
    '20261119_holds_wait_for_the_money.sql',
  ]) await f.db.exec(sqlFile(m));

  cat = await f.val<string>(
    `insert into event_ticket_categories (event_id, name, prefix, price, capacity)
     values ($1, 'REGULAR', 'REGULAR-', 1000, 100) returning id`, [EVENT],
  );
  user = await seedUser(f);
  await f.db.query(
    `insert into ticket_bundles (id, event_id, category_id, name, size, price, max_bundles)
     values ($1, $2, $3, 'Group of 11', 11, 10000, 2)`, [OFFER, EVENT, cat],
  );
});

afterEach(async () => { await f?.close(); });

/**
 * A checkout: its held seats, and the payment order attached to it.
 *
 * `expiredMinsAgo` is how long ago the fifteen-minute hold lapsed, so a case can be aged
 * precisely rather than waited for. `orderStatus` null means the checkout never reached
 * Razorpay at all.
 */
async function checkout(id: string, opts: {
  seats: number;
  firstNumber: number;
  expiredMinsAgo: number;
  orderStatus: string | null;
  /** Minutes since the order last changed — for FAILED, since Razorpay refused it. */
  failedMinsAgo?: number;
  unit?: number;
}) {
  await f.db.query(
    `insert into inventory_reservations (reservation_id, user_id, event_id, state, created_at, expires_at)
     values ($1, $2, $3, 'HELD',
             now() - make_interval(mins => $4 + 15),
             now() - make_interval(mins => $4))`,
    [id, user, EVENT, opts.expiredMinsAgo],
  );
  await f.db.query(
    `insert into ticket_numbers (category_id, number, reservation_id, user_id, state, bundle_ref)
     select $1, $2 + g - 1, $3, $4, 'HELD', $5 from generate_series(1, $6) g`,
    [cat, opts.firstNumber, id, user, `${OFFER}:${id}:${opts.unit ?? 1}`, opts.seats],
  );
  if (opts.orderStatus) {
    // updated_at is when the order last changed state — for a FAILED one, the moment Razorpay
    // refused it. The five-minute retry grace is measured from there, not from checkout.
    await f.db.query(
      `insert into payment_orders (razorpay_order_id, user_id, payment_type, amount_paise, status, reservation_id, created_at, updated_at)
       values ($1, $2, 'EVENT_TICKET', 1074359, $3, $4,
               now() - make_interval(mins => $5 + 15),
               now() - make_interval(mins => $6))`,
      [`order_${id}`, user, opts.orderStatus, id, opts.expiredMinsAgo, opts.failedMinsAgo ?? opts.expiredMinsAgo],
    );
  }
}

const sweep = () => f.val<number>(`select expire_stale_holds()`);
const seats = (id: string) => f.val<number>(`select count(*) from ticket_numbers where reservation_id = $1`, [id]);
const state = (id: string) => f.val<string>(`select state from inventory_reservations where reservation_id = $1`, [id]);

describe('a checkout where nobody is going to pay', () => {
  it('gives the seats back five minutes after Razorpay refuses — the 17 Nov case', async () => {
    // Razorpay said no at 11:51:59; the buyer's browser never got to say so. The seats should
    // be back by ~11:57 rather than sitting for thirty-five minutes.
    await checkout('res_failed', { seats: 11, firstNumber: 73, expiredMinsAgo: 1, orderStatus: 'FAILED', failedMinsAgo: 6 });
    expect(await sweep()).toBe(1);
    expect(await seats('res_failed')).toBe(0);
    expect(await state('res_failed')).toBe('RELEASED');
  });

  it('does not wait out the fifteen-minute hold to do it', async () => {
    // The payment failed two minutes in and was refused six minutes ago, so the hold itself has
    // not lapsed yet. The seats still go back: nothing can arrive for a refused payment.
    await f.db.query(
      `insert into inventory_reservations (reservation_id, user_id, event_id, state, expires_at)
       values ('res_early', $1, $2, 'HELD', now() + interval '7 minutes')`, [user, EVENT],
    );
    await f.db.query(
      `insert into ticket_numbers (category_id, number, reservation_id, user_id, state)
       select $1, 40 + g, 'res_early', $2, 'HELD' from generate_series(1, 11) g`, [cat, user],
    );
    await f.db.query(
      `insert into payment_orders (razorpay_order_id, user_id, payment_type, amount_paise, status, reservation_id, created_at, updated_at)
       values ('order_early', $1, 'EVENT_TICKET', 1074359, 'FAILED', 'res_early',
               now() - interval '8 minutes', now() - interval '6 minutes')`, [user],
    );
    expect(await sweep()).toBe(1);
    expect(await seats('res_early')).toBe(0);
  });

  it('keeps them for the first five minutes, in case the buyer retries', async () => {
    // The checkout window is still open in front of them; a retry there must still find its
    // seats. This is the whole reason the grace exists.
    await checkout('res_just_failed', { seats: 11, firstNumber: 73, expiredMinsAgo: 1, orderStatus: 'FAILED', failedMinsAgo: 2 });
    expect(await sweep()).toBe(0);
    expect(await seats('res_just_failed')).toBe(11);
  });

  it('gives them back when the checkout never reached Razorpay at all', async () => {
    await checkout('res_no_order', { seats: 2, firstNumber: 1, expiredMinsAgo: 1, orderStatus: null });
    expect(await sweep()).toBe(1);
    expect(await seats('res_no_order')).toBe(0);
  });

  it('frees the group offer with them', async () => {
    await checkout('res_failed', { seats: 11, firstNumber: 73, expiredMinsAgo: 1, orderStatus: 'FAILED', failedMinsAgo: 6 });
    expect(await f.val<number>(`select sold from ticket_bundles where id = $1`, [OFFER])).toBe(1);
    await sweep();
    expect(await f.val<number>(`select sold from ticket_bundles where id = $1`, [OFFER])).toBe(0);
  });
});

describe('a checkout where the money might still be coming', () => {
  it('leaves a paid-but-unfulfilled order alone — the 14 Nov case', async () => {
    // Captured at Razorpay, webhook not yet arrived, so our row still reads CREATED. Sweeping
    // this is what refunded a real buyer; it must not be reachable.
    await checkout('res_paying', { seats: 11, firstNumber: 1, expiredMinsAgo: 2, orderStatus: 'CREATED' });
    expect(await sweep()).toBe(0);
    expect(await seats('res_paying')).toBe(11);
    expect(await state('res_paying')).toBe('HELD');
  });

  it('leaves one being fulfilled right now alone', async () => {
    await checkout('res_processing', { seats: 11, firstNumber: 1, expiredMinsAgo: 5, orderStatus: 'PROCESSING' });
    expect(await sweep()).toBe(0);
    expect(await seats('res_processing')).toBe(11);
  });

  it('leaves one Razorpay has already taken money for alone', async () => {
    await checkout('res_paid', { seats: 11, firstNumber: 1, expiredMinsAgo: 10, orderStatus: 'PAID' });
    expect(await sweep()).toBe(0);
    expect(await seats('res_paid')).toBe(11);
  });

  it('still lets go after the backstop, so nothing is held for ever', async () => {
    // Half an hour past expiry — forty-five minutes after checkout began. Reconcile has had
    // six chances to ask Razorpay by then.
    await checkout('res_stuck', { seats: 11, firstNumber: 1, expiredMinsAgo: 31, orderStatus: 'CREATED' });
    expect(await sweep()).toBe(1);
    expect(await seats('res_stuck')).toBe(0);
  });

  it('holds on at twenty-nine minutes and lets go at thirty-one', async () => {
    await checkout('res_29', { seats: 1, firstNumber: 1, expiredMinsAgo: 29, orderStatus: 'CREATED' });
    await checkout('res_31', { seats: 1, firstNumber: 50, expiredMinsAgo: 31, orderStatus: 'CREATED' });
    expect(await sweep()).toBe(1);
    expect(await seats('res_29')).toBe(1);
    expect(await seats('res_31')).toBe(0);
  });
});

describe('what it never touches', () => {
  it('a hold still inside its fifteen minutes', async () => {
    await f.db.query(
      `insert into inventory_reservations (reservation_id, user_id, event_id, state, expires_at)
       values ('res_live', $1, $2, 'HELD', now() + interval '12 minutes')`, [user, EVENT],
    );
    await f.db.query(
      `insert into ticket_numbers (category_id, number, reservation_id, user_id, state)
       select $1, g, 'res_live', $2, 'HELD' from generate_series(1, 11) g`, [cat, user],
    );
    expect(await sweep()).toBe(0);
    expect(await seats('res_live')).toBe(11);
  });

  it('a CONFIRMED reservation, however old — the one somebody paid for', async () => {
    await f.db.query(
      `insert into inventory_reservations (reservation_id, user_id, event_id, state, expires_at)
       values ('res_bought', $1, $2, 'CONFIRMED', now() - interval '30 days')`, [user, EVENT],
    );
    await f.db.query(
      `insert into ticket_numbers (category_id, number, reservation_id, user_id, state)
       select $1, g, 'res_bought', $2, 'ISSUED' from generate_series(1, 11) g`, [cat, user],
    );
    expect(await sweep()).toBe(0);
    expect(await seats('res_bought')).toBe(11);
    expect(await state('res_bought')).toBe('CONFIRMED');
  });
});

describe('several at once', () => {
  it('sorts a mixed batch correctly in one pass', async () => {
    await checkout('res_a', { seats: 1, firstNumber: 1,  expiredMinsAgo: 1,  orderStatus: 'FAILED', failedMinsAgo: 6, unit: 1 });
    await checkout('res_b', { seats: 1, firstNumber: 10, expiredMinsAgo: 1,  orderStatus: null,      unit: 2 });
    await checkout('res_c', { seats: 1, firstNumber: 20, expiredMinsAgo: 2,  orderStatus: 'CREATED', unit: 3 });
    await checkout('res_d', { seats: 1, firstNumber: 30, expiredMinsAgo: 40, orderStatus: 'CREATED', unit: 4 });

    expect(await sweep()).toBe(3);        // a, b, d — not c
    expect(await seats('res_a')).toBe(0);
    expect(await seats('res_b')).toBe(0);
    expect(await seats('res_c')).toBe(1); // still paying
    expect(await seats('res_d')).toBe(0); // backstop
  });

  it('is harmless run over and over, which is what a five-minute job does', async () => {
    await checkout('res_x', { seats: 2, firstNumber: 1, expiredMinsAgo: 1, orderStatus: 'FAILED', failedMinsAgo: 6 });
    expect(await sweep()).toBe(1);
    expect(await sweep()).toBe(0);
    expect(await sweep()).toBe(0);
  });

  it('stays locked away from the public API', async () => {
    expect(await f.val<boolean>(
      `select has_function_privilege('anon', 'public.expire_stale_holds()', 'EXECUTE')`,
    )).toBe(false);
    expect(await f.val<boolean>(
      `select has_function_privilege('service_role', 'public.expire_stale_holds()', 'EXECUTE')`,
    )).toBe(true);
  });
});
