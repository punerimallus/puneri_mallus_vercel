// One group ticket, from the admin creating the offer to the last person walking through the
// gate — against a real PostgreSQL, with the real migrations and the real modules.
//
// Every other test here takes one stage in isolation. This one chains them in the order a sale
// actually happens, because the bugs that got through were all at the joins: the offer that
// sold but never incremented its counter, the free pass that made the reservation look short,
// the group of eight counted as eight personal purchases, the eight seats issued as one pass
// with no mention of eight anywhere the buyer could see.
//
// The route's own logic is reproduced here rather than imported — app/api/razorpay/order is a
// Next handler and cannot be called without a request, a session and Razorpay. Every line of it
// that decides anything is copied, and the modules it calls are the real ones. Where that copy
// drifts from the route, this test stops proving what it claims to, so keep the two in step.

import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { freshDb, seedUser, type Fixture } from './pg';
import { reserveInventory, releaseInventory, type InventoryDb } from '@/lib/payments/inventory';
import { buildIssuedTickets } from '@/lib/payments/fulfil';
import {
  bundleAvailability,
  quoteEventCart,
  MAX_BUNDLES_PER_ACCOUNT,
  MAX_TICKETS_PER_ACCOUNT,
  type TicketBundle,
  type TicketCategory,
} from '@/lib/payments/pricing';
import { checkBundleInput, type BundleCategory } from '@/lib/payments/bundles';
import { applyScan, admitEveryone, progressOf, admitsLabel, seatRangeLabel, type ScanTicket } from '@/lib/payments/scan';
import { bookingAttendance, admittedBy, type ScanLogRow } from '@/lib/payments/attendance';
import { passLinesHtml, passSummaryLine, type EmailedPass } from '@/lib/mail';
import type { Coupon } from '@/lib/payments/coupons';
import type { CartLine, PaymentOrder } from '@/lib/payments/types';

const ROOT = join(import.meta.dirname ?? __dirname, '..', '..');
const sqlFile = (n: string) => readFileSync(join(ROOT, 'supabase', 'migrations', n), 'utf8');

const EVENT = 'evt_test';
const CAPACITY = 78;
const PRICE = 1049;
const GROUP_SIZE = 8;
const GROUP_PRICE = 7000;

let f: Fixture;
let cat: string;
let user: string;

beforeEach(async () => {
  f = await freshDb();
  // Every migration this feature needs, in the order they must be run in production.
  await f.db.exec(sqlFile('20261114_coupons.sql'));
  await f.db.exec(sqlFile('20261115_ticket_bundles.sql'));
  await f.db.exec(sqlFile('20261116_drop_group_tickets.sql'));
  await f.db.exec(sqlFile('20261117_bundle_sold_counter.sql'));
  // Inserted directly rather than through seedCategory: 20261116 drops the old `group_size`
  // column that helper still writes, which is the whole point of that migration.
  cat = await f.val<string>(
    `insert into event_ticket_categories (event_id, name, prefix, price, capacity)
     values ($1, 'REGULAR', 'REGULAR-', $2, $3) returning id`,
    [EVENT, PRICE, CAPACITY],
  );
  user = await seedUser(f);
});

afterEach(async () => { await f?.close(); });

/** The real inventory client, pointed at PGlite. */
const db = (): InventoryDb => ({
  rpc: (fn: string, args: Record<string, unknown>) => {
    const call = fn === 'reserve_order_inventory'
      ? {
          sql: `select ${fn}($1,$2,$3::jsonb,$4,$5,$6,$7,$8) as d`,
          params: [args.p_reservation_id, args.p_user_id, JSON.stringify(args.p_items),
                   args.p_points, args.p_ttl_seconds, args.p_max_single, 2, args.p_max_bundles],
        }
      : { sql: `select ${fn}($1) as d`, params: [args.p_reservation_id] };
    return f.db.query(call.sql, call.params)
      .then((r) => ({ data: (r.rows[0] as { d: unknown }).d as never, error: null }))
      .catch((e: Error) => ({ data: null, error: { message: e.message } }));
  },
});

