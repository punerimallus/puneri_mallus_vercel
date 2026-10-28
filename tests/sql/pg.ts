// A throwaway in-process Postgres (PGlite — real PostgreSQL compiled to WASM) with the
// production baseline schema and the ticketing migration applied, so the migration and its
// plpgsql functions are executed for real in tests instead of being reviewed by eye.

import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname ?? __dirname, '..', '..');

export const MIGRATION = join(ROOT, 'supabase', 'migrations', '20261028_ticketing_integrity.sql');
const BASELINE = join(ROOT, 'tests', 'sql', 'baseline.sql');

export interface Fixture {
  db: PGlite;
  /** One row, or undefined. */
  one<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** A single scalar from the first column of the first row. */
  val<T = unknown>(sql: string, params?: unknown[]): Promise<T>;
  /** Runs SQL expecting it to raise, and returns the Postgres error message. */
  fails(sql: string, params?: unknown[]): Promise<string>;
  close(): Promise<void>;
}

/**
 * `beforeMigration` runs against the baseline schema only — use it to plant legacy rows the
 * migration then has to cope with (old bookings, refunded passes, duplicate numbers).
 */
export async function freshDb(beforeMigration?: (f: Omit<Fixture, 'close'>) => Promise<void>): Promise<Fixture> {
  const db = await PGlite.create();

  const f: Fixture = {
    db,
    async all<T>(sql: string, params: unknown[] = []) {
      const res = await db.query<T>(sql, params);
      return res.rows;
    },
    async one<T>(sql: string, params: unknown[] = []) {
      const rows = await f.all<T>(sql, params);
      return rows[0];
    },
    async val<T>(sql: string, params: unknown[] = []) {
      const row = (await f.all<Record<string, unknown>>(sql, params))[0];
      const v = row ? Object.values(row)[0] : undefined;
      // count(*) comes back as bigint; tests read better comparing plain numbers.
      return (typeof v === 'bigint' ? Number(v) : v) as T;
    },
    async fails(sql: string, params: unknown[] = []) {
      try {
        await db.query(sql, params);
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
      throw new Error(`expected this to raise, but it succeeded: ${sql}`);
    },
    async close() {
      await db.close();
    },
  };

  await db.exec(readFileSync(BASELINE, 'utf8'));
  if (beforeMigration) await beforeMigration(f);
  await db.exec(readFileSync(MIGRATION, 'utf8'));
  return f;
}

/** A buyer with a loyalty balance. */
export async function seedUser(f: Omit<Fixture, 'close'>, points = 0): Promise<string> {
  const id = await f.val<string>(
    'insert into profiles (id, email, loyalty_points) values (gen_random_uuid(), $1, $2) returning id',
    [`buyer-${Math.random().toString(36).slice(2)}@example.com`, points],
  );
  return id;
}

/** A ticket category. `capacity` null means unlimited. */
export async function seedCategory(
  f: Omit<Fixture, 'close'>,
  opts: { eventId?: string; name?: string; prefix?: string; capacity?: number | null; groupSize?: number; price?: number } = {},
): Promise<string> {
  const prefix = opts.prefix ?? `P${Math.random().toString(36).slice(2, 6).toUpperCase()}-`;
  return f.val<string>(
    `insert into event_ticket_categories (event_id, name, prefix, price, capacity, group_size)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [opts.eventId ?? 'evt_test', opts.name ?? `CAT ${prefix}`, prefix, opts.price ?? 500, opts.capacity ?? null, opts.groupSize ?? 1],
  );
}

export const items = (pairs: [string, number][]) =>
  JSON.stringify(pairs.map(([categoryId, qty]) => ({ categoryId, qty })));
