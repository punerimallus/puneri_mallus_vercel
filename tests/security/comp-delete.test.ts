import { beforeEach, describe, expect, it, vi } from 'vitest';

// Deleting a complimentary grant.
//
// This is the only endpoint in the app that removes a ticket_bookings row, so the rail that
// matters is the one refusing to touch a sale: a paid booking is somebody's receipt, and the
// void button exists for that case. The rest of these tests pin the ORDER of the writes, which
// is the part that cannot be seen by reading the happy path. Any step can fail, and the order
// chosen means a half-finished delete leaves dead passes and maybe a stranded seat - never a
// live pass whose number has been handed to the next buyer.

interface Pass { categoryId?: string; ticketNumber: string; status?: string }

let booking: Record<string, unknown> | null = null;
let numberRow: { reservation_id: string } | null = { reservation_id: 'comp_abc' };
let updateHits = 1; // rows the optimistic update matched; 0 means someone else got there first
let isAdmin = true;
let signedIn = true;

/** Every write, in the order it happened. The whole point of the test. */
let ops: string[] = [];
let deleted: string[] = [];
let voided: { categoryId: string; number: number }[] = [];
let logged: Record<string, unknown>[] = [];
let voidedInPlace: Pass[] | null = null;

const comp = (passes: Pass[], over: Record<string, unknown> = {}) => ({
  id: 'b1',
  event_id: 'e1',
  email: 'guest@example.com',
  source: 'COMP',
  tickets_data: passes,
  scan_version: 3,
  ...over,
});

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => undefined }) }));
vi.mock('@/lib/admin', () => ({
  checkAdminAccess: async () => ({ isAdmin, user: signedIn ? { id: 'admin1', email: 'admin@punerimallus.com' } : null }),
}));

vi.mock('@/lib/payments/server', () => ({
  fulfilmentDeps: { confirmReservation: vi.fn(async () => undefined) },
  releaseReservation: vi.fn(async () => 0),
  reserveForCheckout: vi.fn(async () => []),
  resendBooking: vi.fn(async () => ({ status: 'SENT' })),
  supabaseAdmin: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      ops.push(`rpc:${fn}`);
      if (fn === 'void_ticket_number') {
        voided.push({ categoryId: String(args.p_category_id), number: Number(args.p_number) });
        return { data: 1, error: null };
      }
      return { data: null, error: null };
    },
    from: (table: string) => {
      const q: any = { _op: 'select' };
      const settle = () => {
        if (q._op === 'update') {
          ops.push(`update:${table}`);
          if (table === 'ticket_bookings') voidedInPlace = (q._row?.tickets_data || null) as Pass[] | null;
          return { data: Array.from({ length: updateHits }, () => ({ id: 'b1' })), error: null };
        }
        if (q._op === 'delete') {
          ops.push(`delete:${table}`);
          deleted.push(table);
          return { data: null, error: null };
        }
        if (q._op === 'insert') {
          ops.push(`insert:${table}`);
          if (table === 'scan_log') logged = logged.concat(q._rows as Record<string, unknown>[]);
          return { data: null, error: null };
        }
        return {
          data: table === 'ticket_bookings' ? booking
            : table === 'comp_ticket_grants' ? { guest_name: 'Chief Guest' }
            : table === 'ticket_numbers' ? numberRow
            : null,
          error: null,
        };
      };
      Object.assign(q, {
        select: () => q,
        eq: () => q,
        limit: () => q,
        order: () => q,
        update: (row: Record<string, unknown>) => { q._op = 'update'; q._row = row; return q; },
        delete: () => { q._op = 'delete'; return q; },
        insert: (rows: unknown) => { q._op = 'insert'; q._rows = rows; return q; },
        maybeSingle: async () => settle(),
        single: async () => settle(),
        // Supabase's builder is thenable, which is how `await ...select('id')` works.
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(settle()).then(res, rej),
      });
      return q;
    },
  }),
}));

const del = async (body: Record<string, unknown>) => {
  const { DELETE } = await import('@/app/api/admin/tickets/comp/route');
  const res = await DELETE(new Request('http://x/api/admin/tickets/comp', {
    method: 'DELETE', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  }));
  return { status: res.status, body: await res.json() };
};

