// Coupons: a code a buyer types at checkout for money off, free passes, or both.
//
// Everything in this file is pure. The database owns the usage cap — that count has to be
// checked and incremented under a lock or a ten-use coupon goes out forty times in a rush (see
// claim_coupon in the migration). What lives here is the arithmetic and the wording: how much
// comes off, what free passes get added to the cart, and what the buyer is told.
//
// The rule that shapes the rest: a free pass is not a special kind of ticket. It becomes an
// ordinary cart line priced at zero, so it goes through the same reservation, gets a real
// number out of the same pool, cannot oversell the category, and prints a real QR on the PDF.
// Anything else would mean a second code path through the gate, and the one nobody tested is
// the one a guest turns up on.

import { PaymentInputError, type CartLine } from './types';
import { ticketNumberWidth } from './pricing';
import { seatsLeft } from './seats';

export const COUPON_KINDS = ['DISCOUNT', 'FREE_TICKET', 'BOTH'] as const;
export type CouponKind = (typeof COUPON_KINDS)[number];

export const DISCOUNT_TYPES = ['PERCENT', 'FLAT'] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

/**
 * What the free passes are counted against.
 *
 *   INDIVIDUAL  `free_qty` passes once, however much was bought
 *   BUNDLE      `free_qty` passes PER BUNDLE UNIT: two bundles and a free_qty of two is four
 */
export const COUPON_SCOPES = ['INDIVIDUAL', 'BUNDLE'] as const;
export type CouponScope = (typeof COUPON_SCOPES)[number];

export const MIN_CODE_LENGTH = 3;
export const MAX_CODE_LENGTH = 24;
export const MAX_NOTE_LENGTH = 160;

/** Most free passes one coupon may hand out per unit it is counted against. */
export const MAX_FREE_QTY = 10;

/**
 * Most free passes one order can ever collect, however the multiplier adds up.
 *
 * Free passes are exempt from the per-account allowance — a gift is not the buyer spending
 * what they are allowed to buy — so this is the only thing standing between a generous coupon
 * and an empty category. Two ceilings that each look reasonable on their own still multiply:
 * ten per bundle across five bundles is fifty, which is nobody's intended offer.
 *
 * Twenty is the natural maximum of the two caps it sits behind: at most ten free per unit,
 * across at most two bundle units.
 */
export const MAX_FREE_TOTAL = 20;

export interface Coupon {
  id: string;
  code: string;
  event_id?: string | null;
  kind: CouponKind;
  scope?: CouponScope | null;
  discount_type?: DiscountType | null;
  discount_value?: number | null;
  free_category_id?: string | null;
  free_qty?: number | null;
  max_uses?: number | null;
  uses?: number | null;
  per_account_uses?: number | null;
  active?: boolean | null;
  expires_at?: string | null;
  note?: string | null;
}

/** Just the parts of a ticket category a coupon needs to know about. */
export interface CouponCategory {
  id: string;
  name: string;
  prefix: string;
  price: number;
  capacity: number | null;
  sold?: number | null;
  released?: number | null;
  active?: boolean | null;
  comp_only?: boolean | null;
}

/**
 * Tidies a code the way the database stores it: upper case, no spaces.
 *
 * Both ends do this. The admin screen upper-cases as the admin types and the cart upper-cases
 * as the buyer types, so "welcome10" typed on a phone keyboard matches WELCOME10 — which is
 * the whole reason codes are upper case in the first place.
 */
export function normalizeCode(raw: unknown): string {
  return String(raw ?? '').toUpperCase().replace(/\s+/g, '').slice(0, MAX_CODE_LENGTH);
}

/** Is this something that could be a code at all? Checked before it reaches the database. */
export function isValidCode(raw: unknown): boolean {
  const code = normalizeCode(raw);
  return code.length >= MIN_CODE_LENGTH && /^[A-Z0-9][A-Z0-9_-]*$/.test(code);
}

export const givesDiscount = (c: Pick<Coupon, 'kind'> | null | undefined): boolean =>
  c?.kind === 'DISCOUNT' || c?.kind === 'BOTH';