// ------------------------------------------------------------------------------------------
// Stage 1 — the admin makes the offer
// ------------------------------------------------------------------------------------------

/** What the category looks like to the code that checks and prices, read live from the db. */
async function liveCategory(): Promise<TicketCategory & BundleCategory> {
  const row = await f.one<{ id: string; name: string; prefix: string; price: string; capacity: number; sold: number; released: number; active: boolean }>(
    `select id, name, prefix, price, capacity, sold, released, active from event_ticket_categories where id = $1`,
    [cat],
  );
  return {
    id: row!.id, name: row!.name, prefix: row!.prefix, price: Number(row!.price),
    capacity: row!.capacity, sold: row!.sold, released: row!.released, active: row!.active,
  };
}

/** Create the offer exactly as POST /api/admin/bundles does: validate, then insert. */
async function createOffer(over: Record<string, unknown> = {}): Promise<TicketBundle> {
  const category = await liveCategory();
  const clean = checkBundleInput(
    { categoryId: cat, name: 'Group of 8', size: GROUP_SIZE, price: GROUP_PRICE, maxBundles: 3, ...over },
    [category],
    { isNew: true },
  );
  const row = await f.one<{ id: string; size: number; price: string; max_bundles: number | null; sold: number; active: boolean }>(
    `insert into ticket_bundles (event_id, category_id, name, size, price, max_bundles, active)
     values ($1,$2,$3,$4,$5,$6,$7) returning id, size, price, max_bundles, sold, active`,
    [EVENT, clean.categoryId, clean.name, clean.size, clean.price, clean.maxBundles, clean.active],
  );
  return {
    id: row!.id, category_id: cat, name: clean.name, size: row!.size,
    price: Number(row!.price), max_bundles: row!.max_bundles, sold: row!.sold, active: row!.active,
  };
}

/** The offer as the booking page and the box office read it back. */
async function readOffer(id: string): Promise<TicketBundle> {
  const row = await f.one<{ id: string; category_id: string; name: string; size: number; price: string; max_bundles: number | null; sold: number; active: boolean }>(
    `select id, category_id, name, size, price, max_bundles, sold, active from ticket_bundles where id = $1`,
    [id],
  );
  return { ...row!, price: Number(row!.price) } as TicketBundle;
}

// ------------------------------------------------------------------------------------------
// Stage 2 — the buyer's cart, priced and reserved the way the order route does it
// ------------------------------------------------------------------------------------------

async function claimCoupon(code: string, reservationId: string): Promise<Coupon> {
  const row = await f.one<Coupon>(
    `select * from claim_coupon($1, $2, $3, $4, $5)`,
    [code, reservationId, user, EVENT, 'buyer@example.com'],
  );
  return row as Coupon;
}

interface Checkout {
  reservationId: string;
  lines: CartLine[];
  total: number;
  couponDiscount: number;
  tickets: ScanTicket[];
  allocations: { categoryId: string; qty: number; numbers: number[] }[];
}

/**
 * One checkout, from quote to issued passes.
 *
 * This is the order route's own sequence: claim the coupon, quote, split the lines into
 * merged singles / per-unit bundle items / flagged free items, reserve, then (on payment)
 * build the passes.
 */
