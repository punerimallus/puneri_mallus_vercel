import { beforeEach, describe, expect, it, vi } from 'vitest';

// The gate API with an in-memory booking table that behaves like Postgres for our queries
// (including the scan_version guard), so races between two gate staff can be tested, along with
// the authorisation, signature and event-window rules.

let isAdmin = true;
let signedIn: { id: string; email?: string } | null = { id: 'u_admin', email: 'admin@punerimallus.com' };
let staffRows: { email: string; role: string; event_id: string | null; active: boolean }[] = [];
let row: any;
let bookingEventId = 'evt_tonight';
let beforeWrite: (() => void) | null = null;
let scanLog: any[] = [];

/**
 * An event date and time, in the "OCT 28, 2026" / "5:00 PM" shape the app stores, for a moment
 * `offsetDays` from now — expressed on the Indian wall clock, which is how eventStart() reads
 * them.
 *
 * Both halves have to move together. Pinning the time to a fixed "11:59 PM" made this suite
 * fail between 05:30 and 09:29 IST: the UTC calendar day had already rolled over while the
 * Indian one had not, so "today at 11:59 PM" was more than eight hours away and the gate was
 * correctly reporting EARLY. Deriving the time from now keeps offset 0 inside the window at
 * any hour, in any timezone.
 */
function eventAt(offsetDays = 0): { date: string; time: string } {
  const IST_OFFSET_MIN = 330;
  const d = new Date(Date.now() + offsetDays * 86400000 + IST_OFFSET_MIN * 60_000);
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const hour24 = d.getUTCHours();
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return {
    date: `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`,
    time: `${hour12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${hour24 >= 12 ? 'PM' : 'AM'}`,
  };
}
let eventDate = eventAt().date;
let eventTime = eventAt().time;

function builder(table: string) {
  const state: any = { filters: [] as [string, unknown][], patch: null, table };
  const api: any = {
    select: (cols?: string) => { state.cols = cols; return api; },
    update: (patch: any) => { state.patch = patch; return api; },
    insert: (rowsIn: any) => { state.insert = rowsIn; return api; },
    eq: (k: string, v: unknown) => { state.filters.push([k, v]); return api; },
    ilike: (_k: string, v: string) => {
      state.ilike = v;
      return api;
    },
    order: () => api,
    limit: () => api,
    maybeSingle: async () => {
      if (table === 'ticket_bookings') return { data: structuredClone(row), error: null };
      return { data: null, error: null };
    },
    then: (resolve: any) => {
      if (table === 'event_staff') {
        const want = String(state.ilike || '').toLowerCase();
        return resolve({ data: staffRows.filter((r) => r.email.toLowerCase() === want), error: null });
      }
      if (table === 'scan_log') {
        scanLog.push(state.insert);
        return resolve({ data: null, error: null });
      }
      // an update(...).eq(...).eq(...).select('id') chain on ticket_bookings
      if (beforeWrite) { const f = beforeWrite; beforeWrite = null; f(); }
      const matches = state.filters.every(([k, v]: [string, unknown]) => row[k] === v);
      if (state.patch && matches) { row = { ...row, ...structuredClone(state.patch) }; return resolve({ data: [{ id: row.id }], error: null }); }
      return resolve({ data: [], error: null });
    },
  };
  return api;
}

vi.mock('@/lib/admin', () => ({ checkAdminAccess: async () => ({ isAdmin, user: signedIn }) }));
vi.mock('@/lib/payments/server', () => ({
  supabaseAdmin: () => ({ from: builder }),
  loadBookingView: async () => ({
    status: row?.status || 'CONFIRMED',
    eventId: bookingEventId,
    event: { title: 'Onam Night', date: eventDate, time: eventTime, location: 'Pune' },
  }),
}));
// Signatures are exercised on their own in ticket-signature.test.ts; here 'good' stands for a
// correctly signed pass and anything else for a forged one.
vi.mock('@/lib/payments/ticket-signature', () => ({
  verifyTicketSignature: (_b: string, _t: string, sig: unknown) =>
    sig === undefined || sig === null || sig === '' ? 'UNSIGNED' : sig === 'good' ? 'VALID' : 'INVALID',
  unsignedPassesAllowed: () => true,
}));

