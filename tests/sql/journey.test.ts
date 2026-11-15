// One buyer's whole journey, end to end, against a real PostgreSQL.
//
// Every other suite tests a stage. This one walks the stages IN ORDER, handing each step's real
// output to the next, so the joins between them are exercised rather than assumed:
//
//   pick passes -> reserve seats -> pay -> issue numbered passes -> sign the QR
//     -> print the link -> scan it at the gate -> admit -> box office sees who admitted
//
// The things that only break at a join are what this is for: a pass number that reads right in
// the PDF but not at the gate, or a QR the scanner builds but the parser cannot read.
//
// Nothing here touches production. PGlite is a real Postgres in this process, and the Razorpay
// and email steps are stand-ins — the sequence is real, the money is not.

import { describe, expect, it } from 'vitest';
import { freshDb, items, seedCategory, seedUser, type Fixture } from './pg';
import { buildIssuedTickets } from '@/lib/payments/fulfil';
import { signTicket, verifyTicketSignature } from '@/lib/payments/ticket-signature';
import { buildScanUrl } from '@/lib/payments/format';
import { parseScannedPass } from '@/lib/payments/qr';
import { applyScan, type ScanTicket } from '@/lib/payments/scan';
import { admittedBy, bookingAttendance } from '@/lib/payments/attendance';
import type { Allocation, CartLine, PaymentOrder } from '@/lib/payments/types';

process.env.TICKET_QR_SECRET ||= 'journey-test-secret';

const BASE = 'https://punerimallus.com';

/** Just the order fields buildIssuedTickets reads. */
const orderWith = (cart: CartLine[], allocations: Allocation[]): PaymentOrder =>
  ({ cart, allocated_tickets: allocations } as unknown as PaymentOrder);

const reserve = (f: Fixture, resId: string, userId: string | null, cart: [string, number][], points = 0) =>
  f.val<Allocation[]>(
    `select reserve_order_inventory($1, $2, $3::jsonb, $4, 900, 7, 2) as alloc`,
    [resId, userId, items(cart), points],
  );

