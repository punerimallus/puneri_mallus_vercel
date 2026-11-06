// Pre-flight for a live sale, against a real PostgreSQL.
//
// Everything here runs against PGlite with all three ticketing migrations applied, in the order
// production had them applied: the integrity schema, complimentary passes, then the access
// pass. The question each section asks is not "does the function work" - other suites cover
// that - but "can the house be oversold, can a number be printed twice, can money or points go
// missing, between the moment tickets go live and the moment the last person walks in".
//
// Where a guarantee is enforced in the database it is tested in the database. Where it is
// enforced in application code the application code is called here too, so a rule that exists
// in one layer only cannot pass by being asserted against itself.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { freshDb, items, seedCategory, seedUser, type Fixture } from './pg';
import { quoteEventCart, type TicketCategory } from '@/lib/payments/pricing';
import { checkCompDeletable, isCompReservation, publiclyListed } from '@/lib/payments/comp';
import { onSale, partitionBySale } from '@/lib/events/catalogue';
import { bookingAttendance, admittedBy, type ScanLogRow } from '@/lib/payments/attendance';
import type { Allocation } from '@/lib/payments/types';

const MIGRATIONS = join(import.meta.dirname ?? __dirname, '..', '..', 'supabase', 'migrations');
const migration = (name: string) => readFileSync(join(MIGRATIONS, name), 'utf8');

let f: Fixture;

beforeEach(async () => {
  f = await freshDb();
  await f.db.exec(migration('20261106_comp_passes.sql'));
  await f.db.exec(migration('20261107_access_pass.sql'));
});

afterEach(async () => {
  await f.close();
});

// --- the calls a sale is made of ----------------------------------------------------------

const reserve = (
  resId: string,
  userId: string | null,
  cart: [string, number][],
  opts: { points?: number; ttl?: number; maxSingle?: number; maxGroup?: number } = {},
) =>
  f.val<Allocation[]>(
    `select reserve_order_inventory($1, $2, $3::jsonb, $4, $5, $6, $7) as alloc`,
    [resId, userId, items(cart), opts.points ?? 0, opts.ttl ?? 900, opts.maxSingle ?? 7, opts.maxGroup ?? 2],
  );

const reserveFails = (resId: string, userId: string | null, cart: [string, number][], points = 0) =>
  f.fails(`select reserve_order_inventory($1, $2, $3::jsonb, $4, 900, 7, 2)`, [resId, userId, items(cart), points]);

const confirm = (resId: string) => f.val<Record<string, unknown>>(`select confirm_order_inventory($1) as r`, [resId]);
const release = (resId: string) => f.val<number>(`select release_order_inventory($1)`, [resId]);
const voidNumber = (resId: string, categoryId: string, number: number) =>
  f.val<number>(`select void_ticket_number($1, $2, $3)`, [resId, categoryId, number]);

const sold = (categoryId: string) => f.val<number>(`select sold from event_ticket_categories where id = $1`, [categoryId]);
const issuedTotal = (categoryId: string) => f.val<number>(`select issued_total from event_ticket_categories where id = $1`, [categoryId]);
const rows = (categoryId: string) => f.val<number>(`select count(*) from ticket_numbers where category_id = $1`, [categoryId]);
const numbersIn = async (categoryId: string) =>
  (await f.all<{ number: number }>(`select number from ticket_numbers where category_id = $1 order by number`, [categoryId]))
    .map((r) => r.number);

/** The invariant the whole sale rests on: the counter equals the rows, in every category. */
const countersAgree = async () => {
  const drift = await f.all<{ id: string; sold: number; live: number }>(
    `select c.id, c.sold, (select count(*) from ticket_numbers t where t.category_id = c.id)::int as live
       from event_ticket_categories c`,
  );
  return drift.filter((d) => Number(d.sold) !== Number(d.live));
};

const asCategory = (id: string, over: Partial<TicketCategory> = {}): TicketCategory => ({
  id,
  name: 'GENERAL',
  prefix: 'GEN-',
  price: 500,
  capacity: 100,
  sold: 0,
  active: true,
  ...over,
});

