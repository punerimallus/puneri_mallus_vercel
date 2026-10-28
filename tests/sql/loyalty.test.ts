// Tribe loyalty points, end to end, against a real PostgreSQL.
//
// Points are the one part of ticketing that is pure bookkeeping: there is no gateway to check
// against and no email to compare with, so an arithmetic slip just quietly makes people richer
// or poorer. The invariant worth protecting is conservation — across any sequence of buy,
// abandon, confirm and refund, a member's spendable balance must end up exactly where the
// events say it should, and points held for an unfinished checkout must never be lost or
// spendable twice.

import { describe, expect, it } from 'vitest';
import { freshDb, items, seedCategory, seedUser, Fixture } from './pg';

const reserve = (resId: string, userId: string | null, cart: [string, number][], points = 0, ttl = 900): [string, unknown[]] =>
  ['select reserve_order_inventory($1, $2, $3::jsonb, $4, $5, 1000, 99) as alloc',
    [resId, userId, items(cart), points, ttl]];

/** Spendable balance and what is promised elsewhere. */
async function wallet(f: Fixture, user: string) {
  const row = await f.one<{ loyalty_points: number; loyalty_points_held: number }>(
    'select loyalty_points, loyalty_points_held from profiles where id = $1', [user],
  );
  return {
    balance: row!.loyalty_points,
    held: row!.loyalty_points_held,
    spendable: row!.loyalty_points - row!.loyalty_points_held,
  };
}

describe('redeeming points', () => {
  it('holds them at checkout without spending them', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: 50 });
    const user = await seedUser(f, 500);

    await f.val(...reserve('r1', user, [[cat, 1]], 200));

    // Still theirs until the payment lands — a checkout that never completes must not cost them.
    expect(await wallet(f, user)).toEqual({ balance: 500, held: 200, spendable: 300 });
    await f.close();
  });

  it('spends them only when the payment is confirmed', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: 50 });
    const user = await seedUser(f, 500);

    await f.val(...reserve('r1', user, [[cat, 1]], 200));
    await f.val('select confirm_order_inventory($1)', ['r1']);

    expect(await wallet(f, user)).toEqual({ balance: 300, held: 0, spendable: 300 });
    await f.close();
  });

  it('gives them back untouched when the checkout is abandoned', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: 50 });
    const user = await seedUser(f, 500);

    await f.val(...reserve('r1', user, [[cat, 1]], 200));
    await f.val('select release_order_inventory($1)', ['r1']);

    expect(await wallet(f, user)).toEqual({ balance: 500, held: 0, spendable: 500 });
    await f.close();
  });

  it('gives them back when the hold simply lapses', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: 50 });
    const user = await seedUser(f, 500);

    await f.val(...reserve('r1', user, [[cat, 1]], 200));
    await f.val(`update inventory_reservations set expires_at = now() - interval '1 minute'`);
    await f.val('select expire_stale_holds()');

    expect(await wallet(f, user)).toEqual({ balance: 500, held: 0, spendable: 500 });
    await f.close();
  });

  it('returns them when a confirmed order is refunded', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: 50 });
    const user = await seedUser(f, 500);

    await f.val(...reserve('r1', user, [[cat, 1]], 200));
    await f.val('select confirm_order_inventory($1)', ['r1']);
    expect((await wallet(f, user)).balance).toBe(300);

    await f.val('select release_order_inventory($1)', ['r1']);
    expect(await wallet(f, user)).toEqual({ balance: 500, held: 0, spendable: 500 });
    await f.close();
  });
});