export const givesFreeTickets = (c: Pick<Coupon, 'kind'> | null | undefined): boolean =>
  c?.kind === 'FREE_TICKET' || c?.kind === 'BOTH';

/**
 * How much money this coupon takes off a subtotal.
 *
 * Rounded to paise and never more than the subtotal: a ₹500 flat coupon on a ₹300 cart takes
 * ₹300, not ₹500, and certainly never turns into a refund.
 */
export function discountFor(coupon: Coupon | null | undefined, subtotal: number): number {
  if (!givesDiscount(coupon)) return 0;
  const base = Number(subtotal) || 0;
  if (base <= 0) return 0;

  const value = Number(coupon?.discount_value) || 0;
  if (value <= 0) return 0;

  const raw = coupon!.discount_type === 'PERCENT'
    ? (base * Math.min(100, value)) / 100
    : value;

  return Math.min(base, Math.round(raw * 100) / 100);
}

/**
 * The cart lines this coupon adds, priced at zero.
 *
 * Refuses rather than silently giving nothing: an admin who points a coupon at a category they
 * later paused, or one that has since sold out, should hear about it from the buyer's screen
 * rather than find out when nobody ever received the free pass they were promised.
 */
export function freeLinesFor(
  coupon: Coupon | null | undefined,
  categories: CouponCategory[],
  seatsLeftIn: (category: CouponCategory) => number | null,
  bundleUnits = 0,
): CartLine[] {
  if (!givesFreeTickets(coupon)) return [];

  const category = categories.find((c) => String(c.id) === String(coupon?.free_category_id));
  if (!category) {
    throw new PaymentInputError('That coupon is for a ticket type this event no longer has.', 409);
  }
  if (category.active === false) {
    throw new PaymentInputError(`That coupon gives a free "${category.name}", which is paused right now.`, 409);
  }

  // A bundle coupon is worth what it says PER BUNDLE. With none in the cart it is worth
  // nothing, and saying so is better than applying it for zero and letting the buyer think
  // they got the offer.
  const perUnit = Math.max(1, Math.min(MAX_FREE_QTY, Math.floor(Number(coupon?.free_qty) || 0)));
  const multiplier = coupon?.scope === 'BUNDLE' ? Math.max(0, Math.floor(bundleUnits)) : 1;
  if (coupon?.scope === 'BUNDLE' && multiplier === 0) {
    throw new PaymentInputError('That coupon only applies when you buy a group ticket. Add one to your cart to use it.', 409);
  }
  const qty = Math.min(MAX_FREE_TOTAL, perUnit * multiplier);
  const left = seatsLeftIn(category);
  if (left !== null && left < qty) {
    // Sold out reads differently from short: "only 0 left" is the sort of sentence that makes a
    // buyer think the site is broken rather than that the tickets are gone.
    throw new PaymentInputError(
      left === 0
        ? `That coupon gives a free "${category.name}", and those are sold out, so it cannot be issued.`
        : `Only ${left} "${category.name}" left, so that coupon's free passes cannot be issued.`,
      409,
    );
  }

  return [{
    categoryId: String(category.id),
    name: category.name,
    prefix: category.prefix,
    qty,
    // Zero, always. This is what the receipt and the PDF print against the free pass.
    unitPrice: 0,
    numberWidth: ticketNumberWidth(category.capacity),
  }];
}

/** Why a coupon cannot be used at this moment, or null when it can. */
export type CouponStop =
  | 'PAUSED' | 'EXPIRED' | 'USED_UP' | 'CATEGORY_GONE' | 'CATEGORY_CLOSED' | 'NOT_ENOUGH_SEATS' | null;

export interface CouponAvailability {
  stop: CouponStop;
  usable: boolean;
  /**
   * True when the code is live and unspent, but the ticket type it gives away has no room left.
   *
   * Derived, exactly as a group offer's pause is: it lifts itself the moment a refund or a void
   * frees a seat. Nothing is written to `active`, so "I switched this off" and "the hall filled
   * up" stay two different things on the admin card.
   */
  autoPaused: boolean;
  /** Free passes ONE use needs. For a group-scoped coupon that is one group unit's worth. */
  seatsNeeded: number;
  /** Seats left in the category it gives from, null when uncapped or it gives no free passes. */
  seatsLeft: number | null;
  usesLeft: number | null;
}

