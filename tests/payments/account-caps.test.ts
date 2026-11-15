// The three rules a buyer is actually held to:
//
//   * at most 7 individual passes
//   * at most 2 group tickets, counted as GROUPS, not seats
//   * a coupon's free pass spends neither allowance
//
// The database enforces all three (tests/sql/group-of-eight.test.ts proves that against real
// Postgres). These cover the application's own pre-check, which runs FIRST and so can refuse a
// sale the database would have allowed — a cap that is wrong here is just as closed to the
// buyer as a cap that is wrong in SQL.

import { describe, expect, it } from 'vitest';
import { buildIssuedTickets } from '@/lib/payments/fulfil';
import { quoteEventCart, MAX_TICKETS_PER_ACCOUNT, type TicketCategory } from '@/lib/payments/pricing';
import type { Allocation, CartLine, PaymentOrder } from '@/lib/payments/types';

const REG = 'cat_reg';

const categories: TicketCategory[] = [
  { id: REG, name: 'REGULAR', prefix: 'REGULAR-', price: 1000, capacity: 200, sold: 0, active: true },
];

/** The passes a group purchase leaves on the booking. */
function passesFromGroupOfEight() {
  const cart: CartLine[] = [{
    categoryId: REG, name: 'Group of 8 (REGULAR)', prefix: 'REGULAR-',
    qty: 8, unitPrice: 875, numberWidth: 3, bundleId: 'b1', bundleName: 'Group of 8',
  }];
  const allocations: Allocation[] = [{ categoryId: REG, qty: 8, numbers: [1, 2, 3, 4, 5, 6, 7, 8], endSold: 8 }];
  return buildIssuedTickets({ cart, allocated_tickets: allocations } as unknown as PaymentOrder, allocations);
}

/** Exactly how the order route works out what this account has already bought. */
const previouslyBoughtFrom = (passes: { free?: boolean; group?: boolean }[]) =>
  passes.filter((t) => t.free !== true && t.group !== true).length;

describe('what an issued pass remembers about itself', () => {
  it('becomes ONE pass that admits the whole party', () => {
    const passes = passesFromGroupOfEight();
    expect(passes).toHaveLength(1);
    expect(passes[0]).toMatchObject({ group: true, groupSize: 8, groupName: 'Group of 8' });
  });

  it('is never mistaken for an individual purchase', () => {
    expect(passesFromGroupOfEight().every((p) => p.group === true)).toBe(true);
  });

  it('leaves an ordinary pass unmarked', () => {
    const cart: CartLine[] = [{ categoryId: REG, name: 'REGULAR', prefix: 'REGULAR-', qty: 2, unitPrice: 1000, numberWidth: 3 }];
    const allocations: Allocation[] = [{ categoryId: REG, qty: 2, numbers: [1, 2], endSold: 2 }];
    const passes = buildIssuedTickets({ cart, allocated_tickets: allocations } as unknown as PaymentOrder, allocations);
    expect(passes.every((p) => p.group === undefined)).toBe(true);
  });
});

describe('the seven-pass allowance after buying a group', () => {
  const base = {
    categories,
    isLoggedIn: true,
    isMember: false,
    memberDiscountPercent: 0,
    pointsToRedeem: 0,
    loyaltyBalance: 0,
  };

  it('does not count the eight group seats against it', () => {
    // The whole point: somebody who bought a group of 8 has spent NONE of their seven.
    const previouslyBought = previouslyBoughtFrom(passesFromGroupOfEight());
    expect(previouslyBought).toBe(0);

    const q = quoteEventCart({ ...base, cart: { [REG]: 7 }, previouslyBought } as never);
    expect(q.lines[0].qty).toBe(7);
  });

  it('still refuses an eighth individual pass', () => {
    const previouslyBought = previouslyBoughtFrom([
      ...passesFromGroupOfEight(),
      { }, { }, { }, { }, { }, { }, { },   // seven bought singly
    ]);
    expect(previouslyBought).toBe(7);
    expect(() => quoteEventCart({ ...base, cart: { [REG]: 1 }, previouslyBought } as never))
      .toThrow(new RegExp(`maximum of ${MAX_TICKETS_PER_ACCOUNT}`, 'i'));
  });

  it('does not count a coupon\'s free pass against it either', () => {
    const withGift = [...passesFromGroupOfEight(), { free: true }];
    expect(previouslyBoughtFrom(withGift)).toBe(0);
  });

  it('counts a group, a gift and seven singles as exactly seven', () => {
    const everything = [
      ...passesFromGroupOfEight(),           // one group pass, admitting eight
      { free: true },                         // a gift
      ...Array.from({ length: 7 }, () => ({})), // the seven they are allowed
    ];
    expect(everything).toHaveLength(9);
    expect(previouslyBoughtFrom(everything)).toBe(7);
  });
});
