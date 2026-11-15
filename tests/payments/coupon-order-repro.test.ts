// Reproducing "Failed to create order" when a coupon is applied.
//
// That message is the order route's LAST resort — the branch for an exception it did not
// recognise. Anything expected (sold out, a cap, a bad coupon) is supposed to come back as a
// sentence the buyer can act on. So this walks the same sequence the route walks, with the
// coupon exactly as it is stored in production, and asks what actually comes out.

import { describe, expect, it } from 'vitest';
import { quoteEventCart, type TicketCategory, type TicketBundle } from '@/lib/payments/pricing';
import { PaymentInputError } from '@/lib/payments/types';
import type { Coupon } from '@/lib/payments/coupons';

const REG = '6e11e010-4d5e-4260-9f13-5cf4df040362';

const categories: TicketCategory[] = [
  { id: REG, name: 'REGULAR (STANDING)', prefix: 'REGULAR-', price: 1049, capacity: 78, sold: 52, active: true },
];

// BOGOREG, as stored: free ticket, counted PER BUNDLE, one per bundle.
const bogoreg = {
  id: 'c1', code: 'BOGOREG', event_id: '6aea209e10f1401309f4f634',
  kind: 'FREE_TICKET', scope: 'BUNDLE',
  discount_type: null, discount_value: null,
  free_category_id: REG, free_qty: 1,
  max_uses: 1, uses: 0, per_account_uses: 1, active: true, expires_at: null,
} as unknown as Coupon;

const base = {
  categories,
  isLoggedIn: true,
  isMember: false,
  memberDiscountPercent: 0,
  pointsToRedeem: 0,
  loyaltyBalance: 0,
  previouslyBought: 0,
};

/** What the route would end up sending the buyer. */
function asRouteWould(fn: () => unknown): { kind: 'ok' } | { kind: 'friendly'; status: number; message: string } | { kind: 'FAILED TO CREATE ORDER'; error: string } {
  try {
    fn();
    return { kind: 'ok' };
  } catch (e) {
    if (e instanceof PaymentInputError) return { kind: 'friendly', status: e.status, message: e.message };
    return { kind: 'FAILED TO CREATE ORDER', error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
  }
}

describe('a bundle-scoped coupon', () => {
  it('with no bundle in the cart, is refused in words the buyer can act on', () => {
    const out = asRouteWould(() => quoteEventCart({
      ...base, cart: { [REG]: 2 }, coupon: bogoreg, bundles: [], bundleCart: {},
    } as never));
    expect(out).toMatchObject({ kind: 'friendly', status: 409 });
  });

  it('with a bundle in the cart, prices the free pass', () => {
    const squad: TicketBundle = {
      id: 'b1', category_id: REG, name: 'Group of 8', size: 8, price: 7000,
      max_bundles: null, sold: 0, active: true,
    };
    const out = asRouteWould(() => quoteEventCart({
      ...base, cart: {}, coupon: bogoreg, bundles: [squad], bundleCart: { b1: 1 },
    } as never));
    expect(out).toMatchObject({ kind: 'ok' });
  });

  it('with a bundle AND singles, still prices', () => {
    const squad: TicketBundle = {
      id: 'b1', category_id: REG, name: 'Group of 8', size: 8, price: 7000,
      max_bundles: null, sold: 0, active: true,
    };
    const out = asRouteWould(() => quoteEventCart({
      ...base, cart: { [REG]: 2 }, coupon: bogoreg, bundles: [squad], bundleCart: { b1: 1 },
    } as never));
    expect(out).toMatchObject({ kind: 'ok' });
  });
});

describe('what the coupon actually produces', () => {
  const squad: TicketBundle = {
    id: 'b1', category_id: REG, name: 'Group of 8', size: 8, price: 7000,
    max_bundles: null, sold: 0, active: true,
  };

  it('a free line in the same category the bundle draws from', () => {
    const q = quoteEventCart({
      ...base, cart: {}, coupon: bogoreg, bundles: [squad], bundleCart: { b1: 1 },
    } as never);
    const free = q.lines.filter((l) => l.free);
    const bundleLines = q.lines.filter((l) => l.bundleId);
    expect(bundleLines).toHaveLength(1);
    expect(free).toHaveLength(1);
    // Both are REGULAR: the reservation will be asked for the same category twice.
    expect(free[0].categoryId).toBe(REG);
    expect(bundleLines[0].categoryId).toBe(REG);
    expect(q.total).toBe(7000);
  });
});
