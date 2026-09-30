import { describe, it, expect } from 'vitest';
import { emailsFromRows, groupSources } from '@/lib/bulk-mail/sources';

describe('emailsFromRows', () => {
  it('collects valid addresses from every listed column, de-duplicated and lower-cased', () => {
    const rows = [
      { receipt_email: 'A@x.com', other: 'ignored@x.com' },
      { receipt_email: 'a@x.com', backup_email: 'b@x.com' },
      { receipt_email: null, backup_email: 'not an email' },
      { receipt_email: '919876543210@punerimallus.com' },
    ];
    expect(emailsFromRows(rows, ['receipt_email', 'backup_email']).map((r) => r.email)).toEqual(['a@x.com', 'b@x.com']);
  });
  it('attaches no names', () => {
    expect(emailsFromRows([{ email: 'a@x.com', name: 'Sample FC' }], ['email'])[0].name).toBe('');
  });
});

describe('groupSources', () => {
  it('groups columns by table and ignores unsafe identifiers', () => {
    const out = groupSources([
      { table_name: 'ticket_bookings', column_name: 'email' },
      { table_name: 'payment_orders', column_name: 'receipt_email' },
      { table_name: 'ticket_bookings', column_name: 'alt_email' },
      { table_name: 'bad; drop table x', column_name: 'email' },
      { table_name: 'ok', column_name: 'e"mail' },
    ]);
    expect(out).toEqual([
      { table: 'ticket_bookings', columns: ['email', 'alt_email'] },
      { table: 'payment_orders', columns: ['receipt_email'] },
    ]);
  });
});
