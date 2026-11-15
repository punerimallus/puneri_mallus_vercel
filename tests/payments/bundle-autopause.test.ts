// A group offer stops itself when its category can no longer fill it.
//
// The case, in the numbers it was reported in: REGULAR holds 78, a "Group of 10" is on sale,
// and individual sales take REGULAR to 69 gone. Nine seats left cannot make a group of ten, so
// the offer is finished — even though its own counter still says every unit is available, and
// even though the admin never paused anything.
//
// Three layers have to agree, and they are tested separately here because they fail
// differently:
//   * bundleAvailability — the one rule, shared by the booking page and the admin screen
//   * quoteEventCart     — the server, which refuses the sale whatever the page showed
//   * checkBundleInput   — creation, which should not mint an offer that is born stopped
//
// The pause is DERIVED, never written to the offer's `active` column. That is the point: a
// refund, a void or an abandoned cart gives seats back, and an offer that had flipped its own
// flag would stay dark until somebody noticed.

import { describe, expect, it } from 'vitest';
import {
  bundleAvailability,
  bundleStopReason,
  bundlesLeft,
  quoteEventCart,
  type TicketBundle,
  type TicketCategory,
} from '@/lib/payments/pricing';
import { checkBundleInput, type BundleCategory } from '@/lib/payments/bundles';
import { PaymentInputError } from '@/lib/payments/types';

/** REGULAR as it actually stands on the live event: 78 seats. */
const regular = (sold: number, over: Partial<TicketCategory> = {}): TicketCategory => ({
  id: 'reg', name: 'REGULAR', prefix: 'REGULAR-', price: 1049, capacity: 78, sold, active: true, ...over,
});

const groupOf10: TicketBundle = {
  id: 'b10', category_id: 'reg', name: 'Group of 10', size: 10, price: 9000,
  max_bundles: null, sold: 0, active: true,
};

describe('the seat-count pause', () => {
  it('is open while the category can fill a group', () => {
    const a = bundleAvailability(groupOf10, regular(52));
    expect(a.sellable).toBe(true);
    expect(a.autoPaused).toBe(false);
    expect(a.seatsLeft).toBe(26);
    expect(a.units).toBe(2); // 26 left, 10 a group
  });

  it('closes the moment the seats left cannot fill one', () => {
    // 69 of 78 gone: nine left, a group needs ten.
    const a = bundleAvailability(groupOf10, regular(69));
    expect(a.seatsLeft).toBe(9);
    expect(a.units).toBe(0);
    expect(a.sellable).toBe(false);
    expect(a.autoPaused).toBe(true);
    expect(a.stop).toBe('NOT_ENOUGH_SEATS');
  });

  it('closes on the exact boundary and not one seat before it', () => {
    expect(bundleAvailability(groupOf10, regular(68)).sellable).toBe(true);  // 10 left
    expect(bundleAvailability(groupOf10, regular(69)).sellable).toBe(false); // 9 left
  });

  it('says how few are left, in the category\'s own name', () => {
    const a = bundleAvailability(groupOf10, regular(69));
    expect(bundleStopReason(a, 'REGULAR')).toBe('Only 9 REGULAR left — a group takes 10.');
  });

  it('opens again by itself when seats come back', () => {
    // A refund releases seats, so `released` rises and the offer returns with no admin action
    // and nothing to undo. This is why the pause is derived rather than stored.
    const refunded = regular(72, { released: 10 } as Partial<TicketCategory>);
    const a = bundleAvailability(groupOf10, refunded);
    expect(a.seatsLeft).toBe(16);
    expect(a.sellable).toBe(true);
    expect(a.autoPaused).toBe(false);
  });

  it('leaves the admin\'s own pause distinguishable from the automatic one', () => {
    const byHand = bundleAvailability({ ...groupOf10, active: false }, regular(52));
    expect(byHand.stop).toBe('PAUSED');
    expect(byHand.autoPaused).toBe(false);

    const byItself = bundleAvailability(groupOf10, regular(69));
    expect(byItself.stop).toBe('NOT_ENOUGH_SEATS');
    expect(byItself.autoPaused).toBe(true);
  });

  it('calls a finished run sold out rather than short of seats', () => {
    // Both would stop the sale; they are different sentences to a buyer, and the offer's own
    // run is the one that is really "sold out".
    const run = bundleAvailability({ ...groupOf10, max_bundles: 2, sold: 2 }, regular(0));
    expect(run.stop).toBe('RUN_SOLD_OUT');
    expect(run.autoPaused).toBe(false);
    expect(bundleStopReason(run, 'REGULAR')).toBe('Sold out.');
  });

  it('takes whichever of the two limits runs out first', () => {
    // Run says 3 left, seats say 2 fit.
    const b = { ...groupOf10, max_bundles: 5, sold: 2 };
    expect(bundlesLeft(b)).toBe(3);
    expect(bundleAvailability(b, regular(58)).units).toBe(2);
    // And the other way round: seats fit 7, the run has 1.
    expect(bundleAvailability({ ...groupOf10, max_bundles: 3, sold: 2 }, regular(0)).units).toBe(1);
  });

  it('counts what the cart in front of the buyer is already taking', () => {
    // 26 seats left, which is two groups — until the buyer puts seven singles in the same
    // category, leaving 19, which is one. The card has to react then, not at Proceed to Pay.
    const open = regular(52);
    expect(bundleAvailability(groupOf10, open).units).toBe(2);
    expect(bundleAvailability(groupOf10, open, 7).units).toBe(1);
    expect(bundleAvailability(groupOf10, open, 17).units).toBe(0);
    expect(bundleAvailability(groupOf10, open, 17).autoPaused).toBe(true);
  });

  it('stops a closed, hidden or complimentary-only category before anything else', () => {
    expect(bundleAvailability(groupOf10, regular(0, { active: false })).stop).toBe('CATEGORY_CLOSED');
    expect(bundleAvailability(groupOf10, regular(0, { comp_only: true } as Partial<TicketCategory>)).stop)
      .toBe('CATEGORY_CLOSED');
    expect(bundleAvailability(groupOf10, null).stop).toBe('CATEGORY_CLOSED');
    // A missing category is not reported as "not enough seats": the seats are not the problem.
    expect(bundleAvailability(groupOf10, null).autoPaused).toBe(false);
  });

  it('never pauses a group on an uncapped category', () => {
    const a = bundleAvailability(groupOf10, regular(1000, { capacity: null }));
    expect(a.seatsLeft).toBeNull();
    expect(a.units).toBeNull();
    expect(a.sellable).toBe(true);
  });

  it('reports nothing when there is nothing to report', () => {
    expect(bundleStopReason(bundleAvailability(groupOf10, regular(52)))).toBeNull();
  });
});

