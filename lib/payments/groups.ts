// Group tickets: one ticket (one QR code) that admits several people together.
// A category's group size is set by the admin; 1 means an ordinary single-entry ticket.

export const MAX_GROUP_SIZE = 50;

/** Group size from any stored value. Missing, blank or nonsense means a single-entry ticket. */
export function groupSizeOf(value: unknown): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_GROUP_SIZE);
}

/** "1 Person", "5 People". */
export function admitsLabel(size: unknown): string {
  const n = groupSizeOf(size);
  return n === 1 ? '1 Person' : `${n} People`;
}

export const isGroup = (size: unknown): boolean => groupSizeOf(size) > 1;

/** What a customer pays per head for a group ticket, to show next to the group price. */
export function pricePerPerson(price: number, size: unknown): number {
  return Math.round((price / groupSizeOf(size)) * 100) / 100;
}
