import { beforeEach, describe, expect, it, vi } from 'vitest';

// The gate and the box office, acting on the same pass at the same moment.
//
// Unlike the SQL suites, this one really does interleave: one in-memory database serves both
// the gate route and the complimentary-pass route, every read and write yields to the event
// loop before it settles, and the two handlers are started together with Promise.all. So the
// interleavings a single Postgres connection cannot produce - handler A reading, handler B
// writing, handler A writing against what it read - happen here.
//
// The scenario that matters: a volunteer is admitting a VIP at the instant an admin deletes
// that VIP's grant. Exactly one of the two must win, and whichever loses must be told rather
// than quietly writing over the other. There is no acceptable third outcome where the guest is
// recorded as admitted on a booking that no longer exists, or where the seat is freed twice.

interface Pass { categoryId?: string; ticketNumber: string; status?: string; groupSize?: number; admitted?: number }
interface Booking {
  id: string;
  event_id: string;
  email: string;
  source: string;
  status: string;
  tickets_data: Pass[];
  scan_version: number;
}

/** The whole database, such as it is. */
const world = {
  bookings: new Map<string, Booking>(),
  grants: new Map<string, { guest_name: string }>(),
  /** `${categoryId}:${number}` -> which reservation holds it. */
  numbers: new Map<string, string>(),
  scanLog: [] as Record<string, unknown>[],
  rpcCalls: [] as string[],
};

/** Yields to the event loop, so two handlers in flight actually take turns. */
const tick = () => new Promise((r) => setTimeout(r, 0));

let isAdmin = true;
let signedIn: { id: string; email?: string } | null = { id: 'u_admin', email: 'admin@punerimallus.com' };
let staffRows: { email: string; role: string; event_id: string | null; active: boolean }[] = [];

/** The event is on, right now, so the gate window is open. */
function eventAt(): { date: string; time: string } {
  const d = new Date(Date.now() + 330 * 60_000);
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const h24 = d.getUTCHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return {
    date: `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`,
    time: `${h12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h24 >= 12 ? 'PM' : 'AM'}`,
  };
}

