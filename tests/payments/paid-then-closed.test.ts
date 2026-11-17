// Scanned the QR, paid in the app, closed the window.
//
// The checkout releases seats as soon as the Razorpay window is dismissed, which is right for
// somebody who changed their mind and wrong for somebody who has just approved a UPI collect in
// their banking app. A UPI payment can sit at Razorpay as `created`/`pending` for tens of
// seconds — longer than the browser polls — and the captured-or-authorized check that decides
// "paid" reports nothing for it.
//
// Release the seats then and the money lands a moment later with nowhere to go: the buyer is
// auto-refunded for a ticket they believe they bought. So the cancel path asks Razorpay what
// attempts exist, and anything short of an outright failure stops the release.

import { describe, expect, it } from 'vitest';
import { hasLivePaymentAttempt, pickSettlingPayment } from '@/lib/payments/fulfil';
import type { GatewayPayment } from '@/lib/payments/types';

const payment = (status: string, over: Partial<GatewayPayment> = {}): GatewayPayment => ({
  id: `pay_${status}`, order_id: 'order_1', status, amount: 1074359, currency: 'INR', ...over,
} as GatewayPayment);

/** What /api/razorpay/cancel decides, given what Razorpay says about the order. */
const wouldRelease = (attempts: GatewayPayment[]) => !hasLivePaymentAttempt(attempts);

describe('the buyer who paid and then closed the window', () => {
  it('keeps the seats while a UPI collect is still pending', () => {
    // The exact case: approved in the banking app, Razorpay has it as created, not yet captured.
    const attempts = [payment('created')];
    expect(pickSettlingPayment(attempts)).toBeNull();   // the "is it paid?" check says no…
    expect(wouldRelease(attempts)).toBe(false);          // …but the seats stay put anyway
  });

  it('keeps them for a payment Razorpay is still holding as authorized', () => {
    expect(wouldRelease([payment('authorized')])).toBe(false);
  });

  it('keeps them for one already captured', () => {
    expect(wouldRelease([payment('captured')])).toBe(false);
  });

  it('keeps them when an earlier attempt failed but a later one is in flight', () => {
    // Card declined, then they switched to UPI and approved it. The failed attempt must not be
    // read as "this buyer is done".
    expect(wouldRelease([payment('failed'), payment('created')])).toBe(false);
  });
});

describe('the buyer who really did change their mind', () => {
  it('releases at once when Razorpay has no attempt at all', () => {
    expect(wouldRelease([])).toBe(true);
  });

  it('releases when every attempt failed', () => {
    expect(wouldRelease([payment('failed')])).toBe(true);
    expect(wouldRelease([payment('failed'), payment('failed')])).toBe(true);
  });
});

describe('when Razorpay cannot be reached', () => {
  it('is treated as "do not take the seats"', () => {
    // The route returns UNVERIFIED and releases nothing. The hold lapses on its own a few
    // minutes later, which costs stock rather than somebody's ticket — the right way round.
    const unreachable = () => { throw new Error('network'); };
    let released: boolean;
    try {
      released = wouldRelease(unreachable() as never);
    } catch {
      released = false;
    }
    expect(released).toBe(false);
  });
});

describe('the two checks answer different questions', () => {
  // pickSettlingPayment: "has the money arrived?" — used to decide whether to issue passes.
  // hasLivePaymentAttempt: "might it still?" — used to decide whether to take the seats back.
  // Conflating them is what loses a buyer their ticket.
  it('a pending payment is not settled, but is live', () => {
    const attempts = [payment('created')];
    expect(pickSettlingPayment(attempts)).toBeNull();
    expect(hasLivePaymentAttempt(attempts)).toBe(true);
  });

  it('a captured payment is both', () => {
    const attempts = [payment('captured')];
    expect(pickSettlingPayment(attempts)?.status).toBe('captured');
    expect(hasLivePaymentAttempt(attempts)).toBe(true);
  });

  it('a failed payment is neither', () => {
    const attempts = [payment('failed')];
    expect(pickSettlingPayment(attempts)).toBeNull();
    expect(hasLivePaymentAttempt(attempts)).toBe(false);
  });

  it('copes with nothing at all', () => {
    expect(hasLivePaymentAttempt([])).toBe(false);
    expect(hasLivePaymentAttempt(undefined as never)).toBe(false);
  });
});
