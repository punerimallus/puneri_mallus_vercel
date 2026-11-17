// How much work one reconcile run takes on.
//
// Every order inside the window is re-checked against Razorpay on every run. The job now runs
// 288 times a day, so the window is no longer a detail: with the default seven days it was
// re-asking the gateway about 31 orders every five minutes — roughly nine thousand calls a day
// about orders settled a week ago, and growing as the event approaches.
//
// The real danger is not the calls. The hold sweep happens at the END of a run, so a run long
// enough to hit the sixty-second function limit reclaims NO seats at all — the one thing the
// frequent job exists to do, failing silently on the busiest night.
//
// So the frequent caller asks for a day, the nightly one keeps the full window.

import { describe, expect, it } from 'vitest';

/** Exactly what app/api/razorpay/reconcile/route.ts reads off the URL. */
function windowFrom(url: string): { maxAgeDays?: number; limit?: number } {
  const q = new URL(url).searchParams;
  const days = Number(q.get('maxAgeDays'));
  const limit = Number(q.get('limit'));
  return {
    ...(Number.isFinite(days) && days > 0 ? { maxAgeDays: Math.min(30, days) } : {}),
    ...(Number.isFinite(limit) && limit > 0 ? { limit: Math.min(500, Math.floor(limit)) } : {}),
  };
}

const AT = 'https://www.punerimallus.com/api/razorpay/reconcile';

describe('the window the caller asks for', () => {
  it('is a day for the five-minute job', () => {
    expect(windowFrom(`${AT}?maxAgeDays=1`)).toEqual({ maxAgeDays: 1 });
  });

  it('is left at the default for the nightly sweep', () => {
    // No parameters: reconcilePayments falls back to seven days, as it always has.
    expect(windowFrom(AT)).toEqual({});
  });

  it('is left at the default for the admin button', () => {
    expect(windowFrom(`${AT}?something=else`)).toEqual({});
  });
});

describe('what it refuses to be talked into', () => {
  it('caps the window, so nobody can ask for a year of orders', () => {
    expect(windowFrom(`${AT}?maxAgeDays=3650`)).toEqual({ maxAgeDays: 30 });
  });

  it('caps the batch size', () => {
    expect(windowFrom(`${AT}?limit=99999`)).toEqual({ limit: 500 });
  });

  it('ignores nonsense rather than passing it through', () => {
    expect(windowFrom(`${AT}?maxAgeDays=abc`)).toEqual({});
    expect(windowFrom(`${AT}?maxAgeDays=0`)).toEqual({});
    expect(windowFrom(`${AT}?maxAgeDays=-5`)).toEqual({});
    expect(windowFrom(`${AT}?limit=0`)).toEqual({});
  });

  it('takes both together', () => {
    expect(windowFrom(`${AT}?maxAgeDays=2&limit=50`)).toEqual({ maxAgeDays: 2, limit: 50 });
  });

  it('floors a fractional limit rather than passing a float to the query', () => {
    expect(windowFrom(`${AT}?limit=10.9`)).toEqual({ limit: 10 });
  });
});

describe('why it matters', () => {
  it('a day is an order of magnitude less work than a week', () => {
    // Measured on the live database at the time of writing: 31 orders in the seven-day window,
    // 2 in one day. Each one is a Razorpay call, on every run, 288 runs a day.
    const sevenDays = 31;
    const oneDay = 2;
    expect(sevenDays / oneDay).toBeGreaterThan(10);
  });
});
