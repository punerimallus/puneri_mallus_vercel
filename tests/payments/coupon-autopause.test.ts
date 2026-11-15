// A coupon that gives a free ticket stops itself when there is no ticket left to give.
//
// The same rule as a group offer's pause, for the same reason. A code promising a free REGULAR,
// on a REGULAR that has sold out, is a promise that cannot be kept — and checkout already
// refuses it, but it refuses the BUYER, at the moment they type a code somebody sent them, with
// no warning to anybody beforehand. This is what lets the admin screen say so first.
//
// Derived, never written to `active`: a refund or a void frees a seat and the code works again
// on its own, and "I switched this off" stays distinguishable from "the hall filled up".

import { describe, expect, it } from 'vitest';
import {
  applyCoupon,
  couponAvailability,
  couponStopReason,
  checkCouponInput,
  type Coupon,
  type CouponCategory,
} from '@/lib/payments/coupons';
import { seatsLeft } from '@/lib/payments/seats';
import { PaymentInputError } from '@/lib/payments/types';

const REG = 'reg';

const regular = (sold: number, over: Partial<CouponCategory> = {}): CouponCategory => ({
  id: REG, name: 'REGULAR', prefix: 'REGULAR-', price: 1049, capacity: 78, sold, ...over,
});

const coupon = (over: Partial<Coupon> = {}): Coupon => ({
  id: 'c1', code: 'FREEREG', event_id: 'evt', kind: 'FREE_TICKET', scope: 'INDIVIDUAL',
  discount_type: null, discount_value: null,
  free_category_id: REG, free_qty: 1,
  max_uses: null, uses: 0, per_account_uses: 1, active: true, expires_at: null,
  ...over,
});

const check = (c: Coupon, cats: CouponCategory[], now?: Date) =>
  couponAvailability(c, cats, (x) => seatsLeft(x), now);

describe('a free-ticket coupon and the seats behind it', () => {
  it('is usable while there is a seat to give', () => {
    const a = check(coupon(), [regular(52)]);
    expect(a.usable).toBe(true);
    expect(a.autoPaused).toBe(false);
    expect(a.seatsLeft).toBe(26);
    expect(a.seatsNeeded).toBe(1);
  });

  it('pauses itself the moment the last seat goes', () => {
    const a = check(coupon(), [regular(78)]);
    expect(a.usable).toBe(false);
    expect(a.autoPaused).toBe(true);
    expect(a.stop).toBe('NOT_ENOUGH_SEATS');
    expect(couponStopReason(a, 'REGULAR')).toBe('REGULAR is sold out, so its free pass cannot be issued.');
  });

  it('pauses on the boundary, not one seat before it', () => {
    expect(check(coupon(), [regular(77)]).usable).toBe(true);   // one left, gives one
    expect(check(coupon(), [regular(78)]).usable).toBe(false);
  });

  it('counts what it actually gives away, not one', () => {
    // A code worth three free passes needs three seats, so it stops with two left.
    const three = coupon({ free_qty: 3 });
    expect(check(three, [regular(75)]).usable).toBe(true);      // 3 left
    const short = check(three, [regular(76)]);                  // 2 left
    expect(short.autoPaused).toBe(true);
    expect(couponStopReason(short, 'REGULAR')).toBe('Only 2 REGULAR left, and it gives 3 away.');
  });

  it('measures a group-scoped code by one group\'s worth', () => {
    // It gives free_qty PER group unit, so one unit's worth is the least it can ever need.
    const perGroup = coupon({ scope: 'BUNDLE', free_qty: 2 });
    expect(check(perGroup, [regular(76)]).usable).toBe(true);   // 2 left, needs 2
    expect(check(perGroup, [regular(77)]).autoPaused).toBe(true);
  });

  it('comes back by itself when a seat is freed', () => {
    const refunded = regular(78, { released: 2 });
    const a = check(coupon(), [refunded]);
    expect(a.seatsLeft).toBe(2);
    expect(a.usable).toBe(true);
    expect(a.autoPaused).toBe(false);
  });

  it('never pauses a money-off code, which needs no seats', () => {
    const moneyOff = coupon({ kind: 'DISCOUNT', discount_type: 'PERCENT', discount_value: 20, free_category_id: null, free_qty: null });
    const a = check(moneyOff, [regular(78)]);
    expect(a.usable).toBe(true);
    expect(a.autoPaused).toBe(false);
    expect(a.seatsLeft).toBeNull();
  });

  it('does pause a code that gives money off AND a free pass', () => {
    // BOTH is still a promise of a seat, so it cannot be honoured either.
    const both = coupon({ kind: 'BOTH', discount_type: 'PERCENT', discount_value: 20 });
    expect(check(both, [regular(78)]).autoPaused).toBe(true);
  });

  it('never pauses on an uncapped category', () => {
    const a = check(coupon(), [regular(1000, { capacity: null })]);
    expect(a.seatsLeft).toBeNull();
    expect(a.usable).toBe(true);
  });
});