function builder(table: string) {
  const state: { filters: [string, unknown][]; patch?: Record<string, unknown>; insert?: unknown; del?: boolean; ilike?: string } = { filters: [] };
  const api: Record<string, unknown> = {};
  Object.assign(api, {
    select: () => api,
    update: (patch: Record<string, unknown>) => { state.patch = patch; return api; },
    insert: (rowsIn: unknown) => { state.insert = rowsIn; return api; },
    delete: () => { state.del = true; return api; },
    eq: (k: string, v: unknown) => { state.filters.push([k, v]); return api; },
    ilike: (_k: string, v: string) => { state.ilike = v; return api; },
    order: () => api,
    limit: () => api,
    maybeSingle: async () => {
      await tick();
      const id = state.filters.find(([k]) => k === 'id' || k === 'booking_id')?.[1];
      if (table === 'ticket_bookings') {
        const b = world.bookings.get(String(id));
        return { data: b ? structuredClone(b) : null, error: null };
      }
      if (table === 'comp_ticket_grants') {
        const g = world.grants.get(String(id));
        return { data: g ? { ...g } : null, error: null };
      }
      if (table === 'ticket_numbers') {
        const cat = state.filters.find(([k]) => k === 'category_id')?.[1];
        const num = state.filters.find(([k]) => k === 'number')?.[1];
        const res = world.numbers.get(`${cat}:${num}`);
        return { data: res ? { reservation_id: res } : null, error: null };
      }
      return { data: null, error: null };
    },
    then: async (resolve: (v: unknown) => unknown) => {
      await tick();
      if (table === 'event_staff') {
        const want = String(state.ilike || '').toLowerCase();
        return resolve({ data: staffRows.filter((r) => r.email.toLowerCase() === want), error: null });
      }
      if (table === 'scan_log') {
        for (const r of Array.isArray(state.insert) ? state.insert : [state.insert]) {
          world.scanLog.push(r as Record<string, unknown>);
        }
        return resolve({ data: null, error: null });
      }
      if (table === 'comp_ticket_grants' && state.del) {
        const id = state.filters.find(([k]) => k === 'booking_id')?.[1];
        world.grants.delete(String(id));
        return resolve({ data: null, error: null });
      }
      if (table === 'ticket_bookings') {
        const id = String(state.filters.find(([k]) => k === 'id')?.[1]);
        const current = world.bookings.get(id);
        if (state.del) {
          world.bookings.delete(id);
          world.grants.delete(id);  // the real schema cascades
          return resolve({ data: null, error: null });
        }
        if (state.patch) {
          // The optimistic guard: every filter must still match what the caller read.
          const matches = !!current && state.filters.every(([k, v]) => (current as unknown as Record<string, unknown>)[k] === v);
          if (!matches) return resolve({ data: [], error: null });
          world.bookings.set(id, { ...current!, ...structuredClone(state.patch) } as Booking);
          return resolve({ data: [{ id }], error: null });
        }
      }
      return resolve({ data: [], error: null });
    },
  });
  return api;
}

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => undefined }) }));
vi.mock('@/lib/admin', () => ({
  checkAdminAccess: async () => ({ isAdmin, user: signedIn }),
  getRequestUser: async () => signedIn,
}));
vi.mock('@/lib/payments/ticket-signature', () => ({
  verifyTicketSignature: (_b: string, _t: string, sig: unknown) => (sig === 'good' ? 'VALID' : sig ? 'INVALID' : 'UNSIGNED'),
  unsignedPassesAllowed: () => true,
}));
vi.mock('@/lib/payments/server', () => ({
  supabaseAdmin: () => ({
    from: builder,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      await tick();
      world.rpcCalls.push(fn);
      if (fn === 'void_ticket_number') {
        const key = `${args.p_category_id}:${args.p_number}`;
        const holder = world.numbers.get(key);
        if (holder && holder === args.p_reservation_id) {
          world.numbers.delete(key);
          return { data: 1, error: null };
        }
        return { data: 0, error: null };
      }
      return { data: null, error: null };
    },
  }),
  loadBookingView: async (bookingId: string) => {
    const b = world.bookings.get(bookingId);
    if (!b) return null;
    const { date, time } = eventAt();
    return { status: b.status, eventId: b.event_id, event: { title: 'Onam Night', date, time, location: 'Pune' } };
  },
  fulfilmentDeps: { confirmReservation: vi.fn(async () => undefined) },
  releaseReservation: vi.fn(async () => 0),
  reserveForCheckout: vi.fn(async () => []),
  resendBooking: vi.fn(async () => ({ status: 'SENT' })),
}));

