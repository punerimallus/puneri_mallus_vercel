// Ticket numbering, end to end, against a real PostgreSQL.
//
// The promise being tested: within a category, a pass number is always the lowest number nobody
// holds, always between 1 and the capacity, never duplicated, and always padded to the same
// width. That is what makes "GEN-047" mean "one of the 100 GENERAL seats" rather than an
// ever-climbing counter.

import { describe, expect, it } from 'vitest';
import { freshDb, items, seedCategory, seedUser, type Fixture } from './pg';
import { buildIssuedTickets } from '@/lib/payments/fulfil';
import { ticketNumberWidth } from '@/lib/payments/pricing';
import { Allocation, PaymentOrder } from '@/lib/payments/types';

const reserve = (resId: string, userId: string | null, cart: [string, number][], maxSingle = 1000): [string, unknown[]] =>
  ['select reserve_order_inventory($1, $2, $3::jsonb, 0, 900, $4, 99) as alloc', [resId, userId, items(cart), maxSingle]];

/** The pass numbers the app would print for an allocation, exactly as fulfilment builds them. */
function printed(allocations: Allocation[], prefix: string, capacity: number | null): string[] {
  const order = {
    cart: [{ categoryId: allocations[0].categoryId, name: 'GENERAL', prefix, qty: 0, unitPrice: 1, numberWidth: ticketNumberWidth(capacity) }],
  } as unknown as PaymentOrder;
  return buildIssuedTickets(order, allocations).map((t) => t.ticketNumber);
}

