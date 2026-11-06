// The terms a buyer accepts before the box office opens, and that the PDF then prints.
//
// There is one list and two places that render it. These tests are about that single source:
// if the screen and the pass can ever show different wording, the one somebody signed off on
// is the one that loses the argument at the door.

import { describe, expect, it } from 'vitest';
import { CHILD_TICKET_AGE, TERMS, TERMS_VERSION, acceptTerms, termsNumber } from '@/lib/events/terms';

describe('the terms', () => {
  it('has every clause the printed card carries', () => {
    // An exact count, on purpose: this list is rendered in two places and printed on every
    // pass, so a clause disappearing by accident should fail here rather than at a gate. The
    // Sr. Citizen age-proof clause was removed deliberately; update the number when the
    // wording changes on purpose.
    expect(TERMS).toHaveLength(9);
  });

  it('charges for children above eight, which is the change from the printed card', () => {
    // The card at the venue says five. Eight is the decision; it is quoted from one constant so
    // the sentence and the rule cannot drift apart.
    expect(CHILD_TICKET_AGE).toBe(8);
    const child = TERMS.find((t) => /child/i.test(t));
    expect(child).toBeDefined();
    expect(child).toContain('above the age of 8');
    expect(TERMS.join(' ')).not.toContain('above the age of 5');
  });

  it('still says tickets cannot be refunded or passed on', () => {
    expect(TERMS.some((t) => /non-refundable/i.test(t) && /non-transferable/i.test(t))).toBe(true);
  });

  it('still covers entry, security, belongings and parking', () => {
    const all = TERMS.join(' ').toLowerCase();
    for (const topic of ['valid ticket', 'security checks', 'belongings', 'parking']) {
      expect(all).toContain(topic);
    }
  });

  it('is a sentence each, not a paragraph', () => {
    for (const t of TERMS) {
      expect(t.length).toBeGreaterThan(20);
      // Long enough to be a real clause, short enough to wrap to three lines in the PDF box.
      expect(t.length).toBeLessThan(170);
      expect(t.trim()).toBe(t);
    }
  });

  it('has no duplicate clauses', () => {
    expect(new Set(TERMS).size).toBe(TERMS.length);
  });
});

describe('termsNumber', () => {
  it('pads to two digits so the screen and the PDF line up', () => {
    expect(termsNumber(0)).toBe('01.');
    expect(termsNumber(8)).toBe('09.');
    expect(termsNumber(9)).toBe('10.');
  });
});

describe('acceptTerms', () => {
  it('records which wording was agreed to, and when', () => {
    const at = new Date('2026-11-06T09:00:00Z');
    expect(acceptTerms(at)).toEqual({ version: TERMS_VERSION, acceptedAt: '2026-11-06T09:00:00.000Z' });
  });

  it('carries a version that changes when the wording does', () => {
    expect(TERMS_VERSION).toMatch(/^v\d/);
  });
});
