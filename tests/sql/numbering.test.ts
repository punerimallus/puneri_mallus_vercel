// Ticket numbering, end to end, against a real PostgreSQL.
//
// The promise being tested: within a category, a pass number is always the lowest number nobody
// holds, always between 1 and the capacity, never duplicated, and always padded to the same
// width. That is what makes "GEN-047" mean "one of the 100 GENERAL seats" rather than an
// ever-climbing counter.

import { describe, expect, it } from 'vitest';
import { freshDb, items, seedCategory, seedUser } from './pg';
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
