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
