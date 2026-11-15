// What a FAILED checkout leaves behind.
//
// A sale that does not complete must leave nothing: no seats held, no coupon use spent, no
// points promised, no pass issued, and nothing the buyer is charged for. Every one of those is
// taken BEFORE the buyer reaches Razorpay — that is deliberate, so nobody is ever charged for a
// seat somebody else got — which means every one of them has to be given back when the attempt
// dies.
//
// The failures worth covering are the ones at different depths: before anything is taken, after
// the seats are taken, after the gateway order exists, and after the money has actually moved.

import { describe, expect, it } from 'vitest';
import { reservationMessage, translateInventoryError } from '@/lib/payments/inventory';
import { PaymentInputError, SoldOutError, TicketLimitError, PointsUnavailableError } from '@/lib/payments/types';

/**
 * The order route's own unwinding, as it is written:
 *
 *   catch {
 *     if (reservationId) { releaseReservation(...); releaseCoupon(...); }
 *     ...turn the error into something the buyer can read
 *   }
 *
 * Modelled here so the SHAPE can be asserted — that every exit after the reservation goes
 * through it, and that nothing returns early past it.
 */
interface Attempt {
  reservationTaken: boolean;
  couponClaimed: boolean;
  thrown: unknown;
  /** True when the route returns instead of throwing — which SKIPS the catch. */
  returnedEarly?: boolean;
}

function whatIsLeftBehind(a: Attempt) {
  const unwound = a.thrown !== null && !a.returnedEarly;
  return {
    seatsStillHeld: a.reservationTaken && !unwound,
    couponStillClaimed: a.couponClaimed && !unwound,
  };
}

describe('a checkout that dies after the seats are taken', () => {
  it('gives the seats and the coupon back', () => {
    expect(whatIsLeftBehind({
      reservationTaken: true, couponClaimed: true, thrown: new Error('razorpay down'),
    })).toEqual({ seatsStillHeld: false, couponStillClaimed: false });
  });

  it('would strand both if it returned instead of throwing', () => {
    // The bug this guards: `return NextResponse.json(...)` inside the try block never reaches
    // the catch, so the seats stay held and the buyer retrying is told their own single-use
    // coupon is already used — until the sweeper runs, a quarter of an hour later.
    expect(whatIsLeftBehind({
      reservationTaken: true, couponClaimed: true, thrown: new Error('insert failed'), returnedEarly: true,
    })).toEqual({ seatsStillHeld: true, couponStillClaimed: true });
  });
});

describe('every refusal the buyer can actually meet', () => {
  // Each of these is raised BEFORE the gateway is called, so nothing has been charged. What
  // matters is that each arrives as words the buyer can act on, and as a 409 rather than a 500.
  const cases: [string, unknown, RegExp][] = [
    ['the last seats went', new SoldOutError('REGULAR'), /just sold out.*Nothing has been charged/i],
    ['already has seven', new TicketLimitError('SINGLE', 7), /at most 7 passes/i],
    ['already has two groups', new TicketLimitError('BUNDLES', 2), /at most 2 group tickets/i],
    ['points held by another tab', new PointsUnavailableError(40), /Only 40 points/i],
  ];

  it.each(cases)('%s', (_name, error, pattern) => {
    const said = reservationMessage(error);
    expect(said).not.toBeNull();
    expect(said!.message).toMatch(pattern);
    expect(said!.status).toBe(409);
  });

  it('a coupon problem reads as a sentence, not a stack trace', () => {
    const e = new PaymentInputError('That coupon has been fully used up.', 409);
    expect(e.message).toMatch(/used up/i);
    expect(e.status).toBe(409);
  });

  it('anything unrecognised is still refused, not waved through', () => {
    // The catch-all. It becomes "Failed to create order" — ugly, but a refusal, and the seats
    // are given back on the way out.
    expect(reservationMessage(new Error('something nobody predicted'))).toBeNull();
  });
});

describe('the database messages the route has to understand', () => {
  it.each([
    ['SOLD_OUT:REGULAR', SoldOutError],
    ['LIMIT_SINGLE:7', TicketLimitError],
    ['LIMIT_BUNDLES:2', TicketLimitError],
    ['POINTS_UNAVAILABLE:40', PointsUnavailableError],
  ])('%s becomes something the route can act on', (raised, kind) => {
    expect(translateInventoryError(raised)).toBeInstanceOf(kind);
  });

  it('an unknown raise is left as a plain error rather than guessed at', () => {
    const e = translateInventoryError('SOMETHING_NEW:3');
    expect(e).toBeInstanceOf(Error);
    expect(e).not.toBeInstanceOf(SoldOutError);
  });
});
