// The guards added around ticketing: the schema check that stops us taking money against a
// half-migrated database, the rate limiter, pass-QR signing, and who may scan at the gate.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkSchema, resetSchemaCache, REQUIRED_MARKER } from '@/lib/payments/schema-check';
import { RATE_RULES, rateLimit, rateKey, resetRateLimits } from '@/lib/rate-limit';
import { signTicket, unsignedPassesAllowed, verifyTicketSignature } from '@/lib/payments/ticket-signature';
import { canScanEvent, gateIdentifier, gateIdentifierLabel, resolveGateActor, StaffDb } from '@/lib/payments/staff';
import { translateInventoryError, reservationMessage, reserveInventory, ticketNumberValue } from '@/lib/payments/inventory';
import { PointsUnavailableError, ReservationLostError, SoldOutError, TicketLimitError } from '@/lib/payments/types';

const markerDb = (result: { data: unknown; error: { message: string } | null }) =>
  ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => result }) }) }),
  }) as never;

describe('schema check', () => {
  beforeEach(() => resetSchemaCache());

  it('passes once the migration marker is there', async () => {
    const res = await checkSchema(markerDb({ data: { applied_at: '2026-10-28T00:00:00Z' }, error: null }));
    expect(res.ok).toBe(true);
    expect(res.marker).toBe(REQUIRED_MARKER);
  });

  it('fails, naming the migration, when the marker row is missing', async () => {
    const res = await checkSchema(markerDb({ data: null, error: null }));
    expect(res.ok).toBe(false);
    expect(res.error).toContain('20261028_ticketing_integrity.sql');
  });

  it('fails when the markers table itself does not exist', async () => {
    const res = await checkSchema(markerDb({ data: null, error: { message: "relation 'public.app_schema_markers' does not exist" } }));
    expect(res.ok).toBe(false);
    expect(res.error).toContain('20261028_ticketing_integrity.sql');
  });

  it('remembers success but never caches a failure, so it recovers once the migration is run', async () => {
    expect((await checkSchema(markerDb({ data: null, error: null }))).ok).toBe(false);
    expect((await checkSchema(markerDb({ data: null, error: null }))).ok).toBe(false);
    expect((await checkSchema(markerDb({ data: { applied_at: 'x' }, error: null }))).ok).toBe(true);
    // Cached from here on, so a later blip does not start refusing payments.
    expect((await checkSchema(markerDb({ data: null, error: { message: 'connection reset' } }))).ok).toBe(true);
  });
});

describe('rate limiting', () => {
  beforeEach(() => resetRateLimits());

  it('allows a burst up to the limit and then refuses with a wait', () => {
    const rule = { windowMs: 60_000, max: 3 };
    expect(rateLimit('k', rule, 0).ok).toBe(true);
    expect(rateLimit('k', rule, 10).ok).toBe(true);
    expect(rateLimit('k', rule, 20).ok).toBe(true);
    const blocked = rateLimit('k', rule, 30);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfter).toBe(60);
  });

  it('frees up as the window slides', () => {
    const rule = { windowMs: 1000, max: 1 };
    expect(rateLimit('k', rule, 0).ok).toBe(true);
    expect(rateLimit('k', rule, 500).ok).toBe(false);
    expect(rateLimit('k', rule, 1001).ok).toBe(true);
  });

  it('counts each caller separately', () => {
    const rule = { windowMs: 60_000, max: 1 };
    expect(rateLimit('a', rule, 0).ok).toBe(true);
    expect(rateLimit('b', rule, 0).ok).toBe(true);
    expect(rateLimit('a', rule, 0).ok).toBe(false);
  });

  it('keys on the account when there is one, and the address when there is not', () => {
    const req = new Request('http://x/y', { headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } });
    expect(rateKey('createOrder', 'user_9', req)).toBe('createOrder:u_user_9');
    expect(rateKey('createOrder', null, req)).toBe('createOrder:ip_1.2.3.4');
  });

  it('allows enough honest checkout retries to be usable', () => {
    // Someone whose card fails a few times must not be locked out of trying again.
    for (let i = 0; i < RATE_RULES.createOrder.max; i++) {
      expect(rateLimit('checkout', RATE_RULES.createOrder, i * 1000).ok).toBe(true);
    }
  });
});