describe('the other reasons a coupon cannot be used, told in the right order', () => {
  it('a hand switch-off is not an automatic pause', () => {
    const a = check(coupon({ active: false }), [regular(78)]);
    expect(a.stop).toBe('PAUSED');
    expect(a.autoPaused).toBe(false);          // seats are also gone, but that is not the headline
    expect(couponStopReason(a)).toBe('Switched off.');
  });

  it('an expired code says so rather than blaming the seats', () => {
    const a = check(coupon({ expires_at: '2026-01-01T00:00:00Z' }), [regular(78)], new Date('2026-11-15'));
    expect(a.stop).toBe('EXPIRED');
    expect(a.autoPaused).toBe(false);
  });

  it('a code not yet expired is still live', () => {
    const a = check(coupon({ expires_at: '2026-12-31T00:00:00Z' }), [regular(0)], new Date('2026-11-15'));
    expect(a.usable).toBe(true);
  });

  it('a spent code says every use has been taken', () => {
    const a = check(coupon({ max_uses: 5, uses: 5 }), [regular(0)]);
    expect(a.stop).toBe('USED_UP');
    expect(a.usesLeft).toBe(0);
    expect(couponStopReason(a)).toBe('Every use has been taken.');
  });

  it('counts the uses left while there are some', () => {
    expect(check(coupon({ max_uses: 5, uses: 2 }), [regular(0)]).usesLeft).toBe(3);
    expect(check(coupon(), [regular(0)]).usesLeft).toBeNull();
  });

  it('flags a paused ticket type separately from a full one', () => {
    const a = check(coupon(), [regular(0, { active: false })]);
    expect(a.stop).toBe('CATEGORY_CLOSED');
    expect(a.autoPaused).toBe(false);
  });

  it('flags a complimentary-only type, which can never be sold or given by a code', () => {
    expect(check(coupon(), [regular(0, { comp_only: true })]).stop).toBe('CATEGORY_CLOSED');
  });

  it('flags a type that has been deleted outright', () => {
    const a = check(coupon(), []);
    expect(a.stop).toBe('CATEGORY_GONE');
    expect(couponStopReason(a)).toBe('The ticket type it gives away no longer exists.');
  });

  it('says nothing when there is nothing to say', () => {
    expect(couponStopReason(check(coupon(), [regular(52)]))).toBeNull();
  });
});

describe('the buyer still cannot get past it', () => {
  // The admin screen is a courtesy. This is the enforcement, and it has not moved.
  const price = (c: Coupon, cats: CouponCategory[]) =>
    applyCoupon(c, 5000, cats, (x) => seatsLeft(x), 1);

  it('refuses the code at checkout when the seats are gone', () => {
    expect(() => price(coupon(), [regular(78)])).toThrow(/sold out/i);
    try {
      price(coupon(), [regular(78)]);
    } catch (e) {
      expect(e).toBeInstanceOf(PaymentInputError);
      expect((e as PaymentInputError).status).toBe(409);
    }
  });

  it('refuses when it gives more than is left', () => {
    expect(() => price(coupon({ free_qty: 3 }), [regular(76)])).toThrow(/cannot be issued/i);
  });

  it('still honours it while the seats are there', () => {
    const offer = price(coupon(), [regular(52)]);
    expect(offer?.freePasses).toBe(1);
    expect(offer?.summary).toMatch(/1 free REGULAR/);
  });
});

describe('creating a coupon that could never be honoured', () => {
  const form = { code: 'FREEREG', kind: 'FREE_TICKET', freeCategoryId: REG, freeQty: 1 };
  const cat = (sold: number) => [{ id: REG, name: 'REGULAR', capacity: 78, sold }];

  it('is refused while the type is sold out', () => {
    expect(() => checkCouponInput(form, cat(78), { isNew: true }))
      .toThrow(/"REGULAR" is sold out/i);
  });

  it('is refused when it gives more than is left', () => {
    expect(() => checkCouponInput({ ...form, freeQty: 5 }, cat(76), { isNew: true }))
      .toThrow(/Only 2 "REGULAR" left/i);
  });

  it('is allowed when the seats are there', () => {
    expect(checkCouponInput(form, cat(52), { isNew: true }).freeQty).toBe(1);
  });

  it('still allows EDITING one that has stopped working', () => {
    // The code that has gone quiet is exactly the one whose category or expiry needs changing.
    expect(checkCouponInput(form, cat(78)).freeQty).toBe(1);
  });

  it('does not stand in the way of a money-off code', () => {
    const moneyOff = { code: 'SAVE20', kind: 'DISCOUNT', discountType: 'PERCENT', discountValue: 20 };
    expect(checkCouponInput(moneyOff, cat(78), { isNew: true }).discountValue).toBe(20);
  });

  it('is unaffected on a type with no capacity set', () => {
    const uncapped = [{ id: REG, name: 'REGULAR', capacity: null, sold: 500 }];
    expect(checkCouponInput(form, uncapped, { isNew: true }).freeQty).toBe(1);
  });
});
