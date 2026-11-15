// Every column the application asks for has to exist.
//
// Written after a check-in endpoint asked ticket_bookings for `full_name` — a column that lives
// on profiles, not on the booking. PostgREST answers that with an error rather than ignoring
// it, so every single check-in failed with "Could not read the booking". The pure logic was
// covered by tests; the query was not, because nothing executes a route's Supabase call.
//
// This reads the select lists straight out of the source and checks each name against the real
// schema, built from the baseline plus every migration. It cannot catch a wrong filter or a bad
// join, but it catches a column that is simply not there, which is the mistake that actually
// happened and the one no amount of unit testing would have found.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { freshDb, type Fixture } from './pg';

const ROOT = join(import.meta.dirname ?? __dirname, '..', '..');

/** The tables worth policing: the ticketing ones, where a wrong name breaks a sale or a gate. */
const TABLES = [
  'ticket_bookings', 'ticket_numbers', 'event_ticket_categories', 'payment_orders',
  'inventory_reservations', 'scan_log', 'coupons', 'coupon_redemptions', 'ticket_bundles',
  'event_staff', 'comp_grants',
];

/** Source files to read. Routes and the server helpers — everything that talks to Supabase. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      sourceFiles(path, out);
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      out.push(path);
    }
  }
  return out;
}

interface Selection { file: string; table: string; columns: string[] }

/**
 * Every `.from('<table>')…​.select('<list>')` pair in one file.
 *
 * Deliberately simple: it matches a from() and the FIRST select() that follows it within a few
 * lines, which is how every call in this codebase is written. Anything it cannot read with
 * confidence — `*`, a nested `profiles(...)` join, a template literal — is skipped rather than
 * guessed at, because a false failure here would be worse than a missed one.
 */
function selectionsIn(file: string): Selection[] {
  const src = readFileSync(file, 'utf8');
  const out: Selection[] = [];
  const from = /\.from\(\s*'([a-z_]+)'\s*\)([\s\S]{0,400}?)\.select\(\s*'([^']*)'\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = from.exec(src)) !== null) {
    const [, table, between, list] = m;
    if (!TABLES.includes(table)) continue;
    // A second .from() in between means these two are not a pair.
    if (between.includes('.from(')) continue;
    if (list.trim() === '*' || list.includes('(')) continue;
    const columns = list.split(',').map((c) => c.trim()).filter(Boolean);
    if (columns.length) out.push({ file: file.slice(ROOT.length + 1).replace(/\\/g, '/'), table, columns });
  }
  return out;
}

let f: Fixture;
let real: Map<string, Set<string>>;

beforeAll(async () => {
  f = await freshDb();
  // The ticketing migrations, in order. Not the whole folder: some of the older ones build on
  // tables the baseline does not carry (the directory, the mart), and this check is about the
  // ticketing tables.
  for (const name of [
    '20261106_comp_passes.sql',
    '20261107_access_pass.sql',
    '20261114_coupons.sql',
    '20261115_ticket_bundles.sql',
    '20261116_drop_group_tickets.sql',
    '20261117_bundle_sold_counter.sql',
  ]) {
    await f.db.exec(readFileSync(join(ROOT, 'supabase', 'migrations', name), 'utf8'));
  }
  const rows = await f.all<{ table_name: string; column_name: string }>(
    `select table_name, column_name from information_schema.columns where table_schema = 'public'`,
  );
  real = new Map();
  for (const r of rows) {
    if (!real.has(r.table_name)) real.set(r.table_name, new Set());
    real.get(r.table_name)!.add(r.column_name);
  }
}, 120_000);

afterAll(async () => { await f?.close(); });

describe('every column the code selects exists', () => {
  const files = [
    ...sourceFiles(join(ROOT, 'app', 'api')),
    ...sourceFiles(join(ROOT, 'lib')),
  ];
  const selections = files.flatMap(selectionsIn);

  it('found select lists to check at all', () => {
    // If the matcher ever stops matching, this test must fail loudly rather than pass vacuously.
    expect(selections.length).toBeGreaterThan(15);
  });

  it('names only real columns', () => {
    const wrong: string[] = [];
    for (const s of selections) {
      const columns = real.get(s.table);
      if (!columns) continue; // a table this schema does not have is another test's problem
      for (const c of s.columns) {
        if (!columns.has(c)) wrong.push(`${s.file}: ${s.table}.${c}`);
      }
    }
    // The failure prints the file and the column, which is the whole message needed to fix it.
    expect(wrong).toEqual([]);
  });

  it('would have caught the check-in bug', () => {
    // The exact mistake, as a sanity check on the checker itself.
    expect(real.get('ticket_bookings')!.has('full_name')).toBe(false);
    expect(real.get('ticket_bookings')!.has('tickets_data')).toBe(true);
    expect(real.get('ticket_bookings')!.has('scan_version')).toBe(true);
  });
});