async function checkout(opts: {
  bundle?: TicketBundle;
  units?: number;
  cart?: Record<string, number>;
  couponCode?: string;
  reservationId?: string;
}): Promise<Checkout> {
  const reservationId = opts.reservationId ?? `res_${Math.random().toString(36).slice(2)}`;
  const category = await liveCategory();
  const coupon = opts.couponCode ? await claimCoupon(opts.couponCode, reservationId) : null;

  // What the buyer already holds, counted as the route counts it: group seats and gifts do not
  // spend the seven-pass allowance.
  const held = await f.all<{ bundle_ref: string | null; free_pass: boolean }>(
    `select bundle_ref, free_pass from ticket_numbers where user_id = $1`, [user],
  );
  const previouslyBought = held.filter((t) => !t.bundle_ref && !t.free_pass).length;

  const quote = quoteEventCart({
    cart: opts.cart ?? {},
    categories: [category],
    isLoggedIn: true,
    isMember: false,
    memberDiscountPercent: 0,
    pointsToRedeem: 0,
    loyaltyBalance: 0,
    previouslyBought,
    coupon,
    bundles: opts.bundle ? [opts.bundle] : [],
    bundleCart: opts.bundle ? { [opts.bundle.id]: opts.units ?? 1 } : {},
  } as never);

  const wanted = new Map<string, number>();
  const bundleItems: { categoryId: string; qty: number; bundleRef: string }[] = [];
  const freeItems: { categoryId: string; qty: number; free: true }[] = [];
  let unitSeq = 0;
  for (const l of quote.lines) {
    if (l.bundleId) {
      unitSeq += 1;
      l.bundleRef = `${l.bundleId}:${reservationId}:${unitSeq}`;
      bundleItems.push({ categoryId: l.categoryId, qty: l.qty, bundleRef: l.bundleRef });
    } else if (l.free) {
      freeItems.push({ categoryId: l.categoryId, qty: l.qty, free: true });
    } else {
      wanted.set(l.categoryId, (wanted.get(l.categoryId) ?? 0) + l.qty);
    }
  }

  const allocations = await reserveInventory(db(), {
    reservationId,
    userId: user,
    items: [
      ...[...wanted.entries()].map(([categoryId, qty]) => ({ categoryId, qty })),
      ...bundleItems,
      ...freeItems,
    ],
    maxSingle: MAX_TICKETS_PER_ACCOUNT,
    maxBundles: MAX_BUNDLES_PER_ACCOUNT,
  });

  const order = { cart: quote.lines, event_snapshot: {} } as unknown as PaymentOrder;
  const tickets = buildIssuedTickets(order, allocations as never) as unknown as ScanTicket[];

  return { reservationId, lines: quote.lines, total: quote.total, couponDiscount: quote.couponDiscount, tickets, allocations: allocations as never };
}

/**
 * Sell `n` seats to other people, so the category is genuinely short.
 *
 * The reservation row has to exist first: ticket_numbers references it, which is what stops a
 * seat being held by nothing.
 */
async function fillSeats(n: number): Promise<void> {
  await f.db.query(
    `insert into inventory_reservations (reservation_id, user_id, event_id, state, expires_at)
     values ('res_filler', $1, $2, 'CONFIRMED', now() + interval '1 day')
     on conflict (reservation_id) do nothing`,
    [user, EVENT],
  );
  await f.db.query(
    `insert into ticket_numbers (category_id, number, reservation_id, state)
     select $1, g, 'res_filler', 'ISSUED' from generate_series(1, $2) g`,
    [cat, n],
  );
  await f.db.query(`select refresh_category_counts($1)`, [cat]);
}

const seatsTaken = () => f.val<number>(`select count(*) from ticket_numbers where category_id = $1`, [cat]);
const catSold = () => f.val<number>(`select sold from event_ticket_categories where id = $1`, [cat]);
const bundleSold = (id: string) => f.val<number>(`select sold from ticket_bundles where id = $1`, [id]);
const couponUses = (code: string) => f.val<number>(`select uses from coupons where code = $1`, [code]);

// ==========================================================================================

