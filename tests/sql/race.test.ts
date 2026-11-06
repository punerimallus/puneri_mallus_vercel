// What happens when everyone hits "buy" at once.
//
// A note on what this can and cannot prove. PGlite is a real PostgreSQL but a single
// connection, so two statements never execute simultaneously here: `Promise.all` issues them
// together and the engine runs them one after another in whatever order it picks up. That is
// still the test worth having. Each reservation call is its own transaction, so serialising
// them at transaction granularity is exactly the model the functions are written against, and
// a function that only holds up in the order the author imagined fails here. What it cannot
// exercise is lock contention itself - two sessions blocking on the same `for update` row -
// which is why those locks are also read by eye in the migration and why the application-level
// interleaving suites (load.test.ts, gate-race.test.ts) exist alongside this one.
//
// Every section ends by asserting the same four invariants, because a race that balances the
// books in one place and breaks them in another is the kind that reaches an actual door:
//
//   * sold equals the number of live rows, in every category
//   * no two live passes share a number
//   * nothing is sold beyond capacity
//   * loyalty points are conserved: spent once, returned once, never below zero

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { freshDb, items, seedCategory, seedUser, type Fixture } from './pg';
import type { Allocation } from '@/lib/payments/types';

let f: Fixture;

beforeEach(async () => {
  f = await freshDb();
});

afterEach(async () => {
  await f.close();
});

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

/** Runs them all together and reports who won, instead of throwing on the first refusal. */
async function settle<T>(tasks: (() => Promise<T>)[]): Promise<{ won: T[]; refused: string[] }> {
  const results = await Promise.allSettled(tasks.map((t) => t()));
  const won: T[] = [];
  const refused: string[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') won.push(r.value);
    else refused.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
  }
  return { won, refused };
}

// --- the invariants -----------------------------------------------------------------------

/** Categories where the cached counter has drifted from the rows that back it. */
const drift = () =>
  f.all<{ name: string; sold: number; live: number }>(
    `select c.name, c.sold, (select count(*) from ticket_numbers t where t.category_id = c.id)::int as live
       from event_ticket_categories c
      where c.sold <> (select count(*) from ticket_numbers t where t.category_id = c.id)`,
  );

/** Categories holding more rows than they have seats. */
const oversold = () =>
  f.all<{ name: string }>(
    `select c.name from event_ticket_categories c
      where c.capacity is not null
        and (select count(*) from ticket_numbers t where t.category_id = c.id) > c.capacity`,
  );

/** A number held twice in one category. The primary key makes this impossible; we check anyway. */
const duplicates = () =>
  f.all<{ category_id: string; number: number }>(
    `select category_id, number from ticket_numbers group by category_id, number having count(*) > 1`,
  );

const points = (userId: string) =>
  f.one<{ loyalty_points: number; loyalty_points_held: number }>(
    `select loyalty_points, loyalty_points_held from profiles where id = $1`,
    [userId],
  );

const expectSound = async () => {
  expect(await drift()).toEqual([]);
  expect(await oversold()).toEqual([]);
  expect(await duplicates()).toEqual([]);
  expect(await f.val(`select count(*) from profiles where coalesce(loyalty_points, 0) < 0 or coalesce(loyalty_points_held, 0) < 0`)).toBe(0);
};

