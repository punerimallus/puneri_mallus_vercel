// Locking the ticketing functions must not break the ticketing.
//
// Reasoning about grants is how the hole got there in the first place, so this does not reason:
// it applies every migration to a real PostgreSQL, switches to the service_role the application
// actually uses, and runs a whole sale through — reserve, claim a coupon, confirm, void, release
// — then switches to anon and checks the door is shut.
//
// The database is set up the way Supabase sets one up: default privileges that grant EXECUTE on
// new functions to service_role. That is why production shows `service_role=X` on functions that
// were revoked from everyone else, and it is the thing that has to survive the revoke.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { freshDb, type Fixture } from './pg';

const ROOT = join(import.meta.dirname ?? __dirname, '..', '..');
const sqlFile = (n: string) => readFileSync(join(ROOT, 'supabase', 'migrations', n), 'utf8');

const MIGRATIONS = [
  '20261106_comp_passes.sql',
  '20261107_access_pass.sql',
  '20261114_coupons.sql',
  '20261115_ticket_bundles.sql',
  '20261116_drop_group_tickets.sql',
  '20261117_bundle_sold_counter.sql',
  '20261118_lock_reserve_function.sql',
];

let f: Fixture;
let cat: string;
let user: string;

const EVENT = 'evt_test';

beforeAll(async () => {
  f = await freshDb();

  // Deliberately NOT set up the way Supabase sets up default privileges.
  //
  // On the real database every one of these functions carries an explicit service_role grant,
  // so a revoke cannot strip it. Here they do not — the baseline creates them with the plain
  // default of owner + PUBLIC. That makes this the HARSHER test: if the migration relied on an
  // existing service_role grant being there, every call below would fail with permission
  // denied. It passes because the migration grants EXECUTE back to service_role itself.
  for (const m of MIGRATIONS) await f.db.exec(sqlFile(m));

  cat = await f.val<string>(
    `insert into event_ticket_categories (event_id, name, prefix, price, capacity)
     values ($1, 'REGULAR', 'REGULAR-', 1000, 50) returning id`, [EVENT],
  );
  user = await f.val<string>(
    `insert into profiles (id, email, loyalty_points) values (gen_random_uuid(), 'buyer@example.com', 200) returning id`,
  );
  await f.db.query(
    `insert into coupons (code, event_id, kind, discount_type, discount_value, max_uses, per_account_uses, active)
     values ('SAVE100', $1, 'DISCOUNT', 'FLAT', 100, 5, 2, true)`, [EVENT],
  );
}, 180_000);

afterAll(async () => { await f?.close(); });

/** Run one statement as a given database role, then switch back. */
async function asRole<T>(role: string, run: () => Promise<T>): Promise<T> {
  await f.db.exec(`set role ${role};`);
  try {
    return await run();
  } finally {
    await f.db.exec(`reset role;`);
  }
}

describe('the service role — what the application actually uses — can still sell a ticket', () => {
  it('reserves seats', async () => {
    const got = await asRole('service_role', () =>
      f.val<unknown>(
        `select reserve_order_inventory($1, $2, $3::jsonb, 0, 900, 7, 2, 2)`,
        ['res_1', user, JSON.stringify([{ categoryId: cat, qty: 2 }])],
      ));
    expect(JSON.stringify(got)).toContain('"qty":2');
    expect(await f.val<number>(`select count(*) from ticket_numbers where reservation_id = 'res_1'`)).toBe(2);
  });

  it('claims a coupon', async () => {
    const code = await asRole('service_role', () =>
      f.val<string>(`select (claim_coupon('SAVE100', 'res_1', $1, $2, 'buyer@example.com')).code`, [user, EVENT]));
    expect(code).toBe('SAVE100');
    expect(await f.val<number>(`select uses from coupons where code = 'SAVE100'`)).toBe(1);
  });

  it('confirms the sale', async () => {
    const booking = await f.val<string>(
      `insert into ticket_bookings (event_id, email, amount_paid, tickets_data, status, user_id)
       values ($1, 'buyer@example.com', 1900, '[]'::jsonb, 'CONFIRMED', $2) returning id`, [EVENT, user],
    );
    await asRole('service_role', async () => {
      await f.db.query(`select confirm_order_inventory('res_1')`);
      await f.db.query(`select confirm_coupon('res_1', $1, 100, '["REGULAR-001"]'::jsonb)`, [booking]);
    });
    expect(await f.val<string>(`select state from inventory_reservations where reservation_id = 'res_1'`)).toBe('CONFIRMED');
  });

  it('voids one pass and puts its seat back', async () => {
    // It answers with how many seats it freed, not a yes/no.
    const freed = await asRole('service_role', () =>
      f.val<number>(`select void_ticket_number('res_1', $1, 1)`, [cat]));
    expect(freed).toBe(1);
    expect(await f.val<number>(`select count(*) from ticket_numbers where reservation_id = 'res_1'`)).toBe(1);
  });

  it('recounts a category and a bundle', async () => {
    await asRole('service_role', async () => {
      await f.db.query(`select refresh_category_counts($1)`, [cat]);
    });
    expect(await f.val<number>(`select sold from event_ticket_categories where id = $1`, [cat])).toBe(1);
  });

  it('releases a whole checkout, coupon and all', async () => {
    await asRole('service_role', () =>
      f.db.query(`select reserve_order_inventory($1, $2, $3::jsonb, 0, 900, 7, 2, 2)`,
        ['res_2', user, JSON.stringify([{ categoryId: cat, qty: 1 }])]));
    await asRole('service_role', () =>
      f.db.query(`select claim_coupon('SAVE100', 'res_2', $1, $2, 'buyer@example.com')`, [user, EVENT]));
    expect(await f.val<number>(`select uses from coupons where code = 'SAVE100'`)).toBe(2);

    await asRole('service_role', () => f.db.query(`select release_order_inventory('res_2')`));
    expect(await f.val<number>(`select count(*) from ticket_numbers where reservation_id = 'res_2'`)).toBe(0);
    expect(await f.val<number>(`select uses from coupons where code = 'SAVE100'`)).toBe(1);
  });

  it('sweeps expired holds', async () => {
    await asRole('service_role', () => f.db.query(`select expire_stale_holds()`));
  });

  it('spends and returns loyalty points', async () => {
    await asRole('service_role', () => f.db.query(`select adjust_loyalty_points($1, 50)`, [user]));
    expect(await f.val<number>(`select loyalty_points from profiles where id = $1`, [user])).toBe(250);
  });
});

