// Runs supabase/migrations/20261028_ticketing_integrity.sql against a real PostgreSQL and
// exercises every reservation path, including the ones that used to let a buyer pay for a seat
// that no longer existed or spend the same loyalty points twice.

import { describe, expect, it } from 'vitest';
import { freshDb, items, seedCategory, seedUser } from './pg';

const reserve = (resId: string, userId: string | null, cart: [string, number][], points = 0, ttl = 900, maxSingle = 7, maxGroup = 2): [string, unknown[]] =>
  [`select reserve_order_inventory($1, $2, $3::jsonb, $4, $5, $6, $7) as alloc`, [resId, userId, items(cart), points, ttl, maxSingle, maxGroup]];

describe('migration applies', () => {
  it('creates the tables, functions and the marker the app checks for', async () => {
    const f = await freshDb();
    expect(await f.val('select count(*) from app_schema_markers where name = $1', ['ticketing_integrity_v1'])).toBe(1);
    for (const t of ['ticket_numbers', 'inventory_reservations', 'event_staff', 'scan_log']) {
      expect(await f.val(`select count(*) from information_schema.tables where table_name = $1`, [t])).toBe(1);
    }
    expect(await f.val(`select count(*) from information_schema.columns where table_name='profiles' and column_name='loyalty_points_held'`)).toBe(1);
    await f.close();
  });

  it('is safe to run twice', async () => {
    const f = await freshDb();
    const { readFileSync } = await import('node:fs');
    const { MIGRATION } = await import('./pg');
    await f.db.exec(readFileSync(MIGRATION, 'utf8')); // must not throw
    expect(await f.val('select count(*) from app_schema_markers')).toBe(1);
    await f.close();
  });
});

describe('seats are reserved before payment', () => {
  it('hands out the lowest free numbers and counts them as in use', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: 10 });
    const user = await seedUser(f);

    const alloc = await f.val<{ categoryId: string; qty: number; numbers: number[] }[]>(...reserve('r1', user, [[cat, 3]]));
    expect(alloc[0].numbers).toEqual([1, 2, 3]);
    expect(await f.val('select sold from event_ticket_categories where id = $1', [cat])).toBe(3);
    expect(await f.val('select released from event_ticket_categories where id = $1', [cat])).toBe(0);
    await f.close();
  });

  it('refuses the sale when the category is full, instead of taking the money first', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: 4, name: 'FRONT ROW' });
    const a = await seedUser(f);
    const b = await seedUser(f);

    await f.val(...reserve('r1', a, [[cat, 4]]));
    const err = await f.fails(...reserve('r2', b, [[cat, 1]]));
    expect(err).toContain('SOLD_OUT:FRONT ROW');
    // The failed attempt left nothing behind.
    expect(await f.val('select count(*) from ticket_numbers where reservation_id = $1', ['r2'])).toBe(0);
    expect(await f.val('select sold from event_ticket_categories where id = $1', [cat])).toBe(4);
    await f.close();
  });

  it('never issues the same number twice, even if the application asks it to', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: null });
    const user = await seedUser(f);
    await f.val(...reserve('r1', user, [[cat, 2]]));
    const err = await f.fails(
      `insert into ticket_numbers (category_id, number, reservation_id, user_id, state) values ($1, 1, 'r1', $2, 'ISSUED')`,
      [cat, user],
    );
    expect(err).toMatch(/duplicate key|unique/i);
    await f.close();
  });

  it('is idempotent: the same reservation id never takes seats twice', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: 10 });
    const user = await seedUser(f);
    const first = await f.val<{ numbers: number[] }[]>(...reserve('same', user, [[cat, 2]]));
    const again = await f.val<{ numbers: number[] }[]>(...reserve('same', user, [[cat, 2]]));
    expect(again[0].numbers).toEqual(first[0].numbers);
    expect(await f.val('select sold from event_ticket_categories where id = $1', [cat])).toBe(2);
    await f.close();
  });

  it('rejects a cart that mixes two events', async () => {
    const f = await freshDb();
    const a = await seedCategory(f, { eventId: 'evt_a' });
    const b = await seedCategory(f, { eventId: 'evt_b' });
    const user = await seedUser(f);
    expect(await f.fails(...reserve('r1', user, [[a, 1], [b, 1]]))).toContain('MIXED_EVENT_CART');
    await f.close();
  });
});

