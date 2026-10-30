import { describe, expect, it } from 'vitest';
import { admissions, admittedBy, type ScanLogRow } from '@/lib/payments/attendance';

// The box office has to be able to answer "who let them in". tickets_data records how many
// went in but never who waved them through; only scan_log knows that.

const scan = (over: Partial<ScanLogRow> = {}): ScanLogRow => ({
  ticket_number: 'GRP001',
  admitted: 1,
  action: 'ADMIT',
  actor_email: 'volunteer@example.com',
  actor_role: 'SCANNER',
  at: '2026-10-30T14:00:00.000Z',
  ...over,
});

describe('admissions', () => {
  it('reads the rows the gate wrote', () => {
    expect(admissions([scan({ admitted: 3, at: '2026-10-30T14:05:00.000Z' })])).toEqual([
      { ticketNumber: 'GRP001', admitted: 3, by: 'volunteer@example.com', role: 'SCANNER', at: '2026-10-30T14:05:00.000Z' },
    ]);
  });

  it('shows a volunteer who signed in by phone as their number', () => {
    // Members sign in with a phone and the gate sees <phone>@punerimallus.com. Printing that
    // ghost address would tell an organiser nothing; the number is who they actually are.
    expect(admissions([scan({ actor_email: '8669865623@punerimallus.com' })])[0].by).toBe('8669865623');
    expect(admissions([scan({ actor_email: '8669865623@PUNERIMALLUS.COM' })])[0].by).toBe('8669865623');
  });

  it('leaves a real email address alone', () => {
    expect(admissions([scan({ actor_email: 'rohitanish86@gmail.com' })])[0].by).toBe('rohitanish86@gmail.com');
  });

  it('puts the newest admission first', () => {
    const rows = [
      scan({ at: '2026-10-30T14:00:00.000Z', actor_email: 'early@x.com' }),
      scan({ at: '2026-10-30T15:00:00.000Z', actor_email: 'late@x.com' }),
    ];
    expect(admissions(rows).map((a) => a.by)).toEqual(['late@x.com', 'early@x.com']);
  });

  it('ignores any row that is not an admission', () => {
    // scan_log is append-only and may grow other action types; none of them mean "let in".
    expect(admissions([scan({ action: 'VOID' }), scan({ action: 'ADMIT' })])).toHaveLength(1);
  });

  it('treats a missing action as an admission, which is what the gate writes', () => {
    expect(admissions([scan({ action: null })])).toHaveLength(1);
  });

  it('does not invent a name when the gate did not record one', () => {
    expect(admissions([scan({ actor_email: null })])[0].by).toBe('Unknown');
    expect(admissions([scan({ actor_email: '' })])[0].by).toBe('Unknown');
  });

  it('marks an unrecognised role rather than guessing admin', () => {
    expect(admissions([scan({ actor_role: null })])[0].role).toBe('UNKNOWN');
    expect(admissions([scan({ actor_role: 'SOMETHING' })])[0].role).toBe('UNKNOWN');
    expect(admissions([scan({ actor_role: 'ADMIN' })])[0].role).toBe('ADMIN');
  });

  it('copes with nothing at all', () => {
    expect(admissions(null)).toEqual([]);
    expect(admissions(undefined)).toEqual([]);
    expect(admissions([])).toEqual([]);
  });

  it('never returns a negative or fractional headcount', () => {
    expect(admissions([scan({ admitted: -3 })])[0].admitted).toBe(0);
    expect(admissions([scan({ admitted: 2.7 })])[0].admitted).toBe(2);
    expect(admissions([scan({ admitted: null })])[0].admitted).toBe(0);
  });
});