/**
 * Whether a coupon can be honoured right now.
 *
 * The case this exists for: a code promising a free REGULAR, on a REGULAR that has sold out.
 * Checkout already refuses it — but it refuses the BUYER, at the moment they type the code they
 * were sent, with no warning to anybody beforehand. This is what lets the admin screen say so
 * first, and it is the same shape as a group offer's pause so the two read alike.
 */
export function couponAvailability(
  coupon: Coupon | null | undefined,
  categories: CouponCategory[],
  seatsLeftIn: (category: CouponCategory) => number | null,
  now: Date = new Date(),
): CouponAvailability {
  const usesLeft = coupon?.max_uses == null ? null : Math.max(0, coupon.max_uses - (coupon.uses ?? 0));

  const base = { usesLeft, seatsNeeded: 0, seatsLeft: null as number | null };
  const out = (stop: CouponStop, over: Partial<CouponAvailability> = {}): CouponAvailability => ({
    ...base, ...over, stop, usable: stop === null, autoPaused: stop === 'NOT_ENOUGH_SEATS',
  });

  if (!coupon) return out('PAUSED');
  // Ordered by what an admin needs told first: a switched-off code explains everything after it.
  if (coupon.active === false) return out('PAUSED');
  if (coupon.expires_at && new Date(coupon.expires_at) <= now) return out('EXPIRED');
  if (usesLeft !== null && usesLeft <= 0) return out('USED_UP');

  // Only a coupon that gives passes away can run out of seats. A money-off code never can.
  if (!givesFreeTickets(coupon)) return out(null);

  const category = categories.find((c) => String(c.id) === String(coupon.free_category_id));
  if (!category) return out('CATEGORY_GONE');
  if (category.active === false || category.comp_only === true) return out('CATEGORY_CLOSED');

  // One use of a group-scoped code gives free_qty passes PER group unit, so one unit's worth is
  // the least it can ever need. If even that does not fit, the code cannot be honoured at all.
  const seatsNeeded = Math.max(1, Math.min(MAX_FREE_QTY, Math.floor(Number(coupon.free_qty) || 0)));
  const seatsLeft = seatsLeftIn(category);
  if (seatsLeft !== null && seatsLeft < seatsNeeded) {
    return out('NOT_ENOUGH_SEATS', { seatsNeeded, seatsLeft });
  }
  return out(null, { seatsNeeded, seatsLeft });
}

/** One sentence for why a coupon is not usable, shared by the admin card and the cart. */
export function couponStopReason(a: CouponAvailability, categoryName?: string | null): string | null {
  const cat = (categoryName || 'those tickets').toString();
  switch (a.stop) {
    case 'PAUSED': return 'Switched off.';
    case 'EXPIRED': return 'Expired.';
    case 'USED_UP': return 'Every use has been taken.';
    case 'CATEGORY_GONE': return 'The ticket type it gives away no longer exists.';
    case 'CATEGORY_CLOSED': return `${cat} is not on sale.`;
    case 'NOT_ENOUGH_SEATS':
      return a.seatsLeft === 0
        ? `${cat} is sold out, so its free pass cannot be issued.`
        : `Only ${a.seatsLeft} ${cat} left, and it gives ${a.seatsNeeded} away.`;
    default: return null;
  }
}

export interface CouponOffer {
  code: string;
  kind: CouponKind;
  /** Rupees off the subtotal. Zero for a free-tickets-only coupon. */
  discount: number;
  /** The free passes, as cart lines priced at zero. */
  freeLines: CartLine[];
  /** How many free passes in total, counting a group pass as one pass. */
  freePasses: number;
  /** A sentence for the cart: "20% off" / "1 free REGULAR (STANDING)". */
  summary: string;
}

