import { describe, expect, it } from 'vitest';
import { grossUpToPaise, martPlanPrice, membershipPrice, nextMartExpiry, quoteEventCart, TicketCategory } from '@/lib/payments/pricing';

const categories: TicketCategory[] = [
  { id: 'vip', name: 'VIP', prefix: 'VIP', price: 1000, capacity: 10, sold: 8, active: true },
  { id: 'ga', name: 'General', prefix: 'GA', price: 300, capacity: null, sold: 0, active: true },
  { id: 'old', name: 'Early Bird', prefix: 'EB', price: 100, capacity: 50, sold: 0, active: false },
];

const base = {
  categories,
  isLoggedIn: true,
  isMember: false,
  memberDiscountPercent: 0,
  pointsToRedeem: 0,
  loyaltyBalance: 0,
  previouslyBought: 0,
};

describe('quoteEventCart', () => {
  it('prices a normal cart on the server', () => {
    const q = quoteEventCart({ ...base, cart: { vip: 1, ga: 2 } });
    expect(q.total).toBe(1600);
    expect(q.lines).toHaveLength(2);
  });

  it('applies the member discount only to members', () => {
    expect(quoteEventCart({ ...base, cart: { ga: 1 }, isMember: true, memberDiscountPercent: 10 }).total).toBe(270);
    expect(quoteEventCart({ ...base, cart: { ga: 1 }, isMember: false, memberDiscountPercent: 10 }).total).toBe(300);
  });

  it.each([
    [{ nope: 1 }, /Invalid category/],
    [{ ga: -1 }, /Invalid ticket quantity/],
    [{ ga: 1.5 }, /Invalid ticket quantity/],
    [{ ga: 'lots' }, /Invalid ticket quantity/],
    [{}, /at least one/],
    [{ ga: 0 }, /at least one/],
    [{ old: 1 }, /no longer on sale/],
    [{ vip: 3 }, /sold out/],
  ])('rejects tampered or invalid cart %j', (cart, msg) => {
    expect(() => quoteEventCart({ ...base, cart })).toThrow(msg);
  });

  it('rejects a missing or non-object cart', () => {
    expect(() => quoteEventCart({ ...base, cart: null })).toThrow(/Missing/);
    expect(() => quoteEventCart({ ...base, cart: [1, 2] })).toThrow(/Missing/);
  });

  it('enforces the 7-pass cap across earlier bookings', () => {
    expect(() => quoteEventCart({ ...base, cart: { ga: 3 }, previouslyBought: 5 })).toThrow(/Limit Exceeded/);
    expect(quoteEventCart({ ...base, cart: { ga: 2 }, previouslyBought: 5 }).total).toBe(600);
  });

  describe('loyalty points', () => {
    const withPoints = { ...base, cart: { ga: 2 }, loyaltyBalance: 200 };
    it('redeems valid points', () => {
      const q = quoteEventCart({ ...withPoints, pointsToRedeem: 100 });
      expect(q.pointsApplied).toBe(100);
      expect(q.total).toBe(500);
    });
    it('rejects negative points (would have minted points before)', () => {
      expect(() => quoteEventCart({ ...withPoints, pointsToRedeem: -500 })).toThrow(/Invalid points/);
    });
    it('rejects below the minimum, above the balance, and for guests', () => {
      expect(() => quoteEventCart({ ...withPoints, pointsToRedeem: 20 })).toThrow(/minimum/);
      expect(() => quoteEventCart({ ...withPoints, pointsToRedeem: 300 })).toThrow(/Insufficient/);
      expect(() => quoteEventCart({ ...withPoints, isLoggedIn: false, pointsToRedeem: 100 })).toThrow(/Unauthorized/);
    });
    it('floors fractional points and never lets the total reach zero', () => {
      expect(quoteEventCart({ ...withPoints, pointsToRedeem: 99.9 }).pointsApplied).toBe(99);
      expect(() => quoteEventCart({ ...base, cart: { ga: 1 }, loyaltyBalance: 1000, pointsToRedeem: 300 })).toThrow(/Invalid amount/);
    });
  });
});

describe('plan pricing', () => {
  it('uses settings, falling back to defaults', () => {
    expect(membershipPrice({ membership_price: 499 })).toBe(499);
    expect(membershipPrice(null)).toBe(999);
    expect(martPlanPrice({ martYearlyPrice: 799 }, 'YEARLY').price).toBe(799);
    expect(martPlanPrice(null, 'MONTHLY').price).toBe(99);
  });
  it('rejects unknown plans instead of silently charging ₹99', () => {
    expect(() => martPlanPrice(null, 'FREE')).toThrow(/Invalid/);
    expect(() => martPlanPrice(null, undefined)).toThrow(/Invalid/);
  });
  it('grosses up the gateway fee', () => {
    expect(grossUpToPaise(1000)).toBe(102417);
  });
});

describe('nextMartExpiry', () => {
  const now = new Date('2026-09-30T00:00:00Z');
  it('extends an active subscription instead of resetting it', () => {
    expect(nextMartExpiry('MONTHLY', '2026-10-15T00:00:00Z', now)!.toISOString()).toBe('2026-11-15T00:00:00.000Z');
  });
  it('starts from now when expired or new', () => {
    expect(nextMartExpiry('YEARLY', '2026-01-01T00:00:00Z', now)!.toISOString()).toBe('2027-09-30T00:00:00.000Z');
    expect(nextMartExpiry('MONTHLY', null, now)!.toISOString()).toBe('2026-10-30T00:00:00.000Z');
  });
  it('lifetime never expires', () => {
    expect(nextMartExpiry('LIFETIME', null, now)).toBeNull();
  });
});
