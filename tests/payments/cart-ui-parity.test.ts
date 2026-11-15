// The price on the screen and the price on the card.
//
// The booking page works the total out for itself — it has to, to show a figure before anyone
// commits — and the server works it out again from the cart it is sent. Two implementations of
// one calculation is a standing invitation for them to drift, and when they drift the buyer
// sees one number and is charged another. These pin them together.
//
// The page's formula is copied here deliberately rather than imported: if someone changes the
// page, this copy stops matching and the test fails, which is the whole point. Keep it in step
// with app/events/[id]/book/page.tsx.

import { describe, expect, it } from 'vitest';
import { quoteEventCart, grossUpToPaise, type TicketCategory, type TicketBundle } from '@/lib/payments/pricing';
import { applyCoupon, type Coupon, type CouponCategory } from '@/lib/payments/coupons';
import { seatsLeft } from '@/lib/payments/seats';

const REG = 'reg';
const VIP = 'vip';

const categories: TicketCategory[] = [
  { id: REG, name: 'REGULAR', prefix: 'REGULAR-', price: 1049, capacity: 78, sold: 52, active: true },
  { id: VIP, name: 'VIP', prefix: 'VIP-', price: 2500, capacity: 20, sold: 0, active: true },
];

const groupOf8: TicketBundle = {
  id: 'b8', category_id: REG, name: 'Group of 8', size: 8, price: 7000,
  max_bundles: 3, sold: 0, active: true,
};

interface Scenario {
  cart: Record<string, number>;
  bundleCart: Record<string, number>;
  isMember?: boolean;
  memberDiscountPercent?: number;
  coupon?: Coupon | null;
  loyaltyBalance?: number;
  applyPoints?: boolean;
}

const MIN_REDEEM_THRESHOLD = 50;

/** Exactly what app/events/[id]/book/page.tsx computes, in the same order. */
function whatThePageShows(s: Scenario) {
  const discount = s.isMember && (s.memberDiscountPercent || 0) > 0 ? s.memberDiscountPercent! : 0;

  const baseDiscountedPrice = categories.reduce((sum, cat) => {
    const catPrice = discount > 0 ? cat.price - (cat.price * discount) / 100 : cat.price;
    return sum + catPrice * (s.cart[cat.id] || 0);
  }, 0);

  const bundleTotal = [groupOf8].reduce((sum, b) => sum + Number(b.price) * (s.bundleCart[b.id] || 0), 0);
  const cartSubtotal = baseDiscountedPrice + bundleTotal;

  // The page asks /api/coupons/preview, which prices the coupon with applyCoupon on the same
  // subtotal — so the figure it receives is this one.
  const bundleUnits = Object.values(s.bundleCart).reduce((a, b) => a + b, 0);
  const offer = s.coupon
    ? applyCoupon(s.coupon, cartSubtotal, categories as CouponCategory[], (c) => seatsLeft(c), bundleUnits)
    : null;

  const couponOff = Math.min(offer?.discount ?? 0, cartSubtotal);
  const afterCoupon = Math.max(0, Math.round((cartSubtotal - couponOff) * 100) / 100);

  const balance = s.loyaltyBalance ?? 0;
  const maxRedeemable = Math.max(0, Math.min(balance, Math.floor(afterCoupon - 1)));
  const pointsToRedeem =
    s.applyPoints && balance >= MIN_REDEEM_THRESHOLD && maxRedeemable >= 1 ? maxRedeemable : 0;

  const totalPrice = afterCoupon - pointsToRedeem;
  return { subtotal: cartSubtotal, couponOff, pointsToRedeem, totalPrice, chargePaise: grossUpToPaise(totalPrice) };
}

/** What the server will actually charge for the same cart. */
function whatTheServerCharges(s: Scenario) {
  const q = quoteEventCart({
    cart: s.cart,
    categories,
    isLoggedIn: true,
    isMember: !!s.isMember,
    memberDiscountPercent: s.memberDiscountPercent || 0,
    pointsToRedeem: whatThePageShows(s).pointsToRedeem,
    loyaltyBalance: s.loyaltyBalance ?? 0,
    previouslyBought: 0,
    coupon: s.coupon ?? null,
    bundles: [groupOf8],
    bundleCart: s.bundleCart,
  } as never);
  return { subtotal: q.subtotal, couponOff: q.couponDiscount, pointsToRedeem: q.pointsApplied, totalPrice: q.total, chargePaise: grossUpToPaise(q.total) };
}

