// Runs scripts/reset-ticketing.sql for real, against a PostgreSQL carrying the full migration
// chain and a realistic mess of data: live bookings, refunded ones, held reservations, scan
// history, membership orders and a financial ledger.
//
// The reset is destructive and gets run against production, so "it looked right when I read it"
// is not good enough. Two things have to hold every time: ticketing goes to a true zero so the
// next buyer gets number 001, and nothing outside ticketing is touched — above all the
// `payments` ledger, which holds football and membership revenue.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { freshDb, items, seedCategory, seedUser, MIGRATION } from './pg';

const ROOT = join(import.meta.dirname ?? __dirname, '..', '..');
const DROP_LEGACY = join(ROOT, 'supabase', 'migrations', '20261029_drop_legacy_ticketing.sql');
const RESET = join(ROOT, 'scripts', 'reset-ticketing.sql');

/** A database carrying both migrations and a realistic spread of data. */
async function messyDb() {
  const f = await freshDb();
  await f.db.exec(readFileSync(DROP_LEGACY, 'utf8'));

  const cat = await seedCategory(f, { eventId: 'evt_live', name: 'GENERAL', prefix: 'GEN-', capacity: 100 });
  const buyer = await seedUser(f, 250);
  const other = await seedUser(f, 40);

  // Two confirmed purchases and one checkout still holding seats.
  await f.val('select reserve_order_inventory($1,$2,$3::jsonb,$4,900,7,2)', ['res_a', buyer, items([[cat, 2]]), 100]);
  await f.val('select confirm_order_inventory($1)', ['res_a']);
  await f.val('select reserve_order_inventory($1,$2,$3::jsonb,0,900,7,2)', ['res_b', other, items([[cat, 1]])]);
  await f.val('select confirm_order_inventory($1)', ['res_b']);
  await f.val('select reserve_order_inventory($1,$2,$3::jsonb,0,900,7,2)', ['res_held', other, items([[cat, 1]])]);

  const booking = await f.val<string>(
    `insert into ticket_bookings (event_id, user_id, status, tickets_data)
     values ('evt_live', $1, 'CONFIRMED', $2::jsonb) returning id`,
    [buyer, JSON.stringify([{ categoryId: cat, categoryName: 'GENERAL', ticketNumber: 'GEN-001', status: 'CHECKED_IN' }])],
  );
  await f.val(
    `insert into ticket_bookings (event_id, user_id, status, tickets_data)
     values ('evt_live', $1, 'REFUNDED', $2::jsonb)`,
    [other, JSON.stringify([{ categoryId: cat, categoryName: 'GENERAL', ticketNumber: 'GEN-003', status: 'REFUNDED' }])],
  );

  // Orders: ticket ones go, membership and mart stay.
  await f.val(`insert into payment_orders (razorpay_order_id, payment_type, status, booking_id, reservation_id)
               values ('order_t1','EVENT_TICKET','FULFILLED',$1,'res_a')`, [booking]);
  await f.val(`insert into payment_orders (razorpay_order_id, payment_type, status) values ('order_t2','EVENT_TICKET','CREATED')`);
  await f.val(`insert into payment_orders (razorpay_order_id, payment_type, status) values ('order_m1','LIFETIME','FULFILLED')`);
  await f.val(`insert into payment_orders (razorpay_order_id, payment_type, status) values ('order_m2','MART','FULFILLED')`);

  // The things that must survive.
  await f.val(`insert into payments (razorpay_payment_id, payment_type, amount, status) values ('pay_football','FOOTBALL',5000,'SUCCESS')`);
  await f.val(`insert into payments (razorpay_payment_id, payment_type, amount, status) values ('pay_member','LIFETIME',2000,'SUCCESS')`);
  await f.val(`insert into payment_webhook_events (event_id, event_type) values ('evt_hook_1','payment.captured')`);
  await f.val(`insert into payment_webhook_events (event_id, event_type) values ('evt_hook_2','refund.processed')`);
  await f.val(`insert into memberships (user_id, status) values ($1,'ACTIVE')`, [buyer]);
  await f.val(`insert into event_staff (email, role, active) values ('volunteer@example.com','SCANNER',true)`);
  await f.val(
    `insert into scan_log (booking_id, ticket_number, event_id, admitted, actor_email, actor_role)
     values ($1,'GEN-001','evt_live',1,'admin@x.com','ADMIN')`,
    [booking],
  );

  return { f, cat, buyer, other };
}

