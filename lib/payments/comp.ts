// Complimentary passes: real tickets an admin issues to a guest without a payment.
//
// A comp pass is deliberately NOT a different kind of ticket. It takes its seat and its number
// from the same reservation the public checkout uses, lands in the same ticket_bookings row and
// carries the same signed QR, so the gate, the PDF, the void button and the attendance figures
// all work on it without knowing it was free. The only differences are the price (zero) and a
// `source` marker, plus a row in comp_ticket_grants recording who gave it to whom and why.
//
// Doing it any other way — a parallel table the scanner also has to read — would mean every
// gate change had two code paths, and the one nobody tested would be the one a VIP turns up on.

import { PaymentInputError, type CartLine } from './types';
import { groupSizeOf } from './groups';
import { ticketNumberValue } from './inventory';
import { ticketNumberWidth } from './pricing';

/** Most passes one grant may issue at once. A guest list longer than this is several grants. */
export const MAX_COMP_PASSES = 50;
export const MAX_NOTE_LENGTH = 200;
export const MAX_NAME_LENGTH = 80;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Why a pass was given away. Shown in the box office so a free seat always has a reason. */
export const COMP_REASONS = ['VIP', 'INVITEE', 'ARTIST', 'SPONSOR', 'CREW', 'MEDIA', 'OTHER'] as const;
export type CompReason = (typeof COMP_REASONS)[number];

export interface CompCategory {
  id: string;
  name: string;
  prefix: string;
  price: number;
  capacity: number | null;
  active?: boolean | null;
  group_size?: number | null;
  /** Issued by an admin only; never shown on the public booking page. */
  comp_only?: boolean | null;
}

/**
 * The fallback pass, for a guest who is not being put in any particular category: they are let
 * in, and a volunteer seats them wherever there is room.
 *
 * It is a real category because that is the only thing that issues pass numbers and holds
 * capacity, but it carries comp_only so it never reaches the public list. Zero rupees, since a
 * face value on something that is never sold is a number nobody can act on.
 */
export const ACCESS_PASS = {
  name: 'ACCESS PASS',
  prefix: 'AP-',
  price: 0,
  defaultCapacity: 100,
} as const;

/** Is this the event's access-pass category? Matched on the flag and the name, not the id. */
export const isAccessPass = (cat: Pick<CompCategory, 'name' | 'comp_only'> | null | undefined): boolean =>
  !!cat && cat.comp_only === true && String(cat.name).trim().toUpperCase() === ACCESS_PASS.name;

/** Categories a buyer may see. comp_only ones are not for sale and are not "coming soon" either. */
export const publiclyListed = <T extends { comp_only?: boolean | null }>(cat: T): boolean => cat?.comp_only !== true;

export interface CompRequest {
  guestName?: unknown;
  guestEmail?: unknown;
  guestPhone?: unknown;
  reason?: unknown;
  note?: unknown;
  /** categoryId -> how many passes. */
  items?: unknown;
}

export interface CleanComp {
  guestName: string;
  guestEmail: string;
  guestPhone: string | null;
  reason: CompReason;
  note: string | null;
  lines: CartLine[];
  passes: number;
  /** What these passes would have cost at the gate price. Recorded so giveaways are countable. */
  faceValue: number;
}

const text = (v: unknown, max: number): string => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Digits only, Indian mobile. Null for anything we would not try to send a WhatsApp to. */
export function compPhone(v: unknown): string | null {
  const digits = String(v ?? '').replace(/\D/g, '');
  const local = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  return /^[6-9]\d{9}$/.test(local) ? local : null;
}

/**
 * Validate an admin's comp request against the real categories.
 *
 * Every rule here is also enforced by the database when the seats are reserved — a paused or
 * sold-out category is refused there too. This exists so the admin gets a sentence explaining
 * what is wrong instead of a raised Postgres exception.
 */
export function checkCompRequest(input: CompRequest, categories: CompCategory[]): CleanComp {
  const guestName = text(input.guestName, MAX_NAME_LENGTH);
  if (!guestName) throw new PaymentInputError("Enter the guest's name.");

  const guestEmail = text(input.guestEmail, 254).toLowerCase();
  if (!EMAIL_RE.test(guestEmail)) throw new PaymentInputError('Enter a valid email to send the passes to.');

  const reasonRaw = text(input.reason, 20).toUpperCase();
  const reason = (COMP_REASONS as readonly string[]).includes(reasonRaw) ? (reasonRaw as CompReason) : 'OTHER';

  const items = input.items;
  if (!items || typeof items !== 'object' || Array.isArray(items)) {
    throw new PaymentInputError('Choose at least one pass to give.');
  }

  const lines: CartLine[] = [];
  let passes = 0;
  let faceValue = 0;

  for (const [categoryId, rawQty] of Object.entries(items as Record<string, unknown>)) {
    const qty = Number(rawQty);
    if (qty === 0) continue;
    if (!Number.isInteger(qty) || qty < 0) throw new PaymentInputError('Invalid number of passes.');

    const cat = categories.find((c) => String(c.id) === categoryId);
    if (!cat) throw new PaymentInputError('That ticket category no longer exists.');
    // The reservation would raise SOLD_OUT for a paused category, which reads as "sold out" to
    // the admin and sends them hunting for seats that are actually there. Say what it is.
    if (cat.active === false) {
      throw new PaymentInputError(`"${cat.name}" is paused. Resume it in Inventory Control to issue passes from it.`);
    }

    const groupSize = groupSizeOf(cat.group_size);
    lines.push({
      categoryId,
      name: cat.name,
      prefix: cat.prefix,
      qty,
      // Zero: the pass is free, and this is the price the PDF receipt prints.
      unitPrice: 0,
      numberWidth: ticketNumberWidth(cat.capacity),
      ...(groupSize > 1 ? { groupSize } : {}),
    });
    passes += qty;
    faceValue += (Number(cat.price) || 0) * qty;
  }

  if (passes === 0) throw new PaymentInputError('Choose at least one pass to give.');
  if (passes > MAX_COMP_PASSES) {
    throw new PaymentInputError(`You can issue at most ${MAX_COMP_PASSES} passes in one go. Split it into a few grants.`);
  }

  return {
    guestName,
    guestEmail,
    guestPhone: compPhone(input.guestPhone),
    reason,
    note: text(input.note, MAX_NOTE_LENGTH) || null,
    lines,
    passes,
    faceValue: Math.round(faceValue * 100) / 100,
  };
}

