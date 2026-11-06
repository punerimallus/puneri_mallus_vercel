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
const COMP_PASSES = join(ROOT, 'supabase', 'migrations', '20261106_comp_passes.sql');
const ACCESS_PASS = join(ROOT, 'supabase', 'migrations', '20261107_access_pass.sql');
const RESET = join(ROOT, 'scripts', 'reset-ticketing.sql');

/** A database carrying both migrations and a realistic spread of data. */
async function messyDb() {
  const f = await freshDb();
  await f.db.exec(readFileSync(DROP_LEGACY, 'utf8'));
  await f.db.exec(readFileSync(COMP_PASSES, 'utf8'));
  await f.db.exec(readFileSync(ACCESS_PASS, 'utf8'));

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

  // Complimentary passes: an ACCESS PASS category, two grants against it, and the seats they
  // hold. Without these the reset was only ever tested on sold tickets, and a VIP guest list
  // left behind on a "clean" database is a guest list that lets people in on the night.
  const access = await seedCategory(f, {
    eventId: 'evt_live', name: 'ACCESS PASS', prefix: 'AP-', capacity: 100, price: 0,
  });
  await f.db.query(`update event_ticket_categories set comp_only = true where id = $1`, [access]);
  await f.val('select reserve_order_inventory($1,null,$2::jsonb,0,900,7,2)', ['comp_vip', items([[access, 2]])]);
  await f.val('select confirm_order_inventory($1)', ['comp_vip']);

  for (const [n, who] of [[1, 'Chief Guest'], [2, 'Sponsor']] as [number, string][]) {
    const compBooking = await f.val<string>(
      `insert into ticket_bookings (event_id, email, amount_paid, tickets_data, status, source, issued_by)
       values ('evt_live', $1, 0, $2::jsonb, 'CONFIRMED', 'COMP', 'admin@punerimallus.com') returning id`,
      [
        `guest${n}@example.com`,
        JSON.stringify([{ categoryId: access, categoryName: 'ACCESS PASS', ticketNumber: `AP-00${n}`, status: 'ISSUED' }]),
      ],
    );
    await f.db.query(
      `insert into comp_ticket_grants (booking_id, event_id, guest_name, guest_email, reason, passes, admits, face_value, issued_by)
       values ($1,'evt_live',$2,$3,'VIP',1,1,0,'admin@punerimallus.com')`,
      [compBooking, who, `guest${n}@example.com`],
    );
    await f.db.query(
      `insert into scan_log (booking_id, ticket_number, event_id, admitted, action, actor_email, actor_role)
       values ($1,$2,'evt_live',1,'ADMIT','gate@x.com','SCANNER')`,
      [compBooking, `AP-00${n}`],
    );
  }

  return { f, cat, buyer, other, access };
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
    // Complimentary passes go with everything else: the register, the bookings and the seats.
    expect(await f.val('select count(*) from comp_ticket_grants')).toBe(0);
    expect(await f.val(`select count(*) from ticket_bookings where source = 'COMP'`)).toBe(0);
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

  it('clears the complimentary guest list as thoroughly as the sold tickets', async () => {
    // The script leans on a cascade to do this, so it is worth proving rather than reading: a
    // grant surviving a reset is somebody who can still walk in on the night.
    const { f } = await messyDb();
    expect(await f.val('select count(*) from comp_ticket_grants')).toBe(2);
    expect(await f.val(`select count(*) from ticket_bookings where source = 'COMP'`)).toBe(2);

    await f.db.exec(readFileSync(RESET, 'utf8'));

    expect(await f.val('select count(*) from comp_ticket_grants')).toBe(0);
    expect(await f.val(`select count(*) from ticket_bookings where source = 'COMP'`)).toBe(0);
    expect(await f.val('select count(*) from ticket_numbers')).toBe(0);
    await f.close();
  });

  it('keeps the ACCESS PASS category itself, with its seats back', async () => {
    // Deleting it would mean re-creating it by hand before the next comp could be issued, and
    // it is a configured category rather than test data.
    const { f, access } = await messyDb();
    await f.db.exec(readFileSync(RESET, 'utf8'));

    const row = await f.one<{ name: string; sold: number; comp_only: boolean; capacity: number; issued_total: number }>(
      `select name, sold, comp_only, capacity, issued_total from event_ticket_categories where id = $1`,
      [access],
    );
    expect(row).toMatchObject({ name: 'ACCESS PASS', sold: 0, comp_only: true, capacity: 100, issued_total: 0 });
    await f.close();
  });

  it('gives the next complimentary pass number AP-001 again', async () => {
    const { f, access } = await messyDb();
    await f.db.exec(readFileSync(RESET, 'utf8'));

    const alloc = await f.val<{ numbers: number[] }[]>(
      'select reserve_order_inventory($1,null,$2::jsonb,0,900,7,2) as a',
      ['comp_fresh', items([[access, 1]])],
    );
    expect(alloc[0].numbers).toEqual([1]);
    await f.close();
  });

  it('does not fail on a database that never had the comp migration', async () => {
    // The guarded DO block in the script exists for exactly this: naming a missing table in a
    // plain DELETE fails when the statement is parsed, whatever branch it sits in.
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: 10 });
    await f.val('select reserve_order_inventory($1,$2,$3::jsonb,0,900,7,2)', ['r1', await seedUser(f), items([[cat, 1]])]);
    expect(await f.val(`select to_regclass('public.comp_ticket_grants') is null`)).toBe(true);

    await f.db.exec(readFileSync(RESET, 'utf8')); // must not throw

    expect(await f.val('select count(*) from ticket_numbers')).toBe(0);
    await f.close();
  });
});