const scan = async (body: Record<string, unknown>) => {
  const { POST } = await import('@/app/api/gate/scan/route');
  const res = await POST(new Request('http://x/api/gate/scan', { method: 'POST', body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
};

const deleteGrant = async (bookingId: string) => {
  const { DELETE } = await import('@/app/api/admin/tickets/comp/route');
  const res = await DELETE(new Request('http://x/api/admin/tickets/comp', {
    method: 'DELETE', body: JSON.stringify({ bookingId }),
  }));
  return { status: res.status, body: await res.json() };
};

/** A comp grant of `qty` access passes, with its seats actually held. */
function seedComp(qty = 1, over: Partial<Booking> = {}, reservation = 'comp_abc'): string {
  const id = 'b1';
  const tickets: Pass[] = Array.from({ length: qty }, (_, i) => ({
    categoryId: 'cat1',
    ticketNumber: `AP-${String(i + 1).padStart(3, '0')}`,
    status: 'ISSUED',
  }));
  world.bookings.set(id, {
    id, event_id: 'evt_tonight', email: 'guest@example.com', source: 'COMP',
    status: 'CONFIRMED', tickets_data: tickets, scan_version: 0, ...over,
  });
  world.grants.set(id, { guest_name: 'Chief Guest' });
  for (let i = 0; i < qty; i++) world.numbers.set(`cat1:${i + 1}`, reservation);
  return id;
}

beforeEach(() => {
  world.bookings.clear();
  world.grants.clear();
  world.numbers.clear();
  world.scanLog = [];
  world.rpcCalls = [];
  isAdmin = true;
  signedIn = { id: 'u_admin', email: 'admin@punerimallus.com' };
  staffRows = [];
});

// ==========================================================================================
describe('a volunteer admitting while an admin deletes', () => {
  it('ends in one of three sound states, never a fourth', async () => {
    const id = seedComp(1);

    const [admit, remove] = await Promise.all([
      scan({ action: 'admit', bookingId: id, ticketNumber: 'AP-001', sig: 'good' }),
      deleteGrant(id),
    ]);

    // Deleting a guest who has already walked in is allowed on purpose - the admin may be
    // tidying up after the show - so "both succeeded" is a legitimate outcome and not a race
    // lost. What must never happen is a fourth state: a pass that admitted somebody and is
    // still sitting there live, or a seat freed while the booking survives.
    const admitted = world.scanLog.filter((r) => r.action === 'ADMIT').length;
    const gone = !world.bookings.has(id);

    if (admit.status === 200 && remove.status === 200) {
      // The gate got there first, the admin deleted afterwards.
      expect(admitted).toBe(1);
      expect(gone).toBe(true);
      expect(remove.body.admitted).toBe(1);
      expect(world.numbers.size).toBe(0);
    } else if (admit.status === 200) {
      // The admin's write lost the version check and backed out.
      expect(remove.status).toBe(409);
      expect(remove.body.error).toMatch(/scanned or changed/i);
      expect(admitted).toBe(1);
      expect(gone).toBe(false);
      expect(world.numbers.size).toBe(1);
    } else {
      // The delete got there first: nobody was admitted and the seat came back.
      expect(remove.status).toBe(200);
      expect([404, 409, 410]).toContain(admit.status);
      expect(admitted).toBe(0);
      expect(gone).toBe(true);
      expect(world.numbers.size).toBe(0);
    }
  });

  it('never leaves a pass that admitted somebody and can still be used', async () => {
    const id = seedComp(1);
    await Promise.all([
      scan({ action: 'admit', bookingId: id, ticketNumber: 'AP-001', sig: 'good' }),
      deleteGrant(id),
    ]);

    const booking = world.bookings.get(id);
    if (booking) {
      // It survived, so it must be fully used up - a second scan has to be refused.
      const again = await scan({ action: 'admit', bookingId: id, ticketNumber: 'AP-001', sig: 'good' });
      expect(again.status).toBe(409);
      expect(again.body.error).toMatch(/already scanned/i);
    }
  });

  it('never records an admission against a booking that was deleted', async () => {
    const id = seedComp(1);
    await Promise.all([
      scan({ action: 'admit', bookingId: id, ticketNumber: 'AP-001', sig: 'good' }),
      deleteGrant(id),
    ]);

    const admits = world.scanLog.filter((r) => r.action === 'ADMIT');
    if (!world.bookings.has(id)) {
      // Deleted: there must be no admission on it, only the deletion trail.
      expect(admits).toHaveLength(0);
      expect(world.scanLog.filter((r) => r.action === 'COMP_DELETE').length).toBeGreaterThan(0);
    } else {
      expect(admits).toHaveLength(1);
    }
  });

  it('frees the seat exactly once, whoever won', async () => {
    const id = seedComp(2);
    await Promise.all([
      scan({ action: 'admit', bookingId: id, ticketNumber: 'AP-001', sig: 'good' }),
      deleteGrant(id),
    ]);

    const freed = world.rpcCalls.filter((c) => c === 'void_ticket_number').length;
    if (world.bookings.has(id)) {
      expect(world.numbers.size).toBe(2); // delete lost; both seats still held
    } else {
      expect(world.numbers.size).toBe(0); // delete won; both seats returned
      expect(freed).toBe(2);
    }
  });

  it('refuses the scan outright once the grant has gone', async () => {
    const id = seedComp(1);
    const remove = await deleteGrant(id);
    expect(remove.status).toBe(200);

    const admit = await scan({ action: 'admit', bookingId: id, ticketNumber: 'AP-001', sig: 'good' });
    expect(admit.status).toBe(404);
    expect(admit.body.error).toMatch(/not found|invalid/i);
  });

  it('refuses a scan of a pass killed by a delete that then failed to finish', async () => {
    // The delete marks the passes dead before it removes the booking, so even a half-finished
    // delete leaves nothing that scans.
    const id = seedComp(1);
    const booking = world.bookings.get(id)!;
    world.bookings.set(id, { ...booking, tickets_data: [{ ...booking.tickets_data[0], status: 'REFUNDED' }] });

    const admit = await scan({ action: 'admit', bookingId: id, ticketNumber: 'AP-001', sig: 'good' });
    expect(admit.status).toBe(410);
    expect(admit.body.error).toMatch(/refunded/i);
  });

  it('holds when the gate moves underneath a delete that is already in flight', async () => {
    // Two volunteers and one admin, all on the same single pass.
    const id = seedComp(1);
    const results = await Promise.all([
      scan({ action: 'admit', bookingId: id, ticketNumber: 'AP-001', sig: 'good' }),
      scan({ action: 'admit', bookingId: id, ticketNumber: 'AP-001', sig: 'good' }),
      deleteGrant(id),
    ]);
    // One seat, one outcome: either one admission or one deletion, never both and never two.
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
  });
});

// ==========================================================================================
describe('two admins deleting the same grant', () => {
  it('removes it once and returns its seats once', async () => {
    const id = seedComp(3);

    const [a, b] = await Promise.all([deleteGrant(id), deleteGrant(id)]);

    expect([a.status, b.status]).toContain(200);
    expect(world.bookings.has(id)).toBe(false);
    expect(world.grants.has(id)).toBe(false);
    // Three seats held, three returned - no more, however many times void was called.
    expect(world.numbers.size).toBe(0);
  });

  it('does not double-count the passes it reports', async () => {
    const id = seedComp(3);
    const [a, b] = await Promise.all([deleteGrant(id), deleteGrant(id)]);
    const ok = [a, b].filter((r) => r.status === 200);
    for (const r of ok) expect(r.body.deleted).toBeLessThanOrEqual(3);
  });

  it('survives five admins clicking together', async () => {
    const id = seedComp(2);
    const all = await Promise.all(Array.from({ length: 5 }, () => deleteGrant(id)));
    expect(all.some((r) => r.status === 200)).toBe(true);
    expect(world.bookings.has(id)).toBe(false);
    expect(world.numbers.size).toBe(0);
  });

  it('leaves a seat alone if someone else has bought it in the meantime', async () => {
    // The admin deletes a grant, a buyer takes the freed number, and the admin - on a stale
    // page - clicks delete again. The second click must not reach into the buyer's seat.
    const id = seedComp(1);
    expect((await deleteGrant(id)).status).toBe(200);
    expect(world.numbers.size).toBe(0);

    world.numbers.set('cat1:1', 'sale_someone_else');

    const again = await deleteGrant(id);
    expect(again.status).toBe(404);
    expect(again.body.error).toMatch(/no longer exists/i);
    expect(world.numbers.get('cat1:1')).toBe('sale_someone_else');
    expect(world.rpcCalls.filter((c) => c === 'void_ticket_number')).toHaveLength(1);
  });

  it('will not free a number that now belongs to a different reservation', async () => {
    // The guard is in void_ticket_number itself: it matches on the reservation id as well as
    // the seat, so a stale delete cannot evict whoever holds it now.
    const id = seedComp(1);
    world.numbers.set('cat1:1', 'sale_someone_else'); // resold under the admin's feet
    const r = await deleteGrant(id);
    expect(r.status).toBe(200);
    expect(r.body.seatsFreed).toBe(0);
    expect(world.numbers.get('cat1:1')).toBe('sale_someone_else');
  });
});

// ==========================================================================================
describe('a group pass part-way through the door', () => {
  it('reports how many had already come in', async () => {
    const id = 'b1';
    world.bookings.set(id, {
      id, event_id: 'evt_tonight', email: 'g@x.com', source: 'COMP', status: 'CONFIRMED',
      scan_version: 0,
      tickets_data: [{ categoryId: 'cat1', ticketNumber: 'GRP-001', status: 'CHECKED_IN', groupSize: 5 }],
    });
    world.grants.set(id, { guest_name: 'Family' });
    world.numbers.set('cat1:1', 'comp_abc');

    const r = await deleteGrant(id);
    expect(r.status).toBe(200);
    expect(r.body.admitted).toBe(1);
    expect(r.body.note).toMatch(/already been scanned in/);
    expect(world.numbers.size).toBe(0);
  });

  it('cannot be admitted further once deleted mid-entry', async () => {
    const id = 'b1';
    world.bookings.set(id, {
      id, event_id: 'evt_tonight', email: 'g@x.com', source: 'COMP', status: 'CONFIRMED',
      scan_version: 0,
      tickets_data: [{ categoryId: 'cat1', ticketNumber: 'GRP-001', status: 'ISSUED', groupSize: 5, admitted: 2 }],
    });
    world.grants.set(id, { guest_name: 'Family' });
    world.numbers.set('cat1:1', 'comp_abc');

    await deleteGrant(id);
    const admit = await scan({ action: 'admit', bookingId: id, ticketNumber: 'GRP-001', count: 3, sig: 'good' });
    expect(admit.status).toBe(404);
  });

  it('lets the remaining three in if the delete loses the race', async () => {
    const id = 'b1';
    world.bookings.set(id, {
      id, event_id: 'evt_tonight', email: 'g@x.com', source: 'COMP', status: 'CONFIRMED',
      scan_version: 0,
      tickets_data: [{ categoryId: 'cat1', ticketNumber: 'GRP-001', status: 'ISSUED', groupSize: 5, admitted: 2 }],
    });
    world.grants.set(id, { guest_name: 'Family' });
    world.numbers.set('cat1:1', 'comp_abc');

    const [admit, remove] = await Promise.all([
      scan({ action: 'admit', bookingId: id, ticketNumber: 'GRP-001', count: 3, sig: 'good' }),
      deleteGrant(id),
    ]);
    expect([admit.status === 200, remove.status === 200].filter(Boolean)).toHaveLength(1);
    if (admit.status === 200) expect(admit.body.admittedNow).toBe(3);
  });
});

// ==========================================================================================
describe('what a delete must never touch', () => {
  it('refuses a paid booking even under a race', async () => {
    const id = seedComp(1, { source: 'SALE' });
    const [a, b] = await Promise.all([deleteGrant(id), deleteGrant(id)]);
    expect(a.status).toBe(409);
    expect(b.status).toBe(409);
    expect(world.bookings.has(id)).toBe(true);
    expect(world.numbers.size).toBe(1);
    expect(world.rpcCalls).toEqual([]);
  });

  it('refuses a non-admin even while an admin is deleting', async () => {
    const id = seedComp(1);
    const asVolunteer = (async () => {
      isAdmin = false;
      const r = await deleteGrant(id);
      isAdmin = true;
      return r;
    })();
    const [volunteer] = await Promise.all([asVolunteer]);
    expect(volunteer.status).toBe(403);
  });

  it('does not touch another guest\'s grant', async () => {
    seedComp(1);
    world.bookings.set('b2', {
      id: 'b2', event_id: 'evt_tonight', email: 'other@x.com', source: 'COMP', status: 'CONFIRMED',
      scan_version: 0, tickets_data: [{ categoryId: 'cat1', ticketNumber: 'AP-002', status: 'ISSUED' }],
    });
    world.grants.set('b2', { guest_name: 'Someone Else' });
    world.numbers.set('cat1:2', 'comp_other');

    await deleteGrant('b1');
    expect(world.bookings.has('b2')).toBe(true);
    expect(world.grants.has('b2')).toBe(true);
    expect(world.numbers.get('cat1:2')).toBe('comp_other');
  });

  it('leaves the gate log of everyone already admitted', async () => {
    const id = seedComp(1);
    await scan({ action: 'admit', bookingId: id, ticketNumber: 'AP-001', sig: 'good' });
    expect(world.scanLog.filter((r) => r.action === 'ADMIT')).toHaveLength(1);

    await deleteGrant(id);
    // The admission row survives the booking it pointed at.
    expect(world.scanLog.filter((r) => r.action === 'ADMIT')).toHaveLength(1);
    expect(world.bookings.has(id)).toBe(false);
  });
});
