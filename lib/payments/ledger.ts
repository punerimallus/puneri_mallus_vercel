// Filtering the purchaser ledger in the box office by ticket type.
//
// The thing that makes this less obvious than it looks: a booking is not "a REGULAR booking".
// One person can buy two REGULAR and a VIP on one order, so a booking belongs to every type it
// contains. Filtering by REGULAR has to show that person — they are standing at the door with a
// REGULAR pass in their hand — and so does filtering by VIP.

export interface LedgerPass {
  categoryName?: string | null;
  status?: string | null;
}

export interface LedgerBooking {
  tickets_data?: LedgerPass[] | null;
  status?: string | null;
}

/** The filter value meaning "do not filter by type at all". */
export const ALL_TYPES = 'ALL';

const passesOf = (booking: LedgerBooking | null | undefined): LedgerPass[] =>
  Array.isArray(booking?.tickets_data) ? booking!.tickets_data! : [];

const nameOf = (pass: LedgerPass): string => String(pass?.categoryName ?? '').trim();

/**
 * Every ticket type this booking contains, including voided passes.
 *
 * Voided ones are deliberately kept: somebody looking for "who had a VIP" after a refund still
 * needs to find them, and the row shows the pass as refunded anyway. Counting is a separate
 * question and excludes them - see ledgerTypeCounts.
 */
export function bookingTypes(booking: LedgerBooking | null | undefined): string[] {
  return [...new Set(passesOf(booking).map(nameOf).filter((n) => n.length > 0))];
}

/** Does this booking belong under the chosen ticket type? */
export function matchesType(booking: LedgerBooking | null | undefined, type: string): boolean {
  if (!type || type === ALL_TYPES) return true;
  return bookingTypes(booking).some((name) => name.toLowerCase() === type.toLowerCase());
}

/**
 * The chips to show, and how many bookings each one would reveal.
 *
 * The count is BOOKINGS, not passes, because the number on a chip has to be the number of rows
 * you get when you press it. Passes sold per type are already on the stock table above, and a
 * chip reading 50 that opens 25 rows is a bug report waiting to happen.
 *
 * `configured` seeds the list from the event's categories so a type with no sales yet still
 * appears, reading zero, rather than the chips rearranging themselves as the night goes on.
 */
export function ledgerTypeCounts(
  bookings: LedgerBooking[] | null | undefined,
  configured: { name?: string | null }[] | null | undefined = [],
): { name: string; count: number }[] {
  const rows = Array.isArray(bookings) ? bookings : [];
  const counts = new Map<string, number>();

  for (const category of Array.isArray(configured) ? configured : []) {
    const name = String(category?.name ?? '').trim();
    if (name) counts.set(name, 0);
  }

  for (const booking of rows) {
    for (const name of bookingTypes(booking)) {
      // A name only present on old bookings (a category since renamed or deleted) still earns
      // a chip, or those rows would be unreachable from this filter.
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