describe('1 · the admin creates the group offer', () => {
  it('is validated and stored, and starts with nothing sold', async () => {
    const offer = await createOffer();
    expect(offer.size).toBe(8);
    expect(offer.price).toBe(7000);
    expect(offer.sold).toBe(0);
    expect(offer.active).toBe(true);
  });

  it('refuses one priced above the seats bought separately', async () => {
    await expect(createOffer({ price: PRICE * GROUP_SIZE + 1 })).rejects.toThrow(/more than 8 tickets bought separately/i);
  });

  it('refuses one bigger than a group is allowed to be', async () => {
    await expect(createOffer({ size: CAPACITY + 1 })).rejects.toThrow(/at most 50 tickets/i);
  });

  it('refuses one bigger than the seats actually left', async () => {
    await fillSeats(CAPACITY - 7);
    await expect(createOffer()).rejects.toThrow(/Only 7 "REGULAR" seats are left/i);
  });

  it('refuses a unit cap larger than the hall', async () => {
    await expect(createOffer({ maxBundles: 20 })).rejects.toThrow(/At most 9 fit/i);
  });
});

describe('2 · the buyer sees it', () => {
  it('is on sale, priced per seat below the single-ticket price', async () => {
    const offer = await createOffer();
    const a = bundleAvailability(offer, await liveCategory());
    expect(a.sellable).toBe(true);
    expect(a.units).toBe(3);                      // its own run of 3 is the tighter limit
    expect(GROUP_PRICE / GROUP_SIZE).toBeLessThan(PRICE);
  });

  it('stops itself when the category can no longer fill one', async () => {
    const offer = await createOffer();
    // Sell the hall down to seven free seats.
    await f.db.query(`update event_ticket_categories set sold = $2 where id = $1`, [cat, CAPACITY - 7]);
    const a = bundleAvailability(offer, await liveCategory());
    expect(a.sellable).toBe(false);
    expect(a.autoPaused).toBe(true);
    expect(a.seatsLeft).toBe(7);
  });
});

describe('3 · checkout, with a coupon', () => {
  const FREEBIE = 'GROUPFREE';

  beforeEach(async () => {
    // A free pass per group unit bought. The combination that used to fail: the gift comes from
    // the same category the group draws from.
    await f.db.query(
      `insert into coupons (code, event_id, kind, scope, free_category_id, free_qty, max_uses, per_account_uses, active)
       values ($1, $2, 'FREE_TICKET', 'BUNDLE', $3, 1, 5, 2, true)`,
      [FREEBIE, EVENT, cat],
    );
  });

  it('prices the group at the group price and gives the free pass away', async () => {
    const offer = await createOffer();
    const c = await checkout({ bundle: offer, couponCode: FREEBIE });
    expect(c.total).toBe(GROUP_PRICE);                 // the gift costs nothing, so nothing to discount
    expect(c.lines.filter((l) => l.free)).toHaveLength(1);
    expect(c.lines.filter((l) => l.bundleId)).toHaveLength(1);
  });

  it('takes nine seats: eight for the group and one given away', async () => {
    const offer = await createOffer();
    await checkout({ bundle: offer, couponCode: FREEBIE });
    expect(await seatsTaken()).toBe(9);
    expect(await catSold()).toBe(9);
    expect(await f.val<number>(`select count(*) from ticket_numbers where bundle_ref is not null`)).toBe(8);
    expect(await f.val<number>(`select count(*) from ticket_numbers where free_pass`)).toBe(1);
  });

  it('moves the offer\'s own counter, which is what caps the run', async () => {
    // The counter that read 0 after a real sale on the live site. Without the trigger a
    // three-unit run could be sold any number of times.
    const offer = await createOffer();
    await checkout({ bundle: offer, couponCode: FREEBIE });
    expect(await bundleSold(offer.id)).toBe(1);
    expect(bundleAvailability(await readOffer(offer.id), await liveCategory()).units).toBe(2);
  });

  it('spends exactly one coupon use', async () => {
    const offer = await createOffer();
    await checkout({ bundle: offer, couponCode: FREEBIE });
    expect(await couponUses(FREEBIE)).toBe(1);
  });

  it('leaves the seven-pass personal allowance untouched', async () => {
    // Eight seats and a gift, and the buyer may still buy seven passes of their own.
    const offer = await createOffer();
    await checkout({ bundle: offer, couponCode: FREEBIE });
    const singles = await checkout({ cart: { [cat]: MAX_TICKETS_PER_ACCOUNT } });
    expect(singles.tickets).toHaveLength(7);
  });

  it('still refuses the eighth individual pass', async () => {
    const offer = await createOffer();
    await checkout({ bundle: offer });
    await checkout({ cart: { [cat]: MAX_TICKETS_PER_ACCOUNT } });
    await expect(checkout({ cart: { [cat]: 1 } })).rejects.toThrow(/7/);
  });

  it('refuses a third group', async () => {
    const offer = await createOffer();
    await checkout({ bundle: offer });
    await checkout({ bundle: offer });
    // The raw code the database raises; the route turns it into "at most 2 group tickets".
    await expect(checkout({ bundle: offer })).rejects.toThrow(/LIMIT_BUNDLES:2/);
  });
});

