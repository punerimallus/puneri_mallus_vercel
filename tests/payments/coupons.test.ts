// Coupon arithmetic and refusals.
//
// Money comes off a live checkout on the strength of this file, so the cases that matter are
// the ones where a coupon should give LESS than it looks like it promises: a flat discount
// bigger than the cart, a free pass from a category that has since sold out or been paused.
// The usage cap is not here — that belongs to the database, under a lock, and is tested in
// tests/sql/coupons.test.ts against a real Postgres.

import { describe, expect, it } from 'vitest';
import {
  MAX_FREE_QTY,
  MAX_FREE_TOTAL,
  MAX_NOTE_LENGTH,
  applyCoupon,
  checkCouponInput,
  couponError,
  discountFor,
  freeLinesFor,
  givesDiscount,
  givesFreeTickets,
  isValidCode,
  normalizeCode,
  offerSummary,
  type Coupon,
  type CouponCategory,
} from '@/lib/payments/coupons';
import { PaymentInputError } from '@/lib/payments/types';
import { MAX_BUNDLES_PER_ACCOUNT, MAX_TICKETS_PER_ACCOUNT } from '@/lib/payments/pricing';

const CATS: CouponCategory[] = [
  { id: 'reg', name: 'REGULAR (STANDING)', prefix: 'REGULAR-', price: 1049, capacity: 78, sold: 50, active: true },
  { id: 'vip', name: 'VIP (SEATING)', prefix: 'VIP-', price: 1500, capacity: 50, sold: 50, active: true },
  { id: 'paused', name: 'FAN PIT', prefix: 'FAN-', price: 1749, capacity: 45, sold: 10, active: false },
  { id: 'grp', name: 'GROUP OF 5', prefix: 'GRP-', price: 5000, capacity: 20, sold: 0, active: true },
];

/** Seats left, the way the checkout works it out. */
const left = (c: CouponCategory) => (c.capacity == null ? null : c.capacity - (c.sold ?? 0));

const coupon = (over: Partial<Coupon> = {}): Coupon => ({
  id: 'c1', code: 'WELCOME10', kind: 'DISCOUNT', discount_type: 'PERCENT', discount_value: 10, ...over,
});

describe('the code itself', () => {
  it('is upper-cased, so a phone keyboard still matches', () => {
    expect(normalizeCode('welcome10')).toBe('WELCOME10');
    expect(normalizeCode('  Welcome 10 ')).toBe('WELCOME10');
  });

  it('accepts the shapes an admin would reasonably type', () => {
    for (const code of ['SAVE20', 'welcome10', 'EARLY-BIRD', 'VIP_FREE', 'A1B']) {
      expect(isValidCode(code), code).toBe(true);
    }
  });

  it('refuses something that could never be typed back reliably', () => {
    for (const code of ['', 'AB', '   ', '-LEAD', 'HAS SPACE!', '@@@']) {
      expect(isValidCode(code), JSON.stringify(code)).toBe(false);
    }
  });

  it('is capped so it cannot overflow the input or the column', () => {
    expect(normalizeCode('X'.repeat(100))).toHaveLength(24);
  });
});

describe('what kind of offer it is', () => {
  it('knows which coupons do what', () => {
    expect(givesDiscount(coupon({ kind: 'DISCOUNT' }))).toBe(true);
    expect(givesDiscount(coupon({ kind: 'BOTH' }))).toBe(true);
    expect(givesDiscount(coupon({ kind: 'FREE_TICKET' }))).toBe(false);
    expect(givesFreeTickets(coupon({ kind: 'FREE_TICKET' }))).toBe(true);
    expect(givesFreeTickets(coupon({ kind: 'BOTH' }))).toBe(true);
    expect(givesFreeTickets(coupon({ kind: 'DISCOUNT' }))).toBe(false);
    expect(givesDiscount(null)).toBe(false);
    expect(givesFreeTickets(undefined)).toBe(false);
  });
});

