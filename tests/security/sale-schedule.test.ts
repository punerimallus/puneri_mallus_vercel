// Who can see a scheduled event, and who can give tickets away.
//
// The scheduling feature only means anything if a not-yet-live event is genuinely absent from
// the public response. Returning it with an `isSaleLive: false` flag would leave the whole
// announcement sitting in devtools for anyone who looked, which is the opposite of scheduling
// it. These tests pin that down, plus the admin guards on the two new write paths.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const checkAdminAccess = vi.fn();
vi.mock('@/lib/admin', () => ({
  checkAdminAccess: (...a: unknown[]) => checkAdminAccess(...a),
  requireAdmin: vi.fn(async () => null),
}));

const EVENTS = [
  { _id: 'live', title: 'ON SALE NOW', date: 'DEC 20, 2026', time: '7:00 PM', ticketUrl: 'INTERNAL' },
  { _id: 'past', title: 'ALREADY OPENED', date: 'DEC 21, 2026', time: '7:00 PM', ticketUrl: 'INTERNAL', goLiveAt: '2020-01-01T00:00:00.000Z' },
  { _id: 'secret', title: 'UNANNOUNCED HEADLINER', date: 'DEC 31, 2026', time: '7:00 PM', ticketUrl: 'INTERNAL', goLiveAt: '2099-01-01T00:00:00.000Z' },
  { _id: 'broken', title: 'CORRUPT SCHEDULE', date: 'DEC 22, 2026', time: '7:00 PM', ticketUrl: 'INTERNAL', goLiveAt: 'not-a-date' },
];

const updateOne = vi.fn(async () => ({ matchedCount: 1 }));
vi.mock('@/lib/mongodb', () => ({
  default: Promise.resolve({
    db: () => ({
      collection: () => ({
        find: () => ({ sort: () => ({ toArray: async () => EVENTS }), toArray: async () => EVENTS }),
        updateOne: (...a: unknown[]) => updateOne(...(a as [])),
        findOne: async () => null,
      }),
    }),
  }),
}));

const supabaseFrom = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (...a: unknown[]) => supabaseFrom(...a) }),
}));

const get = (qs = '') => new Request(`http://localhost/api/events${qs}`);
const patch = (body: unknown) =>
  new Request('http://localhost/api/admin/boxoffice', { method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
  checkAdminAccess.mockReset();
  updateOne.mockClear();
  supabaseFrom.mockReset();
});

const titles = (rows: { title: string }[]) => rows.map((r) => r.title);

describe('the public event list', () => {
  it('leaves a scheduled event out entirely, not merely flagged', async () => {
    checkAdminAccess.mockResolvedValue({ isAdmin: false, user: null });
    const { GET } = await import('@/app/api/events/route');
    const rows = await (await GET(get())).json();

    expect(titles(rows)).not.toContain('UNANNOUNCED HEADLINER');
    // Not just hidden by a flag — the string must not be in the response at all.
    expect(JSON.stringify(rows)).not.toContain('UNANNOUNCED');
  });

  it('shows an event whose schedule has already fired', async () => {
    checkAdminAccess.mockResolvedValue({ isAdmin: false, user: null });
    const { GET } = await import('@/app/api/events/route');
    const rows = await (await GET(get())).json();
    expect(titles(rows)).toContain('ALREADY OPENED');
  });

  it('shows an event with no schedule at all', async () => {
    checkAdminAccess.mockResolvedValue({ isAdmin: false, user: null });
    const { GET } = await import('@/app/api/events/route');
    expect(titles(await (await GET(get())).json())).toContain('ON SALE NOW');
  });

  it('shows an event whose schedule is corrupt, rather than hiding a live sale', async () => {
    // The expensive failure is an event nobody can buy. Unreadable means on sale.
    checkAdminAccess.mockResolvedValue({ isAdmin: false, user: null });
    const rows = await (await (await import('@/app/api/events/route')).GET(get())).json();
    expect(titles(rows)).toContain('CORRUPT SCHEDULE');
  });

  it('ignores ?scope=admin from someone who is not an admin', async () => {
    // The parameter is a request, not a permission. Asking for everything without being an
    // admin gets the same public list anybody else gets.
    checkAdminAccess.mockResolvedValue({ isAdmin: false, user: { id: 'u1' } });
    const rows = await (await (await import('@/app/api/events/route')).GET(get('?scope=admin'))).json();
    expect(titles(rows)).not.toContain('UNANNOUNCED HEADLINER');
  });

  it('shows everything to an admin who asks for it', async () => {
    checkAdminAccess.mockResolvedValue({ isAdmin: true, user: { id: 'admin' } });
    const rows = await (await (await import('@/app/api/events/route')).GET(get('?scope=admin'))).json();
    expect(titles(rows)).toContain('UNANNOUNCED HEADLINER');
    expect(rows).toHaveLength(EVENTS.length);
  });

  it('does not ask who is logged in for an ordinary public read', async () => {
    // Every visitor hits this route. Checking the admin table on each one would be a database
    // round trip per page view for a question nobody asked.
    checkAdminAccess.mockResolvedValue({ isAdmin: false, user: null });
    await (await import('@/app/api/events/route')).GET(get());
    expect(checkAdminAccess).not.toHaveBeenCalled();
  });

  it('normalises the schedule so every reader sees one shape', async () => {
    checkAdminAccess.mockResolvedValue({ isAdmin: true, user: { id: 'admin' } });
    const rows = await (await (await import('@/app/api/events/route')).GET(get('?scope=admin'))).json();
    const broken = rows.find((r: { _id: string }) => r._id === 'broken');
    expect(broken.goLiveAt).toBeNull();
    expect(rows.find((r: { _id: string }) => r._id === 'past').goLiveAt).toBe('2020-01-01T00:00:00.000Z');
  });
});

