// Gate entry rules, kept free of any database code so every case can be tested.
//
// Most passes admit one person. A GROUP pass admits several on one QR: it is sold as a group
// ticket (a price for several seats of one category), and although those seats come out of that
// category's own capacity, the buyer is handed a single pass for the whole party.
//
// A group can come in together or in parts: each scan says how many are entering now. Splitting
// is deliberately an admin-only action — see ScanOptions.allowPartial.

/** People admitted by one pass. Missing, blank or nonsense means one. */
export function groupSizeOf(value: unknown): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_GROUP_SIZE);
}

/** The largest party one pass may admit, matching the largest group ticket that can be sold. */
export const MAX_GROUP_SIZE = 50;

/** "1 Person", "8 People". */
export function admitsLabel(size: unknown): string {
  const n = groupSizeOf(size);
  return n === 1 ? '1 Person' : `${n} People`;
}

export const isGroup = (size: unknown): boolean => groupSizeOf(size) > 1;

/**
 * The seats a group pass stands for, written the way a person reads them.
 *
 * "REGULAR-055 – REGULAR-059" for five consecutive seats, which is the usual case. The
 * allocator takes the lowest FREE numbers, so after a void or a refund a group can hold seats
 * with a gap in them — those are printed as separate runs ("REGULAR-055 – REGULAR-057,
 * REGULAR-061") rather than as a range that would claim seats the buyer does not hold.
 *
 * Null when there is nothing worth saying: one seat, or no record of them (every pass issued
 * before this was stored).
 */
export interface SeatRangeOptions {
  /**
   * Drop the prefix from every number after the first, so a chip in a crowded table reads
   * "REGULAR-053 – 057" rather than repeating "REGULAR-" twice in the same breath. Only ever
   * applied where the prefix is identical, so nothing is ambiguous.
   */
  compact?: boolean;
}

export function seatRangeLabel(
  seats: readonly string[] | null | undefined,
  options: SeatRangeOptions = {},
): string | null {
  const list = (seats || []).map((s) => String(s).trim()).filter(Boolean);
  if (list.length < 2) return null;

  const parsed = list.map((raw) => {
    const m = /^(.*?)(\d+)$/.exec(raw);
    return m ? { raw, prefix: m[1], n: Number(m[2]) } : null;
  });
  // A number that cannot be read is listed verbatim rather than guessed at.
  if (parsed.some((p) => p === null)) return list.join(', ');

  const sorted = (parsed as { raw: string; prefix: string; n: number }[])
    .slice()
    .sort((a, b) => (a.prefix === b.prefix ? a.n - b.n : a.prefix.localeCompare(b.prefix)));

  const runs: { first: string; last: string; prefix: string }[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const seat = sorted[i];
    const prev = i > 0 ? sorted[i - 1] : null;
    const continues = prev && prev.prefix === seat.prefix && prev.n + 1 === seat.n;
    if (continues && runs.length > 0) runs[runs.length - 1].last = seat.raw;
    else runs.push({ first: seat.raw, last: seat.raw, prefix: seat.prefix });
  }

  // In compact form the first number keeps its prefix and the rest shed it, but only while the
  // prefix is the same one — seats from two categories always read in full.
  const lead = runs[0].prefix;
  const short = (raw: string, prefix: string) =>
    options.compact && prefix === lead && raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;

  return runs
    .map((r, i) => {
      const first = i === 0 ? r.first : short(r.first, r.prefix);
      return r.first === r.last ? first : `${first} – ${short(r.last, r.prefix)}`;
    })
    .join(', ');
}

export interface ScanTicket {
  categoryName: string;
  ticketNumber: string;
  status: 'ISSUED' | 'CHECKED_IN' | 'REFUNDED';
  /** People this one pass admits. Absent means one. */
  groupSize?: number;
  /** People who have already gone in. Absent means nobody (or, with CHECKED_IN, everybody). */
  admitted?: number;
  lastScanAt?: string;
  entries?: { at: string; count: number }[];
}

export interface TicketProgress {
  groupSize: number;
  admitted: number;
  remaining: number;
}

export function progressOf(t: Pick<ScanTicket, 'status' | 'groupSize' | 'admitted'>): TicketProgress {
  const groupSize = groupSizeOf(t.groupSize);
  const admitted = t.status === 'CHECKED_IN'
    ? groupSize
    : Math.min(groupSize, Math.max(0, Math.floor(Number(t.admitted)) || 0));
  return { groupSize, admitted, remaining: groupSize - admitted };
}

export type ScanFailure = 'NOT_FOUND' | 'REFUNDED' | 'ALREADY_USED' | 'INVALID_COUNT' | 'TOO_MANY' | 'PARTIAL_NOT_ALLOWED';