describe('the number a buyer actually gets', () => {
  it('the very first buyer gets 001', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: 100, prefix: 'GEN-' });
    const user = await seedUser(f);
    const alloc = await f.val<Allocation[]>(...reserve('r1', user, [[cat, 1]]));
    expect(alloc[0].numbers).toEqual([1]);
    expect(printed(alloc, 'GEN-', 100)).toEqual(['GEN-001']);
    await f.close();
  });

  it('runs 001, 002, 003 for buyers arriving in turn', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: 100, prefix: 'GEN-' });
    const got: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const user = await seedUser(f);
      const alloc = await f.val<Allocation[]>(...reserve('r' + i, user, [[cat, 1]]));
      got.push(...printed(alloc, 'GEN-', 100));
    }
    expect(got).toEqual(['GEN-001', 'GEN-002', 'GEN-003']);
    await f.close();
  });

  it('one buyer taking three gets a contiguous block', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: 100, prefix: 'GEN-' });
    const user = await seedUser(f);
    const alloc = await f.val<Allocation[]>(...reserve('r1', user, [[cat, 3]]));
    expect(printed(alloc, 'GEN-', 100)).toEqual(['GEN-001', 'GEN-002', 'GEN-003']);
    await f.close();
  });

  it('a freed number is handed to the next buyer, not the next number up', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: 100, prefix: 'GEN-' });
    for (let i = 1; i <= 5; i++) await f.val(...reserve('r' + i, await seedUser(f), [[cat, 1]]));
    // GEN-002 is given up.
    await f.val('select release_order_inventory($1)', ['r2']);
    const next = await f.val<Allocation[]>(...reserve('r6', await seedUser(f), [[cat, 1]]));
    expect(printed(next, 'GEN-', 100)).toEqual(['GEN-002']);
    // And the one after that carries on from the top of the range.
    const after = await f.val<Allocation[]>(...reserve('r7', await seedUser(f), [[cat, 1]]));
    expect(printed(after, 'GEN-', 100)).toEqual(['GEN-006']);
    await f.close();
  });

  it('fills several gaps lowest-first before taking anything new', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: 100, prefix: 'GEN-' });
    for (let i = 1; i <= 5; i++) await f.val(...reserve('r' + i, await seedUser(f), [[cat, 1]]));
    await f.val('select release_order_inventory($1)', ['r4']);
    await f.val('select release_order_inventory($1)', ['r2']);
    const alloc = await f.val<Allocation[]>(...reserve('r6', await seedUser(f), [[cat, 3]]));
    expect(printed(alloc, 'GEN-', 100)).toEqual(['GEN-002', 'GEN-004', 'GEN-006']);
    await f.close();
  });

  it('never issues a number above the capacity', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: 5, prefix: 'GEN-', name: 'TINY' });
    const all: number[] = [];
    for (let i = 1; i <= 5; i++) {
      const alloc = await f.val<Allocation[]>(...reserve('r' + i, await seedUser(f), [[cat, 1]]));
      all.push(...alloc[0].numbers);
    }
    expect(all.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    // The sixth is refused rather than being handed number 6.
    expect(await f.fails(...reserve('r6', await seedUser(f), [[cat, 1]]))).toContain('SOLD_OUT');
    await f.close();
  });

  it('a 1000-seat category reads 0001 to 1000, evenly padded', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: 1000, prefix: 'GEN-' });
    const user = await seedUser(f);
    // Take the first three, then jump to the end of the range by holding everything between.
    const first = await f.val<Allocation[]>(...reserve('r1', user, [[cat, 3]]));
    expect(printed(first, 'GEN-', 1000)).toEqual(['GEN-0001', 'GEN-0002', 'GEN-0003']);
    expect(printed([{ categoryId: cat, qty: 2, endSold: 1000, numbers: [999, 1000] }], 'GEN-', 1000))
      .toEqual(['GEN-0999', 'GEN-1000']);
    await f.close();
  });

  it('numbers are per category, so two categories both start at 001', async () => {
    const f = await freshDb();
    const gen = await seedCategory(f, { eventId: 'e1', capacity: 100, prefix: 'GEN-', name: 'GENERAL' });
    const vip = await seedCategory(f, { eventId: 'e1', capacity: 20, prefix: 'VIP-', name: 'VIP' });
    const user = await seedUser(f);
    const alloc = await f.val<Allocation[]>(...reserve('r1', user, [[gen, 1], [vip, 1]]));
    const byCat = new Map(alloc.map((a) => [a.categoryId, a.numbers]));
    expect(byCat.get(gen)).toEqual([1]);
    expect(byCat.get(vip)).toEqual([1]);
    await f.close();
  });

  it('two live passes can never share a number, whatever the application asks', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: 100, prefix: 'GEN-' });
    await f.val(...reserve('r1', await seedUser(f), [[cat, 1]]));
    const err = await f.fails(
      `insert into ticket_numbers (category_id, number, reservation_id, state) values ($1, 1, 'r1', 'ISSUED')`,
      [cat],
    );
    expect(err).toMatch(/duplicate key|unique/i);
    await f.close();
  });

  it('a hundred buyers in a row get exactly 1..100, each once', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: 100, prefix: 'GEN-' });
    const seen: number[] = [];
    for (let i = 0; i < 100; i++) {
      const alloc = await f.val<Allocation[]>(...reserve('r' + i, await seedUser(f), [[cat, 1]]));
      seen.push(alloc[0].numbers[0]);
    }
    expect(new Set(seen).size).toBe(100);
    expect(seen.sort((a, b) => a - b)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
    expect(await f.val('select sold from event_ticket_categories where id = $1', [cat])).toBe(100);
    await f.close();
  }, 120_000);
});