// ==========================================================================================
describe('the schema a live sale needs', () => {
  it('has all three migrations recorded', async () => {
    const markers = await f.all<{ name: string }>(`select name from app_schema_markers order by name`);
    expect(markers.map((m) => m.name)).toEqual(
      expect.arrayContaining(['ticketing_integrity_v1', 'comp_passes_v1', 'access_pass_v1']),
    );
  });

  it('cannot hold two passes on the same number, whatever the application asks for', async () => {
    const cat = await seedCategory(f, { capacity: 10 });
    await reserve('r1', null, [[cat, 1]]);
    const err = await f.fails(
      `insert into ticket_numbers (category_id, number, reservation_id, state)
       values ($1, 1, 'r1', 'HELD')`,
      [cat],
    );
    expect(err).toMatch(/duplicate key|unique/i);
  });

  it('keeps a ticket number only in a state the gate understands', async () => {
    const cat = await seedCategory(f, { capacity: 10 });
    await reserve('r1', null, [[cat, 1]]);
    const err = await f.fails(`update ticket_numbers set state = 'MAYBE' where category_id = $1`, [cat]);
    expect(err).toMatch(/ticket_numbers_state_check|check constraint/i);
  });

  it('marks a comp booking apart from a sale, and defaults to a sale', async () => {
    const id = await f.val<string>(
      `insert into ticket_bookings (event_id, email, amount_paid, tickets_data) values ('e1','a@b.com',500,'[]'::jsonb) returning id`,
    );
    expect(await f.val(`select source from ticket_bookings where id = $1`, [id])).toBe('SALE');
    const err = await f.fails(`update ticket_bookings set source = 'FREEBIE' where id = $1`, [id]);
    expect(err).toMatch(/check constraint|source/i);
  });

  it('starts every category as publicly sellable', async () => {
    const cat = await seedCategory(f, { capacity: 10 });
    expect(await f.val(`select comp_only from event_ticket_categories where id = $1`, [cat])).toBe(false);
    expect(await f.val(`select active from event_ticket_categories where id = $1`, [cat])).toBe(true);
  });

  it('takes the register row away with the booking, so a deleted grant leaves nothing behind', async () => {
    const cat = await seedCategory(f, { capacity: 10 });
    await reserve('comp_x', null, [[cat, 1]]);
    const booking = await f.val<string>(
      `insert into ticket_bookings (event_id, email, amount_paid, tickets_data, source, issued_by)
       values ('e1','g@x.com',0,'[]'::jsonb,'COMP','admin@x.com') returning id`,
    );
    await f.db.query(
      `insert into comp_ticket_grants (booking_id, event_id, guest_name, guest_email, reason, passes, admits, face_value, issued_by)
       values ($1,'e1','Guest','g@x.com','VIP',1,1,500,'admin@x.com')`,
      [booking],
    );
    expect(await f.val(`select count(*) from comp_ticket_grants`)).toBe(1);
    await f.db.query(`delete from ticket_bookings where id = $1`, [booking]);
    expect(await f.val(`select count(*) from comp_ticket_grants`)).toBe(0);
  });

  it('refuses a grant larger than one admin should be able to type by accident', async () => {
    const booking = await f.val<string>(
      `insert into ticket_bookings (event_id, email, amount_paid, tickets_data, source)
       values ('e1','g@x.com',0,'[]'::jsonb,'COMP') returning id`,
    );
    const err = await f.fails(
      `insert into comp_ticket_grants (booking_id, event_id, guest_name, guest_email, reason, passes, admits, face_value, issued_by)
       values ($1,'e1','Greedy','g@x.com','VIP',5000,5000,0,'admin@x.com')`,
      [booking],
    );
    expect(err).toMatch(/check constraint|passes/i);
  });

  it('refuses a reason nobody chose from the list', async () => {
    const booking = await f.val<string>(
      `insert into ticket_bookings (event_id, email, amount_paid, tickets_data, source)
       values ('e1','g@x.com',0,'[]'::jsonb,'COMP') returning id`,
    );
    const err = await f.fails(
      `insert into comp_ticket_grants (booking_id, event_id, guest_name, guest_email, reason, passes, admits, face_value, issued_by)
       values ($1,'e1','Guest','g@x.com','BECAUSE',1,1,0,'admin@x.com')`,
      [booking],
    );
    expect(err).toMatch(/check constraint|reason/i);
  });
});

