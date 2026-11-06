// Phased sales: the banner above the box office, and the moment an event becomes bookable.
//
// The one that actually matters is isSaleLive. /api/events uses it to decide whether an event
// appears on the site at all, so a bug here either leaks a sale early or hides a live one from
// everyone trying to buy. Everything unreadable has to fall OPEN, never closed.

import { describe, expect, it } from 'vitest';
import { MAX_HEADLINE, MAX_PHASE_ALERT, PHASE_ALERT_IDEAS, PHASE_NOTICE, fromLocalInput, goLiveAt, isSaleLive, phaseAlert, saleHeadline, scheduleLabel, toLocalInput } from '@/lib/events/sale-phase';

describe('saleHeadline', () => {
  it('keeps what the admin typed', () => {
    expect(saleHeadline('Early bird tickets are live')).toBe('Early bird tickets are live');
  });

  it('is null when there is nothing to show', () => {
    expect(saleHeadline('')).toBeNull();
    expect(saleHeadline('   ')).toBeNull();
    expect(saleHeadline(null)).toBeNull();
    expect(saleHeadline(undefined)).toBeNull();
  });

  it('collapses pasted whitespace so the banner stays one line', () => {
    expect(saleHeadline('  Phase   1\n\nis live  ')).toBe('Phase 1 is live');
  });

  it('cuts anything that would overflow the banner', () => {
    expect(saleHeadline('x'.repeat(200))).toHaveLength(MAX_HEADLINE);
  });

  it('does not throw on a value that is not a string', () => {
    expect(saleHeadline(42)).toBe('42');
    expect(saleHeadline({})).toBe('[object Object]');
  });
});

describe('goLiveAt', () => {
  it('normalises any readable date to ISO', () => {
    expect(goLiveAt('2026-11-20T10:30:00.000Z')).toBe('2026-11-20T10:30:00.000Z');
    expect(goLiveAt(new Date('2026-11-20T10:30:00Z'))).toBe('2026-11-20T10:30:00.000Z');
  });

  it('treats "no schedule" and "unreadable schedule" alike', () => {
    // Deliberate: see isSaleLive. A corrupt value must not be able to hide a live event.
    expect(goLiveAt(null)).toBeNull();
    expect(goLiveAt('')).toBeNull();
    expect(goLiveAt(undefined)).toBeNull();
    expect(goLiveAt('not a date')).toBeNull();
    expect(goLiveAt({})).toBeNull();
  });
});

describe('isSaleLive', () => {
  const now = new Date('2026-11-06T12:00:00Z');

  it('is live when no schedule was ever set', () => {
    expect(isSaleLive(null, now)).toBe(true);
    expect(isSaleLive(undefined, now)).toBe(true);
  });

  it('is live once the moment has passed', () => {
    expect(isSaleLive('2026-11-06T11:59:59Z', now)).toBe(true);
  });

  it('is not live before it', () => {
    expect(isSaleLive('2026-11-06T12:00:01Z', now)).toBe(false);
    expect(isSaleLive('2026-12-01T00:00:00Z', now)).toBe(false);
  });

  it('goes live exactly on the second, not a second later', () => {
    expect(isSaleLive('2026-11-06T12:00:00Z', now)).toBe(true);
  });

  it('falls open on a corrupt value rather than hiding a sale', () => {
    // The failure that costs money is an event nobody can buy; an event visible a little early
    // is an announcement. So garbage means "on sale", never "hidden".
    expect(isSaleLive('garbage', now)).toBe(true);
    expect(isSaleLive(0, now)).toBe(true);
  });
});

describe('the datetime-local field', () => {
  it('round-trips an IST wall-clock time', () => {
    // 8pm in Pune on 20 Nov is 14:30 UTC. The admin types 20:00 and must see 20:00 again.
    const iso = fromLocalInput('2026-11-20T20:00');
    expect(iso).toBe('2026-11-20T14:30:00.000Z');
    expect(toLocalInput(iso)).toBe('2026-11-20T20:00');
  });

  it('reads an IST wall-clock time whatever timezone the laptop is set to', () => {
    // Deliberately not the browser's timezone: the admin and the event are both in Pune, so a
    // machine still on another clock must not quietly schedule the sale for the wrong hour.
    expect(fromLocalInput('2026-11-20T00:00')).toBe('2026-11-19T18:30:00.000Z');
  });

  it('is empty when nothing is scheduled', () => {
    expect(fromLocalInput('')).toBeNull();
    expect(fromLocalInput('   ')).toBeNull();
    expect(toLocalInput(null)).toBe('');
    expect(toLocalInput('nonsense')).toBe('');
  });

  it('refuses a half-typed date instead of inventing one', () => {
    expect(fromLocalInput('2026-11')).toBeNull();
    expect(fromLocalInput('tomorrow')).toBeNull();
  });
});

