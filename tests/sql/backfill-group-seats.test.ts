// The one-time backfill that gives older group passes their seat list.
//
// It edits live bookings, so what matters is what it does NOT do: it must not touch a pass that
// already has a list, must not touch an ordinary pass, and must leave alone any group whose
// seats no longer match what the pass admits — a short list there would quietly tell a buyer
// they hold fewer seats than they were sold.

import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { freshDb, seedUser, type Fixture } from './pg';

const ROOT = join(import.meta.dirname ?? __dirname, '..', '..');
const sqlFile = (n: string) => readFileSync(join(ROOT, 'supabase', 'migrations', n), 'utf8');
const SCRIPT = readFileSync(join(ROOT, 'scripts', 'backfill-group-seats.sql'), 'utf8');
/** Just the DO block: Part A and Part C are reporting queries. */
const WRITE = SCRIPT.slice(SCRIPT.indexOf('do $backfill$'), SCRIPT.indexOf('$backfill$;') + '$backfill$;'.length);

let f: Fixture;
let cat: string;
let user: string;
let booking: string;

const EVENT = 'evt_test';
const RES = 'res_old';
// A real offer id: the counter trigger casts the ref's first part to uuid, as production does.
const OFFER = '11111111-2222-3333-4444-555555555555';

beforeEach(async () => {
  f = await freshDb();
  await f.db.exec(sqlFile('20261114_coupons.sql'));
  await f.db.exec(sqlFile('20261115_ticket_bundles.sql'));
  await f.db.exec(sqlFile('20261116_drop_group_tickets.sql'));
  await f.db.exec(sqlFile('20261117_bundle_sold_counter.sql'));
  cat = await f.val<string>(
    `insert into event_ticket_categories (event_id, name, prefix, price, capacity)
     values ($1, 'REGULAR', 'REGULAR-', 1049, 78) returning id`, [EVENT],
  );
  user = await seedUser(f);
});

afterEach(async () => { await f?.close(); });

/** A booking as it was stored BEFORE groupSeats existed: one group pass, no seat list. */
async function seedOldGroup(opts: { size?: number; seats?: number } = {}) {
  const size = opts.size ?? 5;
  const seats = opts.seats ?? size;
  await f.db.query(
    `insert into inventory_reservations (reservation_id, user_id, event_id, state, expires_at)
     values ($1, $2, $3, 'CONFIRMED', now() + interval '1 day')`, [RES, user, EVENT],
  );
  await f.db.query(
    `insert into ticket_numbers (category_id, number, reservation_id, user_id, state, bundle_ref)
     select $1, g + 54, $2, $3, 'ISSUED', $5 || ':' || $2 || ':1' from generate_series(1, $4) g`,
    [cat, RES, user, seats, OFFER],
  );
  booking = await f.val<string>(
    `insert into ticket_bookings (event_id, email, amount_paid, tickets_data, status, user_id)
     values ($1, 'buyer@example.com', 5000, $2::jsonb, 'CONFIRMED', $3) returning id`,
    [EVENT, JSON.stringify([
      { categoryId: cat, categoryName: 'REGULAR', ticketNumber: 'REGULAR-055', status: 'ISSUED', group: true, groupName: 'Group of 5', groupSize: size },
      { categoryId: cat, categoryName: 'REGULAR', ticketNumber: 'REGULAR-099', status: 'ISSUED' },
    ]), user],
  );
  await f.db.query(
    `insert into payment_orders (razorpay_order_id, user_id, payment_type, amount_paise, status, booking_id, reservation_id)
     values ('order_old', $1, 'EVENT_TICKET', 500000, 'FULFILLED', $2, $3)`, [user, booking, RES],
  );
}

const passes = () => f.val<Record<string, unknown>[]>(`select tickets_data from ticket_bookings where id = $1`, [booking]);

describe('backfilling the seats behind an old group pass', () => {
  it('gives it the five seats it was actually sold', async () => {
    await seedOldGroup();
    await f.db.exec(WRITE);
    const data = await passes() as { groupSeats?: string[] }[];
    expect(data[0].groupSeats).toEqual(['REGULAR-055', 'REGULAR-056', 'REGULAR-057', 'REGULAR-058', 'REGULAR-059']);
  });

  it('leaves the ordinary pass on the same booking alone', async () => {
    await seedOldGroup();
    await f.db.exec(WRITE);
    const data = await passes() as { ticketNumber: string; groupSeats?: string[] }[];
    expect(data[1].ticketNumber).toBe('REGULAR-099');
    expect(data[1].groupSeats).toBeUndefined();
  });

  it('changes nothing else about the pass', async () => {
    await seedOldGroup();
    const before = (await passes())[0];
    await f.db.exec(WRITE);
    const after = (await passes())[0] as Record<string, unknown>;
    for (const key of Object.keys(before)) expect(after[key]).toEqual((before as Record<string, unknown>)[key]);
  });

  it('is safe to run twice', async () => {
    await seedOldGroup();
    await f.db.exec(WRITE);
    const once = await passes();
    await f.db.exec(WRITE);
    expect(await passes()).toEqual(once);
  });

  it('leaves a group alone when a seat has since been voided', async () => {
    // The pass says it admits five; only four seats remain on record. Writing four would tell
    // the buyer they hold fewer than they were sold, so it is skipped for a human to decide.
    await seedOldGroup({ size: 5, seats: 4 });
    await f.db.exec(WRITE);
    const data = await passes() as { groupSeats?: string[] }[];
    expect(data[0].groupSeats).toBeUndefined();
  });

  it('does not overwrite a list that is already there', async () => {
    await seedOldGroup();
    await f.db.query(
      `update ticket_bookings set tickets_data = jsonb_set(tickets_data, '{0,groupSeats}', $2::jsonb) where id = $1`,
      [booking, JSON.stringify(['KEEP-ME'])],
    );
    await f.db.exec(WRITE);
    const data = await passes() as { groupSeats?: string[] }[];
    expect(data[0].groupSeats).toEqual(['KEEP-ME']);
  });

  it('does nothing at all when there is nothing to fill', async () => {
    await expect(f.db.exec(WRITE)).resolves.toBeDefined();
  });
});