const coupon = (over: Record<string, unknown> = {}): Coupon => ({
  id: 'c1', code: 'TEST', event_id: null, kind: 'DISCOUNT', scope: 'INDIVIDUAL',
  discount_type: 'PERCENT', discount_value: 20,
  free_category_id: null, free_qty: null,
  max_uses: null, uses: 0, per_account_uses: 1, active: true, expires_at: null,
  ...over,
} as unknown as Coupon);

const SCENARIOS: [string, Scenario][] = [
  ['one individual pass', { cart: { [REG]: 1 }, bundleCart: {} }],
  ['several individual passes', { cart: { [REG]: 3 }, bundleCart: {} }],
  ['a mix of categories', { cart: { [REG]: 2, [VIP]: 1 }, bundleCart: {} }],
  ['the full seven', { cart: { [REG]: 7 }, bundleCart: {} }],
  ['one group only', { cart: {}, bundleCart: { b8: 1 } }],
  ['two groups only', { cart: {}, bundleCart: { b8: 2 } }],
  ['a group and singles', { cart: { [REG]: 2 }, bundleCart: { b8: 1 } }],
  ['member rate on singles', { cart: { [REG]: 3 }, bundleCart: {}, isMember: true, memberDiscountPercent: 10 }],
  ['member rate with a group', { cart: { [REG]: 2 }, bundleCart: { b8: 1 }, isMember: true, memberDiscountPercent: 10 }],
  ['percent coupon on singles', { cart: { [REG]: 2 }, bundleCart: {}, coupon: coupon() }],
  ['percent coupon on a group', { cart: {}, bundleCart: { b8: 1 }, coupon: coupon() }],
  ['percent coupon on both', { cart: { [REG]: 2 }, bundleCart: { b8: 1 }, coupon: coupon() }],
  ['flat coupon', { cart: { [REG]: 2 }, bundleCart: {}, coupon: coupon({ discount_type: 'FLAT', discount_value: 250 }) }],
  ['free-ticket coupon', { cart: { [REG]: 2 }, bundleCart: {}, coupon: coupon({ kind: 'FREE_TICKET', discount_type: null, discount_value: null, free_category_id: REG, free_qty: 1 }) }],
  ['group-scoped free coupon', { cart: {}, bundleCart: { b8: 2 }, coupon: coupon({ kind: 'FREE_TICKET', discount_type: null, discount_value: null, free_category_id: REG, free_qty: 1, scope: 'BUNDLE' }) }],
  ['coupon that both discounts and gifts', { cart: { [REG]: 2 }, bundleCart: {}, coupon: coupon({ kind: 'BOTH', free_category_id: REG, free_qty: 1 }) }],
  ['points only', { cart: { [REG]: 2 }, bundleCart: {}, loyaltyBalance: 300, applyPoints: true }],
  ['points below the threshold are not offered', { cart: { [REG]: 2 }, bundleCart: {}, loyaltyBalance: 20, applyPoints: true }],
  ['points and a coupon', { cart: { [REG]: 2 }, bundleCart: {}, coupon: coupon(), loyaltyBalance: 300, applyPoints: true }],
  ['everything at once', {
    cart: { [REG]: 7 }, bundleCart: { b8: 2 }, isMember: true, memberDiscountPercent: 10,
    coupon: coupon({ kind: 'BOTH', free_category_id: REG, free_qty: 1, scope: 'BUNDLE' }),
    loyaltyBalance: 500, applyPoints: true,
  }],
];

describe('the cart shows what the card is charged', () => {
  it.each(SCENARIOS)('%s', (_name, scenario) => {
    const shown = whatThePageShows(scenario);
    const charged = whatTheServerCharges(scenario);
    expect(shown).toEqual(charged);
  });

  it('agrees to the paisa, including the gateway fee', () => {
    for (const [, scenario] of SCENARIOS) {
      const shown = whatThePageShows(scenario);
      const charged = whatTheServerCharges(scenario);
      expect(shown.chargePaise).toBe(charged.chargePaise);
      // And the buyer is never shown a figure that cannot be charged.
      expect(charged.chargePaise).toBeGreaterThanOrEqual(100);
    }
  });
});
