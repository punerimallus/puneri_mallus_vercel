// The migration that removes the group-ticket model, run for real against PostgreSQL.
//
// This one touches live rows rather than only adding things, so it is the migration most worth
// executing in a test rather than reading: it drops a column, rewrites every booking's
// tickets_data, and carries a guard that is supposed to stop the whole thing if a group pass
// was ever actually issued.

import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { freshDb, seedCategory, type Fixture } from './pg';

const MIGRATIONS = join(import.meta.dirname ?? __dirname, '..', '..', 'supabase', 'migrations');
const sqlFile = (name: string) => readFileSync(join(MIGRATIONS, name), 'utf8');
const DROP = () => sqlFile('20261116_drop_group_tickets.sql');

let f: Fixture;

beforeEach(async () => {
  f = await freshDb();
  await f.db.exec(sqlFile('20261114_coupons.sql'));
  await f.db.exec(sqlFile('20261115_ticket_bundles.sql'));
});

const booking = (tickets: unknown[], id = '11111111-1111-1111-1111-111111111111') =>
  f.db.query(
    `insert into ticket_bookings (id, event_id, email, tickets_data, amount_paid, status)
     values ($1, 'evt_test', 'a@b.com', $2::jsonb, 100, 'CONFIRMED')`,
    [id, JSON.stringify(tickets)],
  );

describe('removing the group-ticket model', () => {
  it('drops the column', async () => {
    await f.db.exec(DROP());
    expect(await f.val<number>(
      `select count(*) from information_schema.columns
        where table_name = 'event_ticket_categories' and column_name = 'group_size'`,
    )).toBe(0);
  });

  it('turns a category still configured as a group into an ordinary one, keeping its stock', async () => {
    const cat = await seedCategory(f, { name: 'FRIENDS GROUP', prefix: 'GRP-', capacity: 20, groupSize: 5 });
    await f.db.exec(DROP());
    const row = await f.one<{ name: string; capacity: number; active: boolean }>(
      `select name, capacity, active from event_ticket_categories where id = $1`, [cat],
    );
    // Capacity always counted seats, not groups, so nothing about what is on sale changes.
    expect(row).toMatchObject({ name: 'FRIENDS GROUP', capacity: 20, active: true });
  });

  it('strips a stale groupSize from passes already issued, leaving everything else alone', async () => {
    await booking([
      { categoryName: 'GENERAL', ticketNumber: 'GEN-001', status: 'CHECKED_IN', groupSize: 1, admitted: 1 },
      { categoryName: 'VIP', ticketNumber: 'VIP-001', status: 'ISSUED' },
    ]);
    await f.db.exec(DROP());
    const data = await f.val<Record<string, unknown>[]>(
      `select tickets_data from ticket_bookings where id = '11111111-1111-1111-1111-111111111111'`,
    );
    expect(data).toEqual([
      { categoryName: 'GENERAL', ticketNumber: 'GEN-001', status: 'CHECKED_IN', admitted: 1 },
      { categoryName: 'VIP', ticketNumber: 'VIP-001', status: 'ISSUED' },
    ]);
  });

  it('refuses to run at all if a real group pass was ever issued', async () => {
    // The whole point of the guard: somebody's ticket says "admits 5", and dropping the column
    // would quietly turn it into a pass for one. Stop, do not drop.
    await booking([{ categoryName: 'FRIENDS GROUP', ticketNumber: 'GRP-001', status: 'ISSUED', groupSize: 5 }]);
    // exec, not the single-statement helper: this is a whole script, and the point is that the
    // script as a whole refuses.
    let err = '';
    try { await f.db.exec(DROP()); } catch (e) { err = String((e as Error).message); }
    expect(err).toMatch(/GROUP_PASSES_EXIST/);
    // The script opened a transaction and the raise aborted it; close it before asking the
    // database anything else. That the whole thing rolls back is the behaviour being checked.
    await f.db.exec('rollback');
    // And nothing was changed on the way to refusing.
    expect(await f.val<number>(
      `select count(*) from information_schema.columns
        where table_name = 'event_ticket_categories' and column_name = 'group_size'`,
    )).toBe(1);
  });

  it('runs twice without complaining', async () => {
    await f.db.exec(DROP());
    await f.db.exec(DROP());
    expect(await f.val<number>(
      `select count(*) from app_schema_markers where name = 'group_tickets_removed_v1'`,
    )).toBe(1);
  });

  it('leaves the reservation function working, with no group allowance left in it', async () => {
    const cat = await seedCategory(f, { capacity: 10 });
    await f.db.exec(DROP());
    const alloc = await f.val<{ numbers: number[] }[]>(
      `select reserve_order_inventory('r1', null, $1::jsonb, 0, 900, 7, 2) as a`,
      [JSON.stringify([{ categoryId: cat, qty: 2 }])],
    );
    expect(alloc[0].numbers).toEqual([1, 2]);
    // One version. p_max_group survives in the signature as an ignored parameter so a call
    // from the previous deploy still resolves; dropping it is a later migration's job.
    expect(await f.val<number>(
      `select count(*) from pg_proc where proname = 'reserve_order_inventory'`,
    )).toBe(1);
  });
});
