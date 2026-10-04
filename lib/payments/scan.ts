// Gate entry rules, kept free of any database code so every case can be tested.
// A ticket admits `groupSize` people (1 for an ordinary ticket). A group can come in
// together or in parts: each scan says how many are entering now.

import { groupSizeOf } from './groups';

export interface ScanTicket {
  categoryName: string;
  ticketNumber: string;
  status: 'ISSUED' | 'CHECKED_IN' | 'REFUNDED';
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
  const admitted = t.status === 'CHECKED_IN' ? groupSize : Math.min(groupSize, Math.max(0, Math.floor(Number(t.admitted)) || 0));
  return { groupSize, admitted, remaining: groupSize - admitted };
}

export type ScanFailure = 'NOT_FOUND' | 'REFUNDED' | 'ALREADY_USED' | 'INVALID_COUNT' | 'TOO_MANY';

export type ScanResult =
  | { ok: false; code: ScanFailure; message: string; progress?: TicketProgress }
  | { ok: true; tickets: ScanTicket[]; ticket: ScanTicket; admittedNow: number; progress: TicketProgress };

/** What a scan would find, without changing anything. */
export function lookupTicket(tickets: ScanTicket[], ticketNumber: string): { ticket: ScanTicket; progress: TicketProgress } | null {
  const ticket = tickets.find((t) => t.ticketNumber === ticketNumber);
  return ticket ? { ticket, progress: progressOf(ticket) } : null;
}

/**
 * Admit `count` people on a ticket. Leaving `count` out admits everyone still outside, which is
 * what a single ticket (or an old scanner that doesn't ask) wants. Never mutates its input.
 */
export function applyScan(tickets: ScanTicket[], ticketNumber: string, count?: number, now: Date = new Date()): ScanResult {
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