describe('a freed number goes back into the pool', () => {
  it('reuses the lowest freed number after a release, and never a number still held', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: 10 });
    const u1 = await seedUser(f);
    const u2 = await seedUser(f);
    const u3 = await seedUser(f);

    await f.val(...reserve('r1', u1, [[cat, 2]])); // 1, 2
    await f.val(...reserve('r2', u2, [[cat, 2]])); // 3, 4
    await f.val('select release_order_inventory($1)', ['r1']); // frees 1, 2

    const next = await f.val<{ numbers: number[] }[]>(...reserve('r3', u3, [[cat, 3]]));
    expect(next[0].numbers).toEqual([1, 2, 5]);
    expect(await f.val('select sold from event_ticket_categories where id = $1', [cat])).toBe(5);
    await f.close();
  });

  it('releasing is idempotent and reports how many it freed', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f);
    const user = await seedUser(f);
    await f.val(...reserve('r1', user, [[cat, 3]]));
    expect(await f.val('select release_order_inventory($1)', ['r1'])).toBe(3);
    expect(await f.val('select release_order_inventory($1)', ['r1'])).toBe(0);
    expect(await f.val('select sold from event_ticket_categories where id = $1', [cat])).toBe(0);
    await f.close();
  });

  it('expires abandoned holds and gives their seats straight back', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: 2, name: 'TINY' });
    const a = await seedUser(f);
    const b = await seedUser(f);

    await f.val(...reserve('abandoned', a, [[cat, 2]]));
    expect(await f.fails(...reserve('r2', b, [[cat, 1]]))).toContain('SOLD_OUT:TINY');

    await f.val(`update inventory_reservations set expires_at = now() - interval '1 minute' where reservation_id = 'abandoned'`);
    expect(await f.val('select expire_stale_holds()')).toBe(1);

    const alloc = await f.val<{ numbers: number[] }[]>(...reserve('r3', b, [[cat, 1]]));
    expect(alloc[0].numbers).toEqual([1]);
    await f.close();
  });

  it('leaves a confirmed reservation alone when sweeping', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f);
    const user = await seedUser(f);
    await f.val(...reserve('r1', user, [[cat, 1]]));
    await f.val('select confirm_order_inventory($1)', ['r1']);
    await f.val(`update inventory_reservations set expires_at = now() - interval '1 hour'`);
    expect(await f.val('select expire_stale_holds()')).toBe(0);
    expect(await f.val('select count(*) from ticket_numbers')).toBe(1);
    await f.close();
  });
});

describe('confirming', () => {
  it('turns held numbers into issued ones, exactly once', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f);
    const user = await seedUser(f);
    await f.val(...reserve('r1', user, [[cat, 2]]));

    const first = await f.val<{ alreadyConfirmed: boolean; issued: number }>('select confirm_order_inventory($1)', ['r1']);
    expect(first.alreadyConfirmed).toBe(false);
    expect(first.issued).toBe(2);
    expect(await f.val(`select count(*) from ticket_numbers where state = 'ISSUED'`)).toBe(2);

    const second = await f.val<{ alreadyConfirmed: boolean }>('select confirm_order_inventory($1)', ['r1']);
    expect(second.alreadyConfirmed).toBe(true);
    await f.close();
  });

  it('refuses to confirm a hold that was already released, so the caller can refund', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f);
    const user = await seedUser(f);
    await f.val(...reserve('r1', user, [[cat, 1]]));
    await f.val('select release_order_inventory($1)', ['r1']);
    expect(await f.fails('select confirm_order_inventory($1)', ['r1'])).toContain('RESERVATION_LOST');
    await f.close();
  });

  it('refuses to confirm a reservation that never existed', async () => {
    const f = await freshDb();
    expect(await f.fails('select confirm_order_inventory($1)', ['nope'])).toContain('RESERVATION_LOST');
    await f.close();
  });
});