describe('the ways it could go wrong', () => {
  it('refuses more points than are spendable', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: 50 });
    const user = await seedUser(f, 100);

    expect(await f.fails(...reserve('r1', user, [[cat, 1]], 101))).toContain('POINTS_UNAVAILABLE:100');
    // The whole reservation rolled back, so no seat was taken either.
    expect(await wallet(f, user)).toEqual({ balance: 100, held: 0, spendable: 100 });
    expect(await f.val('select count(*) from ticket_numbers')).toBe(0);
    await f.close();
  });

  it('counts points already promised to another checkout as unavailable', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: 50 });
    const user = await seedUser(f, 500);

    await f.val(...reserve('tab1', user, [[cat, 1]], 400));
    // 100 left, so 200 must be refused — and the message says how many are really free.
    expect(await f.fails(...reserve('tab2', user, [[cat, 1]], 200))).toContain('POINTS_UNAVAILABLE:100');
    // Exactly the remainder still works.
    await f.val(...reserve('tab3', user, [[cat, 1]], 100));
    expect(await wallet(f, user)).toEqual({ balance: 500, held: 500, spendable: 0 });
    await f.close();
  });

  it('spending the whole balance leaves nothing spendable and nothing negative', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: 50 });
    const user = await seedUser(f, 500);

    await f.val(...reserve('r1', user, [[cat, 1]], 500));
    await f.val('select confirm_order_inventory($1)', ['r1']);
    expect(await wallet(f, user)).toEqual({ balance: 0, held: 0, spendable: 0 });
    await f.close();
  });

  it('confirming twice does not spend twice', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: 50 });
    const user = await seedUser(f, 500);

    await f.val(...reserve('r1', user, [[cat, 1]], 200));
    await f.val('select confirm_order_inventory($1)', ['r1']);
    await f.val('select confirm_order_inventory($1)', ['r1']);
    await f.val('select confirm_order_inventory($1)', ['r1']);

    expect(await wallet(f, user)).toEqual({ balance: 300, held: 0, spendable: 300 });
    await f.close();
  });

  it('a repeated refund does not credit twice', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: 50 });
    const user = await seedUser(f, 500);

    await f.val(...reserve('r1', user, [[cat, 1]], 200));
    await f.val('select confirm_order_inventory($1)', ['r1']);
    for (let i = 0; i < 4; i++) await f.val('select release_order_inventory($1)', ['r1']);

    expect(await wallet(f, user)).toEqual({ balance: 500, held: 0, spendable: 500 });
    await f.close();
  });

  it('releasing a hold that never spent anything does not credit the balance', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: 50 });
    const user = await seedUser(f, 500);

    await f.val(...reserve('r1', user, [[cat, 1]], 200));
    await f.val('select release_order_inventory($1)', ['r1']);
    await f.val('select release_order_inventory($1)', ['r1']);

    // 500, not 700: the points were never taken, so giving them "back" must be a no-op.
    expect(await wallet(f, user)).toEqual({ balance: 500, held: 0, spendable: 500 });
    await f.close();
  });

  it('held never goes negative, whatever order things happen in', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: 50 });
    const user = await seedUser(f, 300);

    await f.val(...reserve('a', user, [[cat, 1]], 100));
    await f.val(...reserve('b', user, [[cat, 1]], 100));
    await f.val('select confirm_order_inventory($1)', ['a']);
    await f.val('select release_order_inventory($1)', ['b']);
    await f.val('select release_order_inventory($1)', ['a']);

    const w = await wallet(f, user);
    expect(w.held).toBe(0);
    expect(w.balance).toBe(300); // a spent 100 then refunded it; b never spent
    await f.close();
  });

  it('a zero-point order touches the wallet not at all', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: 50 });
    const user = await seedUser(f, 250);

    await f.val(...reserve('r1', user, [[cat, 1]], 0));
    await f.val('select confirm_order_inventory($1)', ['r1']);
    await f.val('select release_order_inventory($1)', ['r1']);

    expect(await wallet(f, user)).toEqual({ balance: 250, held: 0, spendable: 250 });
    await f.close();
  });
});

describe('conservation across a long sequence', () => {
  it('buy, abandon, buy, refund, buy again all add up', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: 200 });
    const user = await seedUser(f, 1000);

    await f.val(...reserve('s1', user, [[cat, 1]], 300));   // hold 300
    await f.val('select confirm_order_inventory($1)', ['s1']); // spend 300 -> 700
    await f.val(...reserve('s2', user, [[cat, 1]], 200));   // hold 200
    await f.val('select release_order_inventory($1)', ['s2']); // abandoned -> still 700
    await f.val(...reserve('s3', user, [[cat, 1]], 400));   // hold 400
    await f.val('select confirm_order_inventory($1)', ['s3']); // spend 400 -> 300
    await f.val('select release_order_inventory($1)', ['s1']); // refund the first -> 600

    expect(await wallet(f, user)).toEqual({ balance: 600, held: 0, spendable: 600 });
    await f.close();
  });

  it('points and seats are released together, never one without the other', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: 50 });
    const user = await seedUser(f, 500);

    await f.val(...reserve('r1', user, [[cat, 2]], 200));
    expect(await f.val('select count(*) from ticket_numbers')).toBe(2);
    expect((await wallet(f, user)).held).toBe(200);

    await f.val('select release_order_inventory($1)', ['r1']);
    expect(await f.val('select count(*) from ticket_numbers')).toBe(0);
    expect((await wallet(f, user)).held).toBe(0);
    await f.close();
  });
});

describe('the known limit, stated honestly', () => {
  it('cannot claw back points that were already spent elsewhere', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f, { capacity: 50 });
    const user = await seedUser(f, 0);

    // Earned 20 from a purchase...
    await f.val('select adjust_loyalty_points($1, 20)', [user]);
    expect((await wallet(f, user)).balance).toBe(20);

    // ...spent on something else...
    await f.val(...reserve('spend', user, [[cat, 1]], 20));
    await f.val('select confirm_order_inventory($1)', ['spend']);
    expect((await wallet(f, user)).balance).toBe(0);

    // ...then the original purchase is refunded and we try to take the 20 back.
    await f.val('select adjust_loyalty_points($1, -20)', [user]);

    // It floors at zero rather than going negative. Deliberate: nobody is left owing points.
    // The cost is that earn -> spend -> refund leaks up to one order's worth of points, which at
    // 10-20 a booking is not worth engineering around. If it is ever abused, the fix is to let
    // the balance go negative and block redemption until it is positive again.
    expect((await wallet(f, user)).balance).toBe(0);
    await f.close();
  });
});
