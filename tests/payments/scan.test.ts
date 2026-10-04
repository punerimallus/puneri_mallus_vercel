import { describe, expect, it } from 'vitest';
import { applyScan, lookupTicket, progressOf, ScanTicket } from '@/lib/payments/scan';

const single = (over: Partial<ScanTicket> = {}): ScanTicket => ({ categoryName: 'GENERAL', ticketNumber: 'GEN-001', status: 'ISSUED', ...over });
const group = (size: number, over: Partial<ScanTicket> = {}): ScanTicket => ({ categoryName: 'GROUP', ticketNumber: 'GRP-001', status: 'ISSUED', groupSize: size, ...over });
const now = new Date('2026-10-18T13:00:00Z');

describe('single tickets', () => {
  it('let one person in once', () => {
    const r = applyScan([single()], 'GEN-001', undefined, now);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.ticket.status).toBe('CHECKED_IN');
      expect(r.admittedNow).toBe(1);
      expect(r.progress).toEqual({ groupSize: 1, admitted: 1, remaining: 0 });
    }
  });
  it('are refused the second time', () => {
    const first = applyScan([single()], 'GEN-001', undefined, now);
    if (!first.ok) throw new Error('setup');
    const again = applyScan(first.tickets, 'GEN-001');
    expect(again).toMatchObject({ ok: false, code: 'ALREADY_USED' });
  });
  it('still work for old data that only says CHECKED_IN', () => {
    expect(applyScan([single({ status: 'CHECKED_IN' })], 'GEN-001')).toMatchObject({ ok: false, code: 'ALREADY_USED' });
  });
});

describe('group tickets of any size', () => {
  it.each([2, 5, 6, 7, 12])('admit a whole group of %i on one scan when no count is given', (n) => {
    const r = applyScan([group(n)], 'GRP-001', undefined, now);
    expect(r.ok && r.ticket.status).toBe('CHECKED_IN');
    expect(r.ok && r.admittedNow).toBe(n);
  });

  it('let a group in parts: 3 now, 3 later (group of 6)', () => {
    const a = applyScan([group(6)], 'GRP-001', 3, now);
    if (!a.ok) throw new Error('setup');
    expect(a.ticket.status).toBe('ISSUED'); // still valid for the rest
    expect(a.progress).toEqual({ groupSize: 6, admitted: 3, remaining: 3 });

    const b = applyScan(a.tickets, 'GRP-001', 3, now);
    expect(b.ok && b.ticket.status).toBe('CHECKED_IN');
    expect(b.ok && b.progress.remaining).toBe(0);
  });

  it('lets people trickle in one at a time', () => {
    let tickets = [group(3)];
    for (let i = 1; i <= 3; i++) {
      const r = applyScan(tickets, 'GRP-001', 1, now);
      if (!r.ok) throw new Error(`scan ${i} failed: ${r.message}`);
      tickets = r.tickets;
      expect(r.progress.admitted).toBe(i);
    }
    expect(applyScan(tickets, 'GRP-001', 1)).toMatchObject({ ok: false, code: 'ALREADY_USED' });
  });

  it('refuses more people than are left, and says how many are left', () => {
    const a = applyScan([group(5)], 'GRP-001', 3, now);
    if (!a.ok) throw new Error('setup');
    const r = applyScan(a.tickets, 'GRP-001', 3);
    expect(r).toMatchObject({ ok: false, code: 'TOO_MANY' });
    expect(!r.ok && r.message).toContain('Only 2 of 5');
    expect(!r.ok && r.progress?.remaining).toBe(2);
  });

  it('admits everyone still outside when no count is given after a partial entry', () => {
    const a = applyScan([group(7)], 'GRP-001', 2, now);
    if (!a.ok) throw new Error('setup');
    const rest = applyScan(a.tickets, 'GRP-001');
    expect(rest.ok && rest.admittedNow).toBe(5);
    expect(rest.ok && rest.ticket.status).toBe('CHECKED_IN');
  });

  it('rejects zero, negative, fractional and non-numeric counts', () => {
    for (const bad of [0, -1, 1.5, NaN]) expect(applyScan([group(5)], 'GRP-001', bad)).toMatchObject({ ok: false, code: 'INVALID_COUNT' });
  });

  it('keeps a log of every entry for disputes', () => {
    const a = applyScan([group(5)], 'GRP-001', 2, now);
    if (!a.ok) throw new Error('setup');
    const b = applyScan(a.tickets, 'GRP-001', 3, new Date('2026-10-18T14:00:00Z'));
    expect(b.ok && b.ticket.entries).toEqual([
      { at: '2026-10-18T13:00:00.000Z', count: 2 },
      { at: '2026-10-18T14:00:00.000Z', count: 3 },
    ]);
  });
});

describe('other cases', () => {
  it('rejects a refunded pass, an unknown ticket number, and never changes its input', () => {
    expect(applyScan([single({ status: 'REFUNDED' })], 'GEN-001')).toMatchObject({ ok: false, code: 'REFUNDED' });
    expect(applyScan([single()], 'NOPE-9')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    const original = [group(4)];
    const copy = JSON.stringify(original);
    applyScan(original, 'GRP-001', 2);
    expect(JSON.stringify(original)).toBe(copy);
  });
  it('only touches the scanned pass in a multi-pass booking', () => {
    const tickets = [single({ ticketNumber: 'GEN-001' }), single({ ticketNumber: 'GEN-002' })];
    const r = applyScan(tickets, 'GEN-002');
    expect(r.ok && r.tickets[0].status).toBe('ISSUED');
    expect(r.ok && r.tickets[1].status).toBe('CHECKED_IN');
  });
  it('lookup and progress clamp bad stored numbers', () => {
    expect(lookupTicket([single()], 'X')).toBeNull();
    expect(progressOf({ status: 'ISSUED', groupSize: 5, admitted: 99 })).toEqual({ groupSize: 5, admitted: 5, remaining: 0 });
    expect(progressOf({ status: 'ISSUED', groupSize: 5, admitted: -2 }).admitted).toBe(0);
  });
});