describe('changing the schedule', () => {
  it('refuses a non-admin before writing anything', async () => {
    checkAdminAccess.mockResolvedValue({ isAdmin: false, user: { id: 'u1' } });
    const { PATCH } = await import('@/app/api/admin/boxoffice/route');
    const res = await PATCH(patch({ eventId: '507f1f77bcf86cd799439011', goLiveAt: null }));
    expect(res.status).toBe(403);
    expect(updateOne).not.toHaveBeenCalled();
  });

  it('lets an admin publish an event now', async () => {
    checkAdminAccess.mockResolvedValue({ isAdmin: true, user: { id: 'admin' } });
    const { PATCH } = await import('@/app/api/admin/boxoffice/route');
    const res = await PATCH(patch({ eventId: '507f1f77bcf86cd799439011', goLiveAt: null, salesHeadline: '  Phase 1   is live ' }));
    expect(res.status).toBe(200);
    const [, update] = updateOne.mock.calls[0] as unknown as [unknown, { $set: Record<string, unknown> }];
    expect(update.$set.goLiveAt).toBeNull();
    expect(update.$set.salesHeadline).toBe('Phase 1 is live');
  });

  it('only writes the keys that were sent, so one setting cannot wipe the other', async () => {
    checkAdminAccess.mockResolvedValue({ isAdmin: true, user: { id: 'admin' } });
    const { PATCH } = await import('@/app/api/admin/boxoffice/route');
    await PATCH(patch({ eventId: '507f1f77bcf86cd799439011', salesHeadline: 'Early bird tickets are live' }));
    const [, update] = updateOne.mock.calls[0] as unknown as [unknown, { $set: Record<string, unknown> }];
    expect(update.$set).not.toHaveProperty('goLiveAt');
  });

  it('refuses an event id that is not one', async () => {
    checkAdminAccess.mockResolvedValue({ isAdmin: true, user: { id: 'admin' } });
    const { PATCH } = await import('@/app/api/admin/boxoffice/route');
    expect((await PATCH(patch({ eventId: 'haha', goLiveAt: null }))).status).toBe(400);
    expect(updateOne).not.toHaveBeenCalled();
  });
});

describe('issuing complimentary passes', () => {
  it('refuses someone who is not logged in', async () => {
    checkAdminAccess.mockResolvedValue({ isAdmin: false, user: null });
    const { POST } = await import('@/app/api/admin/tickets/comp/route');
    const res = await POST(new Request('http://localhost/x', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(401);
    expect(supabaseFrom).not.toHaveBeenCalled();
  });

  it('refuses a logged-in user who is not an admin', async () => {
    // Free, scannable tickets. This is the guard that stops any signed-in member minting them.
    checkAdminAccess.mockResolvedValue({ isAdmin: false, user: { id: 'u1', email: 'member@x.com' } });
    const { POST } = await import('@/app/api/admin/tickets/comp/route');
    const res = await POST(new Request('http://localhost/x', { method: 'POST', body: JSON.stringify({ eventId: 'e', items: { a: 1 } }) }));
    expect(res.status).toBe(403);
    expect(supabaseFrom).not.toHaveBeenCalled();
  });

  it('refuses a non-admin reading the guest list', async () => {
    // Names, emails and phone numbers of people who never bought anything.
    checkAdminAccess.mockResolvedValue({ isAdmin: false, user: { id: 'u1' } });
    const { GET } = await import('@/app/api/admin/tickets/comp/route');
    const res = await GET(new Request('http://localhost/x?eventId=e'));
    expect(res.status).toBe(403);
    expect(supabaseFrom).not.toHaveBeenCalled();
  });
});