describe('4 · the passes that come out', () => {
  it('is ONE pass for eight people, not eight passes', async () => {
    const offer = await createOffer();
    const c = await checkout({ bundle: offer });
    expect(c.tickets).toHaveLength(1);
    expect(c.tickets[0]).toMatchObject({ groupSize: 8, group: true, groupName: 'Group of 8' });
    expect(c.tickets[0].ticketNumber).toBe('REGULAR-001');
  });

  it('numbers the gift after the group, and marks it free rather than group', async () => {
    const offer = await createOffer();
    await f.db.query(
      `insert into coupons (code, event_id, kind, scope, free_category_id, free_qty, active)
       values ('GIFT1', $1, 'FREE_TICKET', 'BUNDLE', $2, 1, true)`, [EVENT, cat],
    );
    const c = await checkout({ bundle: offer, couponCode: 'GIFT1' });
    expect(c.tickets).toHaveLength(2);
    expect(c.tickets[0]).toMatchObject({ groupSize: 8, group: true });
    expect(c.tickets[1]).toMatchObject({ free: true, couponCode: 'GIFT1' });
    expect(c.tickets[1].groupSize).toBeUndefined();
    // Nine seats were taken; the ninth is the gift's.
    expect(c.tickets[1].ticketNumber).toBe('REGULAR-009');
  });

  it('records every seat the one pass stands for', async () => {
    // Eight seats, one printed number. Without the list the buyer reads REGULAR-001 for all
    // eight and reasonably concludes they were sent a single ticket.
    const offer = await createOffer();
    const c = await checkout({ bundle: offer });
    expect((c.tickets[0] as { groupSeats?: string[] }).groupSeats).toEqual([
      'REGULAR-001', 'REGULAR-002', 'REGULAR-003', 'REGULAR-004',
      'REGULAR-005', 'REGULAR-006', 'REGULAR-007', 'REGULAR-008',
    ]);
    expect(seatRangeLabel((c.tickets[0] as { groupSeats?: string[] }).groupSeats))
      .toBe('REGULAR-001 – REGULAR-008');
  });

  it('keeps the seats of two groups apart', async () => {
    // Two units in one cart: 1–8 and 9–16, each on its own pass, never pooled.
    const offer = await createOffer();
    const c = await checkout({ bundle: offer, units: 2 });
    expect(c.tickets).toHaveLength(2);
    expect(seatRangeLabel((c.tickets[0] as { groupSeats?: string[] }).groupSeats)).toBe('REGULAR-001 – REGULAR-008');
    expect(seatRangeLabel((c.tickets[1] as { groupSeats?: string[] }).groupSeats)).toBe('REGULAR-009 – REGULAR-016');
  });

  it('records none on an ordinary pass', async () => {
    const c = await checkout({ cart: { [cat]: 2 } });
    expect((c.tickets[0] as { groupSeats?: string[] }).groupSeats).toBeUndefined();
  });

  it('counts eight people against the door, on one pass', async () => {
    const offer = await createOffer();
    const c = await checkout({ bundle: offer });
    const door = bookingAttendance(c.tickets);
    expect(door).toMatchObject({ passes: 1, people: 8, admitted: 0, remaining: 8, state: 'NOT_ARRIVED' });
  });
});