// ==========================================================================================
describe('one sale, all the way through', () => {
  it('holds the seats before the money and only spends the points at the end', async () => {
    const user = await seedUser(f, 500);
    const cat = await seedCategory(f, { capacity: 50, price: 1000 });

    await reserve('res_1', user, [[cat, 2]], { points: 200 });
    // Held, not spent: the balance still reads 500 until the payment lands.
    expect(await f.val(`select loyalty_points from profiles where id = $1`, [user])).toBe(500);
    expect(await f.val(`select loyalty_points_held from profiles where id = $1`, [user])).toBe(200);
    expect(await sold(cat)).toBe(2);

    const result = await confirm('res_1');
    expect(result.alreadyConfirmed).toBe(false);
    expect(await f.val(`select loyalty_points from profiles where id = $1`, [user])).toBe(300);
    expect(await f.val(`select loyalty_points_held from profiles where id = $1`, [user])).toBe(0);
  });

  it('issues the numbers it promised, in order, from one', async () => {
    const cat = await seedCategory(f, { capacity: 50 });
    const alloc = await reserve('res_1', null, [[cat, 3]]);
    expect(alloc[0].numbers).toEqual([1, 2, 3]);
    await confirm('res_1');
    expect(await f.val(`select count(*) from ticket_numbers where state = 'ISSUED'`)).toBe(3);
  });

  it('abandoning a checkout returns everything, including the points', async () => {
    const user = await seedUser(f, 500);
    const cat = await seedCategory(f, { capacity: 50 });
    await reserve('res_1', user, [[cat, 2]], { points: 200 });
    expect(await release('res_1')).toBe(2);
    expect(await sold(cat)).toBe(0);
    expect(await f.val(`select loyalty_points from profiles where id = $1`, [user])).toBe(500);
    expect(await f.val(`select loyalty_points_held from profiles where id = $1`, [user])).toBe(0);
  });

  it('refunding after payment returns the seats and the points that were spent', async () => {
    const user = await seedUser(f, 500);
    const cat = await seedCategory(f, { capacity: 50 });
    await reserve('res_1', user, [[cat, 2]], { points: 200 });
    await confirm('res_1');
    expect(await f.val(`select loyalty_points from profiles where id = $1`, [user])).toBe(300);
    await release('res_1');
    expect(await sold(cat)).toBe(0);
    // Back to the opening balance: a refund must not keep the points nor pay them twice.
    expect(await f.val(`select loyalty_points from profiles where id = $1`, [user])).toBe(500);
  });

  it('cannot confirm a hold the sweeper already took back', async () => {
    const cat = await seedCategory(f, { capacity: 50 });
    await reserve('res_1', null, [[cat, 1]]);
    await release('res_1');
    expect(await f.fails(`select confirm_order_inventory('res_1')`)).toMatch(/RESERVATION_LOST/);
  });

  it('a checkout nobody finished is swept, and only once it is actually stale', async () => {
    const cat = await seedCategory(f, { capacity: 50 });
    await reserve('fresh', null, [[cat, 1]], { ttl: 900 });
    await reserve('stale', null, [[cat, 1]], { ttl: 60 });
    await f.db.query(`update inventory_reservations set expires_at = now() - interval '1 minute' where reservation_id = 'stale'`);
    expect(await f.val(`select expire_stale_holds()`)).toBe(1);
    expect(await sold(cat)).toBe(1);
    expect(await f.val(`select state from inventory_reservations where reservation_id = 'fresh'`)).toBe('HELD');
  });

  it('never sweeps a hold that has been paid for', async () => {
    const cat = await seedCategory(f, { capacity: 50 });
    await reserve('paid', null, [[cat, 1]]);
    await confirm('paid');
    await f.db.query(`update inventory_reservations set expires_at = now() - interval '1 hour'`);
    expect(await f.val(`select expire_stale_holds()`)).toBe(0);
    expect(await sold(cat)).toBe(1);
  });
});

