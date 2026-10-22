import { describe, expect, it } from 'vitest';
import { ageOn, formatDateOnly, formatDobDisplay, isOldEnough, isPlausibleDob, maxDobFor, minDobFor, parseDateOnly } from '@/lib/dob';

describe('parseDateOnly', () => {
  it('reads a real date as the same calendar day, whatever the timezone', () => {
    const d = parseDateOnly('2010-05-20')!;
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2010, 5, 20]);
  });
  it('rejects dates that do not exist or are badly formed', () => {
    for (const bad of ['2010-02-30', '2011-02-29', '2010-13-01', '2010-00-10', '10-05-2010', '2010/05/20', '', null, undefined, 'May 20, 2010']) expect(parseDateOnly(bad as any)).toBeNull();
  });
  it('accepts 29 February in a leap year', () => {
    expect(parseDateOnly('2012-02-29')).not.toBeNull();
  });
  it('round-trips with formatDateOnly', () => {
    for (const s of ['1985-01-01', '1999-12-31', '2012-02-29', '2010-05-20']) expect(formatDateOnly(parseDateOnly(s)!)).toBe(s);
  });
});

describe('display', () => {
  it('shows day, month name, year', () => {
    expect(formatDobDisplay('2005-03-15')).toBe('15 Mar 2005');
    expect(formatDobDisplay('1990-12-01')).toBe('1 Dec 1990');
    expect(formatDobDisplay('garbage')).toBe('');
    expect(formatDobDisplay('')).toBe('');
  });
});

describe('age rules (16 and over)', () => {
  const today = new Date(2026, 9, 22); // 22 Oct 2026
  it('latest allowed birth date is exactly 16 years ago, in the local calendar', () => {
    expect(maxDobFor(today)).toBe('2010-10-22');
  });
  it('is not shifted by the time of day (the old toISOString version was wrong just after midnight in India)', () => {
    expect(maxDobFor(new Date(2026, 9, 22, 0, 10))).toBe('2010-10-22');
    expect(maxDobFor(new Date(2026, 9, 22, 23, 59))).toBe('2010-10-22');
  });
  it('turning 16 today counts; turning 16 tomorrow does not', () => {
    expect(isOldEnough('2010-10-22', today)).toBe(true);
    expect(isOldEnough('2010-10-23', today)).toBe(false);
    expect(ageOn('2010-10-22', today)).toBe(16);
    expect(ageOn('2010-10-23', today)).toBe(15);
  });
  it('handles leap-day birthdays and a leap-day "today"', () => {
    expect(maxDobFor(new Date(2028, 1, 29))).toBe('2012-02-29');
    expect(isOldEnough('2012-02-29', new Date(2028, 1, 29))).toBe(true);
    expect(isOldEnough('2012-02-29', new Date(2028, 1, 28))).toBe(false); // the day before the 16th birthday
    expect(isOldEnough('2012-02-29', new Date(2028, 2, 1))).toBe(true);
  });
  it('rejects missing, unreadable and future dates', () => {
    expect(isOldEnough('', today)).toBe(false);
    expect(isOldEnough('nope', today)).toBe(false);
    expect(isOldEnough('2030-01-01', today)).toBe(false);
    expect(ageOn('2030-01-01', today)).toBeNull();
  });
  it('plausibility: real, past and at most 100 years ago', () => {
    expect(isPlausibleDob('1990-06-15', today)).toBe(true);
    expect(isPlausibleDob('1900-01-01', today)).toBe(false);
    expect(isPlausibleDob('2030-01-01', today)).toBe(false);
    expect(minDobFor(today)).toBe('1926-01-01');
  });
});
