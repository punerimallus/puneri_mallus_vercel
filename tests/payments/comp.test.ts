// Validating a complimentary-pass grant.
//
// A comp takes real seats out of a real category, so getting this wrong is not a cosmetic bug:
// it either hands out stock that was sold, or refuses a VIP at the one moment it matters. The
// database enforces the same rules when the seats are reserved; this exists so an admin gets a
// sentence rather than a raised Postgres exception.

import { describe, expect, it } from 'vitest';
import { ACCESS_PASS, MAX_COMP_PASSES, checkCompDeletable, checkCompRequest, compAdmits, compPhone, compReservationId, isAccessPass, isCompReservation, publiclyListed, type CompCategory } from '@/lib/payments/comp';
import { PaymentInputError } from '@/lib/payments/types';

const CATS: CompCategory[] = [
  { id: 'gen', name: 'GENERAL', prefix: 'GEN-', price: 500, capacity: 100, active: true },
  { id: 'vip', name: 'VIP', prefix: 'VIP-', price: 2000, capacity: 20, active: true },
  { id: 'grp', name: 'FRIENDS GROUP', prefix: 'GRP-', price: 2000, capacity: 1000, active: true, group_size: 5 },
  { id: 'paused', name: 'BALCONY', prefix: 'BAL-', price: 800, capacity: 50, active: false },
  { id: 'ap', name: 'ACCESS PASS', prefix: 'AP-', price: 0, capacity: 100, active: true, comp_only: true },
];

const ask = (over: Record<string, unknown> = {}) =>
  checkCompRequest({ guestName: 'Job Kurian', guestEmail: 'guest@example.com', reason: 'VIP', items: { gen: 2 }, ...over }, CATS);

const refusal = (over: Record<string, unknown>) => {
  try {
    ask(over);
  } catch (e) {
    return e as Error;
  }
  throw new Error('expected this to be refused');
};

describe('who the passes are for', () => {
  it('accepts a complete request', () => {
    const clean = ask();
    expect(clean.guestName).toBe('Job Kurian');
    expect(clean.guestEmail).toBe('guest@example.com');
    expect(clean.reason).toBe('VIP');
    expect(clean.passes).toBe(2);
  });

  it('insists on a name', () => {
    expect(refusal({ guestName: '   ' }).message).toMatch(/name/i);
  });

  it('insists on an email that could actually receive the passes', () => {
    // There is no other delivery route for a comp: no account, no payment receipt. A typo here
    // is a guest who arrives with nothing.
    for (const bad of ['', 'nope', 'a@b', 'a b@c.com', '@example.com']) {
      expect(refusal({ guestEmail: bad }).message).toMatch(/email/i);
    }
  });

  it('lower-cases the email so the same guest is one guest', () => {
    expect(ask({ guestEmail: '  Guest@Example.COM ' }).guestEmail).toBe('guest@example.com');
  });

  it('files an unrecognised reason under OTHER rather than refusing the grant', () => {
    expect(ask({ reason: 'BECAUSE' }).reason).toBe('OTHER');
    expect(ask({ reason: undefined }).reason).toBe('OTHER');
    expect(ask({ reason: 'sponsor' }).reason).toBe('SPONSOR');
  });

  it('keeps a note, trimmed and capped', () => {
    expect(ask({ note: '  Chief guest  ' }).note).toBe('Chief guest');
    expect(ask({ note: null }).note).toBeNull();
    expect(ask({ note: 'x'.repeat(500) }).note).toHaveLength(200);
  });
});

describe('the phone number', () => {
  it('keeps a real Indian mobile, however it was typed', () => {
    expect(compPhone('8669865623')).toBe('8669865623');
    expect(compPhone('+91 86698 65623')).toBe('8669865623');
    expect(compPhone('91-8669865623')).toBe('8669865623');
  });

  it('is null for anything we would not try to message', () => {
    expect(compPhone('')).toBeNull();
    expect(compPhone(null)).toBeNull();
    expect(compPhone('1234567890')).toBeNull();   // does not start 6-9
    expect(compPhone('86698656')).toBeNull();     // too short
    expect(compPhone('866986562312')).toBeNull(); // too long, no 91 prefix
  });

  it('is optional', () => {
    expect(ask({ guestPhone: undefined }).guestPhone).toBeNull();
  });
});