describe('5 · the email and the PDF say what was bought', () => {
  it('tells the buyer the one pass admits all eight', async () => {
    // The gap this closes: the email showed a single pass number and no mention of eight
    // anywhere, which to someone who paid for eight seats reads like being short-changed.
    const offer = await createOffer();
    const c = await checkout({ bundle: offer });
    const html = passLinesHtml(c.tickets as unknown as EmailedPass[]);
    expect(html).toMatch(/one scan admits all 8/i);
    expect(passSummaryLine(c.tickets as unknown as EmailedPass[])).toBe('REGULAR-001 (admits 8)');
  });

  it('names the seats in the email too', async () => {
    const offer = await createOffer();
    const c = await checkout({ bundle: offer });
    expect(passLinesHtml(c.tickets as unknown as EmailedPass[])).toMatch(/Seats REGULAR-001 – REGULAR-008/);
  });

  it('says nothing of the sort for ordinary passes', async () => {
    const c = await checkout({ cart: { [cat]: 2 } });
    const html = passLinesHtml(c.tickets as unknown as EmailedPass[]);
    expect(html).not.toMatch(/admits/i);
    expect(passSummaryLine(c.tickets as unknown as EmailedPass[])).toBe('REGULAR-001, REGULAR-002');
  });

  it('marks the coupon\'s pass as complimentary in the email', async () => {
    const offer = await createOffer();
    await f.db.query(
      `insert into coupons (code, event_id, kind, scope, free_category_id, free_qty, active)
       values ('GIFT2', $1, 'FREE_TICKET', 'BUNDLE', $2, 1, true)`, [EVENT, cat],
    );
    const c = await checkout({ bundle: offer, couponCode: 'GIFT2' });
    expect(passLinesHtml(c.tickets as unknown as EmailedPass[])).toMatch(/REGULAR-009 — complimentary/);
  });

  it('labels the pass for the PDF the same way', async () => {
    const offer = await createOffer();
    const c = await checkout({ bundle: offer });
    expect(admitsLabel(c.tickets[0].groupSize)).toBe('8 People');
  });
});

describe('6 · the gate', () => {
  it('lets the whole party in on one scan', async () => {
    const offer = await createOffer();
    const c = await checkout({ bundle: offer });
    const r = applyScan(c.tickets, 'REGULAR-001', undefined, new Date(), { allowPartial: false });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.admittedNow).toBe(8);
    expect(r.ticket.status).toBe('CHECKED_IN');
  });

  it('refuses a second scan of the same pass', async () => {
    const offer = await createOffer();
    const c = await checkout({ bundle: offer });
    const first = applyScan(c.tickets, 'REGULAR-001');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = applyScan(first.tickets, 'REGULAR-001');
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe('ALREADY_USED');
    expect(second.message).toMatch(/all 8 people on this group pass have already entered/i);
  });

  it('will not let a volunteer split the group', async () => {
    const offer = await createOffer();
    const c = await checkout({ bundle: offer });
    const r = applyScan(c.tickets, 'REGULAR-001', 3, new Date(), { allowPartial: false });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('PARTIAL_NOT_ALLOWED');
  });

  it('lets an admin split it, and the rest come in later', async () => {
    const offer = await createOffer();
    const c = await checkout({ bundle: offer });
    const first = applyScan(c.tickets, 'REGULAR-001', 3, new Date(), { allowPartial: true });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.progress).toEqual({ groupSize: 8, admitted: 3, remaining: 5 });
    const rest = applyScan(first.tickets, 'REGULAR-001', undefined, new Date(), { allowPartial: false });
    expect(rest.ok).toBe(true);
    if (!rest.ok) return;
    expect(rest.progress.remaining).toBe(0);
  });
});

