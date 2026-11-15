import { describe, expect, it } from 'vitest';
import { grossUpToPaise, martPlanPrice, membershipPrice, nextMartExpiry, quoteEventCart, TicketCategory } from '@/lib/payments/pricing';

const categories: TicketCategory[] = [
  { id: 'vip', name: 'VIP', prefix: 'VIP', price: 1000, capacity: 10, sold: 8, active: true },
  { id: 'ga', name: 'General', prefix: 'GA', price: 300, capacity: null, sold: 0, active: true },
  { id: 'old', name: 'Early Bird', prefix: 'EB', price: 100, capacity: 50, sold: 0, active: false },
  { id: 'ap', name: 'ACCESS PASS', prefix: 'AP-', price: 0, capacity: 100, sold: 0, active: true, comp_only: true },
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

  it('member discounts routinely produce paise, so every amount column must cope with fractions', () => {
    const q = quoteEventCart({ ...base, cart: { ga: 1 }, isMember: true, memberDiscountPercent: 15 });
    expect(q.total).toBeCloseTo(255, 5);
    const odd = quoteEventCart({
      ...base,
      categories: [{ id: 'x', name: 'X', prefix: 'X', price: 499, capacity: null, sold: 0, active: true }],
      cart: { x: 1 },
      isMember: true,
      memberDiscountPercent: 15,
    });
    expect(odd.total).toBeCloseTo(424.15, 5);
    expect(Number.isInteger(odd.total)).toBe(false);
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
    [{ ap: 1 }, /Invalid category/],
  ])('rejects tampered or invalid cart %j', (cart, msg) => {
    expect(() => quoteEventCart({ ...base, cart })).toThrow(msg);
  });

  it('will not sell a complimentary-pass category at any quantity, beside anything else', () => {
    // The hole this closes: an ACCESS PASS is free and active, so without this the cart below
    // totals Rs.300, clears the Rs.1 gateway minimum, and admits five people for nothing. Its
    // id reaches the browser with every other category, so the booking page hiding the row is
    // presentation, not a control.
    expect(() => quoteEventCart({ ...base, cart: { ga: 1, ap: 5 } })).toThrow(/Invalid category/);
    expect(() => quoteEventCart({ ...base, cart: { ap: 1 } })).toThrow(/Invalid category/);
    // Zero is still zero: an untouched stepper must not trip over this.
    expect(quoteEventCart({ ...base, cart: { ga: 1, ap: 0 } }).total).toBe(300);
  });

  it('keeps selling categories that predate the comp_only column', () => {
    // Older rows arrive without the field at all; undefined must read as "sellable".
    const legacy: TicketCategory[] = [{ id: 'g', name: 'G', prefix: 'G', price: 200, capacity: null, sold: 0, active: true }];
    expect(quoteEventCart({ ...base, categories: legacy, cart: { g: 1 } }).total).toBe(200);
    const explicit: TicketCategory[] = [{ ...legacy[0], comp_only: null }];
    expect(quoteEventCart({ ...base, categories: explicit, cart: { g: 1 } }).total).toBe(200);
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
      expect(() => quoteEventCart({ ...withPoints, loyaltyBalance: 30, pointsToRedeem: 20 })).toThrow(/minimum/);
      expect(() => quoteEventCart({ ...withPoints, pointsToRedeem: 300 })).toThrow(/Insufficient/);
      expect(() => quoteEventCart({ ...withPoints, isLoggedIn: false, pointsToRedeem: 100 })).toThrow(/Unauthorized/);
    });
    it('floors fractional points and never lets the total reach zero', () => {
      expect(quoteEventCart({ ...withPoints, pointsToRedeem: 99.9 }).pointsApplied).toBe(99);
      // Over-asking is trimmed so at least Rs 1 is always left to pay, instead of failing the checkout.
      const q = quoteEventCart({ ...base, cart: { ga: 1 }, loyaltyBalance: 1000, pointsToRedeem: 300 });
      expect(q.total).toBeGreaterThanOrEqual(1);
      expect(q.pointsApplied + q.total).toBeCloseTo(q.subtotal, 5);
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

describe('small orders with a healthy points balance (the Rs 1 ticket case)', () => {
  const tiny = { ...base, cart: { ga: 1 }, categories: [{ id: 'ga', name: 'GA', prefix: 'GA-', price: 1, capacity: 100, sold: 0 }] as any };
  it('does not reject the order: a 101-point balance on a Rs 1 ticket just uses no points', () => {
    const q = quoteEventCart({ ...tiny, loyaltyBalance: 101, pointsToRedeem: 1 });
    expect(q.pointsApplied).toBe(0);
    expect(q.total).toBe(1);
  });
  it('uses what it can on a slightly bigger order and still leaves Rs 1 to pay', () => {
    const q = quoteEventCart({ ...tiny, categories: [{ id: 'ga', name: 'GA', prefix: 'GA-', price: 10, capacity: 100, sold: 0 }] as any, loyaltyBalance: 101, pointsToRedeem: 50 });
    expect(q.pointsApplied).toBe(9);
    expect(q.total).toBe(1);
  });
  it('still keeps redemption locked until the balance reaches 50', () => {
    expect(() => quoteEventCart({ ...tiny, loyaltyBalance: 49, pointsToRedeem: 1 })).toThrow(/minimum/);
  });
});

describe('a coupon in the quote', () => {
  // The coupon arrives already claimed — the usage cap is the database's job, under a lock.
  // What is checked here is the arithmetic and the order it happens in.
  const cats: TicketCategory[] = [
    { id: 'ga', name: 'General', prefix: 'GA', price: 1000, capacity: 100, sold: 0, active: true },
    { id: 'vip', name: 'VIP', prefix: 'VIP', price: 2000, capacity: 10, sold: 9, active: true },
  ];
  const quote = (coupon: any, over: Record<string, unknown> = {}) =>
    quoteEventCart({ ...base, categories: cats, cart: { ga: 2 }, coupon, ...over });

  const pct = (value: number) => ({ id: 'c', code: 'SAVE', kind: 'DISCOUNT', discount_type: 'PERCENT', discount_value: value });
  const freebie = (qty = 1, categoryId = 'ga') =>
    ({ id: 'c', code: 'FREE1', kind: 'FREE_TICKET', free_category_id: categoryId, free_qty: qty });

  it('changes nothing at all when there is no coupon', () => {
    const q = quote(null);
    expect(q.total).toBe(2000);
    expect(q.couponDiscount).toBe(0);
    expect(q.coupon).toBeNull();
    expect(q.lines).toHaveLength(1);
  });

  it('takes a percentage off the total that gets charged', () => {
    const q = quote(pct(20));
    expect(q.subtotal).toBe(2000);
    expect(q.couponDiscount).toBe(400);
    expect(q.total).toBe(1600);
  });

  it('stacks with the member discount additively, not compounding', () => {
    // 10% member off 2000 = 1800, then 20% coupon off that base = 360.
    const q = quote(pct(20), { isMember: true, memberDiscountPercent: 10 });
    expect(q.subtotal).toBe(1800);
    expect(q.couponDiscount).toBe(360);
    expect(q.total).toBe(1440);
  });

  it('adds the free pass as a real line, priced at zero', () => {
    const q = quote(freebie(1));
    expect(q.lines).toHaveLength(2);
    const free = q.lines.find((l) => l.free)!;
    expect(free).toMatchObject({ categoryId: 'ga', qty: 1, unitPrice: 0, free: true, couponCode: 'FREE1' });
    // And it costs the buyer nothing.
    expect(q.total).toBe(2000);
  });

  it('does both when the coupon does both', () => {
    const q = quote({ ...pct(25), kind: 'BOTH', free_category_id: 'ga', free_qty: 2 });
    expect(q.couponDiscount).toBe(500);
    expect(q.total).toBe(1500);
    expect(q.lines.find((l) => l.free)!.qty).toBe(2);
    expect(q.coupon!.summary).toBe('25% off + 2 free General');
  });

  it('does NOT count the free passes against the per-account allowance', () => {
    // A gift is not the buyer spending what they are allowed to buy. The database exempts them
    // the same way, over a flag on the seat itself — see tests/sql/bundles.test.ts.
    const q = quote(freebie(3), { cart: { ga: 7 }, previouslyBought: 0 });
    expect(q.lines.find((l: any) => l.free)!.qty).toBe(3);
    // Seven bought plus three given: ten seats, and the order stands.
    expect(q.total).toBe(7000);
  });

  it('still refuses an eighth BOUGHT pass', () => {
    expect(() => quote(null, { cart: { ga: 8 } })).toThrow(/Limit Exceeded/);
  });

  it('refuses a free pass the category can no longer supply', () => {
    // VIP has one seat left; the coupon promises two.
    expect(() => quote(freebie(2, 'vip'))).toThrow(/cannot be issued/i);
  });

  it('refuses a coupon on an empty cart', () => {
    expect(() => quote(pct(20), { cart: {} })).toThrow(/at least one pass/i);
  });

  it('applies points to what is left after the coupon', () => {
    const q = quote(pct(50), { loyaltyBalance: 1000, pointsToRedeem: 300 });
    expect(q.couponDiscount).toBe(1000);
    expect(q.pointsApplied).toBe(300);
    expect(q.total).toBe(700);
  });

  it('never lets points plus a coupon drive the order below the gateway minimum', () => {
    const q = quote(pct(90), { loyaltyBalance: 1000, pointsToRedeem: 1000 });
    expect(q.total).toBeGreaterThanOrEqual(1);
    expect(q.pointsApplied).toBe(Math.floor(2000 - 1800 - 1));
  });

  it('says so plainly when a coupon swallows almost the whole order', () => {
    expect(() => quoteEventCart({
      ...base, categories: cats, cart: { ga: 1 },
      coupon: { id: 'c', code: 'ALLOFF', kind: 'DISCOUNT', discount_type: 'FLAT', discount_value: 1000 } as any,
    })).toThrow(/covers almost the whole order/i);
  });
});

describe('the two account allowances', () => {
  it('is seven individual passes and two bundles, counted apart', async () => {
    const { MAX_TICKETS_PER_ACCOUNT, MAX_BUNDLES_PER_ACCOUNT } = await import('@/lib/payments/pricing');
    expect(MAX_TICKETS_PER_ACCOUNT).toBe(7);
    expect(MAX_BUNDLES_PER_ACCOUNT).toBe(2);
  });

  it('tells a buyer which allowance they hit, and that the other is separate', async () => {
    const { reservationMessage } = await import('@/lib/payments/inventory');
    const { TicketLimitError } = await import('@/lib/payments/types');

    expect(reservationMessage(new TicketLimitError('SINGLE', 7))!.message).toMatch(/at most 7 passes/i);
    const bundles = reservationMessage(new TicketLimitError('BUNDLES', 2))!;
    expect(bundles.message).toMatch(/at most 2 group tickets/i);
    expect(bundles.message).toMatch(/counted separately/i);
    expect(bundles.status).toBe(409);
  });

  it('reads a bundle refusal raised by the database', async () => {
    const { translateInventoryError } = await import('@/lib/payments/inventory');
    const { TicketLimitError } = await import('@/lib/payments/types');
    const err = translateInventoryError('error: LIMIT_BUNDLES:2');
    expect(err).toBeInstanceOf(TicketLimitError);
    expect((err as InstanceType<typeof TicketLimitError>).kind).toBe('BUNDLES');
    expect((err as InstanceType<typeof TicketLimitError>).max).toBe(2);
  });
});

describe('bundles in the cart', () => {
  const cats: TicketCategory[] = [
    { id: 'reg', name: 'REGULAR', prefix: 'REG-', price: 1000, capacity: 20, sold: 0, active: true },
  ];
  const squad = { id: 'b1', category_id: 'reg', name: 'Squad of 5', size: 5, price: 4500, max_bundles: 3, sold: 0, active: true };
  const quote = (over: Record<string, unknown> = {}) =>
    quoteEventCart({ ...base, categories: cats, cart: {}, bundles: [squad], ...over } as any);

  it('prices a bundle at its bundle price, not per-seat list price', () => {
    const q = quote({ bundleCart: { b1: 1 } });
    expect(q.subtotal).toBe(4500);
    expect(q.total).toBe(4500);
    expect(q.bundleUnits).toBe(1);
  });

  it('takes its seats from the category it belongs to', () => {
    const q = quote({ bundleCart: { b1: 1 } });
    expect(q.lines).toHaveLength(1);
    expect(q.lines[0]).toMatchObject({ categoryId: 'reg', prefix: 'REG-', qty: 5, unitPrice: 900, bundleId: 'b1' });
  });

  it('makes one line per unit, so each can carry its own reference', () => {
    const q = quote({ bundleCart: { b1: 2 } });
    expect(q.lines).toHaveLength(2);
    expect(q.bundleUnits).toBe(2);
    expect(q.subtotal).toBe(9000);
  });

  it('mixes with individual tickets in one cart', () => {
    const q = quote({ cart: { reg: 2 }, bundleCart: { b1: 1 } });
    expect(q.subtotal).toBe(2000 + 4500);
    expect(q.lines).toHaveLength(2);
    expect(q.bundleUnits).toBe(1);
  });

  it('refuses more units than the offer has left', () => {
    expect(() => quote({ bundleCart: { b1: 4 } })).toThrow(/Only 3/);
    expect(() => quote({ bundles: [{ ...squad, sold: 3 }], bundleCart: { b1: 1 } })).toThrow(/sold out/i);
  });

  it('refuses when the category cannot supply the seats', () => {
    // Capacity 20, 18 already gone: a bundle of 5 does not fit.
    const tight = [{ ...cats[0], sold: 18 }];
    expect(() => quote({ categories: tight, bundleCart: { b1: 1 } })).toThrow(/does not have 5 seats/i);
  });

  it('counts the individual seats and the bundle seats against the same capacity', () => {
    const tight = [{ ...cats[0], sold: 14 }];
    // 3 individual + a bundle of 5 = 8 wanted, only 6 left.
    expect(() => quote({ categories: tight, cart: { reg: 3 }, bundleCart: { b1: 1 } })).toThrow(/does not have/i);
  });

  it('does not charge a bundle for seats bought in a different category', () => {
    // REGULAR has 3 left and the bundle needs exactly 3; the two BALCONY seats in the same cart
    // come out of BALCONY's capacity and must not be counted against REGULAR's.
    const two = [
      { ...cats[0], capacity: 20, sold: 17 },
      { id: 'bal', name: 'BALCONY', prefix: 'BAL-', price: 400, capacity: 50, sold: 0, active: true },
    ];
    const trio = { ...squad, size: 3, price: 2700 };
    const q = quote({ categories: two, bundles: [trio], cart: { bal: 2 }, bundleCart: { b1: 1 } });
    expect(q.subtotal).toBe(2700 + 800);
    expect(q.bundleUnits).toBe(1);
  });

  it('counts two bundles out of the same category together', () => {
    // 4 left, two bundles of 3 is 6: the second must be refused, not waved through because the
    // first was only looking at what was sold before the cart started.
    const tight = [{ ...cats[0], capacity: 20, sold: 16 }];
    const trio = { ...squad, size: 3, price: 2700, max_bundles: 5 };
    expect(() => quote({ categories: tight, bundles: [trio], bundleCart: { b1: 2 } }))
      .toThrow(/does not have/i);
  });

  it('refuses a bundle that is not on this event', () => {
    expect(() => quote({ bundleCart: { nope: 1 } })).toThrow(/Invalid bundle/);
  });

  it('refuses a paused bundle or a paused category', () => {
    expect(() => quote({ bundles: [{ ...squad, active: false }], bundleCart: { b1: 1 } })).toThrow(/no longer available/i);
    expect(() => quote({ categories: [{ ...cats[0], active: false }], bundleCart: { b1: 1 } })).toThrow(/no longer available/i);
  });

  it('ignores a bundle set to zero', () => {
    expect(() => quote({ bundleCart: { b1: 0 } })).toThrow(/at least one pass/i);
  });

  it('refuses a quantity that is not a whole positive number', () => {
    for (const bad of [-1, 1.5, 'two']) {
      expect(() => quote({ bundleCart: { b1: bad } })).toThrow(/Invalid bundle quantity/);
    }
  });
});

describe('a coupon scoped to bundles', () => {
  const cats: TicketCategory[] = [
    { id: 'reg', name: 'REGULAR', prefix: 'REG-', price: 1000, capacity: 50, sold: 0, active: true },
  ];
  const squad = { id: 'b1', category_id: 'reg', name: 'Squad of 5', size: 5, price: 4500, max_bundles: 5, sold: 0, active: true };
  const perBundle = (freeQty: number) => ({
    id: 'c', code: 'SQUADPERK', kind: 'FREE_TICKET', scope: 'BUNDLE',
    free_category_id: 'reg', free_qty: freeQty,
  });
  const quote = (over: Record<string, unknown> = {}) =>
    quoteEventCart({ ...base, categories: cats, cart: {}, bundles: [squad], ...over } as any);

  it('gives one free pass per bundle bought', () => {
    // Admin says 1 free, buyer takes 2 bundles, buyer gets 2 free.
    const q = quote({ bundleCart: { b1: 2 }, coupon: perBundle(1) });
    expect(q.bundleUnits).toBe(2);
    expect(q.lines.find((l: any) => l.free)!.qty).toBe(2);
  });

  it('multiplies: two free per bundle on two bundles is four', () => {
    const q = quote({ bundleCart: { b1: 2 }, coupon: perBundle(2) });
    expect(q.lines.find((l: any) => l.free)!.qty).toBe(4);
  });

  it('gives nothing extra for individual tickets under the same coupon', () => {
    const q = quote({ cart: { reg: 3 }, bundleCart: { b1: 1 }, coupon: perBundle(1) });
    // One bundle, so one free pass — the three singles do not add to it.
    expect(q.lines.find((l: any) => l.free)!.qty).toBe(1);
  });

  it('says so plainly when the cart has no bundle at all', () => {
    // Worth more than giving nothing silently: the buyer thinks the offer applied.
    expect(() => quote({ cart: { reg: 2 }, coupon: perBundle(1) }))
      .toThrow(/only applies when you buy a group ticket/i);
  });

  it('is capped however the multiplier adds up', async () => {
    const { MAX_FREE_TOTAL } = await import('@/lib/payments/coupons');
    const q = quote({ bundleCart: { b1: 5 }, coupon: perBundle(10) });
    expect(q.lines.find((l: any) => l.free)!.qty).toBe(MAX_FREE_TOTAL);
  });

  it('leaves an INDIVIDUAL coupon unmultiplied by bundles', () => {
    const flat = { ...perBundle(1), scope: 'INDIVIDUAL' };
    const q = quote({ bundleCart: { b1: 3 }, coupon: flat });
    expect(q.lines.find((l: any) => l.free)!.qty).toBe(1);
  });
});