describe('money off', () => {
  it('takes a percentage', () => {
    expect(discountFor(coupon({ discount_type: 'PERCENT', discount_value: 10 }), 1000)).toBe(100);
    expect(discountFor(coupon({ discount_type: 'PERCENT', discount_value: 15 }), 1049)).toBe(157.35);
  });

  it('takes a flat amount', () => {
    expect(discountFor(coupon({ discount_type: 'FLAT', discount_value: 200 }), 1049)).toBe(200);
  });

  it('never takes more than the cart is worth', () => {
    // A ₹500 coupon on a ₹300 cart takes ₹300. Anything else is a refund dressed as a discount.
    expect(discountFor(coupon({ discount_type: 'FLAT', discount_value: 500 }), 300)).toBe(300);
    expect(discountFor(coupon({ discount_type: 'PERCENT', discount_value: 100 }), 300)).toBe(300);
  });

  it('rounds to paise, because that is what gets charged', () => {
    const d = discountFor(coupon({ discount_type: 'PERCENT', discount_value: 33 }), 1049);
    expect(d).toBe(346.17);
    expect(Number.isInteger(d * 100)).toBe(true);
  });

  it('is nothing for a free-tickets-only coupon', () => {
    expect(discountFor(coupon({ kind: 'FREE_TICKET', discount_type: null, discount_value: null }), 1000)).toBe(0);
  });

  it('is nothing on an empty or negative subtotal', () => {
    expect(discountFor(coupon(), 0)).toBe(0);
    expect(discountFor(coupon(), -50)).toBe(0);
  });

  it('is nothing for a coupon with a broken value', () => {
    expect(discountFor(coupon({ discount_value: 0 }), 1000)).toBe(0);
    expect(discountFor(coupon({ discount_value: null }), 1000)).toBe(0);
    expect(discountFor(null, 1000)).toBe(0);
  });
});

describe('free passes', () => {
  const freebie = (over: Partial<Coupon> = {}) =>
    coupon({ kind: 'FREE_TICKET', discount_type: null, discount_value: null, free_category_id: 'reg', free_qty: 1, ...over });

  it('adds a cart line priced at zero', () => {
    const [line] = freeLinesFor(freebie(), CATS, left);
    expect(line).toMatchObject({ categoryId: 'reg', name: 'REGULAR (STANDING)', prefix: 'REGULAR-', qty: 1, unitPrice: 0 });
  });

  it('carries the number width so the free pass is numbered like every other', () => {
    const [line] = freeLinesFor(freebie(), CATS, left);
    expect(line.numberWidth).toBe(3);
  });

  it('gives as many as the coupon says', () => {
    expect(freeLinesFor(freebie({ free_qty: 3 }), CATS, left)[0].qty).toBe(3);
  });

  it('always gives at least one, whatever nonsense is stored', () => {
    for (const qty of [0, -4, null, undefined, NaN]) {
      expect(freeLinesFor(freebie({ free_qty: qty as number }), CATS, left)[0].qty).toBe(1);
    }
  });

  it('is capped, so a mistyped quantity cannot empty the house', () => {
    // Two ceilings: MAX_FREE_QTY limits what one unit may earn, MAX_FREE_TOTAL limits the
    // whole order. For an INDIVIDUAL coupon the multiplier is one, so the order ceiling wins.
    expect(freeLinesFor(freebie({ free_qty: 500 }), CATS, left)[0].qty).toBe(Math.min(MAX_FREE_QTY, MAX_FREE_TOTAL));
  });

  it('is the only ceiling on a giveaway, since free passes skip the account cap', () => {
    // A gift is not the buyer spending what they are allowed to buy, so the per-account cap
    // does not apply to it — which makes this the only thing between a generous coupon and an
    // empty category. It is the natural maximum of the two caps behind it: at most ten free
    // per unit, across at most two bundle units.
    expect(MAX_FREE_TOTAL).toBe(MAX_FREE_QTY * MAX_BUNDLES_PER_ACCOUNT);
    expect(MAX_FREE_TOTAL).toBeGreaterThan(MAX_TICKETS_PER_ACCOUNT);
  });

  it('refuses when the category has since sold out', () => {
    // VIP is full. Silently giving nothing would mean a buyer who was promised a free pass
    // finds out at the gate.
    expect(() => freeLinesFor(freebie({ free_category_id: 'vip' }), CATS, left))
      .toThrow(/cannot be issued/i);
  });

  it('refuses when only some of the free passes would fit', () => {
    // 28 REGULAR left, coupon promises more than that.
    expect(() => freeLinesFor(freebie({ free_category_id: 'reg', free_qty: 10 }), CATS, (c) => (c.id === 'reg' ? 2 : 100)))
      .toThrow(/Only 2/);
  });

  it('refuses when the category was paused after the coupon was made', () => {
    expect(() => freeLinesFor(freebie({ free_category_id: 'paused' }), CATS, left)).toThrow(/paused/i);
  });

  it('refuses when the category was deleted after the coupon was made', () => {
    expect(() => freeLinesFor(freebie({ free_category_id: 'gone' }), CATS, left)).toThrow(/no longer has/i);
  });

  it('gives nothing for a discount-only coupon', () => {
    expect(freeLinesFor(coupon({ kind: 'DISCOUNT' }), CATS, left)).toEqual([]);
  });

  it('raises errors the API turns into a status code', () => {
    try {
      freeLinesFor(freebie({ free_category_id: 'vip' }), CATS, left);
    } catch (e) {
      expect(e).toBeInstanceOf(PaymentInputError);
      expect((e as PaymentInputError).status).toBe(409);
    }
  });
});