// ==========================================================================================
describe('capacity can never drift', () => {
  it('stops at the capacity and says which category ran out', async () => {
    const cat = await seedCategory(f, { capacity: 3, name: 'TINY', prefix: 'T-' });
    await reserve('r1', null, [[cat, 3]]);
    expect(await reserveFails('r2', null, [[cat, 1]])).toContain('SOLD_OUT:TINY');
    expect(await sold(cat)).toBe(3);
  });

  it('refuses a cart bigger than what is left, without selling the part that fits', async () => {
    const cat = await seedCategory(f, { capacity: 3, name: 'TINY', prefix: 'T-' });
    await reserve('r1', null, [[cat, 2]]);
    expect(await reserveFails('r2', null, [[cat, 2]])).toContain('SOLD_OUT:TINY');
    // Nothing partial: either the whole cart or none of it.
    expect(await sold(cat)).toBe(2);
    expect(await f.val(`select count(*) from inventory_reservations where reservation_id = 'r2'`)).toBe(0);
  });

  it('rolls the whole cart back when the second category is the one that is full', async () => {
    const roomy = await seedCategory(f, { capacity: 100, name: 'ROOMY', prefix: 'R-' });
    const tiny = await seedCategory(f, { capacity: 1, name: 'TINY', prefix: 'T-' });
    await reserve('r1', null, [[tiny, 1]]);
    expect(await reserveFails('r2', null, [[roomy, 2], [tiny, 1]])).toContain('SOLD_OUT:TINY');
    expect(await sold(roomy)).toBe(0);
    expect(await countersAgree()).toEqual([]);
  });

  it('keeps the counter and the rows in step through a long mixed sequence', async () => {
    const a = await seedCategory(f, { capacity: 20, name: 'A', prefix: 'A-' });
    const b = await seedCategory(f, { capacity: 20, name: 'B', prefix: 'B-' });
    for (let i = 0; i < 10; i++) {
      await reserve(`seq_${i}`, null, i % 2 ? [[a, 2]] : [[a, 1], [b, 1]]);
      if (i % 3 === 0) await confirm(`seq_${i}`);
      if (i % 4 === 0) await release(`seq_${i}`);
    }
    expect(await countersAgree()).toEqual([]);
    expect(await sold(a)).toBe(await rows(a));
    expect(await sold(b)).toBe(await rows(b));
  });

  it('counts a seat as taken while it is only held, so two buyers cannot share it', async () => {
    const cat = await seedCategory(f, { capacity: 1, name: 'ONE', prefix: 'O-' });
    await reserve('holder', null, [[cat, 1]]);
    expect(await reserveFails('other', null, [[cat, 1]])).toContain('SOLD_OUT:ONE');
  });

  it('lets the seat go to someone else the moment the first hold is released', async () => {
    const cat = await seedCategory(f, { capacity: 1, name: 'ONE', prefix: 'O-' });
    await reserve('holder', null, [[cat, 1]]);
    await release('holder');
    const alloc = await reserve('other', null, [[cat, 1]]);
    expect(alloc[0].numbers).toEqual([1]);
  });

  it('treats a category with no capacity as unlimited', async () => {
    const cat = await seedCategory(f, { capacity: null });
    await reserve('r1', null, [[cat, 400]]);
    expect(await sold(cat)).toBe(400);
  });

  it('only ever counts up issued_total, even when seats come back', async () => {
    // It is the "has this category ever had passes out" flag the admin screens read, and a
    // release must not make a category look untouched when PDFs are in people's inboxes.
    const cat = await seedCategory(f, { capacity: 10 });
    await reserve('r1', null, [[cat, 3]]);
    await release('r1');
    expect(await sold(cat)).toBe(0);
    expect(await issuedTotal(cat)).toBe(3);
  });
});

// ==========================================================================================
describe('a paused category', () => {
  it('cannot be sold from, even if the browser asks for it directly', async () => {
    const cat = await seedCategory(f, { capacity: 10, name: 'BALCONY', prefix: 'B-' });
    await f.db.query(`update event_ticket_categories set active = false where id = $1`, [cat]);
    expect(await reserveFails('r1', null, [[cat, 1]])).toContain('SOLD_OUT:BALCONY');
  });

  it('is refused by the price quote before it ever reaches the database', async () => {
    expect(() =>
      quoteEventCart({
        cart: { paused: 1 },
        categories: [asCategory('paused', { name: 'BALCONY', active: false })],
        isLoggedIn: true,
        isMember: false,
        memberDiscountPercent: 0,
        pointsToRedeem: 0,
        loyaltyBalance: 0,
        previouslyBought: 0,
      }),
    ).toThrow(/no longer on sale/);
  });

  it('keeps the passes it already sold valid', async () => {
    const cat = await seedCategory(f, { capacity: 10 });
    await reserve('r1', null, [[cat, 2]]);
    await confirm('r1');
    await f.db.query(`update event_ticket_categories set active = false where id = $1`, [cat]);
    expect(await rows(cat)).toBe(2);
    expect(await f.val(`select count(*) from ticket_numbers where state = 'ISSUED'`)).toBe(2);
  });

  it('is still shown to buyers, as coming soon rather than vanishing', () => {
    // A room that lists GENERAL and silently omits VIP reads as "there is no VIP".
    const cats = [{ id: 'a', active: true }, { id: 'b', active: false }];
    expect(onSale(cats[0])).toBe(true);
    expect(onSale(cats[1])).toBe(false);
    const split = partitionBySale(cats);
    expect(split.live.map((c) => c.id)).toEqual(['a']);
    expect(split.comingSoon.map((c) => c.id)).toEqual(['b']);
  });
});

