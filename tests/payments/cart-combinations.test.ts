// The cart, in every combination a buyer can actually produce.
//
// Individual passes, group tickets, coupons that discount, coupons that give tickets away,
// coupons scoped to groups, member pricing, points, and the caps — crossed with each other,
// because each piece works on its own and the money is decided by the order they are applied
// in. A buyer who is a member, holding a group ticket, redeeming points, with a coupon, is not
// an exotic case: it is a Saturday.
//
// Everything here is the figure the SERVER would charge. The cart on the page computes the same
// number a second time for display, and the two are compared in tests/payments/cart-ui.test.ts.

import { describe, expect, it } from 'vitest';
import { quoteEventCart, MAX_TICKETS_PER_ACCOUNT, MAX_BUNDLES_PER_ACCOUNT, type TicketCategory, type TicketBundle } from '@/lib/payments/pricing';
import { PaymentInputError } from '@/lib/payments/types';
import type { Coupon } from '@/lib/payments/coupons';

const REG = 'reg';
const VIP = 'vip';
const AP = 'ap';

const categories: TicketCategory[] = [
  { id: REG, name: 'REGULAR', prefix: 'REGULAR-', price: 1000, capacity: 100, sold: 0, active: true },
  { id: VIP, name: 'VIP', prefix: 'VIP-', price: 2500, capacity: 20, sold: 0, active: true },
  { id: AP, name: 'ACCESS PASS', prefix: 'AP-', price: 0, capacity: 50, sold: 0, active: true, comp_only: true },
];

const groupOf8: TicketBundle = {
  id: 'b8', category_id: REG, name: 'Group of 8', size: 8, price: 7000,
  max_bundles: 3, sold: 0, active: true,
};

const base = {
  categories,
  isLoggedIn: true,
  isMember: false,
  memberDiscountPercent: 0,
  pointsToRedeem: 0,
  loyaltyBalance: 0,
  previouslyBought: 0,
  bundles: [groupOf8],
};

const quote = (over: Record<string, unknown> = {}) =>
  quoteEventCart({ ...base, cart: {}, bundleCart: {}, ...over } as never);

const coupon = (over: Record<string, unknown> = {}): Coupon => ({
  id: 'c1', code: 'TEST', event_id: null, kind: 'DISCOUNT', scope: 'INDIVIDUAL',
  discount_type: 'PERCENT', discount_value: 20,
  free_category_id: null, free_qty: null,
  max_uses: null, uses: 0, per_account_uses: 1, active: true, expires_at: null,
  ...over,
} as unknown as Coupon);

// ---------------------------------------------------------------------------------------------
describe('individual tickets only', () => {
  it('one pass', () => {
    const q = quote({ cart: { [REG]: 1 } });
    expect(q.subtotal).toBe(1000);
    expect(q.total).toBe(1000);
  });

  it('several of one type', () => {
    expect(quote({ cart: { [REG]: 3 } }).total).toBe(3000);
  });

  it('a mix of types', () => {
    const q = quote({ cart: { [REG]: 2, [VIP]: 1 } });
    expect(q.total).toBe(4500);
    expect(q.lines).toHaveLength(2);
  });

  it('the full personal allowance', () => {
    expect(quote({ cart: { [REG]: MAX_TICKETS_PER_ACCOUNT } }).total).toBe(7000);
  });

  it('one more than the allowance is refused', () => {
    expect(() => quote({ cart: { [REG]: MAX_TICKETS_PER_ACCOUNT + 1 } })).toThrow(PaymentInputError);
  });

  it('the allowance counts what the account already holds', () => {
    expect(() => quote({ cart: { [REG]: 3 }, previouslyBought: 5 })).toThrow(/maximum of 7/i);
  });

  it('an empty cart is refused', () => {
    expect(() => quote({ cart: {} })).toThrow(/at least one pass/i);
  });

  it('a complimentary-only category can never be bought', () => {
    expect(() => quote({ cart: { [AP]: 1 } })).toThrow(/Invalid category/i);
  });

  it('a paused category is refused by name', () => {
    const paused = [{ ...categories[0], active: false }, categories[1], categories[2]];
    expect(() => quote({ categories: paused, cart: { [REG]: 1 } })).toThrow(/no longer on sale/i);
  });

  it('more than the seats left is refused', () => {
    const nearly = [{ ...categories[0], sold: 98 }, categories[1], categories[2]];
    expect(() => quote({ categories: nearly, cart: { [REG]: 3 } })).toThrow(/sold out/i);
  });
});