describe('per-account limits', () => {
  it('counts held passes, not just paid ones, so a second tab cannot exceed the cap', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: 100 });
    const user = await seedUser(f);

    await f.val(...reserve('tab1', user, [[cat, 7]]));
    // Nothing has been paid for yet; the old code counted only committed bookings and let this through.
    expect(await f.fails(...reserve('tab2', user, [[cat, 1]]))).toContain('LIMIT_SINGLE:7');
    expect(await f.val('select count(*) from ticket_numbers where user_id = $1', [user])).toBe(7);
    await f.close();
  });

  it('limits group passes separately from single ones', async () => {
    const f = await freshDb();
    const single = await seedCategory(f, { eventId: 'e1', prefix: 'S-', groupSize: 1, capacity: 100 });
    const group = await seedCategory(f, { eventId: 'e1', prefix: 'G-', groupSize: 10, capacity: 100 });
    const user = await seedUser(f);

    await f.val(...reserve('r1', user, [[group, 2]]));
    expect(await f.fails(...reserve('r2', user, [[group, 1]]))).toContain('LIMIT_GROUP:2');
    // Singles are unaffected by the group cap.
    await f.val(...reserve('r3', user, [[single, 5]]));
    expect(await f.val('select count(*) from ticket_numbers where user_id = $1', [user])).toBe(7);
    await f.close();
  });

  it('frees the account allowance again when a hold is released', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: 100 });
    const user = await seedUser(f);
    await f.val(...reserve('r1', user, [[cat, 7]]));
    await f.val('select release_order_inventory($1)', ['r1']);
    const alloc = await f.val<{ numbers: number[] }[]>(...reserve('r2', user, [[cat, 7]]));
    expect(alloc[0].numbers).toHaveLength(7);
    await f.close();
  });

  it('counts limits per event, not globally', async () => {
    const f = await freshDb();
    const a = await seedCategory(f, { eventId: 'evt_a', capacity: 100 });
    const b = await seedCategory(f, { eventId: 'evt_b', capacity: 100 });
    const user = await seedUser(f);
    await f.val(...reserve('r1', user, [[a, 7]]));
    const other = await f.val<{ numbers: number[] }[]>(...reserve('r2', user, [[b, 7]]));
    expect(other[0].numbers).toHaveLength(7);
    await f.close();
  });
});

describe('loyalty points', () => {
  it('reserves points at checkout so the same balance cannot be spent twice', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: 100 });
    const user = await seedUser(f, 500);

    await f.val(...reserve('tab1', user, [[cat, 1]], 500));
    expect(await f.val('select loyalty_points_held from profiles where id = $1', [user])).toBe(500);
    expect(await f.val('select loyalty_points from profiles where id = $1', [user])).toBe(500);

    // The old code re-read the raw balance and let a second order redeem the same 500.
    expect(await f.fails(...reserve('tab2', user, [[cat, 1]], 500))).toContain('POINTS_UNAVAILABLE:0');
    await f.close();
  });

  it('spends the points only once the payment is confirmed', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f);
    const user = await seedUser(f, 500);
    await f.val(...reserve('r1', user, [[cat, 1]], 200));
    await f.val('select confirm_order_inventory($1)', ['r1']);
    expect(await f.val('select loyalty_points from profiles where id = $1', [user])).toBe(300);
    expect(await f.val('select loyalty_points_held from profiles where id = $1', [user])).toBe(0);
    await f.close();
  });

  it('gives unspent points back when the checkout is abandoned', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f);
    const user = await seedUser(f, 500);
    await f.val(...reserve('r1', user, [[cat, 1]], 200));
    await f.val('select release_order_inventory($1)', ['r1']);
    expect(await f.val('select loyalty_points from profiles where id = $1', [user])).toBe(500);
    expect(await f.val('select loyalty_points_held from profiles where id = $1', [user])).toBe(0);
    await f.close();
  });

  it('returns spent points when a confirmed order is refunded, once', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f);
    const user = await seedUser(f, 500);
    await f.val(...reserve('r1', user, [[cat, 1]], 200));
    await f.val('select confirm_order_inventory($1)', ['r1']);
    expect(await f.val('select loyalty_points from profiles where id = $1', [user])).toBe(300);

    await f.val('select release_order_inventory($1)', ['r1']);
    expect(await f.val('select loyalty_points from profiles where id = $1', [user])).toBe(500);
    await f.val('select release_order_inventory($1)', ['r1']); // repeated refund webhook
    expect(await f.val('select loyalty_points from profiles where id = $1', [user])).toBe(500);
    await f.close();
  });

  it('refuses to redeem more than the balance', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f);
    const user = await seedUser(f, 100);
    expect(await f.fails(...reserve('r1', user, [[cat, 1]], 101))).toContain('POINTS_UNAVAILABLE:100');
    // The whole reservation rolled back, seats included.
    expect(await f.val('select count(*) from ticket_numbers')).toBe(0);
    await f.close();
  });
});

