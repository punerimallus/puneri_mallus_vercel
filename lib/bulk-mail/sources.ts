import { normalizeRecipients, Recipient } from './recipients';

/** Pulls every usable email out of the given columns of a table's rows. No names: a "name" column in an
 *  arbitrary table might be a team or business, and "Hi Sample FC" is worse than "Hi there". */
export function emailsFromRows(rows: Record<string, unknown>[], columns: string[]): Recipient[] {
  const raw: Recipient[] = [];
  for (const row of rows) {
    for (const col of columns) {
      const v = row?.[col];
      if (typeof v === 'string' && v.includes('@')) raw.push({ email: v, name: '' });
    }
  }
  return normalizeRecipients(raw);
}

const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;

/** Groups the email_sources() rows by table, dropping anything that isn't a plain identifier. */
export function groupSources(rows: { table_name: string; column_name: string }[]): { table: string; columns: string[] }[] {
  const by = new Map<string, string[]>();
  for (const r of rows || []) {
    if (!IDENT.test(r.table_name) || !IDENT.test(r.column_name)) continue;
    by.set(r.table_name, [...(by.get(r.table_name) || []), r.column_name]);
  }
  return [...by.entries()].map(([table, columns]) => ({ table, columns }));
}