describe('what happens to the sequence when an admin edits the capacity', () => {
  // The question this answers: a category sells out at 50, the admin drops it to 0 and later
  // raises it again. Does the next buyer get 051, or does the count start over at 001?
  //
  // It does not start over, and the reason is worth stating. `capacity` is only a ceiling that
  // reserve_order_inventory checks. The numbers themselves live in ticket_numbers, one row per
  // seat held, and editing the ceiling never touches those rows. The allocator then hands out
  // the lowest number NOBODY HOLDS, so with rows 1..50 still sitting there the next free slot
  // is 51 whatever the capacity says.

  const sell = async (f: Fixture, cat: string, qty: number, resId: string) => {
    const alloc = await f.val<Allocation[]>(...reserve(resId, null, [[cat, qty]]));
    await f.val('select confirm_order_inventory($1)', [resId]);
    return printed(alloc, 'GEN-', 100);
  };

  it('carries on at 051 after the capacity is dropped to zero and raised again', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: 50, prefix: 'GEN-', name: 'GENERAL' });

    const first = await sell(f, cat, 50, 'r_first');
    expect(first[0]).toBe('GEN-001');
    expect(first[49]).toBe('GEN-050');

    // Closed off entirely...
    await f.db.query('update event_ticket_categories set capacity = 0 where id = $1', [cat]);
    expect(await f.val('select count(*) from ticket_numbers where category_id = $1', [cat])).toBe(50);

    // ...then opened up again, wider than before.
    await f.db.query('update event_ticket_categories set capacity = 100 where id = $1', [cat]);

    const next = await sell(f, cat, 1, 'r_next');
    expect(next).toEqual(['GEN-051']);
    await f.close();
  });

  it('refuses to sell at all if the capacity is put back at or below what is already out', async () => {
    // The trap beside the question: setting it back to 50 does not re-open the category, it
    // leaves it exactly full. Capacity has to clear what has already been issued.
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: 50, prefix: 'GEN-', name: 'GENERAL' });
    await sell(f, cat, 50, 'r_first');

    await f.db.query('update event_ticket_categories set capacity = 0 where id = $1', [cat]);
    expect(await f.fails(...reserve('r_zero', null, [[cat, 1]]))).toContain('SOLD_OUT:GENERAL');

    await f.db.query('update event_ticket_categories set capacity = 50 where id = $1', [cat]);
    expect(await f.fails(...reserve('r_same', null, [[cat, 1]]))).toContain('SOLD_OUT:GENERAL');

    await f.db.query('update event_ticket_categories set capacity = 51 where id = $1', [cat]);
    expect(await sell(f, cat, 1, 'r_more')).toEqual(['GEN-051']);
    await f.close();
  });

  it('keeps the sequence through pausing and resuming the category too', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: 100, prefix: 'GEN-', name: 'GENERAL' });
    await sell(f, cat, 12, 'r_a');

    await f.db.query('update event_ticket_categories set active = false where id = $1', [cat]);
    expect(await f.fails(...reserve('r_paused', null, [[cat, 1]]))).toContain('SOLD_OUT:GENERAL');

    await f.db.query('update event_ticket_categories set active = true where id = $1', [cat]);
    expect(await sell(f, cat, 1, 'r_b')).toEqual(['GEN-013']);
    await f.close();
  });

  it('is not disturbed by renaming the category or changing its price', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: 100, prefix: 'GEN-', name: 'GENERAL', price: 500 });
    await sell(f, cat, 7, 'r_a');
    await f.db.query(`update event_ticket_categories set name = 'GENERAL (PHASE 2)', price = 750 where id = $1`, [cat]);
    expect(await sell(f, cat, 1, 'r_b')).toEqual(['GEN-008']);
    await f.close();
  });

  it('DOES give a freed number back to the next buyer, which is the one case that goes backwards', async () => {
    // Worth knowing alongside the above: voiding a pass deletes its row, and the allocator's
    // rule is "lowest number nobody holds". So the next buyer gets the gap, not the next number
    // up. That is deliberate - it is what stops a refunded seat being lost - but it means a
    // pass number is a seat label, not a running count of how many have been sold.
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: 100, prefix: 'GEN-', name: 'GENERAL' });
    await sell(f, cat, 10, 'r_a');

    await f.val('select void_ticket_number($1, $2, 4)', ['r_a', cat]);
    expect(await sell(f, cat, 1, 'r_b')).toEqual(['GEN-004']);

    // And once the gap is filled the sequence resumes where it left off.
    expect(await sell(f, cat, 1, 'r_c')).toEqual(['GEN-011']);
    await f.close();
  });

  it('DOES restart at 001 if the category itself is deleted and made again', async () => {
    // The other way to lose the sequence, and the one an admin can reach by accident: the
    // numbers hang off the category row by a cascading foreign key, so deleting the category
    // takes every number with it. Editing a category keeps the sequence; replacing it does not.
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: 100, prefix: 'GEN-', name: 'GENERAL' });
    await sell(f, cat, 20, 'r_a');
    expect(await f.val('select count(*) from ticket_numbers where category_id = $1', [cat])).toBe(20);

    await f.db.query('delete from event_ticket_categories where id = $1', [cat]);
    expect(await f.val('select count(*) from ticket_numbers')).toBe(0);

    const fresh = await seedCategory(f, { capacity: 100, prefix: 'GEN-', name: 'GENERAL' });
    expect(await sell(f, fresh, 1, 'r_b')).toEqual(['GEN-001']);
    await f.close();
  });

  it('is not disturbed by a price rise between phases', async () => {
    // Selling in phases by editing one category's price: the number carries on regardless,
    // because nothing in the allocator reads the price. Only ticket_numbers decides.
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: 200, prefix: 'GEN-', name: 'GENERAL', price: 500 });
    expect(await sell(f, cat, 3, 'r_early')).toEqual(['GEN-001', 'GEN-002', 'GEN-003']);

    await f.db.query('update event_ticket_categories set price = 750 where id = $1', [cat]);
    expect(await sell(f, cat, 1, 'r_p2')).toEqual(['GEN-004']);

    await f.db.query('update event_ticket_categories set price = 1200 where id = $1', [cat]);
    expect(await sell(f, cat, 1, 'r_p3')).toEqual(['GEN-005']);

    // Three prices, one unbroken run of numbers.
    expect(await f.val('select count(*) from ticket_numbers where category_id = $1', [cat])).toBe(5);
    await f.close();
  });

  it('DOES change the padding if the capacity crosses a power of ten', async () => {
    // The one way an edit changes how a number LOOKS. The width is taken from the capacity, so
    // a category of 100 prints GEN-006 and the same category raised to 1000 prints GEN-0007.
    // Passes already issued keep the string stored on the booking, so nothing breaks at the
    // gate - but the two look different side by side. Worth knowing before raising a cap past
    // 999 mid-sale.
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: 100, prefix: 'GEN-', name: 'GENERAL' });

    const early = await f.val<Allocation[]>(...reserve('r_a', null, [[cat, 2]]));
    await f.val('select confirm_order_inventory($1)', ['r_a']);
    expect(printed(early, 'GEN-', 100)).toEqual(['GEN-001', 'GEN-002']);

    await f.db.query('update event_ticket_categories set capacity = 1000 where id = $1', [cat]);
    const later = await f.val<Allocation[]>(...reserve('r_b', null, [[cat, 1]]));
    await f.val('select confirm_order_inventory($1)', ['r_b']);

    // Same seat sequence, wider label.
    expect(later[0].numbers).toEqual([3]);
    expect(printed(later, 'GEN-', 1000)).toEqual(['GEN-0003']);
    await f.close();
  });

  it('goes 0999 then 1000, never back to 0001', async () => {
    // The question in plain terms: when the count rolls past 999, does the padding wrap? It
    // cannot. The number is padded with padStart, which only ever ADDS zeros - a number wider
    // than the pad is printed in full. So the run continues 0998, 0999, 1000, 1001.
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: 1002, prefix: 'GEN-', name: 'GENERAL' });

    // Fill 1..997 directly; selling a thousand passes one at a time proves nothing extra.
    await f.db.query(
      `insert into inventory_reservations (reservation_id, user_id, event_id, points_held, state, expires_at, confirmed_at)
       values ('bulk', null, 'evt_test', 0, 'CONFIRMED', now(), now())`,
    );
    await f.db.query(
      `insert into ticket_numbers (category_id, number, reservation_id, state)
       select $1, g, 'bulk', 'ISSUED' from generate_series(1, 997) g`,
      [cat],
    );
    await f.val('select refresh_category_counts($1)', [cat]);

    const alloc = await f.val<Allocation[]>(...reserve('r_edge', null, [[cat, 5]]));
    expect(alloc[0].numbers).toEqual([998, 999, 1000, 1001, 1002]);

    // Capacity 1002 is four digits wide, so every label in this category is four wide.
    expect(printed(alloc, 'GEN-', 1002)).toEqual(['GEN-0998', 'GEN-0999', 'GEN-1000', 'GEN-1001', 'GEN-1002']);
    await f.close();
  });

  it('prints a number too big for its padding in full rather than cutting it', async () => {
    // The same rule seen from the other side: a category capped at 100 is padded to 3, and if
    // its cap were later raised the 1000th seat would still read GEN-1000, not GEN-000.
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: 1200, prefix: 'GEN-', name: 'GENERAL' });
    await f.db.query(
      `insert into inventory_reservations (reservation_id, user_id, event_id, points_held, state, expires_at, confirmed_at)
       values ('bulk', null, 'evt_test', 0, 'CONFIRMED', now(), now())`,
    );
    await f.db.query(
      `insert into ticket_numbers (category_id, number, reservation_id, state)
       select $1, g, 'bulk', 'ISSUED' from generate_series(1, 999) g`,
      [cat],
    );
    await f.val('select refresh_category_counts($1)', [cat]);

    const alloc = await f.val<Allocation[]>(...reserve('r_edge', null, [[cat, 1]]));
    expect(alloc[0].numbers).toEqual([1000]);
    // Width taken from a capacity of only 100: three. The number still prints whole.
    expect(printed(alloc, 'GEN-', 100)).toEqual(['GEN-1000']);
    await f.close();
  });

  it('stops at 999 when that is the whole capacity', async () => {
    // And the case where 1000 never arrives: a category of 999 is three wide and sells out at
    // GEN-999, so the padding never has to grow at all.
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: 999, prefix: 'GEN-', name: 'GENERAL' });
    await f.db.query(
      `insert into inventory_reservations (reservation_id, user_id, event_id, points_held, state, expires_at, confirmed_at)
       values ('bulk', null, 'evt_test', 0, 'CONFIRMED', now(), now())`,
    );
    await f.db.query(
      `insert into ticket_numbers (category_id, number, reservation_id, state)
       select $1, g, 'bulk', 'ISSUED' from generate_series(1, 998) g`,
      [cat],
    );
    await f.val('select refresh_category_counts($1)', [cat]);

    const last = await f.val<Allocation[]>(...reserve('r_last', null, [[cat, 1]]));
    expect(printed(last, 'GEN-', 999)).toEqual(['GEN-999']);
    expect(await f.fails(...reserve('r_over', null, [[cat, 1]]))).toContain('SOLD_OUT:GENERAL');
    await f.close();
  });

  it('keeps the counter honest through every one of those edits', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: 50, prefix: 'GEN-', name: 'GENERAL' });
    await sell(f, cat, 30, 'r_a');
    for (const capacity of [0, 10, 50, 100, 60]) {
      await f.db.query('update event_ticket_categories set capacity = $2 where id = $1', [cat, capacity]);
    }
    await sell(f, cat, 1, 'r_b');
    // `sold` means seats in use, and it must still equal the rows that back it.
    expect(await f.val('select sold from event_ticket_categories where id = $1', [cat])).toBe(31);
    expect(await f.val('select count(*) from ticket_numbers where category_id = $1', [cat])).toBe(31);
    await f.close();
  });
});
