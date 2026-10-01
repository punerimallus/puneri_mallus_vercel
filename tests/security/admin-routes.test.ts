import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

// Every admin-only method must refuse a non-admin BEFORE touching any database.
// Public reads (what the website itself uses) must keep working without an admin.

const requireAdmin = vi.fn();
vi.mock('@/lib/admin', () => ({
  requireAdmin: (...a: unknown[]) => requireAdmin(...a),
  checkAdminAccess: vi.fn(async () => ({ isAdmin: false, user: null })),
}));

const collection = vi.fn(() => ({
  find: () => ({ sort: () => ({ toArray: async () => [] }), toArray: async () => [] }),
  findOne: async () => null,
  updateOne: async () => ({}),
  insertOne: async () => ({ insertedId: 'x' }),
  deleteOne: async () => ({ deletedCount: 1 }),
  deleteMany: async () => ({}),
  insertMany: async () => ({}),
  bulkWrite: async () => ({ modifiedCount: 0 }),
  countDocuments: async () => 0,
  replaceOne: async () => ({}),
}));
vi.mock('@/lib/mongodb', () => ({
  default: Promise.resolve({ db: () => ({ collection }) }),
  dbConnect: vi.fn(async () => undefined),
}));
vi.mock('@/models/SupportTicket', () => ({ default: { find: vi.fn(() => ({ sort: async () => [] })), findByIdAndUpdate: vi.fn() } }));

const fromStub: any = () => ({ select: () => ({ limit: () => ({ single: async () => ({ data: null, error: null }) }) }), insert: async () => ({}), upsert: async () => ({}) });
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: fromStub,
    storage: { from: () => ({ remove: async () => ({}) }) },
    auth: { admin: { createUser: vi.fn(), deleteUser: vi.fn() } },
  }),
}));
vi.mock('@/lib/mail', () => ({ sendAdminAccessEmail: vi.fn() }));

const json = (body: unknown) => new Request('http://localhost/x', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const del = (qs = '?id=507f1f77bcf86cd799439011') => new Request(`http://localhost/x${qs}`, { method: 'DELETE' });
const get = (qs = '') => new Request(`http://localhost/x${qs}`);

const ID = '507f1f77bcf86cd799439011';

// [label, module path, exported method, request factory]
const ADMIN_ONLY: [string, string, string, () => Request][] = [
  ['events/manage POST', '@/app/api/events/manage/route', 'POST', () => json({ title: 't' })],
  ['events/delete DELETE', '@/app/api/events/delete/route', 'DELETE', () => del(`?id=${ID}`)],
  ['partners/manage POST', '@/app/api/partners/manage/route', 'POST', () => json({ name: 'p' })],
  ['partners/delete DELETE', '@/app/api/partners/delete/route', 'DELETE', () => del(`?id=${ID}`)],
  ['partners/reorder POST', '@/app/api/partners/reorder/route', 'POST', () => json({ newOrder: [] })],
  ['team POST', '@/app/api/team/route', 'POST', () => json({ members: [] })],
  ['settings/gallery POST', '@/app/api/settings/gallery/route', 'POST', () => json({ images: [] })],
  ['settings/slider POST', '@/app/api/settings/slider/route', 'POST', () => json({ slides: [] })],
  ['settings/social POST', '@/app/api/settings/social/route', 'POST', () => json({})],
  ['admin/support GET', '@/app/api/admin/support/route', 'GET', () => get()],
  ['admin/support PATCH', '@/app/api/admin/support/route', 'PATCH', () => json({ id: ID, status: 'done' })],
  ['admin/create POST', '@/app/api/admin/create/route', 'POST', () => json({ email: 'new@x.com' })],
  ['admin/popup POST', '@/app/api/admin/popup/route', 'POST', () => json({ title: 't' })],
  ['admin/popup PATCH', '@/app/api/admin/popup/route', 'PATCH', () => json({ id: ID, isActive: true })],
  ['admin/popup DELETE', '@/app/api/admin/popup/route', 'DELETE', () => new Request('http://localhost/x', { method: 'DELETE', body: JSON.stringify({ id: ID }) })],
  ['admin/popup GET ?mode=all', '@/app/api/admin/popup/route', 'GET', () => get('?mode=all')],
];

// What the public website relies on: must NOT demand an admin.
const PUBLIC_READS: [string, string, string, () => Request][] = [
  ['events GET', '@/app/api/events/route', 'GET', () => get()],
  ['events/manage GET (navbar)', '@/app/api/events/manage/route', 'GET', () => get()],
  ['team GET (about page)', '@/app/api/team/route', 'GET', () => get()],
  ['settings/gallery GET', '@/app/api/settings/gallery/route', 'GET', () => get()],
  ['settings/slider GET (home page)', '@/app/api/settings/slider/route', 'GET', () => get()],
  ['settings/social GET', '@/app/api/settings/social/route', 'GET', () => get()],
  ['admin/popup GET (public popup)', '@/app/api/admin/popup/route', 'GET', () => get()],
];

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
  requireAdmin.mockReset();
  collection.mockClear();
});

describe('admin-only API methods', () => {
  for (const [label, mod, method, req] of ADMIN_ONLY) {
    it(`${label}: a non-admin is refused and no database is touched`, async () => {
      requireAdmin.mockResolvedValue(NextResponse.json({ error: 'Admin access required.' }, { status: 403 }));
      const handler = (await import(/* @vite-ignore */ mod))[method] as (r: Request) => Promise<Response>;
      const res = await handler(req());
      expect(res.status).toBe(403);
      expect(collection).not.toHaveBeenCalled();
    });

    it(`${label}: an admin is let through (not 401/403)`, async () => {
      requireAdmin.mockResolvedValue(null);
      const handler = (await import(/* @vite-ignore */ mod))[method] as (r: Request) => Promise<Response>;
      const res = await handler(req());
      expect([401, 403]).not.toContain(res.status);
      expect(requireAdmin).toHaveBeenCalled();
    });
  }
});

describe('public reads keep working without an admin', () => {
  for (const [label, mod, method, req] of PUBLIC_READS) {
    it(`${label}: does not call the admin guard`, async () => {
      requireAdmin.mockResolvedValue(NextResponse.json({ error: 'nope' }, { status: 403 }));
      const handler = (await import(/* @vite-ignore */ mod))[method] as (r: Request) => Promise<Response>;
      const res = await handler(req());
      expect(requireAdmin).not.toHaveBeenCalled();
      expect([401, 403]).not.toContain(res.status);
    });
  }
});