describe('pass QR signatures', () => {
  // Tests run without the production secrets, so set a known key for this block.
  beforeEach(() => {
    process.env.TICKET_QR_SECRET = 'test-qr-secret';
  });

  it('accepts a signature it produced and rejects a tampered one', () => {
    const sig = signTicket('booking-1', 'VIP011');
    expect(verifyTicketSignature('booking-1', 'VIP011', sig)).toBe('VALID');
    // The pair is bound: the same signature on another pass is no good.
    expect(verifyTicketSignature('booking-1', 'VIP012', sig)).toBe('INVALID');
    expect(verifyTicketSignature('booking-2', 'VIP011', sig)).toBe('INVALID');
    expect(verifyTicketSignature('booking-1', 'VIP011', `${sig.slice(0, -1)}0`)).toBe('INVALID');
  });

  it('reports a pass with no signature as unsigned rather than invalid', () => {
    // Passes printed before signing existed have to keep working at the gate.
    expect(verifyTicketSignature('b', 'T', undefined)).toBe('UNSIGNED');
    expect(verifyTicketSignature('b', 'T', '')).toBe('UNSIGNED');
    expect(verifyTicketSignature('b', 'T', 42)).toBe('INVALID');
  });

  it('is stable, so a pass printed today still scans tomorrow', () => {
    expect(signTicket('b', 'T')).toBe(signTicket('b', 'T'));
  });
});

describe('who may scan at the gate', () => {
  const db = (rows: { email: string; role: string; event_id: string | null; active: boolean }[]) =>
    ({ from: () => ({ select: () => ({ ilike: async () => ({ data: rows, error: null }) }) }) }) as unknown as StaffDb;

  it('an admin may scan any event', async () => {
    const actor = await resolveGateActor(db([]), { id: 'u', email: 'a@x.com' }, true);
    expect(actor).toMatchObject({ role: 'ADMIN', eventId: null });
    expect(canScanEvent(actor!, 'anything')).toBe(true);
  });

  it('nobody signed in is nobody', async () => {
    expect(await resolveGateActor(db([]), null, false)).toBeNull();
  });

  it('a volunteer on the list may scan, matched case-insensitively', async () => {
    const actor = await resolveGateActor(
      db([{ email: 'vol@x.com', role: 'SCANNER', event_id: null, active: true }]),
      { id: 'u', email: 'VOL@X.com' },
      false,
    );
    expect(actor).toMatchObject({ role: 'SCANNER', eventId: null });
  });

  it('an event-scoped volunteer is held to that event', async () => {
    const actor = await resolveGateActor(
      db([{ email: 'vol@x.com', role: 'SCANNER', event_id: 'evt_a', active: true }]),
      { id: 'u', email: 'vol@x.com' },
      false,
    );
    expect(canScanEvent(actor!, 'evt_a')).toBe(true);
    expect(canScanEvent(actor!, 'evt_b')).toBe(false);
    expect(canScanEvent(actor!, null)).toBe(false);
  });

  it('a global row beats an event-scoped one for the same person', async () => {
    const actor = await resolveGateActor(
      db([
        { email: 'vol@x.com', role: 'SCANNER', event_id: 'evt_a', active: true },
        { email: 'vol@x.com', role: 'SCANNER', event_id: null, active: true },
      ]),
      { id: 'u', email: 'vol@x.com' },
      false,
    );
    expect(actor?.eventId).toBeNull();
    expect(canScanEvent(actor!, 'evt_z')).toBe(true);
  });

  it('switched-off and non-scanner rows do not count', async () => {
    expect(await resolveGateActor(db([{ email: 'v@x.com', role: 'SCANNER', event_id: null, active: false }]), { id: 'u', email: 'v@x.com' }, false)).toBeNull();
    expect(await resolveGateActor(db([{ email: 'v@x.com', role: 'OTHER', event_id: null, active: true }]), { id: 'u', email: 'v@x.com' }, false)).toBeNull();
  });

  it('never falls open when the list cannot be read', async () => {
    const broken = { from: () => ({ select: () => ({ ilike: async () => ({ data: null, error: { message: 'down' } }) }) }) } as unknown as StaffDb;
    expect(await resolveGateActor(broken, { id: 'u', email: 'v@x.com' }, false)).toBeNull();
  });
});