/** The reservation id a comp grant books its seats under. Prefixed so it is obvious in the table. */
export const compReservationId = (id: string): string => `comp_${id}`;

/**
 * Is this seat held by a complimentary grant rather than a sale?
 *
 * Deleting a grant frees seats by (category, number), and that pair says nothing about who is
 * holding it now. If a seat has been resold since - the delete half-finished, or the admin is
 * working from a stale page - freeing it would take a paying buyer's seat away and leave their
 * pass number pointing at nothing. A paid checkout reserves under a bare UUID and the legacy
 * backfill under `legacy-`, so only `comp_` may be touched from the comp screen.
 */
export const isCompReservation = (reservationId: string | null | undefined): reservationId is string =>
  typeof reservationId === 'string' && reservationId.startsWith('comp_');

/** How many people a grant actually admits, counting group passes properly. */
export function compAdmits(lines: CartLine[]): number {
  return lines.reduce((n, l) => n + l.qty * groupSizeOf(l.groupSize), 0);
}


/** A pass as it sits in ticket_bookings.tickets_data — only the parts deleting one needs. */
export interface CompPassRow {
  categoryId?: string;
  ticketNumber?: string;
  status?: string;
}

/** The booking behind a grant, as much of it as the delete has to look at. */
export interface CompBookingRow {
  source?: string | null;
  tickets_data?: CompPassRow[] | null;
}

/** Everything deleting a grant is going to do, worked out before a single row is written. */
export interface CompDeletion {
  /** Passes that were still alive. */
  live: number;
  /** Passes the single-pass void button had already killed. Nothing left to undo on these. */
  alreadyVoided: number;
  /** Passes scanned in at the gate. The guest came, and scan_log goes on saying so afterwards. */
  admitted: number;
  /** Live passes whose seat and number can be handed straight back. */
  freeable: { categoryId: string; ticketNumber: string; number: number }[];
  /** Live passes too old or too odd to free automatically — capacity wants a look by hand. */
  unfreeable: string[];
}

/**
 * May this booking be deleted from the complimentary-pass register, and what will that cost?
 *
 * The guard that matters is the first one. Deleting a booking is not voiding a pass: the row
 * goes, and with it the only record that someone paid. For a comp there is nothing to lose —
 * no money moved, no invoice exists, and an admin creating one by hand will sometimes create
 * the wrong one. For a sale that would be destroying the receipt, so this refuses outright and
 * sends the admin to the void button, which keeps the booking and kills one pass.
 */
export function checkCompDeletable(booking: CompBookingRow | null | undefined): CompDeletion {
  if (!booking) throw new PaymentInputError('That booking no longer exists.', 404);
  if (String(booking.source || 'SALE').toUpperCase() !== 'COMP') {
    throw new PaymentInputError(
      'That is a paid booking, not a complimentary pass. Use the void button on the pass instead — it keeps the record of the sale.',
      409,
    );
  }

  const out: CompDeletion = { live: 0, alreadyVoided: 0, admitted: 0, freeable: [], unfreeable: [] };

  for (const pass of booking.tickets_data || []) {
    const ticketNumber = String(pass?.ticketNumber || '').trim();
    if (String(pass?.status || 'ISSUED').toUpperCase() === 'REFUNDED') {
      out.alreadyVoided += 1;
      continue;
    }
    out.live += 1;
    if (String(pass?.status || '').toUpperCase() === 'CHECKED_IN') out.admitted += 1;

    // No category, or a number nothing can be read off, means the seat cannot be given back
    // without guessing. Say so rather than silently leaving the count wrong.
    const number = ticketNumberValue(ticketNumber);
    if (!pass?.categoryId || number === null) {
      out.unfreeable.push(ticketNumber || '(unnamed pass)');
      continue;
    }
    out.freeable.push({ categoryId: String(pass.categoryId), ticketNumber, number });
  }

  return out;
}
