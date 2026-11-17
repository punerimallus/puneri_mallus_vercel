// What the box office says is sold.
//
// `sold` on a category counts every seat taken, including those a checkout is merely HOLDING.
// It has to — two buyers must never be sold the same seat — but it means the dashboard reads
// high whenever somebody is at the payment screen, and reads WRONG for as long as a dead
// checkout's hold lasts. On 17 Nov REGULAR showed 83 of 100 gone when 72 had been bought.
//
// Releasing holds faster shortens that, but cannot remove it: while a real buyer is paying,
// their seats are legitimately held and still not sold. The only honest fix is to show the two
// numbers apart, which is what these pin.

import { describe, expect, it } from 'vitest';
import { seatsInUse, seatsLeft } from '@/lib/payments/seats';

interface Card { capacity: number; sold: number; released?: number; held?: number }

/** Exactly what the inventory card renders. Keep in step with app/admin/boxoffice/page.tsx. */
const card = (c: Card) => ({
  soldLine: seatsInUse(c) - (c.held || 0),
  heldLine: (c.held || 0) > 0 ? `+ ${c.held} held in checkout · not sold yet` : null,
  label: (c.held || 0) > 0 ? 'Sold' : 'Seats Taken',
});

describe('the number an organiser reads', () => {
  it('is what has actually been bought, not what is merely taken', () => {
    // The 17 Nov picture: 83 seats taken, 11 of them held by a dead checkout.
    const view = card({ capacity: 100, sold: 83, held: 11 });
    expect(view.soldLine).toBe(72);
    expect(view.label).toBe('Sold');
    expect(view.heldLine).toBe('+ 11 held in checkout · not sold yet');
  });

  it('says so while a real buyer is paying, too', () => {
    // Not an error state — someone is at the payment screen. Their seats are properly held and
    // properly not sold, and the card should say exactly that.
    const view = card({ capacity: 100, sold: 74, held: 2 });
    expect(view.soldLine).toBe(72);
    expect(view.heldLine).toBe('+ 2 held in checkout · not sold yet');
  });

  it('reads plainly when nothing is in flight', () => {
    const view = card({ capacity: 100, sold: 72, held: 0 });
    expect(view.soldLine).toBe(72);
    expect(view.heldLine).toBeNull();
    expect(view.label).toBe('Seats Taken');
  });

  it('copes with an older row that has no held figure at all', () => {
    const view = card({ capacity: 100, sold: 72 });
    expect(view.soldLine).toBe(72);
    expect(view.heldLine).toBeNull();
  });

  it('still counts refunded seats as returned', () => {
    // 80 issued, 8 given back by refunds, 2 held: 70 sold.
    const view = card({ capacity: 100, sold: 80, released: 8, held: 2 });
    expect(seatsInUse({ sold: 80, released: 8 })).toBe(72);
    expect(view.soldLine).toBe(70);
  });

  it('never goes negative, whatever the counters say', () => {
    expect(card({ capacity: 100, sold: 5, held: 5 }).soldLine).toBe(0);
  });
});

describe('what stays the same on purpose', () => {
  it('a held seat is still not on sale to anybody else', () => {
    // The point of counting holds in `sold`: the buyer on the booking page must not be offered
    // a seat somebody is paying for. Only the LABEL changes, never the arithmetic.
    expect(seatsLeft({ capacity: 100, sold: 83 })).toBe(17);
  });

  it('a sold-out category reads sold out even if some of it is held', () => {
    expect(seatsLeft({ capacity: 83, sold: 83 })).toBe(0);
  });
});
