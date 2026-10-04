import { describe, expect, it } from 'vitest';
import { eventDay, eventStart, salesStatus } from '@/lib/events/sales';

describe('event start (Pune time)', () => {
  it('reads the stored text in IST regardless of server timezone', () => {
    expect(eventStart('OCT 18, 2026', '6:00 PM')?.toISOString()).toBe('2026-10-18T12:30:00.000Z');
    expect(eventStart('JAN 9, 2027', '05:00 PM')?.toISOString()).toBe('2027-01-09T11:30:00.000Z');
    expect(eventStart('Dec 5, 2026', '12:00 AM')?.toISOString()).toBe('2026-12-04T18:30:00.000Z');
    expect(eventStart('Dec 5, 2026', '12:00 PM')?.toISOString()).toBe('2026-12-05T06:30:00.000Z');
    expect(eventStart('Dec 5, 2026', '18:15')?.toISOString()).toBe('2026-12-05T12:45:00.000Z');
  });
  it('treats a missing time as start of day and rejects unreadable dates', () => {
    expect(eventStart('Dec 5, 2026', '')?.toISOString()).toBe('2026-12-04T18:30:00.000Z');
    for (const bad of ['', undefined, 'soon', 'FEB 31, 2026', 'Diwali weekend']) expect(eventStart(bad as any, '6:00 PM')).toBeNull();
  });
});

describe('sales status', () => {
  const at = (iso: string) => new Date(iso);
  it('is open until the event starts, then closed', () => {
    expect(salesStatus('OCT 18, 2026', '6:00 PM', at('2026-10-18T12:29:00Z'))).toBe('OPEN');
    expect(salesStatus('OCT 18, 2026', '6:00 PM', at('2026-10-18T12:31:00Z'))).toBe('CLOSED');
    expect(salesStatus('OCT 18, 2026', '6:00 PM', at('2027-01-01T00:00:00Z'))).toBe('CLOSED');
  });
  it('never blocks sales for a date it cannot read', () => {
    expect(salesStatus('TBA', '6:00 PM')).toBe('UNKNOWN');
  });
});

describe('event day for gate staff', () => {
  it('compares by calendar day in India', () => {
    expect(eventDay('OCT 18, 2026', new Date('2026-10-18T02:00:00Z'))).toBe('TODAY');
    expect(eventDay('OCT 18, 2026', new Date('2026-10-18T19:00:00Z'))).toBe('PAST'); // already 19 Oct, 12:30am in Pune
    expect(eventDay('OCT 18, 2026', new Date('2026-10-17T10:00:00Z'))).toBe('FUTURE');
    expect(eventDay('nonsense')).toBe('UNKNOWN');
  });
});
