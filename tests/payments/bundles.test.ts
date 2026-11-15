// Creating a bundle, from the admin side.
//
// The checks worth having are the ones an admin can get wrong expensively rather than
// cosmetically: a bundle dearer than its parts, a unit cap promising seats the category does
// not have, a size bigger than the room. Each of those reaches a buyer as a broken offer
// rather than an error, which is why they are refused on the form.

import { describe, expect, it } from 'vitest';
import {
  MAX_BUNDLE_SIZE,
  MIN_BUNDLE_SIZE,
  bundleSaving,
  checkBundleInput,
  perSeatPrice,
  type BundleCategory,
} from '@/lib/payments/bundles';
import { PaymentInputError } from '@/lib/payments/types';

const CATS: BundleCategory[] = [
  { id: 'reg', name: 'REGULAR', price: 1000, capacity: 78, active: true },
  { id: 'open', name: 'OPEN', price: 500, capacity: null, active: true },
  { id: 'tiny', name: 'TINY', price: 2000, capacity: 10, active: true },
  { id: 'ap', name: 'ACCESS PASS', price: 0, capacity: 100, active: true, comp_only: true },
];

const input = (over: Record<string, unknown> = {}) =>
  checkBundleInput({ categoryId: 'reg', name: 'Squad of 5', size: 5, price: 4500, ...over }, CATS);

const refusal = (over: Record<string, unknown>) => {
  try { input(over); } catch (e) { return e as Error; }
  throw new Error('expected this to be refused');
};

describe('a well-formed bundle', () => {
  it('is accepted and tidied', () => {
    expect(input()).toEqual({
      categoryId: 'reg', name: 'Squad of 5', size: 5, price: 4500, maxBundles: null, active: true,
    });
  });

  it('tidies the name a paste brings with it', () => {
    expect(input({ name: '  Squad   of  5 ' }).name).toBe('Squad of 5');
  });

  it('treats an empty limit as unlimited', () => {
    for (const blank of ['', null, undefined, '   ']) {
      expect(input({ maxBundles: blank }).maxBundles).toBeNull();
    }
  });

  it('keeps a limit that fits', () => {
    expect(input({ maxBundles: 15 }).maxBundles).toBe(15);
  });

  it('allows a category with no capacity at all', () => {
    expect(input({ categoryId: 'open', price: 2000, maxBundles: 999 }).maxBundles).toBe(999);
  });
});

describe('what an admin is stopped from publishing', () => {
  it('a bundle of one, which is just a ticket', () => {
    expect(refusal({ size: 1 }).message).toMatch(new RegExp(`at least ${MIN_BUNDLE_SIZE}`, 'i'));
  });

  it('a bundle bigger than the cap', () => {
    expect(refusal({ size: MAX_BUNDLE_SIZE + 1 }).message).toMatch(/at most/i);
  });

  it('a bundle bigger than the room', () => {
    // TINY holds 10, so a bundle of 20 could never be filled. Checked on a small category
    // because the absolute size cap of 50 would otherwise fire first and hide this.
    expect(refusal({ categoryId: 'tiny', size: 20, price: 100 }).message).toMatch(/only has 10 seats/i);
  });

  it('a bundle that costs more than buying the seats separately', () => {
    // 5 x 1000 = 5000. Anything above that is a worse deal advertised as a better one.
    expect(refusal({ price: 5500 }).message).toMatch(/more than 5 tickets bought separately/i);
    expect(input({ price: 5000 }).price).toBe(5000);
  });

  it('a unit cap the category cannot supply', () => {
    // 20 bundles of 5 needs 100 seats; REGULAR has 78, so 15 fit.
    const e = refusal({ maxBundles: 20 });
    expect(e.message).toMatch(/needs 100 seats/i);
    expect(e.message).toMatch(/At most 15 fit/);
  });

  it('a bundle with no name worth showing', () => {
    expect(refusal({ name: ' ' }).message).toMatch(/name buyers will recognise/i);
    expect(refusal({ name: 'X' }).message).toMatch(/name buyers will recognise/i);
  });

  it('a bundle of a ticket type that is never sold', () => {
    expect(refusal({ categoryId: 'ap' }).message).toMatch(/complimentary passes only/i);
  });

  it('a bundle of a category that is not on this event', () => {
    expect(refusal({ categoryId: 'nope' }).message).toMatch(/Pick the ticket type/i);
  });

  it('a price that is not a number', () => {
    for (const bad of ['free', NaN, -100]) {
      expect(refusal({ price: bad }).message).toMatch(/price for the whole bundle/i);
    }
  });

  it('raises errors the API turns into a status code', () => {
    expect(refusal({ size: 1 })).toBeInstanceOf(PaymentInputError);
  });
});

describe('what the buyer is shown', () => {
  it('works out the per-seat price the receipt prints', () => {
    expect(perSeatPrice(4500, 5)).toBe(900);
    expect(perSeatPrice(4000, 3)).toBe(1333.33);
    expect(perSeatPrice(100, 0)).toBe(0);
  });

  it('works out the saving against buying separately', () => {
    expect(bundleSaving(4500, 5, 1000)).toBe(500);
    expect(bundleSaving(5000, 5, 1000)).toBe(0);
  });
});
