// Checking somebody in from the box office, with no QR.
//
// The case: the pass never arrived, the phone is flat, the screenshot is of somebody else's
// ticket. The alternative an organiser is left with is waving them through unrecorded — and an
// unrecorded entry is worse than no gate at all, because the pass still reads valid afterwards
// and whoever turns up with it next gets in on it too.
//
// Two things have to hold for it to be worth having:
//   * it counts people the same way the gate does, group passes included
//   * it is recorded, attributed, and distinguishable from a real scan afterwards

import { describe, expect, it } from 'vitest';
import { admitEveryone, applyScan, progressOf, seatRangeLabel, type ScanTicket } from '@/lib/payments/scan';
import { admissions, admittedBy, bookingAttendance } from '@/lib/payments/attendance';

const pass = (n: string, over: Partial<ScanTicket> = {}): ScanTicket => ({
  categoryName: 'PREMIUM ARENA (STANDING)', ticketNumber: n, status: 'ISSUED', ...over,
});

/** The booking in the report: two singles, neither of them arrived. */
const pratiksha = [pass('PREMIUM-018'), pass('PREMIUM-019')];

describe('checking in a whole booking at once', () => {
  it('admits everyone still outside', () => {
    const r = admitEveryone(pratiksha);
    expect(r.admittedNow).toBe(2);
    expect(r.admitted).toEqual([
      { ticketNumber: 'PREMIUM-018', count: 1 },
      { ticketNumber: 'PREMIUM-019', count: 1 },
    ]);
    expect(r.tickets.every((t) => t.status === 'CHECKED_IN')).toBe(true);
  });

  it('leaves the booking reading fully in', () => {
    const after = bookingAttendance(admitEveryone(pratiksha).tickets);
    expect(after.state).toBe('ALL_IN');
    expect(after.admitted).toBe(2);
    expect(after.remaining).toBe(0);
  });

  it('never changes what it was given', () => {
    const before = JSON.stringify(pratiksha);
    admitEveryone(pratiksha);
    expect(JSON.stringify(pratiksha)).toBe(before);
  });

  it('skips a pass already scanned at the door instead of refusing the rest', () => {
    // Half the party came in on their own QR ten minutes ago. "Let the rest in" has to mean the
    // rest, not an error about the one that worked.
    const mixed = [pass('PREMIUM-018', { status: 'CHECKED_IN' }), pass('PREMIUM-019')];
    const r = admitEveryone(mixed);
    expect(r.admitted).toEqual([{ ticketNumber: 'PREMIUM-019', count: 1 }]);
    expect(r.admittedNow).toBe(1);
  });

  it('skips a voided pass', () => {
    const r = admitEveryone([pass('PREMIUM-018', { status: 'REFUNDED' }), pass('PREMIUM-019')]);
    expect(r.admitted).toHaveLength(1);
    expect(r.tickets[0].status).toBe('REFUNDED');
  });

  it('admits nobody, and says so by admitting nobody, when all are already in', () => {
    // The route turns an empty result into "Everyone on this booking is already inside."
    const r = admitEveryone(pratiksha.map((t) => ({ ...t, status: 'CHECKED_IN' as const })));
    expect(r.admitted).toEqual([]);
    expect(r.admittedNow).toBe(0);
  });

  it('counts a group pass by people, not by passes', () => {
    // One QR for eight, exactly as the gate counts it.
    const group = [pass('REGULAR-053', { groupSize: 8 }), pass('REGULAR-061')];
    const r = admitEveryone(group);
    expect(r.admittedNow).toBe(9);
    expect(r.admitted[0]).toEqual({ ticketNumber: 'REGULAR-053', count: 8 });
  });

  it('brings in the rest of a half-admitted group', () => {
    const half = [pass('REGULAR-053', { groupSize: 8, admitted: 3 })];
    const r = admitEveryone(half);
    expect(r.admittedNow).toBe(5);
    expect(progressOf(r.tickets[0])).toEqual({ groupSize: 8, admitted: 8, remaining: 0 });
  });

  it('copes with a booking that has no passes at all', () => {
    expect(admitEveryone([])).toEqual({ tickets: [], admitted: [], admittedNow: 0 });
  });
});