// ---------------------------------------------------------------------------------------------
describe('group tickets only', () => {
  it('one group, priced whole and not per seat', () => {
    const q = quote({ bundleCart: { b8: 1 } });
    expect(q.total).toBe(7000);
    expect(q.bundleUnits).toBe(1);
    // 8 seats at 875, not 8 at 1000.
    expect(q.lines[0]).toMatchObject({ qty: 8, unitPrice: 875, bundleId: 'b8' });
  });

  it('two groups', () => {
    const q = quote({ bundleCart: { b8: 2 } });
    expect(q.total).toBe(14000);
    expect(q.bundleUnits).toBe(2);
    // One line per unit, so each can carry its own reference.
    expect(q.lines).toHaveLength(2);
  });

  it('a third group passes the quote, and is stopped by the reservation', () => {
    // The per-account group cap lives in SQL, where it can see groups held by another open
    // checkout too — see tests/sql/group-of-eight.test.ts. The quote prices what was asked
    // for; reserve_order_inventory is what refuses it, as LIMIT_BUNDLES.
    expect(quote({ bundleCart: { b8: MAX_BUNDLES_PER_ACCOUNT + 1 } }).bundleUnits)
      .toBe(MAX_BUNDLES_PER_ACCOUNT + 1);
  });

  it('does not touch the seven individual passes', () => {
    // Eight seats held in a group, and all seven singles still available.
    const q = quote({ cart: { [REG]: 7 }, bundleCart: { b8: 1 } });
    expect(q.total).toBe(7000 + 7000);
  });

  it('a group beyond the run left is refused', () => {
    const nearlyGone = { ...groupOf8, max_bundles: 2, sold: 2 };
    expect(() => quote({ bundles: [nearlyGone], bundleCart: { b8: 1 } })).toThrow(/sold out/i);
  });

  it('a group whose category cannot seat it is refused', () => {
    const tight = [{ ...categories[0], sold: 95 }, categories[1], categories[2]];
    expect(() => quote({ categories: tight, bundleCart: { b8: 1 } })).toThrow(/does not have 8 seats/i);
  });

  it('a paused group is refused', () => {
    expect(() => quote({ bundles: [{ ...groupOf8, active: false }], bundleCart: { b8: 1 } }))
      .toThrow(/no longer available/i);
  });

  it('a group id that is not on this event is refused', () => {
    expect(() => quote({ bundleCart: { nope: 1 } })).toThrow(/Invalid bundle/i);
  });
});