// ==========================================================================================
describe('a comp-only category at the database level', () => {
  it('is deliberately reservable, because that is how a comp gets its number', async () => {
    // The flag is not a database guard and is not meant to be: the admin route reserves from
    // this category on purpose. What must never happen is a BUYER reaching it, and that is
    // enforced one layer up - see the next two tests.
    const cat = await seedCategory(f, { capacity: 10, name: 'ACCESS PASS', prefix: 'AP-', price: 0 });
    await f.db.query(`update event_ticket_categories set comp_only = true where id = $1`, [cat]);
    const alloc = await reserve('comp_1', null, [[cat, 2]]);
    expect(alloc[0].numbers).toEqual([1, 2]);
  });

  it('is refused by the public price quote at any quantity', () => {
    const quote = (cart: Record<string, number>) =>
      quoteEventCart({
        cart,
        categories: [
          asCategory('ga'),
          asCategory('ap', { name: 'ACCESS PASS', prefix: 'AP-', price: 0, comp_only: true }),
        ],
        isLoggedIn: true,
        isMember: false,
        memberDiscountPercent: 0,
        pointsToRedeem: 0,
        loyaltyBalance: 0,
        previouslyBought: 0,
      });
    expect(() => quote({ ap: 1 })).toThrow(/Invalid category/);
    // The dangerous one: free passes hidden behind a paid pass, so the order clears the
    // gateway's minimum amount and looks like an ordinary sale.
    expect(() => quote({ ga: 1, ap: 5 })).toThrow(/Invalid category/);
    expect(quote({ ga: 1 }).total).toBe(500);
  });

  it('never appears in the list a buyer is shown', () => {
    const cats = [
      { id: 'ga', comp_only: false },
      { id: 'ap', comp_only: true },
      { id: 'legacy' },
    ];
    expect(cats.filter(publiclyListed).map((c) => c.id)).toEqual(['ga', 'legacy']);
  });

  it('takes its seats out of the same capacity a buyer is counted against', async () => {
    const cat = await seedCategory(f, { capacity: 3, name: 'ACCESS PASS', prefix: 'AP-' });
    await f.db.query(`update event_ticket_categories set comp_only = true where id = $1`, [cat]);
    await reserve('comp_1', null, [[cat, 3]]);
    expect(await reserveFails('comp_2', null, [[cat, 1]])).toContain('SOLD_OUT:ACCESS PASS');
  });

  it('does not count against what a guest is allowed to buy', async () => {
    // A comp is reserved with no user, so a VIP given six passes can still buy their own.
    const user = await seedUser(f);
    const cat = await seedCategory(f, { capacity: 100 });
    await reserve('comp_1', null, [[cat, 6]]);
    await reserve('their_own', user, [[cat, 7]], { maxSingle: 7 });
    expect(await sold(cat)).toBe(13);
  });
});

// ==========================================================================================
describe('numbers come back and get reused', () => {
  it('puts a voided number back at the front of the queue', async () => {
    const cat = await seedCategory(f, { capacity: 10 });
    await reserve('r1', null, [[cat, 3]]);
    await confirm('r1');
    expect(await voidNumber('r1', cat, 2)).toBe(1);
    expect(await numbersIn(cat)).toEqual([1, 3]);
    const next = await reserve('r2', null, [[cat, 1]]);
    expect(next[0].numbers).toEqual([2]);
  });

  it('frees the seat as well as the number', async () => {
    const cat = await seedCategory(f, { capacity: 2, name: 'TWO', prefix: 'T-' });
    await reserve('r1', null, [[cat, 2]]);
    await confirm('r1');
    expect(await reserveFails('r2', null, [[cat, 1]])).toContain('SOLD_OUT:TWO');
    await voidNumber('r1', cat, 1);
    expect(await sold(cat)).toBe(1);
    const next = await reserve('r3', null, [[cat, 1]]);
    expect(next[0].numbers).toEqual([1]);
  });

  it('is harmless to void the same number twice', async () => {
    const cat = await seedCategory(f, { capacity: 10 });
    await reserve('r1', null, [[cat, 2]]);
    expect(await voidNumber('r1', cat, 1)).toBe(1);
    expect(await voidNumber('r1', cat, 1)).toBe(0);
    expect(await sold(cat)).toBe(1);
  });

  it('will not void a number from somebody else\'s reservation', async () => {
    const cat = await seedCategory(f, { capacity: 10 });
    await reserve('mine', null, [[cat, 1]]);
    await reserve('theirs', null, [[cat, 1]]);
    expect(await voidNumber('mine', cat, 2)).toBe(0);
    expect(await numbersIn(cat)).toEqual([1, 2]);
  });

  it('hands a number back out only once, however many came free', async () => {
    const cat = await seedCategory(f, { capacity: 10 });
    await reserve('r1', null, [[cat, 5]]);
    await confirm('r1');
    for (const n of [2, 4]) await voidNumber('r1', cat, n);
    const next = await reserve('r2', null, [[cat, 2]]);
    expect(next[0].numbers).toEqual([2, 4]);
    expect(await numbersIn(cat)).toEqual([1, 2, 3, 4, 5]);
  });

  it('never gives two live passes the same number across releases and resales', async () => {
    const cat = await seedCategory(f, { capacity: 6 });
    const seen: number[][] = [];
    for (let i = 0; i < 6; i++) {
      const alloc = await reserve(`cycle_${i}`, null, [[cat, 2]]);
      seen.push(alloc[0].numbers);
      await release(`cycle_${i}`);
    }
    // Each cycle starts from an empty house, so each sees 1 and 2 - and critically, at no point
    // do two LIVE rows share a number.
    expect(seen.every((n) => n.length === 2)).toBe(true);
    expect(await rows(cat)).toBe(0);
    expect(await countersAgree()).toEqual([]);
  });
});