describe('checking in one pass by hand', () => {
  // The route calls applyScan directly for this, with allowPartial — an admin in front of the
  // guest is exactly who may split a group.
  it('admits part of a group and leaves the pass live for the rest', () => {
    const r = applyScan([pass('REGULAR-053', { groupSize: 8 })], 'REGULAR-053', 3, new Date(), { allowPartial: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.admittedNow).toBe(3);
    expect(r.ticket.status).toBe('ISSUED');
    expect(r.progress.remaining).toBe(5);
  });

  it('refuses more people than the pass has left', () => {
    const r = applyScan([pass('REGULAR-053', { groupSize: 8, admitted: 6 })], 'REGULAR-053', 3, new Date(), { allowPartial: true });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('TOO_MANY');
  });

  it('refuses a pass that is already fully in', () => {
    const r = applyScan([pass('PREMIUM-018', { status: 'CHECKED_IN' })], 'PREMIUM-018', undefined, new Date(), { allowPartial: true });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('ALREADY_USED');
  });

  it('refuses a voided pass', () => {
    const r = applyScan([pass('PREMIUM-018', { status: 'REFUNDED' })], 'PREMIUM-018', undefined, new Date(), { allowPartial: true });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('REFUNDED');
  });

  it('refuses a pass number that is not on this booking', () => {
    const r = applyScan(pratiksha, 'PREMIUM-999', undefined, new Date(), { allowPartial: true });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('NOT_FOUND');
  });
});

describe('the record it leaves', () => {
  const scanned = {
    ticket_number: 'PREMIUM-018', admitted: 1, action: 'ADMIT',
    actor_email: '9876543210@punerimallus.com', actor_role: 'SCANNER', at: '2026-11-15T14:00:00.000Z',
  };
  const byHand = {
    ticket_number: 'PREMIUM-019', admitted: 1, action: 'MANUAL',
    actor_email: 'organiser@punerimallus.com', actor_role: 'ADMIN', at: '2026-11-15T14:05:00.000Z',
  };

  it('counts a hand check-in as an admission', () => {
    // It has to. A manual entry that did not count would leave the door numbers understating
    // how many people are actually in the room, which is the one number the night turns on.
    expect(admissions([byHand])).toHaveLength(1);
    expect(admissions([byHand])[0].admitted).toBe(1);
  });

  it('marks it as by hand, so it is not mistaken for a scan', () => {
    expect(admissions([byHand])[0].manual).toBe(true);
    expect(admissions([scanned])[0].manual).toBe(false);
  });

  it('names whoever did it, the same way a scan does', () => {
    const [entry] = admissions([byHand]);
    expect(entry.by).toBe('organiser@punerimallus.com');
    expect(entry.role).toBe('ADMIN');
  });

  it('still ignores a void, which is not an admission', () => {
    const voided = { ticket_number: 'PREMIUM-018', admitted: 0, action: 'VOID', actor_role: 'ADMIN', at: '2026-11-15T15:00:00.000Z' };
    expect(admissions([voided])).toEqual([]);
  });

  it('ignores an action nobody has invented yet', () => {
    expect(admissions([{ ...byHand, action: 'SOMETHING_NEW' }])).toEqual([]);
  });

  it('shows both the scanner and the organiser against one booking', () => {
    const who = admittedBy([scanned, byHand]);
    expect(who).toHaveLength(2);
    expect(who.map((w) => w.by)).toContain('9876543210'); // ghost gate address reads as a phone
    expect(who.find((w) => w.role === 'ADMIN')?.manual).toBe(true);
    expect(who.find((w) => w.role === 'SCANNER')?.manual).toBe(false);
  });

  it('flags a person who scanned some and waved the rest in', () => {
    // The flag is there to prompt a second look, so a later scan must not wash it out.
    const same = (over: Record<string, unknown>) => ({ ...byHand, ...over });
    const who = admittedBy([
      same({ action: 'MANUAL', at: '2026-11-15T14:00:00.000Z' }),
      same({ action: 'ADMIT', at: '2026-11-15T14:30:00.000Z' }),
    ]);
    expect(who).toHaveLength(1);
    expect(who[0].admitted).toBe(2);
    expect(who[0].manual).toBe(true);
  });
});

describe('the seats a group pass stands for', () => {
  it('reads as a range when they are consecutive, which is the usual case', () => {
    expect(seatRangeLabel(['REGULAR-055', 'REGULAR-056', 'REGULAR-057', 'REGULAR-058', 'REGULAR-059']))
      .toBe('REGULAR-055 – REGULAR-059');
  });

  it('is sorted, however the allocator handed them over', () => {
    expect(seatRangeLabel(['REGULAR-057', 'REGULAR-055', 'REGULAR-056'])).toBe('REGULAR-055 – REGULAR-057');
  });

  it('never claims a seat the buyer does not hold', () => {
    // The allocator takes the lowest FREE numbers, so after a void a group can hold seats with
    // a gap. Printing "055 – 061" there would name two seats somebody else is sitting in.
    expect(seatRangeLabel(['REGULAR-055', 'REGULAR-056', 'REGULAR-057', 'REGULAR-061']))
      .toBe('REGULAR-055 – REGULAR-057, REGULAR-061');
  });

  it('handles two separate pairs', () => {
    expect(seatRangeLabel(['GA-001', 'GA-002', 'GA-009', 'GA-010'])).toBe('GA-001 – GA-002, GA-009 – GA-010');
  });

  it('says nothing for a pass that is one seat', () => {
    expect(seatRangeLabel(['REGULAR-055'])).toBeNull();
    expect(seatRangeLabel([])).toBeNull();
    expect(seatRangeLabel(undefined)).toBeNull();
    // Every pass issued before the seats were recorded.
    expect(seatRangeLabel(null)).toBeNull();
  });

  it('lists anything it cannot read rather than guessing at a range', () => {
    expect(seatRangeLabel(['ODD', 'ALSO-ODD'])).toBe('ODD, ALSO-ODD');
  });

  it('does not merge across different categories', () => {
    expect(seatRangeLabel(['GA-001', 'VIP-002'])).toBe('GA-001, VIP-002');
  });
});

describe('the compact form, for a chip in a crowded table', () => {
  const seats = ['REGULAR-053', 'REGULAR-054', 'REGULAR-055', 'REGULAR-056', 'REGULAR-057'];

  it('says the prefix once', () => {
    expect(seatRangeLabel(seats, { compact: true })).toBe('REGULAR-053 – 057');
  });

  it('is the same information as the long form', () => {
    expect(seatRangeLabel(seats)).toBe('REGULAR-053 – REGULAR-057');
  });

  it('keeps every run readable when a void left a gap', () => {
    expect(seatRangeLabel(['REGULAR-053', 'REGULAR-054', 'REGULAR-057'], { compact: true }))
      .toBe('REGULAR-053 – 054, 057');
  });

  it('never shortens across two different categories, which would be ambiguous', () => {
    expect(seatRangeLabel(['GA-001', 'VIP-002'], { compact: true })).toBe('GA-001, VIP-002');
  });

  it('leaves a single seat alone', () => {
    expect(seatRangeLabel(['REGULAR-053'], { compact: true })).toBeNull();
  });
});