describe('reservation failures become things we can say to a buyer', () => {
  it('translates each raised message back into a real error', () => {
    expect(translateInventoryError('SOLD_OUT:FRONT ROW')).toBeInstanceOf(SoldOutError);
    expect((translateInventoryError('SOLD_OUT:FRONT ROW') as SoldOutError).categoryName).toBe('FRONT ROW');
    expect(translateInventoryError('LIMIT_SINGLE:7')).toBeInstanceOf(TicketLimitError);
    expect(translateInventoryError('LIMIT_GROUP:2')).toBeInstanceOf(TicketLimitError);
    expect(translateInventoryError('POINTS_UNAVAILABLE:40')).toBeInstanceOf(PointsUnavailableError);
    expect(translateInventoryError('RESERVATION_LOST:res_1')).toBeInstanceOf(ReservationLostError);
  });

  it('explains sold out, the per-account cap and held points in plain words', () => {
    expect(reservationMessage(new SoldOutError('VIP'))?.message).toMatch(/just sold out.*Nothing has been charged/i);
    expect(reservationMessage(new TicketLimitError('SINGLE', 7))?.message).toMatch(/at most 7 passes/i);
    expect(reservationMessage(new TicketLimitError('GROUP', 2))?.message).toMatch(/at most 2 group passes/i);
    expect(reservationMessage(new PointsUnavailableError(40))?.message).toMatch(/Only 40 points/i);
    expect(reservationMessage(new PointsUnavailableError(0))?.message).toMatch(/held by another checkout/i);
    expect(reservationMessage(new Error('something else'))).toBeNull();
  });

  it('every one of them is a 409, because nothing was charged', () => {
    for (const e of [new SoldOutError('X'), new TicketLimitError('SINGLE', 7), new PointsUnavailableError(0)]) {
      expect(reservationMessage(e)?.status).toBe(409);
    }
  });
});

describe('reading the number off a pass', () => {
  it('strips the category prefix', () => {
    expect(ticketNumberValue('GA-013', 'GA-')).toBe(13);
    expect(ticketNumberValue('VIP011', 'VIP')).toBe(11);
    expect(ticketNumberValue('G5-003', 'G5-')).toBe(3);
  });

  it('falls back to the trailing digits when the prefix does not match', () => {
    expect(ticketNumberValue('GA-013', 'XX-')).toBe(13);
    expect(ticketNumberValue('GA-013')).toBe(13);
  });

  it('returns null for anything it cannot read', () => {
    expect(ticketNumberValue('GA-ABC', 'GA-')).toBeNull();
    expect(ticketNumberValue('', 'GA-')).toBeNull();
    expect(ticketNumberValue('GA-000', 'GA-')).toBeNull();
  });
});

describe('unsigned QR codes are refused', () => {
  afterEach(() => { delete process.env.TICKET_QR_UNSIGNED_OK; });

  it('refuses an unsigned pass by default', () => {
    // Signing landed before sales opened, so an unsigned code is never a real pass. Accepting
    // one would mean a forger could simply leave the signature off.
    delete process.env.TICKET_QR_UNSIGNED_OK;
    expect(unsignedPassesAllowed()).toBe(false);
  });

  it('can be re-opened only by an explicit escape hatch', () => {
    process.env.TICKET_QR_UNSIGNED_OK = 'true';
    expect(unsignedPassesAllowed()).toBe(true);
    process.env.TICKET_QR_UNSIGNED_OK = 'false';
    expect(unsignedPassesAllowed()).toBe(false);
  });

  it('a wrong signature is refused either way', () => {
    process.env.TICKET_QR_SECRET = 'test-qr-secret';
    for (const open of ['true', 'false']) {
      process.env.TICKET_QR_UNSIGNED_OK = open;
      expect(verifyTicketSignature('b', 'T', 'deadbeefdeadbeef')).toBe('INVALID');
    }
  });
});