beforeEach(() => {
  ops = []; deleted = []; voided = []; logged = []; voidedInPlace = null;
  numberRow = { reservation_id: 'comp_abc' };
  updateHits = 1;
  isAdmin = true;
  signedIn = true;
  booking = comp([
    { categoryId: 'cat1', ticketNumber: 'AP-001', status: 'ISSUED' },
    { categoryId: 'cat1', ticketNumber: 'AP-002', status: 'ISSUED' },
  ]);
});

describe('who may delete', () => {
  it('refuses a signed-in user who is not an admin', async () => {
    isAdmin = false;
    const r = await del({ bookingId: 'b1' });
    expect(r.status).toBe(403);
    expect(deleted).toHaveLength(0);
  });

  it('refuses someone who is not signed in at all', async () => {
    signedIn = false;
    isAdmin = false;
    const r = await del({ bookingId: 'b1' });
    expect(r.status).toBe(401);
    expect(deleted).toHaveLength(0);
  });

  it('needs to be told which grant', async () => {
    const r = await del({});
    expect(r.status).toBe(400);
    expect(deleted).toHaveLength(0);
  });

  it('is a 404 for a booking that is already gone', async () => {
    booking = null;
    const r = await del({ bookingId: 'nope' });
    expect(r.status).toBe(404);
    expect(deleted).toHaveLength(0);
  });
});

describe('a paid booking is not deletable here', () => {
  // The whole reason this endpoint can be allowed to delete at all. A sale has a receipt
  // behind it; the void button kills one pass and keeps the record.
  it('refuses a SALE and sends the admin to the void button', async () => {
    booking = comp([{ categoryId: 'cat1', ticketNumber: 'GA-001', status: 'ISSUED' }], { source: 'SALE' });
    const r = await del({ bookingId: 'b1' });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/void/i);
    expect(deleted).toHaveLength(0);
    expect(voided).toHaveLength(0);
    expect(ops).toHaveLength(0); // nothing at all was written
  });

  it('refuses a row whose source cannot be read, rather than guessing', async () => {
    // An older database without the column hands back undefined. Reading that as "probably a
    // comp" would make every paid booking deletable on exactly the deployments that are
    // behind, which is the worst possible place for it to be true.
    for (const source of [undefined, null, '', 'sale', 'REFUND']) {
      booking = comp([{ categoryId: 'cat1', ticketNumber: 'GA-001' }], { source });
      expect((await del({ bookingId: 'b1' })).status).toBe(409);
    }
    expect(deleted).toHaveLength(0);
  });

  it('accepts COMP however it is cased', async () => {
    booking = comp([{ categoryId: 'cat1', ticketNumber: 'AP-001' }], { source: 'comp' });
    expect((await del({ bookingId: 'b1' })).status).toBe(200);
  });
});

describe('deleting a grant', () => {
  it('kills the passes, frees the seats, logs it, then removes the booking - in that order', async () => {
    const r = await del({ bookingId: 'b1' });
    expect(r.status).toBe(200);
    expect(r.body.deleted).toBe(2);
    expect(r.body.seatsFreed).toBe(2);

    // The order is the safety property. Voiding first means a later failure leaves passes that
    // do not scan; deleting first would leave seats nobody can find.
    expect(ops).toEqual([
      'update:ticket_bookings',
      'rpc:void_ticket_number',
      'rpc:void_ticket_number',
      'insert:scan_log',
      'delete:ticket_bookings',
    ]);
    expect(deleted).toEqual(['ticket_bookings']);
  });

  it('marks every pass dead in the row before it goes', async () => {
    await del({ bookingId: 'b1' });
    expect(voidedInPlace?.every((t) => t.status === 'REFUNDED')).toBe(true);
  });

  it('hands back exactly the numbers the passes were holding', async () => {
    await del({ bookingId: 'b1' });
    expect(voided).toEqual([
      { categoryId: 'cat1', number: 1 },
      { categoryId: 'cat1', number: 2 },
    ]);
  });

  it('leaves a trail that is not confusable with a single-pass void', async () => {
    await del({ bookingId: 'b1' });
    expect(logged).toHaveLength(2);
    expect(logged.every((l) => l.action === 'COMP_DELETE')).toBe(true);
    // Zero admitted, so attendance (which counts ADMIT rows) cannot be moved by a delete.
    expect(logged.every((l) => l.admitted === 0)).toBe(true);
    expect(logged.every((l) => l.actor_email === 'admin@punerimallus.com' && l.actor_role === 'ADMIN')).toBe(true);
  });

  it('says who lost their passes', async () => {
    const r = await del({ bookingId: 'b1' });
    expect(r.body.note).toMatch(/Chief Guest/);
    expect(r.body.note).toMatch(/2 passes/);
    expect(r.body.note).toMatch(/2 seats back on sale/);
  });
});