describe('voiding one pass', () => {
  it('frees just that number and leaves the rest of the booking alone', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: 10 });
    const user = await seedUser(f);
    await f.val(...reserve('r1', user, [[cat, 3]]));
    await f.val('select confirm_order_inventory($1)', ['r1']);

    expect(await f.val('select void_ticket_number($1, $2, $3)', ['r1', cat, 2])).toBe(1);
    expect(await f.val('select void_ticket_number($1, $2, $3)', ['r1', cat, 2])).toBe(0);
    expect(await f.all('select number from ticket_numbers where reservation_id = $1 order by number', ['r1']))
      .toEqual([{ number: 1 }, { number: 3 }]);
    expect(await f.val('select sold from event_ticket_categories where id = $1', [cat])).toBe(2);
    await f.close();
  });
});

describe('backfill of passes that already exist', () => {
  it('claims the numbers printed on live bookings so they can never be reissued', async () => {
    const f = await freshDb(async (db) => {
      const user = await seedUser(db, 0);
      const cat = await seedCategory(db, { eventId: 'evt_live', name: 'GENERAL ADMISSION', prefix: 'GA-', capacity: 400 });
      await db.val(`update event_ticket_categories set sold = 14, released = 12 where id = $1`, [cat]);
      await db.val(
        `insert into ticket_bookings (event_id, user_id, status, tickets_data) values ($1, $2, 'CONFIRMED', $3::jsonb)`,
        ['evt_live', user, JSON.stringify([
          { status: 'ISSUED', categoryName: 'GENERAL ADMISSION', ticketNumber: 'GA-013' },
          { status: 'ISSUED', categoryName: 'GENERAL ADMISSION', ticketNumber: 'GA-010' },
        ])],
      );
      // A refunded pass must NOT keep its number.
      await db.val(
        `insert into ticket_bookings (event_id, user_id, status, tickets_data) values ($1, $2, 'CONFIRMED', $3::jsonb)`,
        ['evt_live', user, JSON.stringify([{ status: 'REFUNDED', categoryName: 'GENERAL ADMISSION', ticketNumber: 'GA-011' }])],
      );
      // A wholly refunded booking must NOT either.
      await db.val(
        `insert into ticket_bookings (event_id, user_id, status, tickets_data) values ($1, $2, 'REFUNDED', $3::jsonb)`,
        ['evt_live', user, JSON.stringify([{ status: 'ISSUED', categoryName: 'GENERAL ADMISSION', ticketNumber: 'GA-012' }])],
      );
    });

    const claimed = await f.all<{ number: number }>('select number from ticket_numbers order by number');
    expect(claimed.map((r) => r.number)).toEqual([10, 13]);

    // `sold` now reports seats actually in use, replacing the stale 14-minus-12.
    expect(await f.val(`select sold from event_ticket_categories where name = 'GENERAL ADMISSION'`)).toBe(2);
    expect(await f.val(`select released from event_ticket_categories where name = 'GENERAL ADMISSION'`)).toBe(0);

    // The next buyer gets the lowest genuinely free numbers, skipping the two that are printed.
    const cat = await f.val<string>(`select id from event_ticket_categories where name = 'GENERAL ADMISSION'`);
    const user = await seedUser(f);
    const alloc = await f.val<{ numbers: number[] }[]>(...reserve('new', user, [[cat, 4]]));
    expect(alloc[0].numbers).toEqual([1, 2, 3, 4]);
    await f.close();
  });

  it('survives legacy data with an unmatched category or an unparseable number', async () => {
    const f = await freshDb(async (db) => {
      const user = await seedUser(db, 0);
      await seedCategory(db, { eventId: 'evt_x', name: 'KEPT', prefix: 'K-' });
      await db.val(
        `insert into ticket_bookings (event_id, user_id, status, tickets_data) values ($1, $2, 'CONFIRMED', $3::jsonb)`,
        ['evt_x', user, JSON.stringify([
          { status: 'ISSUED', categoryName: 'RENAMED SINCE', ticketNumber: 'R-001' },
          { status: 'ISSUED', categoryName: 'KEPT', ticketNumber: 'K-ABC' },
          { status: 'ISSUED', categoryName: 'KEPT', ticketNumber: 'K-007' },
        ])],
      );
    });
    // Only the one it could understand was claimed; the migration did not fall over.
    expect(await f.val('select count(*) from ticket_numbers')).toBe(1);
    expect(await f.val('select number from ticket_numbers')).toBe(7);
    await f.close();
  });

  it('points existing orders at the reservation their booking now owns', async () => {
    const f = await freshDb(async (db) => {
      const user = await seedUser(db, 0);
      await seedCategory(db, { eventId: 'evt_o', name: 'GA', prefix: 'GA-' });
      const booking = await db.val<string>(
        `insert into ticket_bookings (event_id, user_id, status, tickets_data) values ($1, $2, 'CONFIRMED', $3::jsonb) returning id`,
        ['evt_o', user, JSON.stringify([{ status: 'ISSUED', categoryName: 'GA', ticketNumber: 'GA-001' }])],
      );
      await db.val(
        `insert into payment_orders (razorpay_order_id, payment_type, booking_id, status) values ('order_legacy', 'EVENT_TICKET', $1, 'FULFILLED')`,
        [booking],
      );
    });
    const resId = await f.val<string>(`select reservation_id from payment_orders where razorpay_order_id = 'order_legacy'`);
    expect(resId).toMatch(/^legacy-/);
    // Refunding that legacy order now frees its seat like any other.
    expect(await f.val('select release_order_inventory($1)', [resId])).toBe(1);
    expect(await f.val(`select sold from event_ticket_categories where name = 'GA'`)).toBe(0);
    await f.close();
  });
});