describe('which passes', () => {
  it('prices every comp at zero whatever the category costs', () => {
    // This is what the PDF receipt prints. A comp showing Rs.2000 paid would be a receipt for
    // money nobody handed over.
    const clean = ask({ items: { gen: 1, vip: 1 } });
    expect(clean.lines.every((l) => l.unitPrice === 0)).toBe(true);
  });

  it('still records what the seats were worth', () => {
    // So the guest list has a cost. 2 x 500 + 1 x 2000.
    expect(ask({ items: { gen: 2, vip: 1 } }).faceValue).toBe(3000);
  });

  it('carries the prefix and number width the paying flow uses', () => {
    // Same numbering as a sale, because the seats come from the same reservation: capacity 100
    // means three digits, so a comp reads GEN-001 exactly like a sold pass.
    const line = ask({ items: { gen: 1 } }).lines[0];
    expect(line.prefix).toBe('GEN-');
    expect(line.numberWidth).toBe(3);
  });

  it('remembers a group pass admits several people', () => {
    const clean = ask({ items: { grp: 2 } });
    expect(clean.lines[0].groupSize).toBe(5);
    expect(clean.passes).toBe(2);
    expect(compAdmits(clean.lines)).toBe(10);
  });

  it('counts a mixed grant by heads, not by passes', () => {
    const clean = ask({ items: { gen: 3, grp: 1 } });
    expect(clean.passes).toBe(4);
    expect(compAdmits(clean.lines)).toBe(8); // 3 singles + one group of 5
  });

  it('ignores a category set to zero', () => {
    expect(ask({ items: { gen: 2, vip: 0 } }).lines).toHaveLength(1);
  });

  it('needs at least one pass', () => {
    expect(refusal({ items: {} }).message).toMatch(/at least one/i);
    expect(refusal({ items: { gen: 0 } }).message).toMatch(/at least one/i);
    expect(refusal({ items: undefined }).message).toMatch(/at least one/i);
    expect(refusal({ items: [] }).message).toMatch(/at least one/i);
  });

  it('refuses a quantity that is not a whole positive number', () => {
    for (const bad of [-1, 1.5, NaN, 'two']) {
      expect(refusal({ items: { gen: bad } }).message).toMatch(/invalid/i);
    }
  });

  it('refuses a category that is not this event', () => {
    expect(refusal({ items: { nope: 1 } }).message).toMatch(/no longer exists/i);
  });

  it('explains a paused category instead of letting it read as sold out', () => {
    // reserve_order_inventory raises SOLD_OUT for an inactive category, which would send an
    // admin hunting for seats that are sitting right there.
    const e = refusal({ items: { paused: 1 } });
    expect(e.message).toMatch(/paused/i);
    expect(e.message).toMatch(/BALCONY/);
  });

  it('caps one grant so a mistyped quantity cannot empty the house', () => {
    expect(ask({ items: { gen: MAX_COMP_PASSES } }).passes).toBe(MAX_COMP_PASSES);
    expect(refusal({ items: { gen: MAX_COMP_PASSES + 1 } }).message).toMatch(/at most/i);
    expect(refusal({ items: { gen: 30, vip: 21 } }).message).toMatch(/at most/i);
  });

  it('raises errors the API knows how to turn into a status code', () => {
    expect(refusal({ guestName: '' })).toBeInstanceOf(PaymentInputError);
  });
});

describe('compReservationId', () => {
  it('marks a comp hold so it is obvious in the reservations table', () => {
    expect(compReservationId('abc')).toBe('comp_abc');
  });
});


describe('the access pass', () => {
  it('is a free, general-entry category', () => {
    expect(ACCESS_PASS.name).toBe('ACCESS PASS');
    expect(ACCESS_PASS.price).toBe(0);
    expect(ACCESS_PASS.prefix).toBe('AP-');
  });

  it('is recognised by the flag and the name together', () => {
    expect(isAccessPass({ name: 'ACCESS PASS', comp_only: true })).toBe(true);
    expect(isAccessPass({ name: '  access pass  ', comp_only: true })).toBe(true);
  });

  it('is not recognised from the name alone', () => {
    // Otherwise a category an admin happened to call "Access Pass" would quietly become free
    // and disappear from the public list.
    expect(isAccessPass({ name: 'ACCESS PASS', comp_only: false })).toBe(false);
    expect(isAccessPass({ name: 'ACCESS PASS' })).toBe(false);
    expect(isAccessPass({ name: 'VIP', comp_only: true })).toBe(false);
    expect(isAccessPass(null)).toBe(false);
  });

  it('can be issued as a comp like any other category', () => {
    const clean = checkCompRequest(
      { guestName: 'Chief Guest', guestEmail: 'vip@example.com', reason: 'VIP', items: { ap: 2 } },
      CATS,
    );
    expect(clean.passes).toBe(2);
    expect(clean.lines[0].prefix).toBe('AP-');
    // Zero face value: nothing was given away in money terms, only a seat.
    expect(clean.faceValue).toBe(0);
  });
});

describe('publiclyListed', () => {
  it('keeps everything a buyer is allowed to see', () => {
    expect(publiclyListed({ comp_only: false })).toBe(true);
    expect(publiclyListed({})).toBe(true);           // older rows have no column
    expect(publiclyListed({ comp_only: null })).toBe(true);
  });

  it('hides a comp-only category completely', () => {
    // Not "coming soon" — it is never coming. A free category on the public page is free
    // tickets for anyone who finds it.
    expect(publiclyListed({ comp_only: true })).toBe(false);
  });

  it('keeps the access pass off the booking page', () => {
    expect(CATS.filter(publiclyListed).map((c) => c.id)).not.toContain('ap');
    expect(CATS.filter(publiclyListed)).toHaveLength(CATS.length - 1);
  });
});


