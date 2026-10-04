import { beforeEach, describe, expect, it, vi } from 'vitest';

let user: { id: string } | null = null;
const listUserBookings = vi.fn(async (_id: string, _limit?: number) => [{ id: 'b1' }]);

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@supabase/ssr', () => ({ createServerClient: () => ({ auth: { getUser: async () => ({ data: { user } }) } }) }));
vi.mock('@/lib/payments/server', () => ({ listUserBookings: (id: string, limit?: number) => listUserBookings(id, limit) }));

beforeEach(() => { user = null; listUserBookings.mockClear(); });

describe('GET /api/tickets/mine', () => {
  it('requires login', async () => {
    const { GET } = await import('@/app/api/tickets/mine/route');
    expect((await GET(new Request('http://x/api/tickets/mine'))).status).toBe(401);
    expect(listUserBookings).not.toHaveBeenCalled();
  });
  it("only ever lists the logged-in user's own bookings, even if another user id is supplied", async () => {
    user = { id: 'me' };
    const { GET } = await import('@/app/api/tickets/mine/route');
    const res = await GET(new Request('http://x/api/tickets/mine?userId=someone-else&user_id=someone-else&limit=3'));
    expect(res.status).toBe(200);
    expect(listUserBookings).toHaveBeenCalledWith('me', 3);
  });
  it('clamps an absurd limit', async () => {
    user = { id: 'me' };
    const { GET } = await import('@/app/api/tickets/mine/route');
    await GET(new Request('http://x/api/tickets/mine?limit=100000'));
    expect(listUserBookings).toHaveBeenCalledWith('me', 100);
  });
});
