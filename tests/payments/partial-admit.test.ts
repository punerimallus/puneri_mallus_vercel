import { describe, expect, it } from 'vitest';
import { applyScan, progressOf, type ScanTicket } from '@/lib/payments/scan';
import { partialAdmitAllowed } from '@/lib/payments/staff';

// Letting part of a group in and leaving the rest outside is an admin-only action.
// A volunteer must see the whole group before anyone goes in.

const group = (size: number, admitted = 0): ScanTicket[] => [
  { categoryName: 'FRIENDS GROUP', ticketNumber: 'GRP001', status: admitted >= size ? 'CHECKED_IN' : 'ISSUED', groupSize: size, admitted },
];
const single = (): ScanTicket[] => [{ categoryName: 'GENERAL', ticketNumber: 'GEN001', status: 'ISSUED' }];

const VOLUNTEER = { allowPartial: false };
const ADMIN = { allowPartial: true };

describe('partialAdmitAllowed', () => {
  it('is an admin power only', () => {
    expect(partialAdmitAllowed({ role: 'ADMIN' })).toBe(true);
    expect(partialAdmitAllowed({ role: 'SCANNER' })).toBe(false);
  });
});

describe('a volunteer scanning a group pass', () => {
  it('cannot let in only some of the group', () => {
    const r = applyScan(group(5), 'GRP001', 2, new Date(), VOLUNTEER);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('PARTIAL_NOT_ALLOWED');
      expect(r.message).toMatch(/whole group/i);
    }
  });

  it('cannot let in all but one', () => {
    const r = applyScan(group(5), 'GRP001', 4, new Date(), VOLUNTEER);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('PARTIAL_NOT_ALLOWED');
  });

  it('admits the whole group in one go', () => {
    const r = applyScan(group(5), 'GRP001', 5, new Date(), VOLUNTEER);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.admittedNow).toBe(5);
      expect(r.ticket.status).toBe('CHECKED_IN');
      expect(r.progress.remaining).toBe(0);
    }
  });

  it('admits everyone when no count is given at all', () => {
    // The scanner sends no count for a plain tap; that means "everyone still outside".
    const r = applyScan(group(5), 'GRP001', undefined, new Date(), VOLUNTEER);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.admittedNow).toBe(5);
  });

  it('admits the rest of a group an admin had already split', () => {
    // Two of five were let in earlier by an organiser. The volunteer can still take the other
    // three, because three IS the whole of what is left.
    const r = applyScan(group(5, 2), 'GRP001', 3, new Date(), VOLUNTEER);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.admittedNow).toBe(3);
      expect(r.progress.remaining).toBe(0);
    }
  });

  it('still cannot split what is left of a part-admitted group', () => {
    const r = applyScan(group(5, 2), 'GRP001', 1, new Date(), VOLUNTEER);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('PARTIAL_NOT_ALLOWED');
  });

  it('is unaffected on an ordinary single pass', () => {
    expect(applyScan(single(), 'GEN001', 1, new Date(), VOLUNTEER).ok).toBe(true);
    expect(applyScan(single(), 'GEN001', undefined, new Date(), VOLUNTEER).ok).toBe(true);
  });

  it('changes nothing when it refuses', () => {
    const tickets = group(5);
    const before = structuredClone(tickets);
    applyScan(tickets, 'GRP001', 2, new Date(), VOLUNTEER);
    expect(tickets).toEqual(before);
  });

  it('gets the more useful message first when the count is also wrong', () => {
    // Asking for more than exist is a different mistake; say that, not "come back together".
    const tooMany = applyScan(group(5), 'GRP001', 9, new Date(), VOLUNTEER);
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.code).toBe('TOO_MANY');

    const nonsense = applyScan(group(5), 'GRP001', 0, new Date(), VOLUNTEER);
    expect(nonsense.ok).toBe(false);
    if (!nonsense.ok) expect(nonsense.code).toBe('INVALID_COUNT');
  });

  it('still reports a used pass as used rather than as a partial attempt', () => {
    const r = applyScan(group(5, 5), 'GRP001', 2, new Date(), VOLUNTEER);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('ALREADY_USED');
  });

  it('still reports a refunded pass as refunded', () => {
    const refunded: ScanTicket[] = [{ categoryName: 'G', ticketNumber: 'GRP001', status: 'REFUNDED', groupSize: 5 }];
    const r = applyScan(refunded, 'GRP001', 2, new Date(), VOLUNTEER);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('REFUNDED');
  });
});

describe('an admin scanning the same group pass', () => {
  it('may let part of the group in', () => {
    const r = applyScan(group(5), 'GRP001', 2, new Date(), ADMIN);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.admittedNow).toBe(2);
      expect(r.progress.remaining).toBe(3);
      expect(r.ticket.status).toBe('ISSUED'); // still live for the other three
    }
  });

  it('can split a group across several visits until it is used up', () => {
    let tickets = group(5);
    for (const n of [1, 2, 2]) {
      const r = applyScan(tickets, 'GRP001', n, new Date(), ADMIN);
      expect(r.ok).toBe(true);
      if (r.ok) tickets = r.tickets;
    }
    expect(progressOf(tickets[0])).toMatchObject({ admitted: 5, remaining: 0 });
    expect(tickets[0].status).toBe('CHECKED_IN');
  });
});

describe('the default when nothing is said', () => {
  it('keeps the old behaviour, so existing callers are unchanged', () => {
    // applyScan is called from places that predate roles; they must keep working.
    expect(applyScan(group(5), 'GRP001', 2).ok).toBe(true);
    expect(applyScan(group(5), 'GRP001', 2, new Date()).ok).toBe(true);
    expect(applyScan(group(5), 'GRP001', 2, new Date(), {}).ok).toBe(true);
    expect(applyScan(group(5), 'GRP001', 2, new Date(), { allowPartial: true }).ok).toBe(true);
  });
});