const post = async (body: unknown) => {
  const { POST } = await import('@/app/api/gate/scan/route');
  const res = await POST(new Request('http://x/api/gate/scan', { method: 'POST', body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
};
const fresh = (tickets: any[]) => ({ id: 'b1', status: 'CONFIRMED', scan_version: 0, tickets_data: tickets });
const ids = { bookingId: 'b1', sig: 'good' };

beforeEach(async () => {
  isAdmin = true;
  signedIn = { id: 'u_admin', email: 'admin@punerimallus.com' };
  staffRows = [];
  beforeWrite = null;
  scanLog = [];
  bookingEventId = 'evt_tonight';
  ({ date: eventDate, time: eventTime } = eventAt());

  const { resetRateLimits } = await import('@/lib/rate-limit');
  resetRateLimits();
});

describe('who may scan', () => {
  it('refuses someone who is not signed in', async () => {
    row = fresh([]);
    signedIn = null;
    expect((await post({ ...ids, ticketNumber: 'A' })).status).toBe(401);
  });

  it('refuses a signed-in person who is not an admin and not on the gate list', async () => {
    row = fresh([]);
    isAdmin = false;
    signedIn = { id: 'u_rando', email: 'rando@example.com' };
    const r = await post({ ...ids, ticketNumber: 'A' });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/not on the gate list/i);
  });

  it('lets a volunteer scan without making them an admin', async () => {
    row = fresh([{ categoryName: 'GENERAL', ticketNumber: 'A', status: 'ISSUED' }]);
    isAdmin = false;
    signedIn = { id: 'u_vol', email: 'Volunteer@Example.com' };
    staffRows = [{ email: 'volunteer@example.com', role: 'SCANNER', event_id: null, active: true }];
    const r = await post({ ...ids, ticketNumber: 'A' });
    expect(r.status).toBe(200);
    expect(row.tickets_data[0].status).toBe('CHECKED_IN');
  });

  it('refuses a volunteer whose access was switched off', async () => {
    row = fresh([{ categoryName: 'GENERAL', ticketNumber: 'A', status: 'ISSUED' }]);
    isAdmin = false;
    signedIn = { id: 'u_vol', email: 'volunteer@example.com' };
    staffRows = [{ email: 'volunteer@example.com', role: 'SCANNER', event_id: null, active: false }];
    expect((await post({ ...ids, ticketNumber: 'A' })).status).toBe(403);
  });

  it('a volunteer tied to one event cannot admit anyone to another', async () => {
    row = fresh([{ categoryName: 'GENERAL', ticketNumber: 'A', status: 'ISSUED' }]);
    isAdmin = false;
    signedIn = { id: 'u_vol', email: 'volunteer@example.com' };
    staffRows = [{ email: 'volunteer@example.com', role: 'SCANNER', event_id: 'evt_other', active: true }];
    const r = await post({ ...ids, ticketNumber: 'A' });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('WRONG_EVENT');
    expect(row.tickets_data[0].status).toBe('ISSUED');
  });

  it('rejects malformed requests', async () => {
    row = fresh([]);
    expect((await post({ sig: 'good', ticketNumber: 'A' })).status).toBe(400);
    expect((await post({ ...ids })).status).toBe(400);
  });
});

describe('the QR has to be ours', () => {
  it('refuses a forged signature outright', async () => {
    row = fresh([{ categoryName: 'GENERAL', ticketNumber: 'A', status: 'ISSUED' }]);
    const r = await post({ bookingId: 'b1', ticketNumber: 'A', sig: 'forged' });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('BAD_SIGNATURE');
    expect(row.tickets_data[0].status).toBe('ISSUED');
  });

  it('still admits an unsigned pass printed before signing existed, and records it as unsigned', async () => {
    row = fresh([{ categoryName: 'GENERAL', ticketNumber: 'A', status: 'ISSUED' }]);
    const r = await post({ bookingId: 'b1', ticketNumber: 'A' });
    expect(r.status).toBe(200);
    expect(r.body.gate.signed).toBe(false);
    expect(scanLog[0].signed).toBe(false);
  });
});

describe('a pass only works at its own event, at the right time', () => {
  it('asks a volunteer to confirm on a pass for an event that is over, then lets them admit', async () => {
    row = fresh([{ categoryName: 'GENERAL', ticketNumber: 'A', status: 'ISSUED' }]);
    ({ date: eventDate, time: eventTime } = eventAt(-30));
    isAdmin = false;
    signedIn = { id: 'u_vol', email: 'volunteer@example.com' };
    staffRows = [{ email: 'volunteer@example.com', role: 'SCANNER', event_id: null, active: true }];

    const r = await post({ ...ids, ticketNumber: 'A' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('GATE_CLOSED');
    expect(r.body.needsOverride).toBe(true);
    expect(row.tickets_data[0].status).toBe('ISSUED');

    // The volunteer standing at the door can confirm and let them in. The window stops an
    // accidental wrong-day admission, not the person doing the job.
    const forced = await post({ ...ids, ticketNumber: 'A', override: true });
    expect(forced.status).toBe(200);
    expect(row.tickets_data[0].status).toBe('CHECKED_IN');
  });

  it('refuses a pass for an event weeks away', async () => {
    row = fresh([{ categoryName: 'GENERAL', ticketNumber: 'A', status: 'ISSUED' }]);
    ({ date: eventDate, time: eventTime } = eventAt(30));
    isAdmin = false;
    signedIn = { id: 'u_vol', email: 'volunteer@example.com' };
    staffRows = [{ email: 'volunteer@example.com', role: 'SCANNER', event_id: null, active: true }];

    const r = await post({ ...ids, ticketNumber: 'A' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('GATE_EARLY');
    expect(r.body.needsOverride).toBe(true);
    expect(row.tickets_data[0].status).toBe('ISSUED');
  });

  it('an admin is asked to confirm too, then allowed', async () => {
    row = fresh([{ categoryName: 'GENERAL', ticketNumber: 'A', status: 'ISSUED' }]);
    ({ date: eventDate, time: eventTime } = eventAt(-30));

    const asked = await post({ ...ids, ticketNumber: 'A' });
    expect(asked.status).toBe(409);
    expect(asked.body.needsOverride).toBe(true);
    expect(row.tickets_data[0].status).toBe('ISSUED');

    const forced = await post({ ...ids, ticketNumber: 'A', override: true });
    expect(forced.status).toBe(200);
    expect(row.tickets_data[0].status).toBe('CHECKED_IN');
  });

  it('an unreadable event date does not wave people through', async () => {
    row = fresh([{ categoryName: 'GENERAL', ticketNumber: 'A', status: 'ISSUED' }]);
    eventDate = 'SOMETIME SOON';
    isAdmin = false;
    signedIn = { id: 'u_vol', email: 'volunteer@example.com' };
    staffRows = [{ email: 'volunteer@example.com', role: 'SCANNER', event_id: null, active: true }];

    const r = await post({ ...ids, ticketNumber: 'A' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('GATE_UNKNOWN');
    expect(r.body.needsOverride).toBe(true);
    // Still not admitted without a deliberate confirmation.
    expect(row.tickets_data[0].status).toBe('ISSUED');
  });
});

describe('admitting', () => {
  it('lookup shows the pass and event without changing anything', async () => {
    row = fresh([{ categoryName: 'GROUP', ticketNumber: 'G-1', status: 'ISSUED', groupSize: 6, admitted: 2 }]);
    const r = await post({ ...ids, ticketNumber: 'G-1', action: 'lookup' });
    expect(r.status).toBe(200);
    expect(r.body.ticketDetails).toMatchObject({ groupSize: 6, admitted: 2, remaining: 4 });
    expect(r.body.event.title).toBe('Onam Night');
    expect(r.body.actor).toMatchObject({ role: 'ADMIN' });
    expect(row.scan_version).toBe(0);
    expect(scanLog).toHaveLength(0);
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

  it('writes who admitted whom to the audit log', async () => {
    row = fresh([{ categoryName: 'GROUP', ticketNumber: 'G-1', status: 'ISSUED', groupSize: 6 }]);
    await post({ ...ids, ticketNumber: 'G-1', count: 2 });
    expect(scanLog).toHaveLength(1);
    expect(scanLog[0]).toMatchObject({
      booking_id: 'b1',
      ticket_number: 'G-1',
      event_id: 'evt_tonight',
      admitted: 2,
      action: 'ADMIT',
      actor_email: 'admin@punerimallus.com',
      actor_role: 'ADMIN',
      signed: true,
    });
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
});

describe('two gates at once', () => {
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
});
