import { beforeEach, describe, expect, it, vi } from 'vitest';

// The scanner API with an in-memory booking table that behaves like Postgres for our queries
// (including the scan_version guard), so races between two gate staff can be tested.

let isAdmin = true;
let row: any;
let versionColumn = true;
let beforeWrite: (() => void) | null = null;

function builder(table: string) {
  const state: any = { filters: [] as [string, unknown][], patch: null };
  const api: any = {
    select: (cols?: string) => { state.cols = cols; return api; },
    update: (patch: any) => { state.patch = patch; return api; },
    eq: (k: string, v: unknown) => { state.filters.push([k, v]); return api; },
    maybeSingle: async () => {
      if (!versionColumn && /scan_version/.test(state.cols || '')) return { data: null, error: { code: '42703', message: 'column ticket_bookings.scan_version does not exist' } };
      const { scan_version, ...rest } = row;
      return { data: structuredClone(versionColumn ? row : rest), error: null };
    },
    then: (resolve: any) => {
      // an update(...).eq(...).select('id') chain
      if (beforeWrite) { const f = beforeWrite; beforeWrite = null; f(); }
      const matches = state.filters.every(([k, v]: [string, unknown]) => row[k] === v);
      if (state.patch && matches) { row = { ...row, ...structuredClone(state.patch) }; return resolve({ data: [{ id: row.id }], error: null }); }
      return resolve({ data: [], error: null });
    },
  };
  return api;
}

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: builder }) }));
vi.mock('@/lib/admin', () => ({ checkAdminAccess: async () => ({ isAdmin, user: null }) }));
vi.mock('@/lib/payments/server', () => ({
  loadBookingView: async () => ({ status: row?.status || 'CONFIRMED', event: { title: 'Onam Night', date: 'OCT 18, 2026', time: '6:00 PM', location: 'Pune' } }),
}));

const post = async (body: unknown) => {
  const { POST } = await import('@/app/api/admin/tickets/scan/route');
  const res = await POST(new Request('http://x/api/admin/tickets/scan', { method: 'POST', body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
};
const fresh = (tickets: any[]) => ({ id: 'b1', status: 'CONFIRMED', scan_version: 0, tickets_data: tickets });
const ids = { bookingId: 'b1' };

beforeEach(() => { isAdmin = true; versionColumn = true; beforeWrite = null; });

describe('scanner API', () => {
  it('refuses non-admins and malformed requests', async () => {
    row = fresh([]);
    isAdmin = false;
    expect((await post({ ...ids, ticketNumber: 'A' })).status).toBe(403);
    isAdmin = true;
    expect((await post({ ticketNumber: 'A' })).status).toBe(400);
    expect((await post({ ...ids })).status).toBe(400);
  });

  it('lookup shows the pass and event without changing anything', async () => {
    row = fresh([{ categoryName: 'GROUP', ticketNumber: 'G-1', status: 'ISSUED', groupSize: 6, admitted: 2 }]);
    const r = await post({ ...ids, ticketNumber: 'G-1', action: 'lookup' });
    expect(r.status).toBe(200);
    expect(r.body.ticketDetails).toMatchObject({ groupSize: 6, admitted: 2, remaining: 4 });
    expect(r.body.event.title).toBe('Onam Night');
    expect(row.scan_version).toBe(0);
  });

  it('admits a group in two visits: 3 now, 3 later', async () => {
    row = fresh([{ categoryName: 'GROUP', ticketNumber: 'G-1', status: 'ISSUED', groupSize: 6 }]);
    const a = await post({ ...ids, ticketNumber: 'G-1', count: 3 });
    expect(a.status).toBe(200);
    expect(a.body.ticketDetails).toMatchObject({ admitted: 3, remaining: 3, status: 'ISSUED' });
    const b = await post({ ...ids, ticketNumber: 'G-1', count: 3 });
    expect(b.body.ticketDetails).toMatchObject({ admitted: 6, remaining: 0, status: 'CHECKED_IN' });
    expect((await post({ ...ids, ticketNumber: 'G-1', count: 1 })).status).toBe(409);
    expect(row.scan_version).toBe(2);
  });

  it('rejects too many people with a clear message', async () => {
    row = fresh([{ categoryName: 'GROUP', ticketNumber: 'G-1', status: 'ISSUED', groupSize: 5, admitted: 4 }]);
    const r = await post({ ...ids, ticketNumber: 'G-1', count: 2 });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('Only 1 of 5');
  });

  it('refunded bookings and unknown tickets are refused', async () => {
    row = { ...fresh([{ categoryName: 'G', ticketNumber: 'A', status: 'ISSUED' }]), status: 'REFUNDED' };
    expect((await post({ ...ids, ticketNumber: 'A' })).status).toBe(410);
    row = fresh([{ categoryName: 'G', ticketNumber: 'A', status: 'ISSUED' }]);
    expect((await post({ ...ids, ticketNumber: 'B' })).status).toBe(404);
  });

  it('two staff scanning the last single pass at the same instant: exactly one gets in', async () => {
    row = fresh([{ categoryName: 'GENERAL', ticketNumber: 'A', status: 'ISSUED' }]);
    // Staff 1 has read the booking; before it writes, staff 2's scan lands.
    beforeWrite = () => { row = { ...row, scan_version: 1, tickets_data: [{ categoryName: 'GENERAL', ticketNumber: 'A', status: 'CHECKED_IN', admitted: 1 }] }; };
    const r = await post({ ...ids, ticketNumber: 'A' });
    expect(r.status).toBe(409); // the loser re-reads, sees it is used, and is refused
    expect(row.tickets_data[0].entries).toBeUndefined(); // the loser wrote nothing over the winner
  });

  it('two scans racing on a group cannot admit more people than the group has', async () => {
    row = fresh([{ categoryName: 'GROUP', ticketNumber: 'G', status: 'ISSUED', groupSize: 5, admitted: 0 }]);
    beforeWrite = () => { row = { ...row, scan_version: 1, tickets_data: [{ categoryName: 'GROUP', ticketNumber: 'G', status: 'ISSUED', groupSize: 5, admitted: 3 }] }; };
    const r = await post({ ...ids, ticketNumber: 'G', count: 4 }); // wanted 4, but 3 just went in elsewhere
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('Only 2 of 5');
    expect(row.tickets_data[0].admitted).toBe(3);
  });

  it('keeps scanning even before the scan_version column has been added', async () => {
    versionColumn = false;
    row = fresh([{ categoryName: 'GENERAL', ticketNumber: 'A', status: 'ISSUED' }]);
    const r = await post({ ...ids, ticketNumber: 'A' });
    expect(r.status).toBe(200);
    expect(row.tickets_data[0].status).toBe('CHECKED_IN');
  });
});
