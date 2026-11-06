import { beforeEach, describe, expect, it, vi } from 'vitest';

// Checkout must refuse to take money when the database cannot actually reserve seats, and when
// it cannot read the current prices. Both used to carry on regardless: the first ran in a
// degraded mode where seats were allocated only after payment, the second silently fell back to
// hardcoded default prices and skipped the admin's "membership closed" switch.

let markerRow: { applied_at: string } | null = { applied_at: '2026-10-28T00:00:00.000Z' };
let settingsRow: Record<string, unknown> | null = { membership_price: 499, membership_enabled: true };
let settingsError: { message: string } | null = null;
const FULL_PROFILE = { email: 'u1@x.com', is_member: false, loyalty_points: 0, loyalty_points_held: 0, dob: '1990-01-01' };
let profileRow: Record<string, unknown> | null = FULL_PROFILE;
let profileError: { message: string } | null = null;
const razorpayCreate = vi.fn(async () => ({ id: 'order_123', amount: 100, currency: 'INR' }));
const reserveForCheckout = vi.fn(async () => [{ categoryId: 'c1', qty: 1, endSold: 1, numbers: [1] }]);
const inserted: unknown[] = [];

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => undefined }) }));
vi.mock('@/lib/admin', () => ({ getRequestUser: async () => ({ id: 'u1', email: 'u1@x.com' }) }));
vi.mock('@/lib/payments/server', () => ({
  razorpay: () => ({ orders: { create: razorpayCreate } }),
  getEventSnapshot: async () => null,
  reserveForCheckout,
  releaseReservation: vi.fn(async () => 0),
  supabaseAdmin: () => ({
    from: (table: string) => {
      const q: any = {
        select: () => q, eq: () => q, limit: () => q,
        maybeSingle: async () => ({
          data: table === 'profiles' ? profileRow
            : table === 'app_schema_markers' ? markerRow
            : null,
          error: table === 'profiles' ? profileError : null,
        }),
        single: async () => ({ data: table === 'app_settings' ? settingsRow : null, error: table === 'app_settings' ? settingsError : null }),
        insert: async (row: unknown) => { inserted.push(row); return { error: null }; },
      };
      return q;
    },
  }),
}));

const order = async (body: Record<string, unknown>) => {
  const { POST } = await import('@/app/api/razorpay/order/route');
  const res = await POST(new Request('http://x/api/razorpay/order', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  }));
  return { status: res.status, body: await res.json() };
};

beforeEach(async () => {
  inserted.length = 0;
  razorpayCreate.mockClear();
  reserveForCheckout.mockClear();
  markerRow = { applied_at: '2026-10-28T00:00:00.000Z' };
  settingsRow = { membership_price: 499, membership_enabled: true };
  settingsError = null;
  profileRow = FULL_PROFILE;
  profileError = null;
  const { resetSchemaCache } = await import('@/lib/payments/schema-check');
  resetSchemaCache();
  const { resetRateLimits } = await import('@/lib/rate-limit');
  resetRateLimits();
});

describe('checkout refuses to run against a database that is behind the code', () => {
  it('answers 503 and touches neither Razorpay nor any reservation', async () => {
    markerRow = null;
    const r = await order({ paymentType: 'LIFETIME' });
    expect(r.status).toBe(503);
    expect(r.body.error).toMatch(/temporarily unavailable/i);
    expect(razorpayCreate).not.toHaveBeenCalled();
    expect(reserveForCheckout).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
  });

  it('proceeds normally once the migration marker is there', async () => {
    const r = await order({ paymentType: 'LIFETIME' });
    expect(r.status).toBe(200);
    expect(razorpayCreate).toHaveBeenCalledOnce();
  });
});

describe('checkout refuses to guess at prices', () => {
  it('answers 503 if app_settings cannot be read, rather than using the hardcoded defaults', async () => {
    settingsRow = null;
    settingsError = { message: 'connection reset by peer' };
    const r = await order({ paymentType: 'LIFETIME' });
    expect(r.status).toBe(503);
    expect(r.body.error).toMatch(/could not read current pricing/i);
    expect(razorpayCreate).not.toHaveBeenCalled();
  });
});

describe('a signed-in account with no profile row', () => {
  // The bug this closes cost real money. payments.user_id is a NOT NULL foreign key to
  // profiles(id), and the ledger insert happens during FULFILMENT - after Razorpay has taken
  // the card. A buyer whose auth account had no profile row was charged, had passes written to
  // the database, and then watched fulfilment throw: no email, no PDF, and an order stuck
  // short of FULFILLED while the status poll retried for ever.
  it('is refused before an order exists, so nobody is charged', async () => {
    profileRow = null;
    const r = await order({ paymentType: 'LIFETIME' });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/profile/i);
    expect(r.body.error).toMatch(/nothing has been charged/i);
    expect(razorpayCreate).not.toHaveBeenCalled();
  });

  it('is refused for a ticket purchase too, before any seat is held', async () => {
    // The seats matter as much as the money here: a reservation taken for a checkout that can
    // never complete holds stock away from buyers who could.
    profileRow = null;
    const r = await order({ paymentType: 'EVENT_TICKET', eventId: 'evt_1', cart: { c1: 1 } });
    expect(r.status).toBe(409);
    expect(reserveForCheckout).not.toHaveBeenCalled();
    expect(razorpayCreate).not.toHaveBeenCalled();
  });

  it('is refused for mart as well, since every product writes the same ledger row', async () => {
    profileRow = null;
    const r = await order({ paymentType: 'MART', plan: 'MONTHLY' });
    expect(r.status).toBe(409);
    expect(razorpayCreate).not.toHaveBeenCalled();
  });

  it('fails closed when the profile cannot be read at all', async () => {
    // A transient read failure must not be mistaken for "no profile" and must not be waved
    // through either: refuse, and say it is temporary.
    profileError = { message: 'connection reset by peer' };
    profileRow = null;
    const r = await order({ paymentType: 'LIFETIME' });
    expect(r.status).toBe(503);
    expect(r.body.error).toMatch(/try again/i);
    expect(razorpayCreate).not.toHaveBeenCalled();
  });

  it('lets a complete profile straight through', async () => {
    const r = await order({ paymentType: 'LIFETIME' });
    expect(r.status).toBe(200);
    expect(razorpayCreate).toHaveBeenCalledOnce();
  });
});

describe('rate limiting on checkout', () => {
  it('stops a client minting orders in a loop, with a Retry-After', async () => {
    const { RATE_RULES } = await import('@/lib/rate-limit');
    for (let i = 0; i < RATE_RULES.createOrder.max; i++) {
      expect((await order({ paymentType: 'LIFETIME' })).status).toBe(200);
    }
    const blocked = await order({ paymentType: 'LIFETIME' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/too many/i);
  });
});
