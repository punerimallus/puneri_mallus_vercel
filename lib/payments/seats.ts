// Seat counting for ticket categories.
//
// Two counters live on each category, and they do different jobs:
//   sold      only ever goes up. It is the ticket-number sequence (VIP011, VIP012, ...), so a number is never reused.
//   released  goes up when a fully refunded order gives its seats back.
// Seats actually in use = sold - released. Capacity checks, "left" counts and the box office all use that.

export interface SeatCounters {
  sold?: number | null;
  released?: number | null;
}

/** Seats currently held by valid (not refunded) tickets. */
export function seatsInUse(c: SeatCounters): number {
  const sold = Math.max(0, Math.floor(Number(c.sold)) || 0);
  const released = Math.max(0, Math.floor(Number(c.released)) || 0);
  return Math.max(0, sold - Math.min(released, sold));
}

/** Seats still on sale, or null when the category has no capacity limit. */
export function seatsLeft(c: SeatCounters & { capacity?: number | null }): number | null {
  if (c.capacity == null) return null;
  return Math.max(0, c.capacity - seatsInUse(c));
}