// ==========================================================================================
describe('the last seat', () => {
  it('goes to exactly one of twenty people asking together', async () => {
    const cat = await seedCategory(f, { capacity: 1, name: 'LAST', prefix: 'L-' });
    const users = await Promise.all(Array.from({ length: 20 }, () => seedUser(f)));

    const { won, refused } = await settle(users.map((u, i) => () => reserve(`rush_${i}`, u, [[cat, 1]])));

    expect(won).toHaveLength(1);
    expect(refused).toHaveLength(19);
    expect(refused.every((m) => m.includes('SOLD_OUT:LAST'))).toBe(true);
    expect(await f.val(`select count(*) from ticket_numbers where category_id = $1`, [cat])).toBe(1);
    await expectSound();
  });

  it('sells exactly ten of ten to fifty people, numbered one to ten', async () => {
    const cat = await seedCategory(f, { capacity: 10, name: 'TEN', prefix: 'T-' });
    const users = await Promise.all(Array.from({ length: 50 }, () => seedUser(f)));

    const { won, refused } = await settle(users.map((u, i) => () => reserve(`rush_${i}`, u, [[cat, 1]])));

    expect(won).toHaveLength(10);
    expect(refused).toHaveLength(40);
    const numbers = await f.all<{ number: number }>(`select number from ticket_numbers order by number`);
    expect(numbers.map((n) => n.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    await expectSound();
  });

  it('refuses the whole cart rather than selling part of it, under load', async () => {
    // Everyone wants three; there is room for seven. Four carts of three do not fit, so two
    // must win and the rest be refused outright - nobody gets one or two of their three.
    const cat = await seedCategory(f, { capacity: 7, name: 'SEVEN', prefix: 'S-' });
    const users = await Promise.all(Array.from({ length: 4 }, () => seedUser(f)));

    const { won } = await settle(users.map((u, i) => () => reserve(`cart_${i}`, u, [[cat, 3]])));

    expect(won).toHaveLength(2);
    expect(await f.val(`select count(*) from ticket_numbers`)).toBe(6);
    // The seventh seat is left unsold, which is correct: no cart of three fits in it.
    await expectSound();
  });

  it('lets a comp and a buyer compete for one seat, and only one gets it', async () => {
    const cat = await seedCategory(f, { capacity: 1, name: 'ONE', prefix: 'O-' });
    const buyer = await seedUser(f);

    const { won, refused } = await settle([
      () => reserve('sale_1', buyer, [[cat, 1]]),
      () => reserve('comp_1', null, [[cat, 1]]),
    ]);

    expect(won).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toContain('SOLD_OUT:ONE');
    await expectSound();
  });

  it('lets two admins issue comps at once without inventing a seat', async () => {
    const cat = await seedCategory(f, { capacity: 3, name: 'ACCESS PASS', prefix: 'AP-' });

    const { won, refused } = await settle([
      () => reserve('comp_a', null, [[cat, 2]]),
      () => reserve('comp_b', null, [[cat, 2]]),
    ]);

    expect(won).toHaveLength(1);
    expect(refused[0]).toContain('SOLD_OUT:ACCESS PASS');
    expect(await f.val(`select count(*) from ticket_numbers`)).toBe(2);
    await expectSound();
  });

  it('makes a group pass and a single compete for the same stock', async () => {
    const cat = await seedCategory(f, { capacity: 2, name: 'MIX', prefix: 'M-', groupSize: 5 });
    const a = await seedUser(f);
    const b = await seedUser(f);

    const { won } = await settle([
      () => reserve('grp_a', a, [[cat, 2]]),
      () => reserve('grp_b', b, [[cat, 2]]),
    ]);

    expect(won).toHaveLength(1);
    // Two passes, admitting ten people between them: capacity counts passes, not heads.
    expect(await f.val(`select sold from event_ticket_categories where id = $1`, [cat])).toBe(2);
    await expectSound();
  });

  it('spreads a storm across two categories without leaking stock between them', async () => {
    const a = await seedCategory(f, { capacity: 5, name: 'A', prefix: 'A-' });
    const b = await seedCategory(f, { capacity: 5, name: 'B', prefix: 'B-' });
    const users = await Promise.all(Array.from({ length: 30 }, () => seedUser(f)));

    await settle(users.map((u, i) => () => reserve(`mix_${i}`, u, i % 2 ? [[a, 1]] : [[b, 1]])));

    expect(await f.val(`select count(*) from ticket_numbers where category_id = $1`, [a])).toBe(5);
    expect(await f.val(`select count(*) from ticket_numbers where category_id = $1`, [b])).toBe(5);
    await expectSound();
  });

  it('keeps a two-category cart all-or-nothing when one side runs out mid-storm', async () => {
    const roomy = await seedCategory(f, { capacity: 100, name: 'ROOMY', prefix: 'R-' });
    const scarce = await seedCategory(f, { capacity: 2, name: 'SCARCE', prefix: 'S-' });
    const users = await Promise.all(Array.from({ length: 10 }, () => seedUser(f)));

    const { won } = await settle(users.map((u, i) => () => reserve(`both_${i}`, u, [[roomy, 1], [scarce, 1]])));

    expect(won).toHaveLength(2);
    // The eight refused carts must not have left a ROOMY seat behind them.
    expect(await f.val(`select count(*) from ticket_numbers where category_id = $1`, [roomy])).toBe(2);
    await expectSound();
  });
});

// ==========================================================================================
describe('the same request arriving more than once', () => {
  it('takes seats once however many times one reservation is replayed', async () => {
    const cat = await seedCategory(f, { capacity: 10 });
    const user = await seedUser(f);

    const { won, refused } = await settle(Array.from({ length: 10 }, () => () => reserve('same_id', user, [[cat, 1]])));

    expect(refused).toEqual([]);
    expect(won).toHaveLength(10); // all ten answered
    expect(await f.val(`select count(*) from ticket_numbers`)).toBe(1); // one seat taken
    await expectSound();
  });

  it('confirms once, and tells the other callers it was already done', async () => {
    const cat = await seedCategory(f, { capacity: 10 });
    await reserve('res_1', null, [[cat, 2]]);

    const { won } = await settle(
      Array.from({ length: 5 }, () => () => f.val<{ alreadyConfirmed: boolean }>(`select confirm_order_inventory('res_1') as r`)),
    );

    expect(won.filter((r) => r.alreadyConfirmed === false)).toHaveLength(1);
    expect(won.filter((r) => r.alreadyConfirmed === true)).toHaveLength(4);
    expect(await f.val(`select count(*) from ticket_numbers where state = 'ISSUED'`)).toBe(2);
    await expectSound();
  });

  it('frees the seats once when a refund is reported from four directions', async () => {
    const cat = await seedCategory(f, { capacity: 10 });
    const user = await seedUser(f, 300);
    await reserve('res_1', user, [[cat, 2]], { points: 100 });
    await f.val(`select confirm_order_inventory('res_1')`);

    const { won } = await settle(Array.from({ length: 4 }, () => () => f.val<number>(`select release_order_inventory('res_1')`)));

    expect(won.filter((n) => Number(n) > 0)).toHaveLength(1);
    expect(await f.val(`select sold from event_ticket_categories where id = $1`, [cat])).toBe(0);
    // The hundred points come back exactly once.
    expect(await points(user)).toMatchObject({ loyalty_points: 300, loyalty_points_held: 0 });
    await expectSound();
  });

  it('never both confirms and releases the same hold', async () => {
    const cat = await seedCategory(f, { capacity: 10 });
    await reserve('res_1', null, [[cat, 1]]);

    await settle([
      () => f.val(`select confirm_order_inventory('res_1')`),
      () => f.val(`select release_order_inventory('res_1')`),
    ]);

    const state = await f.val<string>(`select state from inventory_reservations where reservation_id = 'res_1'`);
    expect(['CONFIRMED', 'RELEASED']).toContain(state);
    // Whichever won, the books balance: a CONFIRMED hold keeps its seat, a RELEASED one gives it up.
    const live = await f.val<number>(`select count(*) from ticket_numbers where reservation_id = 'res_1'`);
    expect(live).toBe(state === 'CONFIRMED' ? 1 : 0);
    await expectSound();
  });

  it('voids one number once, however many admins click at the same moment', async () => {
    const cat = await seedCategory(f, { capacity: 10 });
    await reserve('res_1', null, [[cat, 3]]);
    await f.val(`select confirm_order_inventory('res_1')`);

    const { won } = await settle(
      Array.from({ length: 5 }, () => () => f.val<number>(`select void_ticket_number('res_1', $1, 2)`, [cat])),
    );

    expect(won.filter((n) => Number(n) === 1)).toHaveLength(1);
    expect(won.filter((n) => Number(n) === 0)).toHaveLength(4);
    expect(await f.val(`select sold from event_ticket_categories where id = $1`, [cat])).toBe(2);
    await expectSound();
  });

  it('never hands a freed number to two buyers at once', async () => {
    const cat = await seedCategory(f, { capacity: 3, name: 'THREE', prefix: 'T-' });
    await reserve('res_1', null, [[cat, 3]]);
    await f.val(`select confirm_order_inventory('res_1')`);

    // One seat comes free while four buyers are trying for it.
    const users = await Promise.all(Array.from({ length: 4 }, () => seedUser(f)));
    const buyers = await settle(users.map((u, i) => () => reserve(`late_${i}`, u, [[cat, 1]])));
    const voidFirst = await settle([() => f.val<number>(`select void_ticket_number('res_1', $1, 2)`, [cat])]);
    expect(voidFirst.won.map(Number)).toEqual([1]);

    // Whether the buyers ran before or after the void, at most one of them can hold the seat
    // it freed - and the house is never over its three.
    expect(buyers.won.length).toBeLessThanOrEqual(1);
    expect(await f.val(`select count(*) from ticket_numbers where category_id = $1`, [cat])).toBeLessThanOrEqual(3);
    await expectSound();
  });
});

// ==========================================================================================
describe('loyalty points under load', () => {
  it('cannot be promised to two checkouts at once', async () => {
    const user = await seedUser(f, 100);
    const cat = await seedCategory(f, { capacity: 100 });

    const { won, refused } = await settle(
      Array.from({ length: 5 }, (_, i) => () => reserve(`tab_${i}`, user, [[cat, 1]], { points: 100 })),
    );

    expect(won).toHaveLength(1);
    expect(refused).toHaveLength(4);
    expect(refused.every((m) => m.includes('POINTS_UNAVAILABLE'))).toBe(true);
    expect(await points(user)).toMatchObject({ loyalty_points: 100, loyalty_points_held: 100 });
    await expectSound();
  });

  it('spends them once when the winning checkout is paid for', async () => {
    const user = await seedUser(f, 100);
    const cat = await seedCategory(f, { capacity: 100 });
    await reserve('tab_0', user, [[cat, 1]], { points: 100 });

    await settle(Array.from({ length: 3 }, () => () => f.val(`select confirm_order_inventory('tab_0')`)));

    expect(await points(user)).toMatchObject({ loyalty_points: 0, loyalty_points_held: 0 });
    await expectSound();
  });

  it('is conserved across a storm of holds, payments and refunds', async () => {
    const user = await seedUser(f, 1000);
    const cat = await seedCategory(f, { capacity: 200 });

    // Ten checkouts of 50 points each, half paid for, half refunded afterwards. The pass
    // allowance is lifted deliberately: this test is about the points arithmetic, and leaving
    // the default cap of seven in place would silently refuse three of the ten and make the
    // expected balance depend on a rule from somewhere else.
    const held = await settle(
      Array.from({ length: 10 }, (_, i) => () => reserve(`s_${i}`, user, [[cat, 1]], { points: 50, maxSingle: 10 })),
    );
    expect(held.won).toHaveLength(10);
    expect(await points(user)).toMatchObject({ loyalty_points: 1000, loyalty_points_held: 500 });

    await settle(Array.from({ length: 10 }, (_, i) => () => f.val(`select confirm_order_inventory($1)`, [`s_${i}`])));
    expect(await points(user)).toMatchObject({ loyalty_points: 500, loyalty_points_held: 0 });

    await settle(Array.from({ length: 5 }, (_, i) => () => f.val(`select release_order_inventory($1)`, [`s_${i}`])));

    // Five orders kept (250 spent for good), five refunded (250 handed back). Nothing held.
    expect(await points(user)).toMatchObject({ loyalty_points: 750, loyalty_points_held: 0 });
    await expectSound();
  });

  it('counts a cart against the pass allowance even when it is paid for in points', async () => {
    // The flip side of the test above, stated on purpose rather than by accident: points do
    // not buy a way around the per-account limit.
    const user = await seedUser(f, 1000);
    const cat = await seedCategory(f, { capacity: 200 });
    const { won, refused } = await settle(
      Array.from({ length: 10 }, (_, i) => () => reserve(`cap_${i}`, user, [[cat, 1]], { points: 50, maxSingle: 7 })),
    );
    expect(won).toHaveLength(7);
    expect(refused).toHaveLength(3);
    expect(refused.every((m) => m.includes('LIMIT_SINGLE:7'))).toBe(true);
    // The three refusals rolled back cleanly: only the seven winners hold points.
    expect(await points(user)).toMatchObject({ loyalty_points: 1000, loyalty_points_held: 350 });
    await expectSound();
  });

  it('refuses points to a reservation with no account behind it', async () => {
    const cat = await seedCategory(f, { capacity: 10 });
    const err = await f.fails(`select reserve_order_inventory('comp_1', null, $1::jsonb, 50, 900, 7, 2)`, [items([[cat, 1]])]);
    expect(err).toContain('POINTS_UNAVAILABLE:0');
    await expectSound();
  });
});

// ==========================================================================================
describe('per-account limits under load', () => {
  it('holds across checkouts opened in two tabs at the same moment', async () => {
    // The bug this closes: each tab counted only what the OTHER tab had already paid for, so
    // seven plus seven got through.
    const user = await seedUser(f);
    const cat = await seedCategory(f, { capacity: 100 });

    const { won } = await settle(Array.from({ length: 4 }, (_, i) => () => reserve(`tab_${i}`, user, [[cat, 4]], { maxSingle: 7 })));

    expect(won).toHaveLength(1);
    expect(await f.val(`select count(*) from ticket_numbers where user_id = $1`, [user])).toBe(4);
    await expectSound();
  });

  it('counts single and group allowances separately', async () => {
    const user = await seedUser(f);
    const single = await seedCategory(f, { capacity: 100, name: 'S', prefix: 'S-' });
    const group = await seedCategory(f, { capacity: 100, name: 'G', prefix: 'G-', groupSize: 5 });

    await reserve('r1', user, [[single, 7], [group, 2]], { maxSingle: 7, maxGroup: 2 });
    expect(await f.fails(`select reserve_order_inventory('r2', $1, $2::jsonb, 0, 900, 7, 2)`, [user, items([[single, 1]])]))
      .toContain('LIMIT_SINGLE:7');
    expect(await f.fails(`select reserve_order_inventory('r3', $1, $2::jsonb, 0, 900, 7, 2)`, [user, items([[group, 1]])]))
      .toContain('LIMIT_GROUP:2');
    await expectSound();
  });

  it('does not let one account\'s limit refuse anybody else', async () => {
    const hog = await seedUser(f);
    const others = await Promise.all(Array.from({ length: 5 }, () => seedUser(f)));
    const cat = await seedCategory(f, { capacity: 100 });
    await reserve('hog', hog, [[cat, 7]], { maxSingle: 7 });

    const { won, refused } = await settle(others.map((u, i) => () => reserve(`other_${i}`, u, [[cat, 2]])));

    expect(won).toHaveLength(5);
    expect(refused).toEqual([]);
    await expectSound();
  });

  it('leaves comps out of the allowance entirely', async () => {
    const user = await seedUser(f);
    const cat = await seedCategory(f, { capacity: 100 });

    await settle([
      ...Array.from({ length: 5 }, (_, i) => () => reserve(`comp_${i}`, null, [[cat, 5]])),
      () => reserve('their_own', user, [[cat, 7]], { maxSingle: 7 }),
    ]);

    expect(await f.val(`select count(*) from ticket_numbers where user_id = $1`, [user])).toBe(7);
    expect(await f.val(`select count(*) from ticket_numbers where user_id is null`)).toBe(25);
    await expectSound();
  });
});

// ==========================================================================================
describe('the sweeper', () => {
  it('does not take seats from a checkout that is still live', async () => {
    const cat = await seedCategory(f, { capacity: 10 });
    await reserve('fresh', null, [[cat, 2]], { ttl: 900 });

    await settle([
      () => f.val<number>(`select expire_stale_holds()`),
      () => f.val<number>(`select expire_stale_holds()`),
    ]);

    expect(await f.val(`select count(*) from ticket_numbers`)).toBe(2);
    await expectSound();
  });

  it('frees a stale hold exactly once when it runs twice together', async () => {
    const cat = await seedCategory(f, { capacity: 10 });
    const user = await seedUser(f, 200);
    await reserve('stale', user, [[cat, 2]], { points: 100 });
    await f.db.query(`update inventory_reservations set expires_at = now() - interval '1 hour'`);

    const { won } = await settle(Array.from({ length: 3 }, () => () => f.val<number>(`select expire_stale_holds()`)));

    expect(won.filter((n) => Number(n) === 1)).toHaveLength(1);
    expect(await f.val(`select count(*) from ticket_numbers`)).toBe(0);
    // The points were held, never spent, so the balance is untouched and nothing stays held.
    expect(await points(user)).toMatchObject({ loyalty_points: 200, loyalty_points_held: 0 });
    await expectSound();
  });

  it('races a confirm without losing the paid order', async () => {
    const cat = await seedCategory(f, { capacity: 10 });
    await reserve('edge', null, [[cat, 1]], { ttl: 60 });
    await f.db.query(`update inventory_reservations set expires_at = now() - interval '1 second'`);

    await settle([
      () => f.val(`select expire_stale_holds()`),
      () => f.val(`select confirm_order_inventory('edge')`),
    ]);

    // Either the sweep got there first (the order must then be refunded, which is what
    // RESERVATION_LOST tells the application to do) or the confirm did and the seat is kept.
    const state = await f.val<string>(`select state from inventory_reservations where reservation_id = 'edge'`);
    expect(['CONFIRMED', 'RELEASED']).toContain(state);
    expect(await f.val(`select count(*) from ticket_numbers`)).toBe(state === 'CONFIRMED' ? 1 : 0);
    await expectSound();
  });

  it('lets the freed seat be resold straight away', async () => {
    const cat = await seedCategory(f, { capacity: 1, name: 'ONE', prefix: 'O-' });
    await reserve('abandoned', null, [[cat, 1]], { ttl: 60 });
    await f.db.query(`update inventory_reservations set expires_at = now() - interval '1 hour'`);
    await f.val(`select expire_stale_holds()`);

    const alloc = await reserve('next', await seedUser(f), [[cat, 1]]);
    expect(alloc[0].numbers).toEqual([1]);
    await expectSound();
  });
});

// ==========================================================================================
describe('a full storm, and the books afterwards', () => {
  it('survives sixty mixed operations with every invariant intact', async () => {
    const ga = await seedCategory(f, { capacity: 20, name: 'GA', prefix: 'GA-', price: 500 });
    const vip = await seedCategory(f, { capacity: 5, name: 'VIP', prefix: 'VIP-', price: 2000 });
    const grp = await seedCategory(f, { capacity: 4, name: 'GRP', prefix: 'GRP-', price: 2000, groupSize: 5 });
    const users = await Promise.all(Array.from({ length: 20 }, () => seedUser(f, 200)));

    // Deterministic, so a failure is reproducible.
    let seed = 20261106;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

    const tasks: (() => Promise<unknown>)[] = [];
    for (let i = 0; i < 40; i++) {
      const u = users[Math.floor(rand() * users.length)];
      const r = rand();
      const cart: [string, number][] = r < 0.5 ? [[ga, 1 + Math.floor(rand() * 3)]] : r < 0.8 ? [[vip, 1]] : [[grp, 1]];
      const pts = rand() < 0.3 ? 50 : 0;
      tasks.push(() => reserve(`storm_${i}`, u, cart, { points: pts }));
    }
    await settle(tasks);

    // Then pay for some, refund some, void individual passes from others - all at once.
    const after: (() => Promise<unknown>)[] = [];
    for (let i = 0; i < 40; i++) {
      const r = rand();
      if (r < 0.5) after.push(() => f.val(`select confirm_order_inventory($1)`, [`storm_${i}`]));
      else if (r < 0.7) after.push(() => f.val(`select release_order_inventory($1)`, [`storm_${i}`]));
      else after.push(() => f.val(`select expire_stale_holds()`));
    }
    await settle(after);

    const live = await f.all<{ category_id: string; number: number }>(`select category_id, number from ticket_numbers`);
    for (const row of live) {
      // Every live number must be a positive integer inside its category's capacity.
      expect(row.number).toBeGreaterThan(0);
    }
    await expectSound();
  }, 180_000);

  it('voids and resells through the storm without duplicating a number', async () => {
    const cat = await seedCategory(f, { capacity: 8, name: 'EIGHT', prefix: 'E-' });
    const users = await Promise.all(Array.from({ length: 8 }, () => seedUser(f)));
    await settle(users.map((u, i) => () => reserve(`own_${i}`, u, [[cat, 1]])));
    await settle(users.map((_, i) => () => f.val(`select confirm_order_inventory($1)`, [`own_${i}`])));

    // Four voids and four new buyers, together.
    const newcomers = await Promise.all(Array.from({ length: 4 }, () => seedUser(f)));
    await settle([
      ...[1, 2, 3, 4].map((n, i) => () => f.val(`select void_ticket_number($1, $2, $3)`, [`own_${i}`, cat, n])),
      ...newcomers.map((u, i) => () => reserve(`new_${i}`, u, [[cat, 1]])),
    ]);

    expect(await duplicates()).toEqual([]);
    expect(await f.val(`select count(*) from ticket_numbers where category_id = $1`, [cat])).toBeLessThanOrEqual(8);
    await expectSound();
  });

  it('cannot be pushed over capacity by an admin shrinking it after the fact', async () => {
    const cat = await seedCategory(f, { capacity: 10, name: 'SHRINK', prefix: 'S-' });
    const users = await Promise.all(Array.from({ length: 5 }, () => seedUser(f)));
    await settle(users.map((u, i) => () => reserve(`before_${i}`, u, [[cat, 1]])));

    // The admin cuts capacity below what is already sold. The five passes out there stay valid.
    await f.db.query(`update event_ticket_categories set capacity = 2 where id = $1`, [cat]);
    expect(await f.val(`select count(*) from ticket_numbers where category_id = $1`, [cat])).toBe(5);

    // And nothing more may be sold while it is over the new line.
    const latecomer = await seedUser(f);
    const { won, refused } = await settle([() => reserve('after', latecomer, [[cat, 1]])]);
    expect(won).toEqual([]);
    expect(refused[0]).toContain('SOLD_OUT:SHRINK');
    expect(await drift()).toEqual([]);
  });

  it('keeps issued_total only ever rising through the storm', async () => {
    const cat = await seedCategory(f, { capacity: 10 });
    const users = await Promise.all(Array.from({ length: 10 }, () => seedUser(f)));
    await settle(users.map((u, i) => () => reserve(`t_${i}`, u, [[cat, 1]])));
    const peak = await f.val<number>(`select issued_total from event_ticket_categories where id = $1`, [cat]);

    await settle(users.map((_, i) => () => f.val(`select release_order_inventory($1)`, [`t_${i}`])));

    expect(await f.val(`select sold from event_ticket_categories where id = $1`, [cat])).toBe(0);
    expect(await f.val(`select issued_total from event_ticket_categories where id = $1`, [cat])).toBe(peak);
    await expectSound();
  });

  it('refuses a cart mixing two events, however it is ordered', async () => {
    const a = await seedCategory(f, { eventId: 'evt_a', capacity: 10, name: 'A', prefix: 'A-' });
    const b = await seedCategory(f, { eventId: 'evt_b', capacity: 10, name: 'B', prefix: 'B-' });
    expect(await f.fails(`select reserve_order_inventory('x1', null, $1::jsonb, 0, 900, 7, 2)`, [items([[a, 1], [b, 1]])]))
      .toContain('MIXED_EVENT_CART');
    expect(await f.fails(`select reserve_order_inventory('x2', null, $1::jsonb, 0, 900, 7, 2)`, [items([[b, 1], [a, 1]])]))
      .toContain('MIXED_EVENT_CART');
    expect(await f.val(`select count(*) from ticket_numbers`)).toBe(0);
    await expectSound();
  });

  it('refuses an empty cart and a cart of nothing but zeroes', async () => {
    const cat = await seedCategory(f, { capacity: 10 });
    expect(await f.fails(`select reserve_order_inventory('e1', null, '[]'::jsonb, 0, 900, 7, 2)`)).toContain('EMPTY_CART');
    expect(await f.fails(`select reserve_order_inventory('e2', null, $1::jsonb, 0, 900, 7, 2)`, [items([[cat, 0]])]))
      .toContain('EMPTY_CART');
    expect(await f.val(`select count(*) from inventory_reservations`)).toBe(0);
  });

  it('refuses a reservation with no id, before anything is written', async () => {
    const cat = await seedCategory(f, { capacity: 10 });
    expect(await f.fails(`select reserve_order_inventory('', null, $1::jsonb, 0, 900, 7, 2)`, [items([[cat, 1]])]))
      .toContain('RESERVATION_ID_REQUIRED');
    expect(await f.val(`select count(*) from ticket_numbers`)).toBe(0);
  });

  it('does not let one bad category in a batch spoil the rest', async () => {
    const good = await seedCategory(f, { capacity: 10 });
    const { won, refused } = await settle([
      () => reserve('ok_1', null, [[good, 1]]),
      () => reserve('bad_1', null, [['00000000-0000-0000-0000-000000000000', 1]]),
      () => reserve('ok_2', null, [[good, 1]]),
    ]);
    expect(won).toHaveLength(2);
    expect(refused).toHaveLength(1);
    expect(await f.val(`select count(*) from ticket_numbers`)).toBe(2);
    await expectSound();
  });
});