describe('identifying a volunteer the way they actually sign in', () => {
  it('turns a mobile number into the account the entry gate really creates', () => {
    // GlobalEntryGate signs members up as `<phone>@punerimallus.com`, so that — not their
    // personal address — is the email the gate compares against.
    expect(gateIdentifier('9890122274')).toBe('9890122274@punerimallus.com');
    expect(gateIdentifier('+91 98901 22274')).toBe('9890122274@punerimallus.com');
    expect(gateIdentifier('09890122274')).toBe('9890122274@punerimallus.com');
    expect(gateIdentifier('+919890122274')).toBe('9890122274@punerimallus.com');
    expect(gateIdentifier(' 98901-22274 ')).toBe('9890122274@punerimallus.com');
  });

  it('leaves a real email alone, lower-cased', () => {
    expect(gateIdentifier('Volunteer@Example.COM')).toBe('volunteer@example.com');
  });

  it('refuses anything that is neither', () => {
    for (const bad of ['', '   ', 'not-an-email', '12345', '98901222741234', 'a@b']) {
      expect(gateIdentifier(bad)).toBeNull();
    }
  });

  it('shows a ghost address back as the plain number', () => {
    expect(gateIdentifierLabel('9890122274@punerimallus.com')).toBe('9890122274');
    expect(gateIdentifierLabel('volunteer@example.com')).toBe('volunteer@example.com');
  });

  it('round-trips: what an organiser types matches what the gate sees', () => {
    const typedByOrganiser = gateIdentifier('+91 98901 22274')!;
    const emailOnTheirAccount = '9890122274@punerimallus.com';
    expect(typedByOrganiser).toBe(emailOnTheirAccount);
  });
});

describe('a reservation that did not fully succeed never reaches payment', () => {
  const db = (data: unknown) => ({ rpc: async () => ({ data, error: null }) }) as never;
  const req = {
    reservationId: 'r1', userId: 'u1',
    items: [{ categoryId: 'cat_a', qty: 2 }, { categoryId: 'cat_b', qty: 1 }],
    maxSingle: 7, maxGroup: 2,
  };

  it('accepts a result that matches the cart exactly', async () => {
    const out = await reserveInventory(db([
      { categoryId: 'cat_a', qty: 2, endSold: 2, numbers: [1, 2] },
      { categoryId: 'cat_b', qty: 1, endSold: 1, numbers: [1] },
    ]), req);
    expect(out).toHaveLength(2);
  });

  it('refuses an empty result rather than sending the buyer to pay for nothing', async () => {
    await expect(reserveInventory(db([]), req)).rejects.toThrow(/RESERVATION_INCOMPLETE/);
    await expect(reserveInventory(db(null), req)).rejects.toThrow(/RESERVATION_INCOMPLETE/);
  });

  it('refuses when a category is missing from the result', async () => {
    await expect(reserveInventory(db([{ categoryId: 'cat_a', qty: 2, endSold: 2, numbers: [1, 2] }]), req))
      .rejects.toThrow(/RESERVATION_INCOMPLETE/);
  });

  it('refuses when fewer numbers came back than seats asked for', async () => {
    await expect(reserveInventory(db([
      { categoryId: 'cat_a', qty: 2, endSold: 2, numbers: [1] },
      { categoryId: 'cat_b', qty: 1, endSold: 1, numbers: [1] },
    ]), req)).rejects.toThrow(/cat_a wanted 2, got 1/);
  });

  it('ignores zero-quantity lines when checking', async () => {
    const out = await reserveInventory(db([{ categoryId: 'cat_a', qty: 1, endSold: 1, numbers: [1] }]), {
      ...req, items: [{ categoryId: 'cat_a', qty: 1 }, { categoryId: 'cat_b', qty: 0 }],
    });
    expect(out).toHaveLength(1);
  });
});