/** The sentence shown beside the code in the cart, and on the admin list. */
export function offerSummary(coupon: Coupon, discount: number, freeLines: CartLine[]): string {
  const parts: string[] = [];
  if (discount > 0) {
    parts.push(
      coupon.discount_type === 'PERCENT'
        ? `${Number(coupon.discount_value)}% off`
        : `₹${Number(coupon.discount_value)} off`,
    );
  }
  for (const line of freeLines) {
    parts.push(`${line.qty} free ${line.name}`);
  }
  return parts.join(' + ') || 'No offer';
}

/**
 * What a coupon is worth against a particular cart.
 *
 * `subtotal` is after the member discount and before loyalty points, which is the same base
 * the member discount works on — stacking is deliberate and additive rather than compounding.
 */
export function applyCoupon(
  coupon: Coupon | null | undefined,
  subtotal: number,
  categories: CouponCategory[],
  seatsLeftIn: (category: CouponCategory) => number | null,
  bundleUnits = 0,
): CouponOffer | null {
  if (!coupon) return null;

  const discount = discountFor(coupon, subtotal);
  const freeLines = freeLinesFor(coupon, categories, seatsLeftIn, bundleUnits);
  const freePasses = freeLines.reduce((n, l) => n + l.qty, 0);

  return {
    code: normalizeCode(coupon.code),
    kind: coupon.kind,
    discount,
    freeLines,
    freePasses,
    summary: offerSummary(coupon, discount, freeLines),
  };
}

/** What an admin typed on the coupon form, tidied and checked. */
export interface CleanCoupon {
  code: string;
  eventId: string | null;
  kind: CouponKind;
  scope: CouponScope;
  discountType: DiscountType | null;
  discountValue: number | null;
  freeCategoryId: string | null;
  freeQty: number | null;
  maxUses: number | null;
  perAccountUses: number;
  active: boolean;
  expiresAt: string | null;
  note: string | null;
}

/**
 * Validates and tidies a coupon an admin is creating.
 *
 * The database has the same rules as constraints — a coupon that claims to discount with no
 * discount on it is rejected there too. These exist so an admin gets a sentence on the form
 * rather than a raised Postgres exception, and so the shape is fixed before it is stored.
 */
export interface CouponCheckOptions {
  /**
   * True when this is a NEW coupon rather than an edit.
   *
   * A new free-ticket code is measured against the seats still FREE: one created for a sold-out
   * type would be born auto-paused, and the admin would have sent it out before noticing. An
   * edit is not, because a code that has stopped working is exactly the one whose category or
   * expiry an admin needs to change.
   */
  isNew?: boolean;
}