describe('admittedBy', () => {
  it('totals what each person let in', () => {
    const rows = [
      scan({ admitted: 2, actor_email: 'anna@x.com', at: '2026-10-30T14:00:00.000Z' }),
      scan({ admitted: 3, actor_email: 'anna@x.com', at: '2026-10-30T14:30:00.000Z' }),
    ];
    expect(admittedBy(rows)).toEqual([
      { by: 'anna@x.com', role: 'SCANNER', admitted: 5, at: '2026-10-30T14:30:00.000Z' },
    ]);
  });

  it('names every person who worked one booking', () => {
    // A group that trickled in past two volunteers is exactly the case that settles a dispute.
    const rows = [
      scan({ admitted: 2, actor_email: 'anna@x.com', at: '2026-10-30T14:00:00.000Z' }),
      scan({ admitted: 3, actor_email: 'bob@x.com', at: '2026-10-30T16:00:00.000Z', actor_role: 'ADMIN' }),
    ];
    const out = admittedBy(rows);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ by: 'bob@x.com', role: 'ADMIN', admitted: 3 });   // newest first
    expect(out[1]).toMatchObject({ by: 'anna@x.com', role: 'SCANNER', admitted: 2 });
  });

  it('keeps each person at their most recent scan time', () => {
    const rows = [
      scan({ actor_email: 'anna@x.com', at: '2026-10-30T14:00:00.000Z' }),
      scan({ actor_email: 'anna@x.com', at: '2026-10-30T18:00:00.000Z' }),
    ];
    expect(admittedBy(rows)[0].at).toBe('2026-10-30T18:00:00.000Z');
  });

  it('is empty for a booking nobody has scanned', () => {
    expect(admittedBy([])).toEqual([]);
    expect(admittedBy(null)).toEqual([]);
  });

  it('handles the shape the live scan_log actually holds', () => {
    // Copied from production: booking 0ab8e020 was worked by a volunteer signed in by phone
    // and by an admin signed in by email — the mixed case, in the real column shape.
    const rows: ScanLogRow[] = [
      { booking_id: '0ab8e020', ticket_number: 'GEN-002', admitted: 1, action: 'ADMIT', actor_email: '9307658864@punerimallus.com', actor_role: 'SCANNER', at: '2026-10-28 09:55:25.274327+00' } as ScanLogRow,
      { booking_id: '0ab8e020', ticket_number: 'GEN-001', admitted: 1, action: 'ADMIT', actor_email: 'rohitanish86@gmail.com', actor_role: 'ADMIN', at: '2026-10-28 09:49:51.7331+00' } as ScanLogRow,
    ];
    expect(admittedBy(rows)).toEqual([
      { by: '9307658864', role: 'SCANNER', admitted: 1, at: '2026-10-28 09:55:25.274327+00' },
      { by: 'rohitanish86@gmail.com', role: 'ADMIN', admitted: 1, at: '2026-10-28 09:49:51.7331+00' },
    ]);
  });

  it('sorts Postgres timestamps, not just ISO strings', () => {
    // Supabase returns "2026-10-28 09:55:25.274327+00", not the ISO "T" form. Sorting is
    // lexicographic, so a mix of the two shapes would order wrongly — keep both covered.
    const rows: ScanLogRow[] = [
      scan({ actor_email: 'early@x.com', at: '2026-10-28 09:00:00+00' }),
      scan({ actor_email: 'late@x.com', at: '2026-10-28 21:00:00+00' }),
    ];
    expect(admittedBy(rows).map((r) => r.by)).toEqual(['late@x.com', 'early@x.com']);
  });

  it('groups two people who scanned under the same phone as one', () => {
    const rows = [
      scan({ admitted: 1, actor_email: '8669865623@punerimallus.com', at: '2026-10-30T14:00:00.000Z' }),
      scan({ admitted: 1, actor_email: '8669865623@punerimallus.com', at: '2026-10-30T14:01:00.000Z' }),
    ];
    expect(admittedBy(rows)).toEqual([{ by: '8669865623', role: 'SCANNER', admitted: 2, at: '2026-10-30T14:01:00.000Z' }]);
  });
});