describe('7 · admitted by hand, then the QR turns up', () => {
  // The case this was built for: the guest says their pass never arrived, an organiser checks
  // them in from the box office, and then the pass is found and scanned at the door. The gate
  // MUST refuse it. If it did not, a group of eight would be admitted twice over.
  it('a scanned QR is refused after the box office let them in', async () => {
    const offer = await createOffer();
    const c = await checkout({ bundle: offer });

    // Box office: check in by hand. This is exactly what the route writes back.
    const byHand = admitEveryone(c.tickets);
    expect(byHand.admittedNow).toBe(8);

    // The gate reads the same booking row a minute later.
    const scanned = applyScan(byHand.tickets, 'REGULAR-001', undefined, new Date(), { allowPartial: false });
    expect(scanned.ok).toBe(false);
    if (scanned.ok) return;
    expect(scanned.code).toBe('ALREADY_USED');
    expect(scanned.message).toMatch(/already entered/i);
  });

  it('the same holds for an ordinary single pass', async () => {
    const c = await checkout({ cart: { [cat]: 2 } });
    const byHand = admitEveryone(c.tickets);
    const scanned = applyScan(byHand.tickets, 'REGULAR-001');
    expect(scanned.ok).toBe(false);
    if (scanned.ok) return;
    expect(scanned.code).toBe('ALREADY_USED');
    expect(scanned.message).toMatch(/already been used/i);
  });

  it('a partial hand check-in still lets the rest in on the QR', async () => {
    // Three of the eight arrive without the pass; the other five turn up with it later. The
    // gate must admit exactly the five.
    const offer = await createOffer();
    const c = await checkout({ bundle: offer });
    const three = applyScan(c.tickets, 'REGULAR-001', 3, new Date(), { allowPartial: true });
    expect(three.ok).toBe(true);
    if (!three.ok) return;

    const five = applyScan(three.tickets, 'REGULAR-001', undefined, new Date(), { allowPartial: false });
    expect(five.ok).toBe(true);
    if (!five.ok) return;
    expect(five.admittedNow).toBe(5);
    expect(five.progress.remaining).toBe(0);
  });

  it('the door count is the same however they came in', async () => {
    const offer = await createOffer();
    const c = await checkout({ bundle: offer });
    const byHand = admitEveryone(c.tickets);
    expect(bookingAttendance(byHand.tickets)).toMatchObject({ people: 8, admitted: 8, remaining: 0, state: 'ALL_IN' });
  });

  it('the record says it was by hand, and who did it', async () => {
    const rows: ScanLogRow[] = [{
      ticket_number: 'REGULAR-001', admitted: 8, action: 'MANUAL',
      actor_email: 'organiser@punerimallus.com', actor_role: 'ADMIN', at: '2026-11-15T14:00:00.000Z',
    }];
    const [who] = admittedBy(rows);
    expect(who).toMatchObject({ by: 'organiser@punerimallus.com', role: 'ADMIN', admitted: 8, manual: true });
  });

  it('a voided pass cannot be checked in by hand either', async () => {
    const offer = await createOffer();
    const c = await checkout({ bundle: offer });
    const voided = c.tickets.map((t) => ({ ...t, status: 'REFUNDED' as const }));
    expect(admitEveryone(voided).admittedNow).toBe(0);
  });
});

