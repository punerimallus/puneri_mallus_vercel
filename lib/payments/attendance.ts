// Who has actually walked through the gate.
//
// The box office could say what was sold but not what had turned up, which is the question an
// organiser actually asks on the night. Counting is less obvious than it looks: a group pass is
// one pass but several people, and it can be half admitted, so "tickets scanned" and "people
// inside" are different numbers and both matter.
//
// Kept free of React and database code so the arithmetic can be tested on its own.

import { progressOf, ScanTicket } from './scan';

export type AttendanceState = 'NOT_ARRIVED' | 'PARTLY_IN' | 'ALL_IN' | 'REFUNDED';

export interface Attendance {
  /** Passes that still count (refunded ones are excluded). */
  passes: number;
  /** People those passes admit in total — a group pass of five counts five. */
  people: number;
  /** People who have gone in. */
  admitted: number;
  /** People still outside. */
  remaining: number;
  /** Passes fully used up. */
  passesScanned: number;
  /** Passes voided or refunded. */
  refunded: number;
  state: AttendanceState;
}

const EMPTY: Attendance = { passes: 0, people: 0, admitted: 0, remaining: 0, passesScanned: 0, refunded: 0, state: 'NOT_ARRIVED' };

/** How much of one booking has come in. */
export function bookingAttendance(
  tickets: ScanTicket[] | null | undefined,
  bookingStatus?: string | null,
): Attendance {
  const all = Array.isArray(tickets) ? tickets : [];
  if (!all.length) return { ...EMPTY, state: bookingStatus === 'REFUNDED' ? 'REFUNDED' : 'NOT_ARRIVED' };

  const refunded = all.filter((t) => t.status === 'REFUNDED').length;

  // A refunded booking is out of the count entirely: nobody on it is coming in.
  if (bookingStatus === 'REFUNDED' || refunded === all.length) {
    return { ...EMPTY, refunded: all.length, state: 'REFUNDED' };
  }

  const live = all.filter((t) => t.status !== 'REFUNDED');
  let people = 0;
  let admitted = 0;
  let passesScanned = 0;
  for (const t of live) {
    const p = progressOf(t);
    people += p.groupSize;
    admitted += p.admitted;
    if (p.remaining === 0) passesScanned += 1;
  }

  return {
    passes: live.length,
    people,
    admitted,
    remaining: people - admitted,
    passesScanned,
    refunded,
    state: admitted === 0 ? 'NOT_ARRIVED' : admitted >= people ? 'ALL_IN' : 'PARTLY_IN',
  };
}

export const ATTENDANCE_LABEL: Record<AttendanceState, string> = {
  NOT_ARRIVED: 'Not arrived',
  PARTLY_IN: 'Partly in',
  ALL_IN: 'Checked in',
  REFUNDED: 'Refunded',
};

/** Totals across every booking for an event. */
export function eventAttendance(
  bookings: { tickets_data?: ScanTicket[] | null; status?: string | null }[] | null | undefined,
): Attendance & { bookings: number; arrived: number; notArrived: number } {
  const rows = Array.isArray(bookings) ? bookings : [];
  const totals = { ...EMPTY, bookings: 0, arrived: 0, notArrived: 0 };

  for (const b of rows) {
    const a = bookingAttendance(b.tickets_data, b.status);
    totals.passes += a.passes;
    totals.people += a.people;
    totals.admitted += a.admitted;
    totals.passesScanned += a.passesScanned;
    totals.refunded += a.refunded;
    if (a.state === 'REFUNDED') continue;
    totals.bookings += 1;
    if (a.state === 'NOT_ARRIVED') totals.notArrived += 1;
    else totals.arrived += 1;
  }

  totals.remaining = totals.people - totals.admitted;
  totals.state = totals.admitted === 0 ? 'NOT_ARRIVED' : totals.admitted >= totals.people ? 'ALL_IN' : 'PARTLY_IN';
  return totals;
}

/** Share of expected people who are inside, 0-100. */
export function attendancePercent(a: Pick<Attendance, 'people' | 'admitted'>): number {
  if (!a.people) return 0;
  return Math.round((a.admitted / a.people) * 100);
}

// --------------------------------------------------------------------------------------
// Who admitted them
//
// tickets_data records how many went in, never who waved them through. That lives only in
// scan_log, which the gate appends to on every admission. When a guest disputes an entry — or
// a count looks wrong the morning after — the organiser's question is "who scanned this", and
// this turns those rows into the answer.
// --------------------------------------------------------------------------------------

export interface ScanLogRow {
  ticket_number?: string | null;
  admitted?: number | null;
  action?: string | null;
  actor_email?: string | null;
  actor_role?: string | null;
  at?: string | null;
}

export interface AdmissionEntry {
  ticketNumber: string;
  admitted: number;
  /** The volunteer's phone or the admin's email, ready to print. */
  by: string;
  role: 'ADMIN' | 'SCANNER' | 'UNKNOWN';
  at: string | null;
}

/** A ghost gate address reads back as the phone number it was made from. */
function actorLabel(email: string | null | undefined): string {
  const raw = String(email || '').trim();
  if (!raw) return 'Unknown';
  const ghost = /^(\d{10})@punerimallus\.com$/i.exec(raw);
  return ghost ? ghost[1] : raw;
}

/**
 * The admissions on one booking, newest first.
 *
 * Only ADMIT rows count: scan_log is append-only and may grow other action types later, and a
 * future row type must not be mistaken for somebody being let in.
 */
export function admissions(scans: ScanLogRow[] | null | undefined): AdmissionEntry[] {
  const rows = Array.isArray(scans) ? scans : [];
  return rows
    .filter((s) => String(s.action || 'ADMIT').toUpperCase() === 'ADMIT')
    .map((s) => ({
      ticketNumber: String(s.ticket_number || ''),
      admitted: Math.max(0, Math.floor(Number(s.admitted)) || 0),
      by: actorLabel(s.actor_email),
      role: (s.actor_role === 'ADMIN' ? 'ADMIN' : s.actor_role === 'SCANNER' ? 'SCANNER' : 'UNKNOWN') as AdmissionEntry['role'],
      at: s.at ? String(s.at) : null,
    }))
    .sort((a, b) => (b.at || '').localeCompare(a.at || ''));
}

/**
 * The people who worked this booking's entry, each with how many they let in.
 *
 * A group that trickled in past two volunteers has two names against it, which is exactly the
 * detail that settles an argument about a miscount.
 */
export function admittedBy(scans: ScanLogRow[] | null | undefined): { by: string; role: AdmissionEntry['role']; admitted: number; at: string | null }[] {
  const byPerson = new Map<string, { by: string; role: AdmissionEntry['role']; admitted: number; at: string | null }>();
  for (const entry of admissions(scans)) {
    const existing = byPerson.get(entry.by);
    if (existing) {
      existing.admitted += entry.admitted;
      // admissions() is newest first, so the first time we see someone is their latest scan.
    } else {
      byPerson.set(entry.by, { by: entry.by, role: entry.role, admitted: entry.admitted, at: entry.at });
    }
  }
  return [...byPerson.values()].sort((a, b) => (b.at || '').localeCompare(a.at || ''));
}