describe('both at once', () => {
  const both = coupon({
    kind: 'BOTH', discount_type: 'PERCENT', discount_value: 20,
    free_category_id: 'reg', free_qty: 2, code: 'BIGNIGHT',
  });

  it('gives the money off and the passes together', () => {
    const offer = applyCoupon(both, 2098, CATS, left)!;
    expect(offer.discount).toBe(419.6);
    expect(offer.freePasses).toBe(2);
    expect(offer.freeLines[0].unitPrice).toBe(0);
  });

  it('says what it did, in words a buyer understands', () => {
    expect(applyCoupon(both, 2098, CATS, left)!.summary).toBe('20% off + 2 free REGULAR (STANDING)');
    expect(applyCoupon(coupon({ discount_type: 'FLAT', discount_value: 250 }), 1000, CATS, left)!.summary)
      .toBe('₹250 off');
  });

  it('normalises the code it reports back', () => {
    expect(applyCoupon(coupon({ code: 'welcome10' }), 1000, CATS, left)!.code).toBe('WELCOME10');
  });

  it('is nothing at all when there is no coupon', () => {
    expect(applyCoupon(null, 1000, CATS, left)).toBeNull();
    expect(applyCoupon(undefined, 1000, CATS, left)).toBeNull();
  });

  it('describes an offer that can currently give nothing', () => {
    expect(offerSummary(coupon({ kind: 'DISCOUNT', discount_value: 0 }), 0, [])).toBe('No offer');
  });
});

describe('turning a database refusal into a sentence', () => {
  it('explains each one without leaking what else exists', () => {
    const cases: [string, RegExp][] = [
      ['COUPON_UNKNOWN', /not recognised/i],
      ['COUPON_INACTIVE', /no longer active/i],
      ['COUPON_EXPIRED', /expired/i],
      ['COUPON_WRONG_EVENT', /not valid for this event/i],
      ['COUPON_EXHAUSTED', /fully used/i],
    ];
    for (const [raised, reads] of cases) {
      const err = couponError(`error: ${raised}`)!;
      expect(err, raised).toBeInstanceOf(PaymentInputError);
      expect(err.message, raised).toMatch(reads);
    }
  });

  it('counts an account that has had its turn', () => {
    expect(couponError('COUPON_ALREADY_USED:1')!.message).toMatch(/already used that coupon\./i);
    expect(couponError('COUPON_ALREADY_USED:3')!.message).toMatch(/3 times/);
  });

  it('leaves anything it does not recognise alone, so a real fault is not dressed up', () => {
    expect(couponError('connection reset by peer')).toBeNull();
  });
});