describe('checkCompDeletable', () => {
  const pass = (over: Record<string, unknown> = {}) => ({ categoryId: 'cat1', ticketNumber: 'AP-001', status: 'ISSUED', ...over });

  it('sorts the passes into what has to be done to each', () => {
    const plan = checkCompDeletable({
      source: 'COMP',
      tickets_data: [
        pass({ ticketNumber: 'AP-001' }),
        pass({ ticketNumber: 'AP-002', status: 'CHECKED_IN' }),
        pass({ ticketNumber: 'AP-003', status: 'REFUNDED' }),
      ],
    });
    expect(plan.live).toBe(2);
    expect(plan.alreadyVoided).toBe(1);
    expect(plan.admitted).toBe(1);
    expect(plan.freeable.map((f) => f.number)).toEqual([1, 2]);
  });

  it('counts a scanned-in pass as live, because its seat is still taken', () => {
    const plan = checkCompDeletable({ source: 'COMP', tickets_data: [pass({ status: 'CHECKED_IN' })] });
    expect(plan.live).toBe(1);
    expect(plan.freeable).toHaveLength(1);
  });

  it('reads the number off the pass however it is written', () => {
    const plan = checkCompDeletable({
      source: 'COMP',
      tickets_data: [pass({ ticketNumber: 'AP-007' }), pass({ ticketNumber: 'EB-GEN-120' }), pass({ ticketNumber: '9' })],
    });
    expect(plan.freeable.map((f) => f.number)).toEqual([7, 120, 9]);
  });

  it('sets aside a pass whose seat cannot be returned without guessing', () => {
    const plan = checkCompDeletable({
      source: 'COMP',
      tickets_data: [
        pass({ categoryId: undefined }),               // nothing says which category to credit
        pass({ ticketNumber: 'COMPLIMENTARY' }),        // no number anywhere in it
        pass({ ticketNumber: 'AP-004' }),
      ],
    });
    expect(plan.unfreeable).toEqual(['AP-001', 'COMPLIMENTARY']);
    expect(plan.freeable).toHaveLength(1);
    // Still counted as live: they were real passes and they are being killed.
    expect(plan.live).toBe(3);
  });

  it('refuses a paid booking', () => {
    expect(() => checkCompDeletable({ source: 'SALE', tickets_data: [pass()] })).toThrow(/void button/i);
  });

  it('treats an unreadable source as a sale', () => {
    // Fail closed. An older deployment without the column reports undefined, and reading that
    // as a comp would make every paid booking deletable exactly where the code is behind.
    for (const source of [undefined, null, '', 'Sale', 'anything']) {
      expect(() => checkCompDeletable({ source, tickets_data: [pass()] })).toThrow(/paid booking/i);
    }
  });

  it('refuses a booking that is not there', () => {
    expect(() => checkCompDeletable(null)).toThrow(/no longer exists/i);
    expect(() => checkCompDeletable(undefined)).toThrow(/no longer exists/i);
  });

  it('has nothing to do for a grant with no passes', () => {
    const plan = checkCompDeletable({ source: 'COMP', tickets_data: [] });
    expect(plan).toMatchObject({ live: 0, alreadyVoided: 0, admitted: 0, freeable: [], unfreeable: [] });
    expect(checkCompDeletable({ source: 'COMP', tickets_data: null }).live).toBe(0);
  });

  it('raises errors the API knows how to turn into a status code', () => {
    try {
      checkCompDeletable({ source: 'SALE' });
    } catch (e) {
      expect(e).toBeInstanceOf(PaymentInputError);
      expect((e as PaymentInputError).status).toBe(409);
    }
  });
});


describe('isCompReservation', () => {
  it('recognises a hold the comp screen created', () => {
    expect(isCompReservation(compReservationId('abc'))).toBe(true);
    expect(isCompReservation('comp_2edf3271-a5bc-4d31-ae7e-27219948304c')).toBe(true);
  });

  it('does not recognise a paid checkout, a legacy backfill or nothing at all', () => {
    // This is what stops a stale delete freeing a seat somebody has since paid for: a sale
    // reserves under a bare UUID, and the backfill under `legacy-`.
    expect(isCompReservation('acf649bb-39db-40e3-bbf3-b5298dfc7432')).toBe(false);
    expect(isCompReservation('legacy-0ab8e020')).toBe(false);
    expect(isCompReservation('')).toBe(false);
    expect(isCompReservation(null)).toBe(false);
    expect(isCompReservation(undefined)).toBe(false);
  });

  it('is not fooled by a reservation that merely mentions comp', () => {
    expect(isCompReservation('not_comp_abc')).toBe(false);
    expect(isCompReservation('COMP_abc')).toBe(false);
  });
});
