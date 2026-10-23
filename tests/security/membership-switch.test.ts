import { beforeEach, describe, expect, it, vi } from 'vitest';

// Admin → Payments "membership" switch: off must close the door on the server, not just hide the button.

let settingsRow: Record<string, unknown> | null;
let profileRow: Record<string, unknown>;
const razorpayCreate = vi.fn(async () => ({ id: 'order_123', amount: 100, currency: 'INR' }));
const inserted: unknown[] = [];

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'u1@x.com' } } }) } }),
}));
vi.mock('@/lib/payments/server', () => ({
  razorpay: () => ({ orders: { create: razorpayCreate } }),
  getEventSnapshot: async () => null,
  supabaseAdmin: () => ({
    from: (table: string) => {
      const q: any = {
        select: () => q, eq: () => q, limit: () => q,
        maybeSingle: async () => ({ data: table === 'profiles' ? profileRow : null }),
        single: async () => ({ data: table === 'app_settings' ? settingsRow : null, error: null }),
        insert: async (row: unknown) => { inserted.push(row); return { error: null }; },
      };
      return q;
    },
  }),
}));

const order = async (paymentType: string, extra: Record<string, unknown> = {}) => {
  const { POST } = await import('@/app/api/razorpay/order/route');
  const res = await POST(new Request('http://x/api/razorpay/order', { method: 'POST', body: JSON.stringify({ paymentType, ...extra }), headers: { 'content-type': 'application/json' } }));
  return { status: res.status, body: await res.json() };
};

beforeEach(() => {
  inserted.length = 0;
  razorpayCreate.mockClear();
  profileRow = { email: 'u1@x.com', is_member: false, loyalty_points: 0, mart_unlocked: false, phone_number: '+919999999999', dob: '1990-01-01' };
  settingsRow = { membership_price: 499, membership_enabled: true, mart_lifetime_active: true, mart_lifetime_price: 2499 };
});

describe('membership switch: orders', () => {
  it('refuses a new membership order while the switch is off, before Razorpay is touched', async () => {
    settingsRow = { ...settingsRow, membership_enabled: false };
    const r = await order('LIFETIME');
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/closed/i);
    expect(razorpayCreate).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
  });

  it('takes the order when the switch is on', async () => {
    const r = await order('LIFETIME');
    expect(r.status).toBe(200);
    expect(razorpayCreate).toHaveBeenCalledOnce();
  });

  it('treats a missing column (migration not run yet) as open', async () => {
    delete settingsRow!.membership_enabled;
    expect((await order('LIFETIME')).status).toBe(200);
  });

  it('only closes membership: Mallu Mart orders are unaffected', async () => {
    settingsRow = { ...settingsRow, membership_enabled: false };
    const r = await order('MART', { plan: 'LIFETIME' });
    expect(r.status).toBe(200);
  });
});

describe('membership switch: settings API', () => {
  const upserts: Record<string, unknown>[] = [];
  let failFirstUpsertWithMissingColumn = false;

  const load = async () => {
    vi.resetModules();
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => ({
        from: () => ({
          select: () => ({
            limit: () => ({ single: async () => ({ data: settingsRow, error: null }) }),
            eq: () => ({ single: async () => ({ data: { email: 'a@x.com' }, error: null }) }), // the authorized_admins check
          }),
          upsert: async (row: Record<string, unknown>) => {
            upserts.push(row);
            if (failFirstUpsertWithMissingColumn && 'membership_enabled' in row) {
              return { error: { message: 'Could not find the \'membership_enabled\' column of \'app_settings\' in the schema cache' } };
            }
            return { error: null };
          },
        }),
      }),
    }));
    vi.doMock('@supabase/ssr', () => ({
      createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'a', email: 'a@x.com' } }, error: null }) } }),
    }));
    vi.doMock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
    return import('@/app/api/admin/settings/route');
  };

  beforeEach(() => { upserts.length = 0; failFirstUpsertWithMissingColumn = false; });

  it('reports the switch, defaulting to open', async () => {
    let mod = await load();
    settingsRow = { membership_price: 499, membership_enabled: false };
    expect((await (await mod.GET()).json()).membershipEnabled).toBe(false);
    settingsRow = { membership_price: 499, membership_enabled: true };
    expect((await (await mod.GET()).json()).membershipEnabled).toBe(true);
    settingsRow = { membership_price: 499 };
    expect((await (await mod.GET()).json()).membershipEnabled).toBe(true);
  });

  it('saves the switch', async () => {
    const mod = await load();
    const res = await mod.PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ membershipEnabled: false }) }));
    expect(await res.json()).toMatchObject({ success: true, membershipSwitchSaved: true });
    expect(upserts[0]).toMatchObject({ membership_enabled: false });
  });

  it('before the SQL is run: the rest of the settings still save and the switch says it was not saved', async () => {
    failFirstUpsertWithMissingColumn = true;
    const mod = await load();
    const res = await mod.PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ membershipEnabled: false, membershipPrice: 599 }) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, membershipSwitchSaved: false });
    expect(upserts).toHaveLength(2);
    expect(upserts[1]).toMatchObject({ membership_price: 599 });
    expect(upserts[1]).not.toHaveProperty('membership_enabled');
  });
});