describe('creating a coupon, from the admin side', () => {
  const CATEGORIES = [
    { id: 'reg', name: 'REGULAR' },
    { id: 'ap', name: 'ACCESS PASS', comp_only: true },
  ];
  const make = (over: Record<string, unknown> = {}) =>
    checkCouponInput({ code: 'save20', kind: 'DISCOUNT', discountType: 'PERCENT', discountValue: 20, ...over }, CATEGORIES);
  const no = (over: Record<string, unknown>) => {
    try { make(over); } catch (e) { return e as Error; }
    throw new Error('expected this to be refused');
  };

  it('upper-cases the code it stores', () => {
    expect(make().code).toBe('SAVE20');
  });

  it('defaults to counting free passes per order, not per bundle', () => {
    expect(make().scope).toBe('INDIVIDUAL');
    expect(make({ scope: 'bundle' }).scope).toBe('BUNDLE');
  });

  it('insists a discount coupon has a discount on it', () => {
    expect(no({ discountValue: 0 }).message).toMatch(/how much comes off/i);
    expect(no({ discountType: '' }).message).toMatch(/percentage or a flat amount/i);
    expect(no({ discountType: 'PERCENT', discountValue: 150 }).message).toMatch(/cannot be more than 100/i);
  });

  it('insists a free-ticket coupon says which type and how many', () => {
    const freebie = { kind: 'FREE_TICKET', eventId: 'e1' };
    expect(no({ ...freebie }).message).toMatch(/which ticket type/i);
    expect(no({ ...freebie, freeCategoryId: 'reg', freeQty: 0 }).message).toMatch(/at least 1 free ticket/i);
    expect(make({ ...freebie, freeCategoryId: 'reg', freeQty: 2 })).toMatchObject({ freeCategoryId: 'reg', freeQty: 2 });
  });

  it('refuses to give away the comp-only type', () => {
    expect(no({ kind: 'FREE_TICKET', eventId: 'e1', freeCategoryId: 'ap', freeQty: 1 }).message)
      .toMatch(/complimentary passes only/i);
  });

  it('caps how many free tickets one coupon may promise', () => {
    expect(no({ kind: 'FREE_TICKET', eventId: 'e1', freeCategoryId: 'reg', freeQty: 99 }).message)
      .toMatch(/At most/i);
  });

  it('refuses a code nobody could type back reliably', () => {
    for (const code of ['', 'AB', 'HAS SPACE!', '@@']) {
      expect(() => make({ code })).toThrow(/letters or numbers/i);
    }
  });

  it('treats an empty total as unlimited, and refuses nonsense', () => {
    expect(make({ maxUses: '' }).maxUses).toBeNull();
    expect(make({ maxUses: 50 }).maxUses).toBe(50);
    expect(no({ maxUses: 0 }).message).toMatch(/empty for unlimited/i);
  });

  it('refuses letting one account have more uses than the coupon has', () => {
    expect(no({ maxUses: 2, perAccountUses: 5 }).message).toMatch(/more uses than the coupon has/i);
  });

  it('reads an expiry date, and refuses one it cannot', () => {
    expect(make({ expiresAt: '2027-01-09T12:00:00Z' }).expiresAt).toBe('2027-01-09T12:00:00.000Z');
    expect(make().expiresAt).toBeNull();
    expect(no({ expiresAt: 'next tuesday-ish' }).message).toMatch(/could not be read/i);
  });

  it('keeps a note, trimmed and capped', () => {
    expect(make({ note: '  for the radio ad  ' }).note).toBe('for the radio ad');
    expect(make({ note: 'x'.repeat(500) }).note).toHaveLength(MAX_NOTE_LENGTH);
  });
});
