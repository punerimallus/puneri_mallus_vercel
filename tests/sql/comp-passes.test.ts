// The complimentary-pass migration, executed for real against an in-process PostgreSQL.
//
// The claim this file has to stand up is that a free pass is not a free-for-all: a comp takes
// a real seat out of a real category through the same reservation a paying buyer uses, so it
// cannot oversell, cannot be handed a number somebody paid for, and cannot be issued from a
// category an admin has paused. Those are database guarantees, so they are tested in a database.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { freshDb, items, seedCategory, seedUser, type Fixture } from './pg';
import { buildIssuedTickets } from '@/lib/payments/fulfil';
import { checkCompRequest, type CompCategory } from '@/lib/payments/comp';
import type { Allocation, PaymentOrder } from '@/lib/payments/types';

const MIGRATIONS = join(import.meta.dirname ?? __dirname, '..', '..', 'supabase', 'migrations');
const sql = () => readFileSync(join(MIGRATIONS, '20261106_comp_passes.sql'), 'utf8');
const accessPassSql = () => readFileSync(join(MIGRATIONS, '20261107_access_pass.sql'), 'utf8');

let f: Fixture;

beforeEach(async () => {
  f = await freshDb();
  await f.db.exec(sql());
  await f.db.exec(accessPassSql());
});

afterEach(async () => {
  await f.close();
});

/** Reserve seats the way the comp route does: no user, so no per-account limits apply. */
const reserveComp = (resId: string, cart: [string, number][]) =>
  f.val<Allocation[]>(
    `select reserve_order_inventory($1, null, $2::jsonb, 0, 900, 7, 2) as alloc`,
    [resId, items(cart)],
  );

const booking = async (eventId: string, over: Record<string, unknown> = {}) =>
  f.val<string>(
    `insert into ticket_bookings (event_id, email, amount_paid, tickets_data, source, issued_by)
     values ($1, $2, $3, $4::jsonb, $5, $6) returning id`,
    [
      eventId,
      over.email ?? 'guest@example.com',
      over.amount ?? 0,
      JSON.stringify(over.tickets ?? []),
      over.source ?? 'COMP',
      over.issuedBy ?? 'admin@punerimallus.com',
    ],
  );

describe('the comp-passes migration', () => {
  it('applies on top of the ticketing schema and leaves its marker', async () => {
    expect(await f.val<number>(`select count(*) from app_schema_markers where name = 'comp_passes_v1'`)).toBe(1);
  });

  it('can be run again without complaint', async () => {
    await f.db.exec(sql());
    await f.db.exec(sql());
    expect(await f.val<number>(`select count(*) from app_schema_markers where name = 'comp_passes_v1'`)).toBe(1);
  });

  it('marks every booking that already existed as a sale', async () => {
    // No backfill is needed because everything in the table today was bought. If the default
    // were anything else, every historic sale would read as a giveaway.
    const id = await booking('evt_test', { source: 'SALE', amount: 500 });
    expect(await f.val(`select source from ticket_bookings where id = $1`, [id])).toBe('SALE');
  });

  it('refuses a source that is neither bought nor given', async () => {
    const err = await f.fails(
      `insert into ticket_bookings (event_id, email, amount_paid, source) values ('e', 'a@b.com', 0, 'FREEBIE')`,
    );
    expect(err).toMatch(/ticket_bookings_source_check/);
  });

  it('records who handed the passes over', async () => {
    const id = await booking('evt_test', { issuedBy: 'rohitanish86@gmail.com' });
    expect(await f.val(`select issued_by from ticket_bookings where id = $1`, [id])).toBe('rohitanish86@gmail.com');
  });
});

