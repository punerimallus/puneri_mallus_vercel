// When an event starts, and whether tickets can still be sold or scanned today.
// Event dates are stored as text ("OCT 18, 2026", "6:00 PM") and are Pune (IST) times, whatever
// timezone the server runs in.

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const IST_OFFSET_MIN = 330;

function parseDay(date?: string | null): { y: number; m: number; d: number } | null {
  const m = (date || '').trim().match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
  if (month === -1) return null;
  const probe = new Date(Date.UTC(Number(m[3]), month, Number(m[2])));
  if (probe.getUTCMonth() !== month || probe.getUTCDate() !== Number(m[2])) return null;
  return { y: Number(m[3]), m: month, d: Number(m[2]) };
}

function parseTime(time?: string | null): { h: number; min: number } | null {
  const m = (time || '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  const ap = m[3]?.toLowerCase();
  if (min > 59 || h > 23) return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (ap === 'pm' ? 12 : 0);
  }
  return { h, min };
}

/** The moment the event starts, or null when the stored date can't be understood. A missing time means start of day. */
export function eventStart(date?: string | null, time?: string | null): Date | null {
  const day = parseDay(date);
  if (!day) return null;
  const t = parseTime(time) ?? { h: 0, min: 0 };
  return new Date(Date.UTC(day.y, day.m, day.d, t.h, t.min) - IST_OFFSET_MIN * 60_000);
}

export type SalesStatus = 'OPEN' | 'CLOSED' | 'UNKNOWN';

/** Tickets are on sale until the event starts. An unreadable date never blocks sales. */
export function salesStatus(date: string | null | undefined, time: string | null | undefined, now: Date = new Date()): SalesStatus {
  const start = eventStart(date, time);
  if (!start) return 'UNKNOWN';
  return start.getTime() > now.getTime() ? 'OPEN' : 'CLOSED';
}

export type EventDay = 'TODAY' | 'FUTURE' | 'PAST' | 'UNKNOWN';

/** Is the event today (in India), later, or already over (by calendar day)? Used to warn gate staff. */
export function eventDay(date: string | null | undefined, now: Date = new Date()): EventDay {
  const day = parseDay(date);
  if (!day) return 'UNKNOWN';
  const ist = new Date(now.getTime() + IST_OFFSET_MIN * 60_000);
  const today = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  const target = Date.UTC(day.y, day.m, day.d);
  return target === today ? 'TODAY' : target > today ? 'FUTURE' : 'PAST';
}