describe('the awkward ones', () => {
  it('backs out if the gate touched the grant in the meantime', async () => {
    // scan_version moved, so a volunteer may be admitting this guest right now. Deleting over
    // the top of that would lose the admission.
    updateHits = 0;
    const r = await del({ bookingId: 'b1' });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/reload/i);
    expect(deleted).toHaveLength(0);
    expect(voided).toHaveLength(0);
  });

  it('still removes a grant whose passes were already voided one by one', async () => {
    // Nothing to kill and nothing to free, but the register row must still go - otherwise a
    // tidied-up grant is stuck in the list for ever.
    booking = comp([
      { categoryId: 'cat1', ticketNumber: 'AP-001', status: 'REFUNDED' },
      { categoryId: 'cat1', ticketNumber: 'AP-002', status: 'REFUNDED' },
    ]);
    const r = await del({ bookingId: 'b1' });
    expect(r.status).toBe(200);
    expect(r.body.deleted).toBe(2);
    expect(r.body.seatsFreed).toBe(0);
    expect(r.body.note).toMatch(/no seats needed returning/);
    expect(deleted).toEqual(['ticket_bookings']);
    expect(ops).toEqual(['delete:ticket_bookings']);
  });

  it('can be run twice: a seat already freed is not an error', async () => {
    numberRow = null; // the number row has gone, by an earlier attempt or the void button
    const r = await del({ bookingId: 'b1' });
    expect(r.status).toBe(200);
    expect(r.body.seatsFreed).toBe(0);
    expect(voided).toHaveLength(0);
    expect(deleted).toEqual(['ticket_bookings']);
  });

  it('deletes a guest who had already been scanned in, and says so', async () => {
    booking = comp([{ categoryId: 'cat1', ticketNumber: 'AP-001', status: 'CHECKED_IN' }]);
    const r = await del({ bookingId: 'b1' });
    expect(r.status).toBe(200);
    expect(r.body.admitted).toBe(1);
    expect(r.body.note).toMatch(/already been scanned in/);
    // The admission itself stays in scan_log: the person did walk in, and deleting the pass
    // afterwards does not change that.
    expect(deleted).toEqual(['ticket_bookings']);
  });

  it('names a pass whose seat it could not return instead of pretending it did', async () => {
    booking = comp([
      { ticketNumber: 'AP-001', status: 'ISSUED' },                         // no category
      { categoryId: 'cat1', ticketNumber: 'LEGACY', status: 'ISSUED' },     // no number in it
      { categoryId: 'cat1', ticketNumber: 'AP-003', status: 'ISSUED' },
    ]);
    const r = await del({ bookingId: 'b1' });
    expect(r.status).toBe(200);
    expect(r.body.seatsFreed).toBe(1);
    expect(r.body.unfreeable).toEqual(['AP-001', 'LEGACY']);
    expect(r.body.note).toMatch(/check capacity by hand for AP-001, LEGACY/);
  });

  it('deletes a grant with no passes left in it at all', async () => {
    booking = comp([]);
    const r = await del({ bookingId: 'b1' });
    expect(r.status).toBe(200);
    expect(deleted).toEqual(['ticket_bookings']);
  });
});