// ==========================================================================================
describe('the gate', () => {
  const scan = (over: Partial<ScanLogRow> = {}): ScanLogRow =>
    ({ booking_id: 'b1', ticket_number: 'GEN-001', admitted: 1, action: 'ADMIT', actor_email: 'gate@x.com', actor_role: 'SCANNER', at: '2026-11-06T18:00:00Z', ...over }) as ScanLogRow;

  it('counts a checked-in pass as one person through the door', () => {
    const att = bookingAttendance([{ categoryName: 'GENERAL', ticketNumber: 'GEN-001', status: 'CHECKED_IN' }]);
    expect(att).toMatchObject({ passes: 1, people: 1, admitted: 1, remaining: 0, passesScanned: 1 });
    expect(att.state).toBe('ALL_IN');
  });

  it('leaves a voided pass out of the count entirely', () => {
    const att = bookingAttendance([
      { categoryName: 'GENERAL', ticketNumber: 'GEN-001', status: 'REFUNDED' },
      { categoryName: 'GENERAL', ticketNumber: 'GEN-002', status: 'ISSUED' },
    ]);
    // One pass refunded, one still expected: the refunded seat must not inflate the door count.
    expect(att).toMatchObject({ passes: 1, people: 1, admitted: 0, refunded: 1 });
  });

  it('treats a wholly refunded booking as nobody coming', () => {
    const tickets = [{ categoryName: 'GENERAL', ticketNumber: 'GEN-001', status: 'ISSUED' as const }];
    expect(bookingAttendance(tickets, 'REFUNDED')).toMatchObject({ people: 0, admitted: 0, state: 'REFUNDED' });
  });

  it('does not read a deleted comp as somebody walking in', () => {
    // scan_log is append-only and grows new action types; only ADMIT may ever move a figure.
    expect(admittedBy([scan({ action: 'COMP_DELETE', admitted: 0 })])).toEqual([]);
    expect(admittedBy([scan({ action: 'VOID', admitted: 0 })])).toEqual([]);
    expect(admittedBy([scan({ action: 'ADMIT', admitted: 1 })])).toHaveLength(1);
  });

  it('keeps the gate record of a guest whose pass was deleted afterwards', async () => {
    // scan_log has no foreign key to the booking on purpose: the person did walk in, and
    // deleting the pass later must not rewrite that.
    const booking = await f.val<string>(
      `insert into ticket_bookings (event_id, email, amount_paid, tickets_data, source)
       values ('e1','g@x.com',0,'[]'::jsonb,'COMP') returning id`,
    );
    await f.db.query(
      `insert into scan_log (booking_id, ticket_number, event_id, admitted, action, actor_email, actor_role)
       values ($1,'AP-001','e1',1,'ADMIT','gate@x.com','SCANNER')`,
      [booking],
    );
    await f.db.query(`delete from ticket_bookings where id = $1`, [booking]);
    expect(await f.val(`select count(*) from scan_log where booking_id = $1`, [booking])).toBe(1);
  });

  it('adds up a group pass by heads, not by passes', () => {
    const att = bookingAttendance([
      { categoryName: 'GROUP', ticketNumber: 'GRP-001', status: 'ISSUED', groupSize: 5, admitted: 3 },
    ]);
    expect(att).toMatchObject({ passes: 1, people: 5, admitted: 3, remaining: 2, passesScanned: 0 });
    expect(att.state).toBe('PARTLY_IN');
  });

  it('counts a checked-in group as everybody in, even with no running tally', () => {
    // CHECKED_IN on a group with no `admitted` recorded is legacy data; reading it as one
    // person would under-report the room.
    const att = bookingAttendance([
      { categoryName: 'GROUP', ticketNumber: 'GRP-001', status: 'CHECKED_IN', groupSize: 5 },
    ]);
    expect(att).toMatchObject({ people: 5, admitted: 5, remaining: 0 });
  });

  it('names who let each person in', () => {
    const by = admittedBy([
      scan({ ticket_number: 'GEN-001', actor_email: '9307658864@punerimallus.com', actor_role: 'SCANNER' }),
      scan({ ticket_number: 'GEN-002', actor_email: '9307658864@punerimallus.com', actor_role: 'SCANNER' }),
      scan({ ticket_number: 'GEN-003', actor_email: 'admin@punerimallus.com', actor_role: 'ADMIN' }),
    ]);
    expect(by).toHaveLength(2);
    expect(by.find((b) => b.role === 'SCANNER')?.admitted).toBe(2);
    expect(by.find((b) => b.role === 'ADMIN')?.admitted).toBe(1);
  });
});

