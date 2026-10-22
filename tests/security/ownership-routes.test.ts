import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

// Mallu Connect (mart), Community and profile routes, with a fake database and a controllable login.
// Who you are comes only from the session; nothing the browser sends (emails, ids, cookies) can grant access.

type Session = null | { id: string; email?: string; phone?: string; isAdmin?: boolean };
let session: Session = null;
let store: Record<string, any[]> = {};
const sent: string[] = [];

vi.mock('@/lib/admin', () => ({
  checkAdminAccess: async () => (session ? { isAdmin: !!session.isAdmin, user: { id: session.id, email: session.email, phone: session.phone } } : { isAdmin: false, user: null }),
  requireAdmin: async () => {
    if (!session) return NextResponse.json({ error: 'Please log in.' }, { status: 401 });
    if (!session.isAdmin) return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });
    return null;
  },
}));

const matches = (doc: any, f: any) => Object.entries(f || {}).every(([k, v]) => (k === '_id' ? String(doc._id) === String(v) : doc[k] === v));
const col = (name: string) => ({
  find: (f: any = {}) => ({ sort: () => ({ toArray: async () => store[name].filter((d) => matches(d, f)).map((d) => ({ ...d })) }), toArray: async () => store[name].filter((d) => matches(d, f)).map((d) => ({ ...d })) }),
  findOne: async (f: any) => { const d = store[name].find((x) => matches(x, f)); return d ? { ...d } : null; },
  insertOne: async (d: any) => { const doc = { _id: `new${store[name].length}`, ...d }; store[name].push(doc); return { insertedId: doc._id }; },
  updateOne: async (f: any, u: any) => { const d = store[name].find((x) => matches(x, f)); if (d) Object.assign(d, u.$set || {}); return { modifiedCount: d ? 1 : 0 }; },
  deleteOne: async (f: any) => { const i = store[name].findIndex((x) => matches(x, f)); if (i >= 0) store[name].splice(i, 1); return { deletedCount: i >= 0 ? 1 : 0 }; },
  deleteMany: async (f: any) => { const before = store[name].length; store[name] = store[name].filter((x) => !matches(x, f)); return { deletedCount: before - store[name].length }; },
  bulkWrite: async (ops: any[]) => ({ modifiedCount: ops.length }),
  countDocuments: async () => 0,
});
vi.mock('mongodb', () => ({ ObjectId: class { s: string; constructor(s: string) { this.s = s; } toString() { return this.s; } static isValid(s: string) { return typeof s === 'string' && s.length > 0; } } }));
vi.mock('@/lib/mongodb', () => ({ default: Promise.resolve({ db: () => ({ collection: (n: string) => col(n) }) }), dbConnect: async () => undefined }));

const deleted: string[] = [];
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (t: string) => {
      const q: any = { select: () => q, eq: () => q, upsert: async () => ({}), maybeSingle: async () => ({ data: t === 'profiles' ? { email: null, phone_number: session?.phone || null } : null }), then: (r: any) => r({ data: [] }) };
      return q;
    },
    storage: { from: () => ({ remove: async () => ({}) }) },
    auth: { admin: { deleteUser: async (id: string) => { deleted.push(id); return { error: null }; } } },
  }),
}));
vi.mock('@/lib/mail', () => ({ sendMartPendingEmail: async () => { sent.push('sendMartPendingEmail'); }, sendMartLiveEmail: async () => { sent.push('sendMartLiveEmail'); }, sendMartRejectedEmail: async () => { sent.push('sendMartRejectedEmail'); }, sendAdminMartAlert: async () => { sent.push('sendAdminMartAlert'); }, sendMartVerificationPendingEmail: async () => { sent.push('sendMartVerificationPendingEmail'); }, sendAdminVerificationAlert: async () => { sent.push('sendAdminVerificationAlert'); }, sendMartVerificationSuccessEmail: async () => { sent.push('sendMartVerificationSuccessEmail'); }, sendPendingCommunityEmail: async () => { sent.push('sendPendingCommunityEmail'); }, sendApprovedCommunityEmail: async () => { sent.push('sendApprovedCommunityEmail'); }, sendAdminPendingAlert: async () => { sent.push('sendAdminPendingAlert'); }, sendRejectedCommunityEmail: async () => { sent.push('sendRejectedCommunityEmail'); } }));