// ---------------------------------------------------------------------------------------------
describe('a discount coupon', () => {
  it('takes a percentage off individual tickets', () => {
    const q = quote({ cart: { [REG]: 2 }, coupon: coupon() });
    expect(q.couponDiscount).toBe(400);
    expect(q.total).toBe(1600);
  });

  it('takes a percentage off a group too', () => {
    const q = quote({ bundleCart: { b8: 1 }, coupon: coupon() });
    expect(q.couponDiscount).toBe(1400);
    expect(q.total).toBe(5600);
  });

  it('takes a percentage off both together', () => {
    const q = quote({ cart: { [REG]: 2 }, bundleCart: { b8: 1 }, coupon: coupon() });
    expect(q.subtotal).toBe(9000);
    expect(q.couponDiscount).toBe(1800);
    expect(q.total).toBe(7200);
  });

  it('takes a flat amount off', () => {
    const q = quote({ cart: { [REG]: 2 }, coupon: coupon({ discount_type: 'FLAT', discount_value: 250 }) });
    expect(q.total).toBe(1750);
  });

  it('is refused rather than taking the order to nothing', () => {
    // A gateway cannot charge zero, so a coupon worth more than the cart is a dead end. Said
    // in words the buyer can act on instead of failing later at Razorpay.
    expect(() => quote({ cart: { [REG]: 1 }, coupon: coupon({ discount_type: 'FLAT', discount_value: 5000 }) }))
      .toThrow(/covers almost the whole order/i);
  });

  it('a discount that leaves at least a rupee is fine', () => {
    const q = quote({ cart: { [REG]: 1 }, coupon: coupon({ discount_type: 'FLAT', discount_value: 999 }) });
    expect(q.total).toBe(1);
  });

  it('is simply absent when no coupon is applied', () => {
    const q = quote({ cart: { [REG]: 2 } });
    expect(q.couponDiscount).toBe(0);
    expect(q.coupon).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
describe('a coupon that gives tickets away', () => {
  const freebie = (over: Record<string, unknown> = {}) => coupon({
    kind: 'FREE_TICKET', discount_type: null, discount_value: null,
    free_category_id: REG, free_qty: 1, ...over,
  });

  it('adds a free pass at no charge', () => {
    const q = quote({ cart: { [REG]: 1 }, coupon: freebie() });
    expect(q.total).toBe(1000);
    const free = q.lines.filter((l) => l.free);
    expect(free).toHaveLength(1);
    expect(free[0].unitPrice).toBe(0);
  });

  it('gives several when the coupon says so', () => {
    const q = quote({ cart: { [REG]: 1 }, coupon: freebie({ free_qty: 3 }) });
    expect(q.lines.find((l) => l.free)!.qty).toBe(3);
    expect(q.total).toBe(1000);
  });

  it('counted per group when it is scoped that way', () => {
    const q = quote({ bundleCart: { b8: 2 }, coupon: freebie({ scope: 'BUNDLE' }) });
    expect(q.lines.find((l) => l.free)!.qty).toBe(2);
  });

  it('a group-scoped coupon on a cart with no group says so plainly', () => {
    expect(() => quote({ cart: { [REG]: 2 }, coupon: freebie({ scope: 'BUNDLE' }) }))
      .toThrow(/only applies when you buy a group ticket/i);
  });

  it('refuses when the free category has sold out', () => {
    const gone = [{ ...categories[0], sold: 100 }, categories[1], categories[2]];
    expect(() => quote({ categories: gone, cart: { [VIP]: 1 }, coupon: freebie() }))
      .toThrow(/cannot be issued/i);
  });

  it('does both at once when the coupon is BOTH', () => {
    const q = quote({
      cart: { [REG]: 2 },
      coupon: coupon({ kind: 'BOTH', free_category_id: REG, free_qty: 1 }),
    });
    expect(q.couponDiscount).toBe(400);
    expect(q.total).toBe(1600);
    expect(q.lines.some((l) => l.free)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
describe('member pricing, points and a coupon, in the order they are applied', () => {
  it('the member discount comes off first', () => {
    const q = quote({ cart: { [REG]: 2 }, isMember: true, memberDiscountPercent: 10 });
    expect(q.subtotal).toBe(1800);
  });

  it('then the coupon, on the already-discounted figure', () => {
    const q = quote({
      cart: { [REG]: 2 }, isMember: true, memberDiscountPercent: 10, coupon: coupon(),
    });
    // 2000 -> 1800 (member) -> 360 off (20% of 1800) -> 1440
    expect(q.subtotal).toBe(1800);
    expect(q.couponDiscount).toBe(360);
    expect(q.total).toBe(1440);
  });

  it('then points, last of all', () => {
    const q = quote({
      cart: { [REG]: 2 }, isMember: true, memberDiscountPercent: 10,
      coupon: coupon(), pointsToRedeem: 200, loyaltyBalance: 500,
    });
    expect(q.pointsApplied).toBe(200);
    expect(q.total).toBe(1240);
  });

  it('a member rate does not apply to a group, which is already a deal', () => {
    const q = quote({ bundleCart: { b8: 1 }, isMember: true, memberDiscountPercent: 10 });
    expect(q.total).toBe(7000);
  });

  it('points can never take the total below one rupee', () => {
    const q = quote({ cart: { [REG]: 1 }, pointsToRedeem: 5000, loyaltyBalance: 5000 });
    expect(q.total).toBeGreaterThanOrEqual(1);
  });

  it('points beyond the balance are refused', () => {
    expect(() => quote({ cart: { [REG]: 2 }, pointsToRedeem: 900, loyaltyBalance: 100 }))
      .toThrow(PaymentInputError);
  });
});

// ---------------------------------------------------------------------------------------------
describe('the whole Saturday cart', () => {
  it('a member buying 7 singles and 2 groups, with a coupon and points', () => {
    const q = quote({
      cart: { [REG]: 7 },
      bundleCart: { b8: 2 },
      isMember: true,
      memberDiscountPercent: 10,
      coupon: coupon({ kind: 'BOTH', free_category_id: REG, free_qty: 1, scope: 'BUNDLE' }),
      pointsToRedeem: 500,
      loyaltyBalance: 500,
    });

    // 7 x 900 (member rate) = 6300, plus 2 groups at 7000 = 14000 -> 20300
    expect(q.subtotal).toBe(20300);
    // 20% off the lot
    expect(q.couponDiscount).toBe(4060);
    // two groups, so two free passes
    expect(q.lines.find((l) => l.free)!.qty).toBe(2);
    expect(q.pointsApplied).toBe(500);
    expect(q.total).toBe(20300 - 4060 - 500);
    expect(q.bundleUnits).toBe(2);
  });

  it('still refuses an eighth single in that cart', () => {
    expect(() => quote({
      cart: { [REG]: 8 }, bundleCart: { b8: 2 }, isMember: true, memberDiscountPercent: 10,
    })).toThrow(/maximum of 7/i);
  });
});