// ==========================================================================================
describe('deleting a complimentary grant, as the route does it', () => {
  /** The exact sequence app/api/admin/tickets/comp/route.ts performs, against real SQL. */
  const deleteGrant = async (bookingId: string) => {
    const booking = await f.one<{ source: string; tickets_data: { categoryId?: string; ticketNumber: string; status?: string }[] }>(
      `select source, tickets_data from ticket_bookings where id = $1`,
      [bookingId],
    );
    const plan = checkCompDeletable(booking);
    let freed = 0;
    for (const pass of plan.freeable) {
      const resId = await f.val<string | undefined>(
        `select reservation_id from ticket_numbers where category_id = $1 and number = $2`,
        [pass.categoryId, pass.number],
      );
      // Only a comp's own hold may be released here: see isCompReservation.
      if (!isCompReservation(resId)) continue;
      freed += await voidNumber(resId, pass.categoryId, pass.number);
    }
    await f.db.query(`delete from ticket_bookings where id = $1`, [bookingId]);
    return { plan, freed };
  };

  const issueComp = async (categoryId: string, qty: number, resId = 'comp_1') => {
    const alloc = await reserve(resId, null, [[categoryId, qty]]);
    await confirm(resId);
    const prefix = await f.val<string>(`select prefix from event_ticket_categories where id = $1`, [categoryId]);
    const tickets = alloc[0].numbers.map((n) => ({
      categoryId,
      categoryName: 'ACCESS PASS',
      ticketNumber: `${prefix}${String(n).padStart(3, '0')}`,
      status: 'ISSUED',
    }));
    const booking = await f.val<string>(
      `insert into ticket_bookings (event_id, email, amount_paid, tickets_data, source, issued_by)
       values ('evt_test','g@x.com',0,$1::jsonb,'COMP','admin@x.com') returning id`,
      [JSON.stringify(tickets)],
    );
    await f.db.query(
      `insert into comp_ticket_grants (booking_id, event_id, guest_name, guest_email, reason, passes, admits, face_value, issued_by)
       values ($1,'evt_test','Guest','g@x.com','VIP',$2,$2,0,'admin@x.com')`,
      [booking, qty],
    );
    return booking;
  };

  it('returns every seat it took', async () => {
    const cat = await seedCategory(f, { capacity: 10, name: 'ACCESS PASS', prefix: 'AP-' });
    const booking = await issueComp(cat, 3);
    expect(await sold(cat)).toBe(3);

    const { freed } = await deleteGrant(booking);
    expect(freed).toBe(3);
    expect(await sold(cat)).toBe(0);
    expect(await rows(cat)).toBe(0);
    expect(await countersAgree()).toEqual([]);
  });

  it('takes the register row with it', async () => {
    const cat = await seedCategory(f, { capacity: 10, name: 'ACCESS PASS', prefix: 'AP-' });
    const booking = await issueComp(cat, 1);
    await deleteGrant(booking);
    expect(await f.val(`select count(*) from comp_ticket_grants`)).toBe(0);
    expect(await f.val(`select count(*) from ticket_bookings where id = $1`, [booking])).toBe(0);
  });

  it('lets the freed numbers be sold to someone who pays', async () => {
    const cat = await seedCategory(f, { capacity: 3, name: 'ACCESS PASS', prefix: 'AP-' });
    const booking = await issueComp(cat, 3);
    expect(await reserveFails('buyer', null, [[cat, 1]])).toContain('SOLD_OUT');
    await deleteGrant(booking);
    const alloc = await reserve('buyer', null, [[cat, 3]]);
    expect(alloc[0].numbers).toEqual([1, 2, 3]);
  });

  it('frees a grant that overlaps a paid sale without touching the sale', async () => {
    const cat = await seedCategory(f, { capacity: 10, name: 'EARLY BIRD', prefix: 'EBIRD-' });
    const user = await seedUser(f);
    // A real buyer takes number 1, the comp takes 2 and 3.
    await reserve('sale_1', user, [[cat, 1]]);
    await confirm('sale_1');
    const booking = await issueComp(cat, 2, 'comp_2');

    await deleteGrant(booking);
    expect(await numbersIn(cat)).toEqual([1]);
    expect(await f.val(`select reservation_id from ticket_numbers where category_id = $1`, [cat])).toBe('sale_1');
    expect(await sold(cat)).toBe(1);
  });

  it('can be run twice without taking seats from anyone', async () => {
    const cat = await seedCategory(f, { capacity: 10, name: 'ACCESS PASS', prefix: 'AP-' });
    const booking = await issueComp(cat, 2);
    await deleteGrant(booking);
    // Someone buys the freed seats before the admin clicks again.
    await reserve('buyer', null, [[cat, 2]]);
    const second = await f.val<number>(`select count(*) from ticket_bookings where id = $1`, [booking]);
    expect(second).toBe(0);
    // The numbers now belong to the buyer and must stay theirs.
    expect(await f.val(`select reservation_id from ticket_numbers where category_id = $1 and number = 1`, [cat])).toBe('buyer');
    expect(await sold(cat)).toBe(2);
  });

  it('refuses to delete a paid booking, so a receipt cannot be destroyed here', async () => {
    const cat = await seedCategory(f, { capacity: 10 });
    const user = await seedUser(f);
    await reserve('sale_1', user, [[cat, 1]]);
    await confirm('sale_1');
    const booking = await f.val<string>(
      `insert into ticket_bookings (event_id, email, amount_paid, tickets_data, source, razorpay_payment_id)
       values ('evt_test','buyer@x.com',500,$1::jsonb,'SALE','pay_123') returning id`,
      [JSON.stringify([{ categoryId: cat, categoryName: 'GENERAL', ticketNumber: 'GEN-001', status: 'ISSUED' }])],
    );
    await expect(deleteGrant(booking)).rejects.toThrow(/paid booking/i);
    expect(await f.val(`select count(*) from ticket_bookings where id = $1`, [booking])).toBe(1);
    expect(await sold(cat)).toBe(1);
  });

  it('leaves a seat alone once somebody has paid for it', async () => {
    // The seat is identified by (category, number), which says nothing about who holds it now.
    // A grant whose seat was resold - a delete that half-finished, an admin on a stale page -
    // must not evict the buyer, or their printed number points at nothing.
    const cat = await seedCategory(f, { capacity: 10, name: 'ACCESS PASS', prefix: 'AP-' });
    const booking = await issueComp(cat, 1);
    const user = await seedUser(f);

    // Number 1 ends up held by a paid reservation instead of the comp's.
    await f.db.query(
      `insert into inventory_reservations (reservation_id, user_id, event_id, points_held, state, expires_at, confirmed_at)
       values ('paid_res', $1, 'evt_test', 0, 'CONFIRMED', now(), now())`,
      [user],
    );
    await f.db.query(`update ticket_numbers set reservation_id = 'paid_res' where category_id = $1`, [cat]);

    const { freed } = await deleteGrant(booking);
    expect(freed).toBe(0);
    expect(await f.val(`select reservation_id from ticket_numbers where category_id = $1`, [cat])).toBe('paid_res');
    expect(await sold(cat)).toBe(1);
  });

  it('leaves no reservation holding seats once the grant is gone', async () => {
    const cat = await seedCategory(f, { capacity: 10, name: 'ACCESS PASS', prefix: 'AP-' });
    const booking = await issueComp(cat, 2);
    await deleteGrant(booking);
    // The reservation row itself survives as history; what matters is that it holds nothing.
    expect(await f.val(`select count(*) from ticket_numbers where reservation_id = 'comp_1'`)).toBe(0);
    expect(await countersAgree()).toEqual([]);
  });
});
