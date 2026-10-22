// Dates of birth: one place for parsing, showing and checking them.
//
// A birth date is a calendar date with no time or timezone ("2010-05-20"). The classic bug is reading it with
// new Date("2010-05-20"), which means midnight UTC, and then showing it in local time: anywhere west of London
// that prints the day before. Everything here works with the year, month and day directly, so it is the same
// on every device and server.

export const MIN_MEMBER_AGE = 16;
export const OLDEST_BIRTH_YEARS = 100;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2010-05-20" to a local Date at midnight, or null if it isn't a real calendar date (e.g. 2010-02-30). */
export function parseDateOnly(value: string | null | undefined): Date | null {
  const m = String(value ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date;
}

/** A local Date to "2010-05-20". */
export function formatDateOnly(date: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(date.getFullYear(), 4)}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/** "2005-03-15" to "15 Mar 2005" (empty if it can't be read). */
export function formatDobDisplay(value: string | null | undefined): string {
  const d = parseDateOnly(value);
  return d ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : '';
}

/** The latest birth date that is still old enough today, as "yyyy-MM-dd" (today minus `minAge` years, in the local calendar). */
export function maxDobFor(today: Date = new Date(), minAge: number = MIN_MEMBER_AGE): string {
  return formatDateOnly(new Date(today.getFullYear() - minAge, today.getMonth(), today.getDate()));
}

/** The earliest birth date the picker offers, as "yyyy-MM-dd". */
export function minDobFor(today: Date = new Date()): string {
  return formatDateOnly(new Date(today.getFullYear() - OLDEST_BIRTH_YEARS, 0, 1));
}

/** Whole years old on `today`, or null if the date can't be read or is in the future. */
export function ageOn(dob: string | null | undefined, today: Date = new Date()): number | null {
  const b = parseDateOnly(dob);
  if (!b) return null;
  let age = today.getFullYear() - b.getFullYear();
  if (today.getMonth() < b.getMonth() || (today.getMonth() === b.getMonth() && today.getDate() < b.getDate())) age--;
  return age >= 0 ? age : null;
}

export function isOldEnough(dob: string | null | undefined, today: Date = new Date(), minAge: number = MIN_MEMBER_AGE): boolean {
  const a = ageOn(dob, today);
  return a !== null && a >= minAge;
}

/** Is this a plausible birth date (a real date, not in the future, not over 100 years ago)? */
export function isPlausibleDob(dob: string | null | undefined, today: Date = new Date()): boolean {
  const a = ageOn(dob, today);
  return a !== null && a <= OLDEST_BIRTH_YEARS;
}