describe('8 · the payment fails', () => {
  it('gives back every seat, the coupon use and the offer\'s unit', async () => {
    await f.db.query(
      `insert into coupons (code, event_id, kind, scope, free_category_id, free_qty, max_uses, active)
       values ('FAILTEST', $1, 'FREE_TICKET', 'BUNDLE', $2, 1, 1, true)`, [EVENT, cat],
    );
    const offer = await createOffer();
    const c = await checkout({ bundle: offer, couponCode: 'FAILTEST' });

    expect(await seatsTaken()).toBe(9);
    expect(await bundleSold(offer.id)).toBe(1);
    expect(await couponUses('FAILTEST')).toBe(1);

    // Razorpay refused the card, or the buyer closed the window. One call unwinds all of it.
    const freed = await releaseInventory(db(), c.reservationId);
    expect(freed).toBe(9);

    expect(await seatsTaken()).toBe(0);
    expect(await catSold()).toBe(0);
    expect(await bundleSold(offer.id)).toBe(0);
    expect(await couponUses('FAILTEST')).toBe(0);
  });

  it('puts the offer back on sale, so the next buyer can have it', async () => {
    const offer = await createOffer({ maxBundles: 1 });
    const c = await checkout({ bundle: offer });
    expect(bundleAvailability(await readOffer(offer.id), await liveCategory()).sellable).toBe(false);

    await releaseInventory(db(), c.reservationId);
    expect(bundleAvailability(await readOffer(offer.id), await liveCategory()).sellable).toBe(true);
  });

  it('lets the same buyer use their own code again straight away', async () => {
    // The leak that cost a buyer their single-use code: the seats came back but the coupon did
    // not, so retrying told them their own code was already used.
    await f.db.query(
      `insert into coupons (code, event_id, kind, discount_type, discount_value, max_uses, per_account_uses, active)
       values ('ONCE', $1, 'DISCOUNT', 'FLAT', 500, 1, 1, true)`, [EVENT],
    );
    const offer = await createOffer();
    const first = await checkout({ bundle: offer, couponCode: 'ONCE' });
    await releaseInventory(db(), first.reservationId);

    const second = await checkout({ bundle: offer, couponCode: 'ONCE' });
    expect(second.couponDiscount).toBe(500);
    expect(second.total).toBe(GROUP_PRICE - 500);
  });

  it('releasing twice is harmless', async () => {
    const offer = await createOffer();
    const c = await checkout({ bundle: offer });
    expect(await releaseInventory(db(), c.reservationId)).toBe(8);
    expect(await releaseInventory(db(), c.reservationId)).toBe(0);
    expect(await bundleSold(offer.id)).toBe(0);
  });
});

describe('9 · the hall fills up', () => {
  it('refuses a group the remaining seats cannot fill, whatever the offer says', async () => {
    const offer = await createOffer({ maxBundles: 9 });
    // 72 seats gone, six left: the offer's own counter still shows units available.
    await fillSeats(72);

    expect(bundleAvailability(await readOffer(offer.id), await liveCategory())).toMatchObject({
      autoPaused: true, sellable: false, seatsLeft: 6,
    });
    await expect(checkout({ bundle: offer })).rejects.toThrow(/does not have 8 seats/i);
  });

  it('the database refuses it too, even if the page and the quote were both bypassed', async () => {
    const offer = await createOffer();
    await fillSeats(72);

    await expect(
      reserveInventory(db(), {
        reservationId: 'res_sneaky',
        userId: user,
        items: [{ categoryId: cat, qty: GROUP_SIZE, bundleRef: `${offer.id}:res_sneaky:1` }],
        maxSingle: MAX_TICKETS_PER_ACCOUNT,
        maxBundles: MAX_BUNDLES_PER_ACCOUNT,
      }),
    ).rejects.toThrow(/SOLD_OUT:REGULAR/);
  });

  it('sells the last group that does fit', async () => {
    const offer = await createOffer();
    await fillSeats(70);
    const c = await checkout({ bundle: offer });
    expect(c.tickets[0].groupSize).toBe(8);
    expect(await seatsTaken()).toBe(78);
    expect(progressOf(c.tickets[0]).remaining).toBe(8);
  });
});