describe('reset-ticketing.sql', () => {
  it('runs cleanly against the current schema', async () => {
    const { f } = await messyDb();
    await f.db.exec(readFileSync(RESET, 'utf8')); // must not throw
    await f.close();
  });

  it('takes ticketing to a true zero', async () => {
    const { f } = await messyDb();
    await f.db.exec(readFileSync(RESET, 'utf8'));

    expect(await f.val('select count(*) from ticket_bookings')).toBe(0);
    expect(await f.val(`select count(*) from payment_orders where payment_type = 'EVENT_TICKET'`)).toBe(0);
    expect(await f.val('select count(*) from ticket_numbers')).toBe(0);
    expect(await f.val('select count(*) from inventory_reservations')).toBe(0);
    expect(await f.val('select count(*) from scan_log')).toBe(0);
    expect(await f.val('select coalesce(sum(sold), 0) from event_ticket_categories')).toBe(0);
    expect(await f.val('select coalesce(sum(issued_total), 0) from event_ticket_categories')).toBe(0);
    await f.close();
  });

  it('leaves the money and everything else alone', async () => {
    const { f } = await messyDb();
    await f.db.exec(readFileSync(RESET, 'utf8'));

    // The ledger holds football and membership revenue. Losing it would be the worst outcome.
    expect(await f.val('select count(*) from payments')).toBe(2);
    expect(await f.val(`select count(*) from payments where payment_type = 'FOOTBALL'`)).toBe(1);
    // Webhook de-duplication: without these, a replayed refund is reprocessed forever.
    expect(await f.val('select count(*) from payment_webhook_events')).toBe(2);
    // Membership and Mart are a different product.
    expect(await f.val(`select count(*) from payment_orders where payment_type <> 'EVENT_TICKET'`)).toBe(2);
    expect(await f.val('select count(*) from memberships')).toBe(1);
    // The gate list survives, so volunteers do not have to be re-added after every reset.
    expect(await f.val('select count(*) from event_staff')).toBe(1);
    // Accounts themselves are untouched.
    expect(await f.val('select count(*) from profiles')).toBe(2);
    await f.close();
  });

  it('clears loyalty points, including any still held by a reservation', async () => {
    const { f } = await messyDb();
    // A held reservation was holding points; deleting it directly bypasses the release, which is
    // exactly why the script must zero the held column itself.
    expect(await f.val('select sum(loyalty_points) from profiles')).toBeGreaterThan(0);

    await f.db.exec(readFileSync(RESET, 'utf8'));

    expect(await f.val('select coalesce(sum(loyalty_points), 0) from profiles')).toBe(0);
    expect(await f.val('select coalesce(sum(loyalty_points_held), 0) from profiles')).toBe(0);
    await f.close();
  });

  it('the next buyer afterwards gets number 001', async () => {
    const { f, cat } = await messyDb();
    await f.db.exec(readFileSync(RESET, 'utf8'));

    const fresh = await seedUser(f);
    const alloc = await f.val<{ numbers: number[] }[]>(
      'select reserve_order_inventory($1,$2,$3::jsonb,0,900,7,2)',
      ['after_reset', fresh, items([[cat, 1]])],
    );
    expect(alloc[0].numbers).toEqual([1]);
    await f.close();
  });

  it('is safe to run twice', async () => {
    const { f } = await messyDb();
    const sql = readFileSync(RESET, 'utf8');
    await f.db.exec(sql);
    await f.db.exec(sql); // must not throw on an already-empty database
    expect(await f.val('select count(*) from ticket_bookings')).toBe(0);
    await f.close();
  });

  it('still works on a database that never had the legacy migration dropped', async () => {
    // Someone running the reset before 20261029 should not hit an error.
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: 10 });
    await f.val('select reserve_order_inventory($1,$2,$3::jsonb,0,900,7,2)', ['r1', await seedUser(f), items([[cat, 1]])]);
    await f.db.exec(readFileSync(RESET, 'utf8'));
    expect(await f.val('select count(*) from ticket_numbers')).toBe(0);
    await f.close();
  });
});