describe('a buyer, from picking passes to walking through the gate', () => {
  it('carries the same pass number all the way from the sale to the scanner', async () => {
    const f = await freshDb();
    const user = await seedUser(f);

    // --- 1. The event is on sale --------------------------------------------------------
    const general = await seedCategory(f, { name: 'GENERAL', prefix: 'GEN-', capacity: 100, price: 500 });
    const vip = await seedCategory(f, { name: 'VIP', prefix: 'VIP-', capacity: 20, price: 2000 });

    // --- 2. They pick two generals and a VIP --------------------------------------------
    const cart: CartLine[] = [
      { categoryId: general, name: 'GENERAL', prefix: 'GEN-', qty: 2, unitPrice: 500, numberWidth: 3 },
      { categoryId: vip, name: 'VIP', prefix: 'VIP-', qty: 1, unitPrice: 2000, numberWidth: 3 },
    ];

    // --- 3. Seats are held BEFORE payment -----------------------------------------------
    const allocations = await reserve(f, 'res_journey', user, [[general, 2], [vip, 1]]);
    expect(allocations).toHaveLength(2);

    // The very first sale of the event starts at 1, not 3.
    const forGeneral = allocations.find((a) => a.categoryId === general)!;
    const forVip = allocations.find((a) => a.categoryId === vip)!;
    expect(forGeneral.numbers).toEqual([1, 2]);
    expect(forVip.numbers).toEqual([1]);

    // --- 4. Payment succeeds; the hold becomes a sale -----------------------------------
    const confirmed = await f.val<{ alreadyConfirmed: boolean }>(`select confirm_order_inventory($1) as r`, ['res_journey']);
    expect(confirmed.alreadyConfirmed).toBe(false);
    expect(await f.val('select sold from event_ticket_categories where id = $1', [general])).toBe(2);

    // --- 5. The passes are issued -------------------------------------------------------
    const issued = buildIssuedTickets(orderWith(cart, allocations), allocations);
    expect(issued.map((t) => t.ticketNumber)).toEqual(['GEN-001', 'GEN-002', 'VIP-001']);
    // Cart order, not database order: the receipt, the PDF and the email all read this way.
    expect(issued[0].categoryName).toBe('GENERAL');
    expect(issued[2].categoryName).toBe('VIP');

    const bookingId = '11111111-2222-3333-4444-555555555555';

    // --- 6. Each pass gets a signed QR, which is what the PDF prints --------------------
    const printed = issued.map((t) => ({
      ticketNumber: t.ticketNumber,
      url: buildScanUrl(BASE, bookingId, t.ticketNumber, signTicket(bookingId, t.ticketNumber)),
    }));
    expect(printed[0].url).toContain('/gate?bid=');
    expect(printed[0].url).toContain('&sig=');

    // --- 7. The gate camera reads that QR back ------------------------------------------
    // This is the join that matters most: what the PDF prints must be what the scanner parses.
    for (const p of printed) {
      const scanned = parseScannedPass(p.url);
      expect(scanned).not.toBeNull();
      expect(scanned!.bookingId).toBe(bookingId);
      expect(scanned!.ticketNumber).toBe(p.ticketNumber);
      expect(verifyTicketSignature(scanned!.bookingId, scanned!.ticketNumber, scanned!.sig)).toBe('VALID');
    }

    // A pass number tampered with in the link no longer verifies.
    const forged = parseScannedPass(buildScanUrl(BASE, bookingId, 'GEN-099', printed[0].url.split('&sig=')[1]));
    expect(verifyTicketSignature(forged!.bookingId, forged!.ticketNumber, forged!.sig)).toBe('INVALID');

    // --- 8. The volunteer on the door admits them ---------------------------------------
    let passes: ScanTicket[] = issued.map((t) => ({
      categoryName: t.categoryName,
      ticketNumber: t.ticketNumber,
      status: 'ISSUED',
    }));

    const first = applyScan(passes, 'GEN-001', undefined, new Date());
    expect(first.ok).toBe(true);
    if (first.ok) passes = first.tickets;

    // The same QR a second time is refused rather than admitting twice.
    expect(applyScan(passes, 'GEN-001', undefined, new Date()).ok).toBe(false);

    // The rest of the party arrive separately, each on their own pass.
    // The second of the party arrives later, on their own pass. The third never turns up.
    const second = applyScan(passes, 'GEN-002', undefined, new Date());
    expect(second.ok).toBe(true);
    if (second.ok) passes = second.tickets;

    // --- 9. The box office sees the night as it happened --------------------------------
    const door = bookingAttendance(passes, 'CONFIRMED');
    // Three passes sold, two of them walked in, the VIP never came.
    expect(door.people).toBe(3);
    expect(door.admitted).toBe(2);
    expect(door.remaining).toBe(1);
    expect(door.state).toBe('PARTLY_IN');

    const who = admittedBy([
      { ticket_number: 'GEN-002', admitted: 1, action: 'ADMIT', actor_email: '9307658864@punerimallus.com', actor_role: 'SCANNER', at: '2026-11-03T18:40:00Z' },
      { ticket_number: 'GEN-001', admitted: 1, action: 'ADMIT', actor_email: 'rohitanish86@gmail.com', actor_role: 'ADMIN', at: '2026-11-03T18:20:00Z' },
    ]);
    expect(who[0]).toMatchObject({ by: '9307658864', role: 'SCANNER', admitted: 1 });
    expect(who[1]).toMatchObject({ by: 'rohitanish86@gmail.com', role: 'ADMIN', admitted: 1 });

    await f.close();
  });

  it('starts the next buyer where the last one left off, and never reuses a number', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f, { name: 'GENERAL', prefix: 'GEN-', capacity: 10 });
    const cart = (qty: number): CartLine[] => [{ categoryId: cat, name: 'GENERAL', prefix: 'GEN-', qty, unitPrice: 500, numberWidth: 3 }];

    const first = await reserve(f, 'r1', await seedUser(f), [[cat, 2]]);
    await f.db.query(`select confirm_order_inventory($1)`, ['r1']);
    const second = await reserve(f, 'r2', await seedUser(f), [[cat, 2]]);
    await f.db.query(`select confirm_order_inventory($1)`, ['r2']);

    expect(buildIssuedTickets(orderWith(cart(2), first), first).map((t) => t.ticketNumber)).toEqual(['GEN-001', 'GEN-002']);
    expect(buildIssuedTickets(orderWith(cart(2), second), second).map((t) => t.ticketNumber)).toEqual(['GEN-003', 'GEN-004']);
    await f.close();
  });

  it('gives the seats back when the buyer never pays, so the next person can have them', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f, { name: 'GENERAL', prefix: 'GEN-', capacity: 2 });

    await reserve(f, 'abandoned', await seedUser(f), [[cat, 2]]);
    expect(await f.val('select sold from event_ticket_categories where id = $1', [cat])).toBe(2);

    // Checkout abandoned: the hold is released.
    await f.db.query(`select release_order_inventory($1)`, ['abandoned']);
    expect(await f.val('select sold from event_ticket_categories where id = $1', [cat])).toBe(0);

    // The next buyer gets the same seats, from 1 again.
    const next = await reserve(f, 'r_next', await seedUser(f), [[cat, 2]]);
    expect(next[0].numbers).toEqual([1, 2]);
    await f.close();
  });

  it('refuses to oversell the last seat when two buyers reach for it together', async () => {
    const f = await freshDb();
    const cat = await seedCategory(f, { name: 'GENERAL', prefix: 'GEN-', capacity: 1 });

    await reserve(f, 'buyer_a', await seedUser(f), [[cat, 1]]);
    const err = await f.fails(
      `select reserve_order_inventory($1, $2, $3::jsonb, 0, 900, 7, 2)`,
      ['buyer_b', await seedUser(f), items([[cat, 1]])],
    );
    expect(err).toMatch(/SOLD_OUT/);
    await f.close();
  });
});
