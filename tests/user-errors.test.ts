import { describe, expect, it } from 'vitest';
import { friendlyError, looksTechnical } from '@/lib/user-errors';

describe('Firebase phone sign-in', () => {
  it('explains a wrong OTP instead of printing the SDK error', () => {
    // What a person actually saw: "Firebase: Error (auth/invalid-verification-code)."
    const err = { code: 'auth/invalid-verification-code', message: 'Firebase: Error (auth/invalid-verification-code).' };
    expect(friendlyError(err)).toBe('That code is not right. Check the 6 digits and try again.');
  });

  it('reads the code out of the message when there is no code field', () => {
    expect(friendlyError(new Error('Firebase: Error (auth/code-expired).')))
      .toBe('That code has expired. Tap resend to get a new one.');
  });

  it('covers the rest of what a person can hit', () => {
    const cases: [string, RegExp][] = [
      ['auth/too-many-requests', /wait a few minutes/i],
      ['auth/invalid-phone-number', /does not look right/i],
      ['auth/network-request-failed', /internet connection/i],
      ['auth/captcha-check-failed', /reload the page/i],
      ['auth/user-disabled', /disabled/i],
      ['auth/quota-exceeded', /try again in a few minutes/i],
    ];
    for (const [code, expected] of cases) {
      expect(friendlyError({ code })).toMatch(expected);
    }
  });

  it('never leaks a Firebase code we have not listed', () => {
    const out = friendlyError({ code: 'auth/some-brand-new-thing', message: 'Firebase: Error (auth/some-brand-new-thing).' });
    expect(out).toBe('Something went wrong. Please try again.');
    expect(out).not.toMatch(/firebase|auth\//i);
  });
});

describe('Supabase auth', () => {
  it('translates the common failures', () => {
    expect(friendlyError(new Error('Invalid login credentials'))).toBe('That email or password is not right.');
    expect(friendlyError(new Error('Email not confirmed'))).toMatch(/confirm your email/i);
    expect(friendlyError(new Error('User already registered'))).toMatch(/already exists/i);
    expect(friendlyError(new Error('Token has expired or is invalid'))).toMatch(/expired/i);
    expect(friendlyError(new Error('For security purposes, you can only request this after 46 seconds')))
      .toMatch(/wait a moment/i);
  });
});

describe('our own messages still get through', () => {
  it('shows a sentence written for the person as-is', () => {
    for (const ours of [
      '"GENERAL" just sold out. Nothing has been charged.',
      'You can hold at most 7 passes for this event on one account.',
      'Membership is open from age 16. Please add a valid birth date in your profile first.',
      'Ticket sales for this event have closed.',
    ]) {
      expect(friendlyError(new Error(ours))).toBe(ours);
    }
  });

  it('uses the caller fallback when there is nothing useful', () => {
    expect(friendlyError(null, 'Checkout failed')).toBe('Checkout failed');
    expect(friendlyError(new Error(''), 'Checkout failed')).toBe('Checkout failed');
    expect(friendlyError(undefined)).toBe('Something went wrong. Please try again.');
  });
});

describe('what counts as developer output', () => {
  it('spots the things that must never reach a screen', () => {
    for (const technical of [
      'Firebase: Error (auth/invalid-verification-code).',
      'SOLD_OUT:FRONT ROW',
      'TypeError: Cannot read properties of null',
      'at POST (/app/api/x/route.ts:41:39)',
      '{"error":"nope"}',
      'column ticket_bookings.scan_version does not exist',
      'undefined',
      'x'.repeat(201),
      '',
    ]) {
      expect(looksTechnical(technical)).toBe(true);
    }
  });

  it('leaves plain sentences alone', () => {
    for (const human of [
      'That code is not right. Check the 6 digits and try again.',
      'Your seats are held for 15 minutes.',
      'Please enter your mobile number.',
    ]) {
      expect(looksTechnical(human)).toBe(false);
    }
  });

  it('a raw SDK string is replaced even if it reaches friendlyError directly', () => {
    expect(friendlyError('Firebase: Error (auth/invalid-verification-code).'))
      .toBe('That code is not right. Check the 6 digits and try again.');
    expect(friendlyError('PostgrestError: relation does not exist'))
      .toBe('Something went wrong. Please try again.');
  });
});

describe('ordinary English is not mistaken for developer output', () => {
  it('keeps messages that merely contain those letters inside a word', () => {
    // "annulled" contains "null"; "candid" contains no code. Substring matching ate these.
    for (const human of [
      'Your booking was annulled by the organiser.',
      'That order was cancelled, so the seats went back on sale.',
      'The venue is in Kondhwa Annexe.',
    ]) {
      expect(looksTechnical(human)).toBe(false);
      expect(friendlyError(new Error(human))).toBe(human);
    }
  });

  it('still catches the bare values on their own', () => {
    for (const technical of ['undefined', 'null', 'NaN', 'Cannot read x of undefined']) {
      expect(looksTechnical(technical)).toBe(true);
    }
  });
});