describe('scheduleLabel', () => {
  const now = new Date('2026-11-06T12:00:00Z');

  it('says so plainly when nothing is scheduled', () => {
    expect(scheduleLabel(null, now)).toBe('On sale now');
  });

  it('distinguishes a schedule that has fired from one that has not', () => {
    expect(scheduleLabel('2026-11-01T06:00:00Z', now)).toMatch(/^On sale since /);
    expect(scheduleLabel('2026-11-20T14:30:00Z', now)).toMatch(/^Goes live /);
  });

  it('shows the time in India, not the server timezone', () => {
    // 14:30 UTC is 8:00 pm in Pune. A server in UTC printing "2:30 pm" would have an admin
    // scheduling against the wrong clock.
    expect(scheduleLabel('2026-11-20T14:30:00Z', now)).toContain('8:00');
  });
});

describe('the phase notice', () => {
  it('tells buyers the direction prices move', () => {
    expect(PHASE_NOTICE.body).toMatch(/15%/);
    expect(PHASE_NOTICE.title.toLowerCase()).toContain('up');
  });

  it('promises no date, because we cannot keep one', () => {
    expect(PHASE_NOTICE.body).not.toMatch(/\b(tomorrow|tonight|\d{1,2}\s*(am|pm))\b/i);
  });
});


describe('the next-phase warning', () => {
  it('keeps what the admin typed', () => {
    expect(phaseAlert('Phase 2 starts in 48 hours')).toBe('Phase 2 starts in 48 hours');
  });

  it('is null when there is nothing to warn about', () => {
    // Null, not an empty string: the booking page renders nothing at all rather than an empty
    // red bar, and clearing the field in the box office has to actually remove the banner.
    expect(phaseAlert('')).toBeNull();
    expect(phaseAlert('   ')).toBeNull();
    expect(phaseAlert(null)).toBeNull();
    expect(phaseAlert(undefined)).toBeNull();
  });

  it('tidies the whitespace a paste brings with it', () => {
    expect(phaseAlert('  Phase 2   starts\n\nin 48 hours  ')).toBe('Phase 2 starts in 48 hours');
  });

  it('caps the length so it cannot push the passes off the screen', () => {
    const long = 'Phase 2 starts in 48 hours and the price goes up by at least fifteen percent, so please hurry';
    expect(phaseAlert(long)).toHaveLength(MAX_PHASE_ALERT);
    expect(long.length).toBeGreaterThan(MAX_PHASE_ALERT);
  });

  it('survives whatever shape the database hands back', () => {
    expect(phaseAlert(42)).toBe('42');
    expect(phaseAlert(['a'])).toBe('a');
    expect(phaseAlert({})).toBe('[object Object]'); // ugly, but it renders rather than throwing
  });

  it('is longer than the headline, because it is a sentence', () => {
    expect(MAX_PHASE_ALERT).toBeGreaterThan(MAX_HEADLINE);
  });

  it('offers ideas that all fit inside the cap', () => {
    expect(PHASE_ALERT_IDEAS.length).toBeGreaterThan(0);
    for (const idea of PHASE_ALERT_IDEAS) {
      expect(phaseAlert(idea)).toBe(idea);
      expect(idea.length).toBeLessThanOrEqual(MAX_PHASE_ALERT);
    }
  });

  it('is independent of the headline and the schedule', () => {
    // Three separate controls on one form; setting one must not imply anything about the others.
    expect(phaseAlert('Phase 2 starts in 48 hours')).not.toBe(saleHeadline('Phase 1 is live'));
    expect(isSaleLive(null)).toBe(true);
  });
});