export interface ScanOptions {
  /**
   * May this scanner split a group across several entries?
   *
   * Only an admin may. A volunteer on the door has to see the whole group before anyone goes
   * in, because splitting is the one gate action that cannot be undone and is easy to be talked
   * into: "the other three are just parking, let us in". Half a group admitted means the pass
   * still reads valid later, and whoever turns up with it next gets in on it. An admin can
   * still split deliberately — they are the ones who can also undo the consequences.
   */
  allowPartial?: boolean;
}

export type ScanResult =
  | { ok: false; code: ScanFailure; message: string; progress?: TicketProgress }
  | { ok: true; tickets: ScanTicket[]; ticket: ScanTicket; admittedNow: number; progress: TicketProgress };

export interface BulkAdmitResult {
  tickets: ScanTicket[];
  /** One entry per pass somebody actually came in on, in the order they were issued. */
  admitted: { ticketNumber: string; count: number }[];
  /** People admitted across all of them. */
  admittedNow: number;
}

/**
 * Admit everyone still outside on every live pass of a booking.
 *
 * What the box office needs when somebody arrives without a QR: a booking of two passes is one
 * decision by the organiser, not two. Passes that are refunded, or whose party is already
 * inside, are skipped rather than refused — on "let the rest in", one pass already scanned at
 * the door is a normal thing to find, not an error.
 *
 * Never mutates its input, and reuses applyScan so a group pass is counted by PEOPLE here
 * exactly as it is at the gate.
 */
export function admitEveryone(tickets: ScanTicket[], now: Date = new Date()): BulkAdmitResult {
  let working = tickets;
  const admitted: { ticketNumber: string; count: number }[] = [];

  for (const t of tickets) {
    if (t.status === 'REFUNDED' || progressOf(t).remaining === 0) continue;
    const result = applyScan(working, t.ticketNumber, undefined, now, { allowPartial: true });
    if (!result.ok) continue;
    working = result.tickets;
    admitted.push({ ticketNumber: t.ticketNumber, count: result.admittedNow });
  }

  return { tickets: working, admitted, admittedNow: admitted.reduce((n, a) => n + a.count, 0) };
}

/** What a scan would find, without changing anything. */
export function lookupTicket(tickets: ScanTicket[], ticketNumber: string): { ticket: ScanTicket; progress: TicketProgress } | null {
  const ticket = tickets.find((t) => t.ticketNumber === ticketNumber);
  return ticket ? { ticket, progress: progressOf(ticket) } : null;
}

/**
 * Admit `count` people on a pass. Leaving `count` out admits everyone still outside, which is
 * what a single pass (or an old scanner that doesn't ask) wants. Never mutates its input.
 */
export function applyScan(
  tickets: ScanTicket[],
  ticketNumber: string,
  count?: number,
  now: Date = new Date(),
  options: ScanOptions = {},
): ScanResult {
  const found = lookupTicket(tickets, ticketNumber);
  if (!found) return { ok: false, code: 'NOT_FOUND', message: 'Ticket number does not belong to this booking.' };
  const { ticket, progress } = found;

  if (ticket.status === 'REFUNDED') return { ok: false, code: 'REFUNDED', message: 'REFUNDED! This pass was refunded and is no longer valid.', progress };
  if (progress.remaining === 0) {
    const msg = progress.groupSize > 1
      ? `ALREADY SCANNED! All ${progress.groupSize} people on this group pass have already entered.`
      : 'ALREADY SCANNED! This ticket has already been used.';
    return { ok: false, code: 'ALREADY_USED', message: msg, progress };
  }

  const admitNow = count === undefined || count === null ? progress.remaining : count;
  if (!Number.isInteger(admitNow) || admitNow < 1) {
    return { ok: false, code: 'INVALID_COUNT', message: 'Enter how many people are entering (a whole number, at least 1).', progress };
  }
  if (admitNow > progress.remaining) {
    return { ok: false, code: 'TOO_MANY', message: `Only ${progress.remaining} of ${progress.groupSize} ${progress.remaining === 1 ? 'person is' : 'people are'} still to enter.`, progress };
  }
  // Leaving part of the group outside is an admin-only action. Checked after TOO_MANY and
  // INVALID_COUNT, so a volunteer gets the useful message first.
  if (admitNow < progress.remaining && options.allowPartial === false) {
    return {
      ok: false,
      code: 'PARTIAL_NOT_ALLOWED',
      message: `The whole group has to come in together. All ${progress.remaining} still need to be here — ask an organiser if some are arriving later.`,
      progress,
    };
  }

  const at = now.toISOString();
  const admitted = progress.admitted + admitNow;
  const updated: ScanTicket = {
    ...ticket,
    status: admitted >= progress.groupSize ? 'CHECKED_IN' : 'ISSUED',
    admitted,
    lastScanAt: at,
    entries: [...(ticket.entries || []), { at, count: admitNow }],
  };
  return {
    ok: true,
    tickets: tickets.map((t) => (t.ticketNumber === ticketNumber ? updated : t)),
    ticket: updated,
    admittedNow: admitNow,
    progress: progressOf(updated),
  };
}
