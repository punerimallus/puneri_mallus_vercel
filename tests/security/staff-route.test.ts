import { beforeEach, describe, expect, it, vi } from 'vitest';

// The gate list API, against an in-memory event_staff table that enforces the same unique index
// the migration creates: one row per person per scope, matched case-insensitively.
//
// Regression: this route first used `upsert(..., { onConflict: 'email,event_id' })`, which
// Postgres rejects outright — the real index is an EXPRESSION index on
// (lower(email), coalesce(event_id, '*')) and ON CONFLICT can only infer a target from an index
// whose definition matches literally. Every add returned 500.

let isAdmin = true;
let signedIn: { id: string; email?: string } | null = { id: 'u1', email: 'admin@punerimallus.com' };
let rows: any[] = [];
let nextId = 1;

const key = (email: string, eventId: string | null) => `${email.toLowerCase()}|${eventId ?? '*'}`;

function builder(table: string) {
  const st: any = { filters: [] as [string, unknown][] };
  const api: any = {
    select: () => api,
    update: (patch: any) => { st.patch = patch; return api; },
    insert: (row: any) => { st.insert = row; return api; },
    delete: () => { st.del = true; return api; },
    eq: (k: string, v: unknown) => { st.filters.push([k, v]); return api; },
    ilike: (_k: string, v: string) => { st.ilike = v; return api; },
    order: () => api,
    maybeSingle: async () => {
      const r = await api.then((x: any) => x);
      return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error };
    },
    then: (resolve: any) => {
      if (table !== 'event_staff') return resolve({ data: [], error: null });
      if (st.insert) {
        if (rows.some((r) => key(r.email, r.event_id) === key(st.insert.email, st.insert.event_id ?? null))) {
          return resolve({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "event_staff_email_scope_uq"' } });
        }
        const row = { id: `s${nextId++}`, created_at: '2026-10-28T00:00:00Z', event_id: null, note: null, added_by: null, ...st.insert };
        rows.push(row);
        return resolve({ data: [row], error: null });
      }
      let match = rows;
      if (st.ilike) match = match.filter((r) => r.email.toLowerCase() === st.ilike.toLowerCase());
      for (const [k, v] of st.filters) match = match.filter((r) => r[k] === v);
      if (st.patch) { match.forEach((r) => Object.assign(r, st.patch)); return resolve({ data: match, error: null }); }
      if (st.del) { rows = rows.filter((r) => !match.includes(r)); return resolve({ data: null, error: null }); }
      return resolve({ data: match, error: null });
    },
  };
  return api;
}

vi.mock('@/lib/admin', () => ({
  checkAdminAccess: async () => ({ isAdmin, user: signedIn }),
  requireAdmin: async () => {
    const { NextResponse } = await import('next/server');
    if (!signedIn) return NextResponse.json({ error: 'Please log in.' }, { status: 401 });
    if (!isAdmin) return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });
    return null;
  },
}));
vi.mock('@/lib/payments/server', () => ({ supabaseAdmin: () => ({ from: builder }) }));
vi.mock('@/lib/payments/schema-check', () => ({
  asMarkerDb: (x: unknown) => x,
  checkSchema: async () => ({ ok: true, marker: 'ticketing_integrity_v1' }),
}));

const call = async (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', body?: unknown, qs = '') => {
  const mod = await import('@/app/api/admin/staff/route');
  const req = new Request(`http://x/api/admin/staff${qs}`, {
    method, ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
  });
  const res = await (mod as any)[method](req);
  return { status: res.status, body: await res.json() };
};

beforeEach(() => { isAdmin = true; signedIn = { id: 'u1', email: 'admin@punerimallus.com' }; rows = []; nextId = 1; });

describe('gate list: who can change it', () => {
  it('refuses anyone who is not an admin', async () => {
    isAdmin = false;
    expect((await call('GET')).status).toBe(403);
    expect((await call('POST', { email: 'v@x.com' })).status).toBe(403);
    signedIn = null;
    expect((await call('GET')).status).toBe(401);
  });
});

describe('adding a volunteer', () => {
  it('adds them and records who did it', async () => {
    const r = await call('POST', { email: 'Gate.Volunteer@Example.com', note: 'Main gate' });
    expect(r.status).toBe(200);
    expect(r.body.staff).toMatchObject({ email: 'gate.volunteer@example.com', role: 'SCANNER', active: true, event_id: null, added_by: 'admin@punerimallus.com' });
  });

  it('adding the same person again updates them instead of failing', async () => {
    await call('POST', { email: 'v@x.com', note: 'first' });
    const again = await call('POST', { email: 'V@X.COM', note: 'second' });
    expect(again.status).toBe(200);
    expect(again.body.alreadyListed).toBe(true);
    expect(again.body.staff.note).toBe('second');
    expect(rows).toHaveLength(1);
  });

  it('re-adding someone switched off turns them back on', async () => {
    await call('POST', { email: 'v@x.com' });
    rows[0].active = false;
    const again = await call('POST', { email: 'v@x.com' });
    expect(again.body.staff.active).toBe(true);
  });

  it('a global entry and an event-scoped one are separate', async () => {
    await call('POST', { email: 'v@x.com' });
    const scoped = await call('POST', { email: 'v@x.com', eventId: 'evt_1' });
    expect(scoped.body.alreadyListed).toBeUndefined();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.event_id).sort()).toEqual(['evt_1', null]);
  });

  it('rejects an invalid email before touching the table', async () => {
    const r = await call('POST', { email: 'not-an-email' });
    expect(r.status).toBe(400);
    expect(rows).toHaveLength(0);
  });
});

describe('changing and removing', () => {
  it('switches access off and back on', async () => {
    await call('POST', { email: 'v@x.com' });
    expect((await call('PATCH', { id: rows[0].id, active: false })).status).toBe(200);
    expect(rows[0].active).toBe(false);
    await call('PATCH', { id: rows[0].id, active: true });
    expect(rows[0].active).toBe(true);
  });

  it('refuses a PATCH that asks for nothing', async () => {
    await call('POST', { email: 'v@x.com' });
    expect((await call('PATCH', { id: rows[0].id })).status).toBe(400);
  });

  it('removes someone from the list', async () => {
    await call('POST', { email: 'v@x.com' });
    expect((await call('DELETE', undefined, `?id=${rows[0].id}`)).status).toBe(200);
    expect(rows).toHaveLength(0);
  });

  it('needs an id to delete', async () => {
    expect((await call('DELETE')).status).toBe(400);
  });
});
