// Filtering the purchaser ledger by ticket type.
//
// The rule that needs pinning is the one that is easy to get wrong: a booking is not "a REGULAR
// booking". One order can hold two REGULAR and a VIP, and that person has to appear under both
// — they are standing at the door with both passes.

import { describe, expect, it } from 'vitest';
import { ALL_TYPES, bookingTypes, ledgerTypeCounts, matchesType } from '@/lib/payments/ledger';

const booking = (...names: string[]) => ({
  tickets_data: names.map((categoryName, i) => ({ categoryName, ticketNumber: `T-${i}`, status: 'ISSUED' })),
});

describe('which types a booking holds', () => {
  it('lists the one type on a simple booking', () => {
    expect(bookingTypes(booking('REGULAR (STANDING)'))).toEqual(['REGULAR (STANDING)']);
  });

  it('lists every type on a mixed order, once each', () => {
    expect(bookingTypes(booking('REGULAR (STANDING)', 'REGULAR (STANDING)', 'VIP (SEATING)')))
      .toEqual(['REGULAR (STANDING)', 'VIP (SEATING)']);
  });

  it('keeps a voided pass, so a refunded VIP is still findable', () => {
    const b = { tickets_data: [{ categoryName: 'VIP (SEATING)', status: 'REFUNDED' }] };
    expect(bookingTypes(b)).toEqual(['VIP (SEATING)']);
  });

  it('is empty rather than throwing for a booking with nothing on it', () => {
    expect(bookingTypes({ tickets_data: [] })).toEqual([]);
    expect(bookingTypes({ tickets_data: null })).toEqual([]);
    expect(bookingTypes({})).toEqual([]);
    expect(bookingTypes(null)).toEqual([]);
  });

  it('ignores a pass with no category name on it', () => {
    const b = { tickets_data: [{ categoryName: '  ' }, { categoryName: 'FAN PIT' }, {}] };
    expect(bookingTypes(b)).toEqual(['FAN PIT']);
  });
});

describe('matchesType', () => {
  it('shows a mixed order under each of its types', () => {
    const mixed = booking('REGULAR (STANDING)', 'VIP (SEATING)');
    expect(matchesType(mixed, 'REGULAR (STANDING)')).toBe(true);
    expect(matchesType(mixed, 'VIP (SEATING)')).toBe(true);
    expect(matchesType(mixed, 'FAN PIT')).toBe(false);
  });

  it('lets everything through when no type is chosen', () => {
    expect(matchesType(booking('FAN PIT'), ALL_TYPES)).toBe(true);
    expect(matchesType(booking('FAN PIT'), '')).toBe(true);
    // Even a booking with no passes at all, which should not vanish from the unfiltered view.
    expect(matchesType({ tickets_data: [] }, ALL_TYPES)).toBe(true);
  });

  it('does not care about case, so a renamed category still matches', () => {
    expect(matchesType(booking('Regular (Standing)'), 'REGULAR (STANDING)')).toBe(true);
  });

  it('excludes a booking holding nothing of that type', () => {
    expect(matchesType({ tickets_data: [] }, 'REGULAR (STANDING)')).toBe(false);
    expect(matchesType(null, 'REGULAR (STANDING)')).toBe(false);
  });
});

describe('the chip counts', () => {
  const bookings = [
    booking('REGULAR (STANDING)', 'REGULAR (STANDING)'),
    booking('REGULAR (STANDING)'),
    booking('FAN PIT', 'REGULAR (STANDING)'),
    booking('FAN PIT'),
  ];

  it('counts bookings, not passes, so the chip matches the rows it opens', () => {
    // Four passes of REGULAR exist across three bookings. Pressing the chip shows three rows,
    // so the chip has to read three — a chip reading 4 that opens 3 rows is a bug report.
    const counts = ledgerTypeCounts(bookings, []);
    expect(counts.find((c) => c.name === 'REGULAR (STANDING)')?.count).toBe(3);
    expect(counts.find((c) => c.name === 'FAN PIT')?.count).toBe(2);
  });

  it('agrees with the filter it drives, for every type', () => {
    // The property that matters, checked rather than assumed.
    for (const { name, count } of ledgerTypeCounts(bookings, [])) {
      expect(bookings.filter((b) => matchesType(b, name)), name).toHaveLength(count);
    }
  });

  it('shows a configured type with no sales yet, reading zero', () => {
    // Otherwise the chips rearrange themselves as the night goes on, which is disorienting
    // when you are looking for the same button twice in a row.
    const counts = ledgerTypeCounts(bookings, [{ name: 'VIP (SEATING)' }, { name: 'FAN PIT' }]);
    expect(counts.find((c) => c.name === 'VIP (SEATING)')?.count).toBe(0);
  });

  it('still lists a type that only exists on old bookings', () => {
    // A category since renamed or deleted. Without this those rows are unreachable from the
    // filter, because no chip would ever select them.
    const counts = ledgerTypeCounts([booking('EARLY BIRD')], [{ name: 'REGULAR (STANDING)' }]);
    expect(counts.map((c) => c.name).sort()).toEqual(['EARLY BIRD', 'REGULAR (STANDING)']);
  });

  it('puts the busiest type first', () => {
    expect(ledgerTypeCounts(bookings, []).map((c) => c.name)).toEqual(['REGULAR (STANDING)', 'FAN PIT']);
  });

  it('is empty for an event with no bookings and no categories', () => {
    expect(ledgerTypeCounts([], [])).toEqual([]);
    expect(ledgerTypeCounts(null, null)).toEqual([]);
  });

  it('survives whatever shape the dashboard hands it', () => {
    expect(ledgerTypeCounts([null, undefined, {}] as any, [{ name: null }, {}] as any)).toEqual([]);
  });
});