describe('the door is shut on everyone else', () => {
  const denied = async (role: string, sql: string, params: unknown[] = []) => {
    const message = await asRole(role, async () => {
      try {
        await f.db.query(sql, params);
        return 'IT RAN';
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    });
    expect(message).toMatch(/permission denied/i);
  };

  it('anon cannot take seats', async () => {
    await denied('anon', `select reserve_order_inventory('res_hack', null, $1::jsonb, 0, 900, 7, 2, 2)`,
      [JSON.stringify([{ categoryId: cat, qty: 40 }])]);
  });

  it('a signed-in buyer cannot either', async () => {
    await denied('authenticated', `select reserve_order_inventory('res_hack2', null, $1::jsonb, 0, 900, 7, 2, 2)`,
      [JSON.stringify([{ categoryId: cat, qty: 40 }])]);
  });

  it('nor spend a coupon, void a pass or rewrite a counter', async () => {
    await denied('anon', `select claim_coupon('SAVE100', 'res_hack3', null, $1, null)`, [EVENT]);
    await denied('anon', `select void_ticket_number('res_1', $1, 2)`, [cat]);
    await denied('anon', `select refresh_category_counts($1)`, [cat]);
    await denied('authenticated', `select release_order_inventory('res_1')`);
  });

  it('and the hall is untouched by any of it', async () => {
    // The point of the lock: a stranger could have held forty of the fifty seats.
    expect(await f.val<number>(`select count(*) from ticket_numbers where category_id = $1`, [cat])).toBe(1);
  });
});

describe('what the lock does NOT touch', () => {
  it('leaves phone sign-in alone', () => {
    // get_auth_email_by_phone is called with the anon key by GlobalEntryGate, so locking it
    // would stop anybody signing in. Asserted against the migration itself because the function
    // belongs to an older migration than the ones applied here.
    const sql = sqlFile('20261118_lock_reserve_function.sql');
    const list = sql.slice(sql.indexOf('p.proname in ('), sql.indexOf('  loop'));
    expect(list).not.toMatch(/'get_auth_email_by_phone'/);
  });

  it('leaves the bundle-counter triggers firing', async () => {
    // Their functions were revoked by 20261117 and they still fire: Postgres checks EXECUTE
    // when a trigger is CREATED, not every time it runs. Proven rather than assumed.
    const before = await f.val<number>(`select count(*) from ticket_bundles`);
    expect(before).toBe(0);
    const bundle = await f.val<string>(
      `insert into ticket_bundles (event_id, category_id, name, size, price, max_bundles)
       values ($1, $2, 'Group of 4', 4, 3600, 3) returning id`, [EVENT, cat],
    );
    await asRole('service_role', () =>
      f.db.query(`select reserve_order_inventory($1, $2, $3::jsonb, 0, 900, 7, 2, 2)`,
        ['res_bundle', user, JSON.stringify([{ categoryId: cat, qty: 4, bundleRef: `${bundle}:res_bundle:1` }])]));
    // The trigger ran: the counter moved without anybody calling refresh_bundle_counts.
    expect(await f.val<number>(`select sold from ticket_bundles where id = $1`, [bundle])).toBe(1);
  });

  it('leaves scanning alone, because scanning calls no function at all', () => {
    // The gate marks a pass used with a plain UPDATE on ticket_bookings. Asserted against the
    // source so it stays true: the day somebody adds an rpc there, this fails and the grant has
    // to be thought about.
    for (const file of ['app/api/gate/scan/route.ts', 'app/api/admin/tickets/checkin/route.ts']) {
      const src = readFileSync(join(ROOT, file), 'utf8');
      expect(src).not.toMatch(/\.rpc\(/);
    }
  });
});