describe('the grants register', () => {
  const grant = (bookingId: string, over: Record<string, unknown> = {}) =>
    f.db.query(
      `insert into comp_ticket_grants (booking_id, event_id, guest_name, guest_email, reason, passes, admits, face_value, issued_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        bookingId,
        over.eventId ?? 'evt_test',
        over.name ?? 'Job Kurian',
        over.email ?? 'guest@example.com',
        over.reason ?? 'VIP',
        over.passes ?? 2,
        over.admits ?? 2,
        over.faceValue ?? 1000,
        over.issuedBy ?? 'admin@punerimallus.com',
      ],
    );

  it('stores a grant against its booking', async () => {
    const id = await booking('evt_test');
    await grant(id);
    expect(await f.val(`select guest_name from comp_ticket_grants where booking_id = $1`, [id])).toBe('Job Kurian');
  });

  it('refuses a reason the dashboard cannot colour', async () => {
    const id = await booking('evt_test');
    expect(await f.fails(
      `insert into comp_ticket_grants (booking_id, event_id, guest_name, guest_email, reason, issued_by)
       values ($1, 'evt_test', 'X', 'x@y.com', 'MATE', 'admin')`,
      [id],
    )).toMatch(/comp_ticket_grants_reason_check/);
  });

  it('refuses a grant pointing at a booking that does not exist', async () => {
    // Otherwise the register could claim seats were given to someone when no pass was issued.
    expect(await f.fails(
      `insert into comp_ticket_grants (booking_id, event_id, guest_name, guest_email, issued_by)
       values (gen_random_uuid(), 'evt_test', 'Ghost', 'g@x.com', 'admin')`,
    )).toMatch(/foreign key|violates/i);
  });

  it('keeps one grant per booking', async () => {
    const id = await booking('evt_test');
    await grant(id);
    expect(await f.fails(
      `insert into comp_ticket_grants (booking_id, event_id, guest_name, guest_email, issued_by)
       values ($1, 'evt_test', 'Second', 's@x.com', 'admin')`,
      [id],
    )).toMatch(/comp_ticket_grants_booking_uidx|duplicate/i);
  });

  it('takes the grant with the booking when the booking goes', async () => {
    const id = await booking('evt_test');
    await grant(id);
    await f.db.query(`delete from ticket_bookings where id = $1`, [id]);
    expect(await f.val<number>(`select count(*) from comp_ticket_grants where booking_id = $1`, [id])).toBe(0);
  });

  it('will not record a grant larger than one request can issue', async () => {
    const id = await booking('evt_test');
    expect(await f.fails(
      `insert into comp_ticket_grants (booking_id, event_id, guest_name, guest_email, passes, issued_by)
       values ($1, 'evt_test', 'X', 'x@y.com', 500, 'admin')`,
      [id],
    )).toMatch(/comp_ticket_grants_passes_check/);
  });
});

describe('a comp takes real stock', () => {
  it('reduces what is left on sale', async () => {
    const cat = await seedCategory(f, { name: 'VIP', prefix: 'VIP-', capacity: 10 });
    await reserveComp('comp_a', [[cat, 3]]);
    await f.db.query(`select confirm_order_inventory($1)`, ['comp_a']);
    expect(await f.val('select sold from event_ticket_categories where id = $1', [cat])).toBe(3);
  });

  it('cannot give away a seat that was sold', async () => {
    const cat = await seedCategory(f, { name: 'VIP', prefix: 'VIP-', capacity: 1 });
    await f.db.query(
      `select reserve_order_inventory($1, $2, $3::jsonb, 0, 900, 7, 2)`,
      ['buyer', await seedUser(f), items([[cat, 1]])],
    );
    expect(await f.fails(`select reserve_order_inventory('comp_b', null, $1::jsonb, 0, 900, 7, 2)`, [items([[cat, 1]])]))
      .toMatch(/SOLD_OUT/);
  });

  it('cannot sell a seat that was given away', async () => {
    // The other direction matters just as much: a VIP holding a pass must not find a paying
    // customer in their seat.
    const cat = await seedCategory(f, { name: 'VIP', prefix: 'VIP-', capacity: 1 });
    await reserveComp('comp_c', [[cat, 1]]);
    await f.db.query(`select confirm_order_inventory($1)`, ['comp_c']);
    expect(await f.fails(
      `select reserve_order_inventory('buyer', $1, $2::jsonb, 0, 900, 7, 2)`,
      [await seedUser(f), items([[cat, 1]])],
    )).toMatch(/SOLD_OUT/);
  });

  it('never hands a comp a pass number somebody paid for', async () => {
    const cat = await seedCategory(f, { name: 'GENERAL', prefix: 'GEN-', capacity: 100 });
    const sold = await f.val<Allocation[]>(
      `select reserve_order_inventory($1, $2, $3::jsonb, 0, 900, 7, 2) as a`,
      ['buyer', await seedUser(f), items([[cat, 2]])],
    );
    await f.db.query(`select confirm_order_inventory($1)`, ['buyer']);

    const free = await reserveComp('comp_d', [[cat, 2]]);
    await f.db.query(`select confirm_order_inventory($1)`, ['comp_d']);

    expect(sold[0].numbers).toEqual([1, 2]);
    expect(free[0].numbers).toEqual([3, 4]);
    // Belt and braces: the numbers table is the thing that must have no repeats.
    expect(await f.val<number>(
      `select count(*) from (select number from ticket_numbers where category_id = $1 group by number having count(*) > 1) d`,
      [cat],
    )).toBe(0);
  });

  it('refuses to issue from a category an admin has paused', async () => {
    const cat = await seedCategory(f, { name: 'BALCONY', prefix: 'BAL-', capacity: 50 });
    await f.db.query(`update event_ticket_categories set active = false where id = $1`, [cat]);
    expect(await f.fails(`select reserve_order_inventory('comp_e', null, $1::jsonb, 0, 900, 7, 2)`, [items([[cat, 1]])]))
      .toMatch(/SOLD_OUT/);
  });

  it('is not held back by the per-account limits a buyer faces', async () => {
    // A comp is issued to a guest by name, not against anyone's account, so a 20-strong artist
    // list is one grant rather than three logins.
    const cat = await seedCategory(f, { name: 'GENERAL', prefix: 'GEN-', capacity: 100 });
    const alloc = await reserveComp('comp_f', [[cat, 20]]);
    expect(alloc[0].numbers).toHaveLength(20);
  });

  it('gives the seats back when a grant fails after reserving', async () => {
    // The route releases the hold in its catch. Without that, a failed giveaway would hold
    // stock for fifteen minutes during a sale.
    const cat = await seedCategory(f, { name: 'VIP', prefix: 'VIP-', capacity: 2 });
    await reserveComp('comp_g', [[cat, 2]]);
    expect(await f.val('select sold from event_ticket_categories where id = $1', [cat])).toBe(2);
    await f.db.query(`select release_order_inventory($1)`, ['comp_g']);
    expect(await f.val('select sold from event_ticket_categories where id = $1', [cat])).toBe(0);
  });
});

describe('a comp pass, end to end', () => {
  it('produces the same numbered, scannable passes a sale does', async () => {
    const eventId = 'evt_comp';
    const gen = await seedCategory(f, { eventId, name: 'GENERAL', prefix: 'GEN-', capacity: 100, price: 500 });
    const grp = await seedCategory(f, { eventId, name: 'FRIENDS GROUP', prefix: 'GRP-', capacity: 20, price: 2000, groupSize: 5 });

    const categories: CompCategory[] = [
      { id: gen, name: 'GENERAL', prefix: 'GEN-', price: 500, capacity: 100, active: true },
      { id: grp, name: 'FRIENDS GROUP', prefix: 'GRP-', price: 2000, capacity: 20, active: true, group_size: 5 },
    ];

    const clean = checkCompRequest(
      { guestName: 'Job Kurian', guestEmail: 'JOB@example.com', reason: 'ARTIST', items: { [gen]: 2, [grp]: 1 } },
      categories,
    );

    const allocations = await reserveComp('comp_journey', [[gen, 2], [grp, 1]]);
    await f.db.query(`select confirm_order_inventory($1)`, ['comp_journey']);

    const tickets = buildIssuedTickets(
      { cart: clean.lines, allocated_tickets: allocations } as unknown as PaymentOrder,
      allocations,
    );

    // Numbered exactly like a sale, in the order they were chosen.
    expect(tickets.map((t) => t.ticketNumber)).toEqual(['GEN-001', 'GEN-002', 'GRP-001']);
    expect(tickets.every((t) => t.status === 'ISSUED')).toBe(true);
    // The gate reads groupSize off the pass; losing it would admit one person on a group QR.
    expect(tickets[2].groupSize).toBe(5);

    const bookingId = await booking(eventId, { tickets, email: clean.guestEmail, issuedBy: 'admin@punerimallus.com' });

    const row = await f.one<{ source: string; amount_paid: string; razorpay_payment_id: string | null; status: string }>(
      `select source, amount_paid, razorpay_payment_id, status from ticket_bookings where id = $1`,
      [bookingId],
    );
    expect(row!.source).toBe('COMP');
    expect(Number(row!.amount_paid)).toBe(0);
    // No invented payment reference: the ledger must not look like money arrived.
    expect(row!.razorpay_payment_id).toBeNull();
    // CONFIRMED is what the gate requires; anything else and the guest is turned away.
    expect(row!.status).toBe('CONFIRMED');

    expect(clean.faceValue).toBe(3000);
    expect(clean.guestEmail).toBe('job@example.com');
  });
});


describe('the access-pass migration', () => {
  it('applies and leaves its marker', async () => {
    expect(await f.val<number>(`select count(*) from app_schema_markers where name = 'access_pass_v1'`)).toBe(1);
  });

  it('can be run again without complaint', async () => {
    await f.db.exec(accessPassSql());
    expect(await f.val<number>(`select count(*) from app_schema_markers where name = 'access_pass_v1'`)).toBe(1);
  });

  it('leaves every category that already existed on sale to the public', async () => {
    // Defaulting to false is the whole safety property: if it defaulted the other way, every
    // category on every event would vanish from the booking page the moment this ran.
    const id = await seedCategory(f, { name: 'GENERAL' });
    expect(await f.val(`select comp_only from event_ticket_categories where id = $1`, [id])).toBe(false);
  });

  it('issues a real, numbered pass from an access-pass category', async () => {
    const cat = await seedCategory(f, { name: 'ACCESS PASS', prefix: 'AP-', capacity: 100, price: 0 });
    await f.db.query(`update event_ticket_categories set comp_only = true where id = $1`, [cat]);

    const alloc = await reserveComp('comp_ap', [[cat, 2]]);
    await f.db.query(`select confirm_order_inventory($1)`, ['comp_ap']);
    expect(alloc[0].numbers).toEqual([1, 2]);
    expect(await f.val('select sold from event_ticket_categories where id = $1', [cat])).toBe(2);
  });

  it('still refuses to oversell an access pass', async () => {
    // It is free, not unlimited: the venue still has a fire limit.
    const cat = await seedCategory(f, { name: 'ACCESS PASS', prefix: 'AP-', capacity: 1, price: 0 });
    await f.db.query(`update event_ticket_categories set comp_only = true where id = $1`, [cat]);
    await reserveComp('comp_ap1', [[cat, 1]]);
    await f.db.query(`select confirm_order_inventory($1)`, ['comp_ap1']);
    expect(await f.fails(`select reserve_order_inventory('comp_ap2', null, $1::jsonb, 0, 900, 7, 2)`, [items([[cat, 1]])]))
      .toMatch(/SOLD_OUT/);
  });
});
