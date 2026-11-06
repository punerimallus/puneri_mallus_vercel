// Which pass categories a buyer sees, and in what order.
//
// The bug this guards against is a quiet one: the booking page used to ask the database for
// active categories only, so pausing VIP made it disappear and the page read as though VIP did
// not exist. Anyone reinstating that filter — or inverting this sort — breaks the "coming soon"
// feature without breaking anything that looks broken, which is why it is pinned here.

import { describe, expect, it } from 'vitest';
import { onSale, partitionBySale, sortForSale, type SaleCategory } from '@/lib/events/catalogue';

const cat = (name: string, price: number, active?: boolean | null): SaleCategory & { name: string } =>
  ({ id: name, name, price, ...(active === undefined ? {} : { active }) });

describe('onSale', () => {
  it('is true unless an admin explicitly paused it', () => {
    expect(onSale(cat('GEN', 500, true))).toBe(true);
    expect(onSale(cat('GEN', 500))).toBe(true);        // older rows have no flag
    expect(onSale({ active: null })).toBe(true);        // and null is not "paused"
  });

  it('is false for a paused category', () => {
    expect(onSale(cat('VIP', 2000, false))).toBe(false);
  });

  it('copes with nothing at all', () => {
    expect(onSale(null)).toBe(false);
    expect(onSale(undefined)).toBe(false);
  });
});

describe('sortForSale', () => {
  it('puts everything buyable before everything that is not', () => {
    const out = sortForSale([
      cat('BALCONY', 100, false),
      cat('VIP', 2000),
      cat('GENERAL', 500),
    ]);
    expect(out.map((c) => c.name)).toEqual(['GENERAL', 'VIP', 'BALCONY']);
  });

  it('does not let a cheap paused category jump the queue', () => {
    // The whole point: price ordering is secondary to "can I buy this".
    const out = sortForSale([cat('CHEAP', 1, false), cat('DEAR', 9999)]);
    expect(out[0].name).toBe('DEAR');
  });

  it('orders what is on sale cheapest first', () => {
    const out = sortForSale([cat('VIP', 2000), cat('GENERAL', 500), cat('GOLD', 1200)]);
    expect(out.map((c) => c.name)).toEqual(['GENERAL', 'GOLD', 'VIP']);
  });

  it('orders the coming-soon tail cheapest first too', () => {
    const out = sortForSale([cat('B', 900, false), cat('A', 300, false)]);
    expect(out.map((c) => c.name)).toEqual(['A', 'B']);
  });

  it('keeps the database order for two at the same price', () => {
    const out = sortForSale([cat('SECOND', 500), cat('FIRST', 500)]);
    expect(out.map((c) => c.name)).toEqual(['SECOND', 'FIRST']);
  });

  it('does not reorder the caller\'s array', () => {
    const input = [cat('VIP', 2000), cat('GENERAL', 500)];
    sortForSale(input);
    expect(input.map((c) => c.name)).toEqual(['VIP', 'GENERAL']);
  });

  it('treats a missing price as zero rather than throwing', () => {
    const out = sortForSale([cat('PRICED', 500), { id: 'x', name: 'FREE', price: null }]);
    expect(out[0].name).toBe('FREE');
  });

  it('copes with an empty list', () => {
    expect(sortForSale([])).toEqual([]);
  });
});

describe('partitionBySale', () => {
  it('splits the two groups without losing anyone', () => {
    const all = [cat('GEN', 500), cat('VIP', 2000, false), cat('GOLD', 1200)];
    const { live, comingSoon } = partitionBySale(all);
    expect(live.map((c) => c.name)).toEqual(['GEN', 'GOLD']);
    expect(comingSoon.map((c) => c.name)).toEqual(['VIP']);
    expect(live.length + comingSoon.length).toBe(all.length);
  });

  it('handles an event where everything is paused', () => {
    const { live, comingSoon } = partitionBySale([cat('A', 1, false), cat('B', 2, false)]);
    expect(live).toEqual([]);
    expect(comingSoon).toHaveLength(2);
  });
});