const call = async (mod: string, method: string, url: string, body?: unknown, headers: Record<string, string> = {}) => {
  const route = await import(mod);
  const res = await route[method](new Request(`http://x${url}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers }));
  return { status: res.status, body: await res.json().catch(() => null) };
};

const alice = { id: 'alice', email: 'alice@x.com' };
const bob = { id: 'bob', email: 'bob@x.com' };
const admin = { id: 'adm', email: 'admin@x.com', isAdmin: true };

beforeEach(() => {
  session = null; deleted.length = 0; sent.length = 0;
  store = {
    mallu_mart: [
      { _id: 'm_live', name: 'Live Cafe', isApproved: true, isDraft: false, userId: 'alice', userEmail: 'alice@x.com', verificationDocs: { gst: 'secret.pdf' }, isPremium: false, isVerified: false },
      { _id: 'm_pending', name: 'Pending Shop', isApproved: false, isDraft: false, userId: 'alice', userEmail: 'alice@x.com' },
      { _id: 'm_draft', name: 'Bob Draft', isApproved: false, isDraft: true, userId: 'bob', userEmail: 'bob@x.com' },
    ],
    profiles: [],
    community_circles: [
      { _id: 'c_live', title: 'Live Circle', isApproved: true, isDraft: false, userId: 'alice', submittedBy: 'alice@x.com', contact: '9876543210' },
      { _id: 'c_pending', title: 'Pending Circle', isApproved: false, isDraft: false, userId: 'bob', submittedBy: 'bob@x.com' },
      { _id: 'c_legacy', title: 'Old Circle', isApproved: true, isDraft: false, submittedBy: 'someone@else.com', contact: '9123456789' },
    ],
  };
});

describe('Mallu Connect: who can see what', () => {
  it('visitors only see live listings, without owner email or verification documents', async () => {
    const r = await call('@/app/api/mart/route', 'GET', '/api/mart');
    expect(r.body.map((d: any) => d.name)).toEqual(['Live Cafe']);
    expect(r.body[0]).not.toHaveProperty('userEmail');
    expect(r.body[0]).not.toHaveProperty('userId');
    expect(r.body[0]).not.toHaveProperty('verificationDocs');
  });
  it('an owner also sees their own pending listing, in full; other people drafts stay hidden', async () => {
    session = alice;
    const r = await call('@/app/api/mart/route', 'GET', '/api/mart');
    expect(r.body.map((d: any) => d.name).sort()).toEqual(['Live Cafe', 'Pending Shop']);
    expect(r.body.find((d: any) => d.name === 'Live Cafe').verificationDocs).toBeTruthy();
  });
  it('admins see everything', async () => {
    session = admin;
    expect((await call('@/app/api/mart/route', 'GET', '/api/mart')).body).toHaveLength(3);
  });
});

describe('Mallu Connect: who can change what', () => {
  it('approving a listing needs an admin: visitors get 401, members get 403', async () => {
    expect((await call('@/app/api/mart/route', 'PATCH', '/api/mart', { id: 'm_pending', isApproved: true })).status).toBe(401);
    session = bob;
    expect((await call('@/app/api/mart/route', 'PATCH', '/api/mart', { id: 'm_pending', isApproved: true })).status).toBe(403);
    expect(store.mallu_mart[1].isApproved).toBe(false);
    session = admin;
    expect((await call('@/app/api/mart/route', 'PATCH', '/api/mart', { id: 'm_pending', isApproved: true })).status).toBe(200);
    expect(store.mallu_mart[1].isApproved).toBe(true);
  });
  it('verifying, featuring and reordering are admin-only too', async () => {
    session = alice;
    for (const body of [{ id: 'm_live', isVerified: true }, { id: 'm_live', isPremium: true }, { reorder: true, newOrder: [{ id: 'm_live', order: 0 }] }]) {
      expect((await call('@/app/api/mart/route', 'PATCH', '/api/mart', body)).status).toBe(403);
    }
  });
  it("a fake admin_token cookie or someone else's email does not grant ownership", async () => {
    session = bob;
    const r = await call('@/app/api/mart/route', 'PATCH', '/api/mart', { id: 'm_live', userEmail: 'alice@x.com', updatedData: { userId: 'alice', name: 'Hacked' } }, { cookie: 'admin_token=1' });
    expect(r.status).toBe(403);
    expect(store.mallu_mart[0].name).toBe('Live Cafe');
  });
  it('an owner can edit their listing but cannot award themselves premium, verified or approved', async () => {
    session = alice;
    const r = await call('@/app/api/mart/route', 'PATCH', '/api/mart', { id: 'm_live', updatedData: { name: 'Better Cafe', isPremium: true, isVerified: true, isApproved: true, order: 0, userId: 'someone-else' } });
    expect(r.status).toBe(200);
    expect(store.mallu_mart[0]).toMatchObject({ name: 'Better Cafe', isPremium: false, isVerified: false, isApproved: false, userId: 'alice' });
  });
  it('deleting needs the owner or an admin; the adminEmail URL trick no longer works', async () => {
    expect((await call('@/app/api/mart/route', 'DELETE', '/api/mart?id=m_live')).status).toBe(401);
    session = bob;
    expect((await call('@/app/api/mart/route', 'DELETE', '/api/mart?id=m_live&adminEmail=admin@x.com&userEmail=alice@x.com&userId=alice')).status).toBe(403);
    expect(store.mallu_mart).toHaveLength(3);
    session = alice;
    expect((await call('@/app/api/mart/route', 'DELETE', '/api/mart?id=m_live')).status).toBe(200);
    session = admin;
    expect((await call('@/app/api/mart/route', 'DELETE', '/api/mart?id=m_draft')).status).toBe(200);
    expect(store.mallu_mart.map((d) => d._id)).toEqual(['m_pending']);
  });
  it('creating a listing needs a login, is owned by the logged-in account, and starts unapproved', async () => {
    expect((await call('@/app/api/mart/route', 'POST', '/api/mart', { name: 'X' })).status).toBe(401);
    session = bob;
    await call('@/app/api/mart/route', 'POST', '/api/mart', { name: 'New Place', userId: 'alice', isPremium: true, isApproved: true });
    const made = store.mallu_mart.find((d) => d.name === 'New Place');
    expect(made).toMatchObject({ userId: 'bob', isApproved: false, isPremium: false, isVerified: false });
  });
});

describe('Community', () => {
  it('visitors see only live circles, without owner details; owners also see their pending ones', async () => {
    let r = await call('@/app/api/community/route', 'GET', '/api/community');
    expect(r.body.map((d: any) => d.title).sort()).toEqual(['Live Circle', 'Old Circle']);
    expect(r.body[0]).not.toHaveProperty('submittedBy');
    session = bob;
    r = await call('@/app/api/community/route', 'GET', '/api/community');
    expect(r.body.map((d: any) => d.title)).toContain('Pending Circle');
  });
  it('the old ?admin=true flag unlocks nothing', async () => {
    const r = await call('@/app/api/community/route', 'GET', '/api/community?admin=true');
    expect(r.body.map((d: any) => d.title)).not.toContain('Pending Circle');
  });
  it('an unpublished circle is a 404 for strangers, visible to its owner and admins', async () => {
    expect((await call('@/app/api/community/route', 'GET', '/api/community?id=c_pending')).status).toBe(404);
    session = bob;
    expect((await call('@/app/api/community/route', 'GET', '/api/community?id=c_pending')).status).toBe(200);
    session = admin;
    expect((await call('@/app/api/community/route', 'GET', '/api/community?id=c_pending')).status).toBe(200);
  });
  it('deleting needs the owner or an admin', async () => {
    expect((await call('@/app/api/community/delete/route', 'DELETE', '/api/community/delete?id=c_live', undefined, { cookie: 'admin_token=1' })).status).toBe(401);
    session = bob;
    expect((await call('@/app/api/community/delete/route', 'DELETE', '/api/community/delete?id=c_live')).status).toBe(403);
    expect(store.community_circles).toHaveLength(3);
    session = alice;
    expect((await call('@/app/api/community/delete/route', 'DELETE', '/api/community/delete?id=c_live')).status).toBe(200);
    session = admin;
    expect((await call('@/app/api/community/delete/route', 'DELETE', '/api/community/delete?id=c_pending')).status).toBe(200);
  });
  it('an older circle is still recognised as its owner by phone number', async () => {
    session = { id: 'carol', phone: '+919123456789' };
    expect((await call('@/app/api/community/delete/route', 'DELETE', '/api/community/delete?id=c_legacy')).status).toBe(200);
  });
  it('only admins approve, reject or reorder; owners can edit content but it goes back to review', async () => {
    expect((await call('@/app/api/community/manage/route', 'POST', '/api/community/manage', { _id: 'c_pending', isApproved: true })).status).toBe(401);
    session = bob;
    expect((await call('@/app/api/community/manage/route', 'POST', '/api/community/manage', { reorder: true, newOrder: [{ id: 'c_pending', order: 1 }] })).status).toBe(403);
    expect((await call('@/app/api/community/manage/route', 'POST', '/api/community/manage', { _id: 'c_live', title: 'Hijacked' })).status).toBe(403);
    expect((await call('@/app/api/community/manage/route', 'POST', '/api/community/manage', { _id: 'c_pending', title: 'Renamed', isApproved: true, isVerified: true, approvedBy: 'admin' })).status).toBe(200);
    expect(store.community_circles[1]).toMatchObject({ title: 'Renamed', isApproved: false });
    expect(store.community_circles[1].isVerified).toBeUndefined();
    session = admin;
    expect((await call('@/app/api/community/manage/route', 'POST', '/api/community/manage', { _id: 'c_pending', isApproved: true, approvedBy: 'Admin' })).status).toBe(200);
    expect(store.community_circles[1].isApproved).toBe(true);
  });
  it('a new circle is owned by the logged-in account and cannot start verified', async () => {
    session = bob;
    await call('@/app/api/community/manage/route', 'POST', '/api/community/manage', { title: 'Fresh', userId: 'alice', isVerified: true, isApproved: true });
    expect(store.community_circles.find((d) => d.title === 'Fresh')).toMatchObject({ userId: 'bob', isVerified: false, isApproved: false });
  });
});

describe('Profiles', () => {
  it('you can delete only your own account (admins excepted)', async () => {
    expect((await call('@/app/api/profile/delete/route', 'DELETE', '/api/profile/delete?id=alice')).status).toBe(401);
    session = bob;
    expect((await call('@/app/api/profile/delete/route', 'DELETE', '/api/profile/delete?id=alice')).status).toBe(403);
    expect(deleted).toEqual([]);
    const bobsListings = store.mallu_mart.filter((d) => d.userId === 'bob').length;
    const othersListings = store.mallu_mart.length - bobsListings;
    expect((await call('@/app/api/profile/delete/route', 'DELETE', '/api/profile/delete?id=bob')).status).toBe(200);
    expect(deleted).toEqual(['bob']);
    // Their own Mallu Mart listings go with the account; nobody else's do.
    expect(store.mallu_mart.some((d) => d.userId === 'bob')).toBe(false);
    expect(store.mallu_mart).toHaveLength(othersListings);
    expect(bobsListings).toBeGreaterThan(0);
  });
  it("another member's profile (email, phone, membership) cannot be read", async () => {
    session = bob;
    expect((await call('@/app/api/profile/check/route', 'GET', '/api/profile/check?id=alice')).status).toBe(403);
    expect((await call('@/app/api/profile/check/route', 'GET', '/api/profile/check?id=bob')).status).toBe(200);
    session = null;
    expect((await call('@/app/api/profile/check/route', 'GET', '/api/profile/check?id=bob')).status).toBe(401);
  });
});