export function checkCouponInput(
  input: Record<string, unknown>,
  categories: { id: string; name: string; comp_only?: boolean | null; capacity?: number | null; sold?: number | null; released?: number | null }[],
  opts: CouponCheckOptions = {},
): CleanCoupon {
  const code = normalizeCode(input.code);
  if (!isValidCode(code)) {
    throw new PaymentInputError(
      `A code needs ${MIN_CODE_LENGTH} to ${MAX_CODE_LENGTH} letters or numbers, and may use - or _ inside.`,
    );
  }

  const kind = String(input.kind ?? '').toUpperCase() as CouponKind;
  if (!COUPON_KINDS.includes(kind)) throw new PaymentInputError('Choose what the coupon gives.');

  const scope = (String(input.scope ?? 'INDIVIDUAL').toUpperCase() as CouponScope);
  if (!COUPON_SCOPES.includes(scope)) throw new PaymentInputError('Choose how the free passes are counted.');

  let discountType: DiscountType | null = null;
  let discountValue: number | null = null;
  if (kind === 'DISCOUNT' || kind === 'BOTH') {
    discountType = String(input.discountType ?? '').toUpperCase() as DiscountType;
    if (!DISCOUNT_TYPES.includes(discountType)) throw new PaymentInputError('Choose a percentage or a flat amount.');
    discountValue = Math.round(Number(input.discountValue) * 100) / 100;
    if (!Number.isFinite(discountValue) || discountValue <= 0) {
      throw new PaymentInputError('Enter how much comes off.');
    }
    if (discountType === 'PERCENT' && discountValue > 100) {
      throw new PaymentInputError('A percentage cannot be more than 100.');
    }
  }

  let freeCategoryId: string | null = null;
  let freeQty: number | null = null;
  if (kind === 'FREE_TICKET' || kind === 'BOTH') {
    freeCategoryId = String(input.freeCategoryId ?? '').trim() || null;
    const category = categories.find((c) => String(c.id) === freeCategoryId);
    if (!category) throw new PaymentInputError('Choose which ticket type the free passes come from.');
    if (category.comp_only === true) {
      throw new PaymentInputError('That ticket type is for complimentary passes only and cannot be given by a coupon.');
    }
    freeQty = Math.floor(Number(input.freeQty));
    if (!Number.isFinite(freeQty) || freeQty < 1) {
      throw new PaymentInputError('A coupon has to give at least 1 free ticket.');
    }
    if (freeQty > MAX_FREE_QTY) {
      throw new PaymentInputError(
        `At most ${MAX_FREE_QTY} free tickets${scope === 'BUNDLE' ? ' per bundle' : ''}.`,
      );
    }
    // A new code also has to be honourable today. Without this an admin can create one for a
    // sold-out type, send it to a hundred people, and find out when the first of them types it.
    if (opts.isNew === true && category.capacity != null) {
      const free = seatsLeft(category as { capacity?: number | null; sold?: number | null; released?: number | null });
      if (free != null && free < freeQty) {
        throw new PaymentInputError(
          free === 0
            ? `"${category.name}" is sold out, so a coupon giving one away cannot be honoured.`
            : `Only ${free} "${category.name}" left, so a coupon giving ${freeQty} away cannot be honoured.`,
        );
      }
    }
  }

  let maxUses: number | null = null;
  if (input.maxUses !== undefined && input.maxUses !== null && String(input.maxUses).trim() !== '') {
    maxUses = Math.floor(Number(input.maxUses));
    if (!Number.isFinite(maxUses) || maxUses < 1) {
      throw new PaymentInputError('Leave the total uses empty for unlimited, or enter at least 1.');
    }
  }

  const perAccountUses = Math.floor(Number(input.perAccountUses ?? 1));
  if (!Number.isFinite(perAccountUses) || perAccountUses < 1) {
    throw new PaymentInputError('One account must be able to use it at least once.');
  }
  if (maxUses !== null && perAccountUses > maxUses) {
    throw new PaymentInputError('One account cannot be allowed more uses than the coupon has in total.');
  }

  let expiresAt: string | null = null;
  if (input.expiresAt) {
    const when = new Date(String(input.expiresAt));
    if (Number.isNaN(when.getTime())) throw new PaymentInputError('That expiry date could not be read.');
    expiresAt = when.toISOString();
  }

  return {
    code,
    eventId: String(input.eventId ?? '').trim() || null,
    kind,
    scope,
    discountType,
    discountValue,
    freeCategoryId,
    freeQty,
    maxUses,
    perAccountUses,
    active: input.active !== false,
    expiresAt,
    note: String(input.note ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE_LENGTH) || null,
  };
}

/** Postgres raises these from claim_coupon; turn each into something to show the buyer. */
export function couponError(message: string): PaymentInputError | null {
  if (/COUPON_UNKNOWN/.test(message)) {
    return new PaymentInputError('That coupon code is not recognised. Check the spelling and try again.', 404);
  }
  if (/COUPON_INACTIVE/.test(message)) {
    return new PaymentInputError('That coupon is no longer active.', 409);
  }
  if (/COUPON_EXPIRED/.test(message)) {
    return new PaymentInputError('That coupon has expired.', 409);
  }
  if (/COUPON_WRONG_EVENT/.test(message)) {
    return new PaymentInputError('That coupon is not valid for this event.', 409);
  }
  if (/COUPON_EXHAUSTED/.test(message)) {
    return new PaymentInputError('That coupon has been fully used up.', 409);
  }
  const mine = /COUPON_ALREADY_USED:(\d+)/.exec(message);
  if (mine) {
    const max = Number(mine[1]);
    return new PaymentInputError(
      max === 1 ? 'You have already used that coupon.' : `You have already used that coupon ${max} times.`,
      409,
    );
  }
  return null;
}