describe('the server refuses it whatever the page showed', () => {
  // The page is a courtesy; this is the enforcement. A buyer on a stale tab, or anyone posting
  // the cart by hand, meets the same answer.
  const quote = (cats: TicketCategory[], over: Record<string, unknown> = {}) =>
    quoteEventCart({
      categories: cats,
      cart: {},
      bundles: [groupOf10],
      isLoggedIn: true,
      isMember: false,
      memberDiscountPercent: 0,
      pointsToRedeem: 0,
      loyaltyBalance: 0,
      previouslyBought: 0,
      ...over,
    } as never);

  it('sells the group while the seats are there', () => {
    const q = quote([regular(52)], { bundleCart: { b10: 1 } });
    expect(q.subtotal).toBe(9000);
    expect(q.bundleUnits).toBe(1);
  });

  it('refuses it once the category is down to nine', () => {
    expect(() => quote([regular(69)], { bundleCart: { b10: 1 } })).toThrow(/does not have 10 seats/i);
  });

  it('refuses it when the singles in the same cart are what leave it short', () => {
    // 68 gone leaves exactly 10, so the group fits on its own — but not beside two singles.
    expect(() => quote([regular(68)], { cart: { reg: 2 }, bundleCart: { b10: 1 } }))
      .toThrow(/does not have 10 seats/i);
    expect(quote([regular(68)], { bundleCart: { b10: 1 } }).bundleUnits).toBe(1);
  });

  it('refuses the second group when only one fits', () => {
    expect(() => quote([regular(60)], { bundleCart: { b10: 2 } })).toThrow(/does not have 20 seats/i);
  });

  it('charges nothing — it throws before any total exists', () => {
    // The refusal is a 409 the buyer can read, not a 500, and not a sale at a wrong price.
    try {
      quote([regular(69)], { bundleCart: { b10: 1 } });
      throw new Error('should have refused');
    } catch (e) {
      expect(e).toBeInstanceOf(PaymentInputError);
      expect((e as PaymentInputError).status).toBe(409);
    }
  });
});

describe('creating a group that could never be filled', () => {
  const cat = (sold: number): BundleCategory => ({
    id: 'reg', name: 'REGULAR', price: 1049, capacity: 78, sold,
  });

  const form = { categoryId: 'reg', name: 'Group of 10', size: 10, price: 9000 };

  it('is refused while fewer seats than that are left', () => {
    expect(() => checkBundleInput(form, [cat(69)], { isNew: true }))
      .toThrow(/Only 9 "REGULAR" seats are left/i);
  });

  it('is allowed when they are', () => {
    const clean = checkBundleInput(form, [cat(52)], { isNew: true });
    expect(clean.size).toBe(10);
  });

  it('still allows EDITING one that has stopped selling', () => {
    // The offer that has gone quiet is exactly the one whose price an admin wants to change,
    // so the seats-left rule is for creation only.
    const clean = checkBundleInput({ ...form, price: 7500 }, [cat(69)]);
    expect(clean.price).toBe(7500);
  });

  it('is unaffected on a category with no capacity set', () => {
    const uncapped: BundleCategory = { id: 'reg', name: 'REGULAR', price: 1049, capacity: null, sold: 500 };
    expect(checkBundleInput(form, [uncapped], { isNew: true }).size).toBe(10);
  });
});