describe('a hundred buyers against real Postgres', () => {
  it('sells exactly the capacity and hands out numbers 1..N with no gaps or repeats', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: 10, name: 'TINY', prefix: 'T-' });
    const users: string[] = [];
    for (let i = 0; i < 100; i++) users.push(await seedUser(f));

    let won = 0;
    let soldOut = 0;
    for (let i = 0; i < 100; i++) {
      try {
        await f.val(...reserve(`rush_${i}`, users[i], [[cat, 1]]));
        won++;
      } catch (e) {
        expect(String(e)).toContain('SOLD_OUT:TINY');
        soldOut++;
      }
    }

    expect(won).toBe(10);
    expect(soldOut).toBe(90);
    expect(await f.val('select count(*) from ticket_numbers where category_id = $1', [cat])).toBe(10);
    expect(await f.val('select sold from event_ticket_categories where id = $1', [cat])).toBe(10);

    const numbers = await f.all<{ number: number }>('select number from ticket_numbers order by number');
    expect(numbers.map((r) => r.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    // The 90 who missed out hold nothing at all.
    expect(await f.val(`select count(*) from inventory_reservations where state = 'HELD'`)).toBe(10);
    await f.close();
  }, 120_000);

  it('one account cannot exceed its allowance across a hundred checkouts', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: 1000 });
    const user = await seedUser(f);

    let accepted = 0;
    for (let i = 0; i < 100; i++) {
      try {
        await f.val(...reserve(`tab_${i}`, user, [[cat, 1]]));
        accepted++;
      } catch (e) {
        expect(String(e)).toContain('LIMIT_SINGLE:7');
      }
    }
    expect(accepted).toBe(7);
    expect(await f.val('select count(*) from ticket_numbers where user_id = $1', [user])).toBe(7);
    await f.close();
  }, 120_000);

  it('the same points cannot be promised to a hundred checkouts', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: 1000 });
    const user = await seedUser(f, 500);

    let accepted = 0;
    for (let i = 0; i < 100; i++) {
      try {
        await f.val(...reserve(`pt_${i}`, user, [[cat, 1]], 500, 900, 1000, 2));
        accepted++;
      } catch (e) {
        expect(String(e)).toContain('POINTS_UNAVAILABLE');
      }
    }
    expect(accepted).toBe(1);
    expect(await f.val('select loyalty_points_held from profiles where id = $1', [user])).toBe(500);
    expect(await f.val('select loyalty_points from profiles where id = $1', [user])).toBe(500);
    await f.close();
  }, 120_000);
});
