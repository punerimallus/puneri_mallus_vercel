import { CartLine, MartPlan, PaymentInputError } from './types';
import { seatsInUse, seatsLeft } from './seats';
import { applyCoupon, type Coupon, type CouponCategory, type CouponOffer } from './coupons';

// Razorpay's 2% fee + 18% GST on it, passed on to the buyer.
export const GATEWAY_FEE_RATE = 0.0236;
export const MAX_TICKETS_PER_ACCOUNT = 7;
/**
 * Bundles one account may hold for an event, counted in UNITS.
 *
 * Its own allowance, separate from the seven singles: a Squad of 5 is one decision a buyer
 * made, not five, so charging it against the single-pass cap would make a second squad
 * impossible for no good reason. Two of each is the rule — seven individual passes and two
 * bundles, and no more of either.
 */
export const MAX_BUNDLES_PER_ACCOUNT = 2;
export const MIN_REDEEM_POINTS = 50;

/** Smallest pass number width, so a small category still reads GEN-001 rather than GEN-1. */
export const MIN_TICKET_NUMBER_WIDTH = 3;

/**
 * How many digits to pad a pass number to, from the category's capacity.
 *
 * A number can never exceed the capacity (the allocator refuses the sale first), so the capacity
 * decides the width for good: 100 seats gives GEN-001..GEN-100, and 1000 gives
 * GEN-0001..GEN-1000 rather than GEN-999 followed by a wider GEN-1000.
 */
export function ticketNumberWidth(capacity: number | null | undefined): number {
  const cap = Math.floor(Number(capacity));
  if (!Number.isFinite(cap) || cap < 1) return MIN_TICKET_NUMBER_WIDTH;
  return Math.max(MIN_TICKET_NUMBER_WIDTH, String(cap).length);
}

export function grossUpToPaise(baseRupees: number): number {
  return Math.round((baseRupees / (1 - GATEWAY_FEE_RATE)) * 100);
}

/** Per-ticket fee shown on the PDF, matching how the order total was grossed up. */
export function ticketFee(unitPrice: number): number {
  return Math.round(unitPrice / (1 - GATEWAY_FEE_RATE)) - unitPrice;
}

/**
 * A bundle offer: several seats of one category, bought together at a bundle price.
 *
 * Not a ticket type. The seats come out of the category's own pool and are issued as ordinary
 * passes of that category, so nothing downstream — the gate, the numbering, the PDF — has to
 * know a bundle existed.
 */
export interface TicketBundle {
  id: string;
  category_id: string;
  name: string;
  size: number;
  price: number;
  max_bundles?: number | null;
  sold?: number | null;
  active?: boolean | null;
}

/** Bundle units left of the offer's OWN run, or null when only the category's capacity limits it. */
export function bundlesLeft(b: TicketBundle): number | null {
  if (b.max_bundles == null) return null;
  return Math.max(0, b.max_bundles - (b.sold ?? 0));
}

/** The seat pool a bundle draws from, as much of a category as the availability rule needs. */
export interface BundleSeatPool {
  name?: string | null;
  capacity?: number | null;
  sold?: number | null;
  released?: number | null;
  active?: boolean | null;
  comp_only?: boolean | null;
}

/** Why a bundle cannot be sold at this moment, or null when it can. */
export type BundleStop = 'CATEGORY_CLOSED' | 'PAUSED' | 'RUN_SOLD_OUT' | 'NOT_ENOUGH_SEATS' | null;

export interface BundleAvailability {
  /** Units still sellable, counting BOTH limits. Null only when neither limit applies. */
  units: number | null;
  /** Seats left in the category itself, null when uncapped. */
  seatsLeft: number | null;
  /** Seats one unit takes. */
  seatsNeeded: number;
  stop: BundleStop;
  sellable: boolean;
  /**
   * True when the offer is open and unsold but the category can no longer fill one unit.
   *
   * This is the automatic pause, and it is DERIVED rather than written to `active`: a refund,
   * a void or an abandoned cart gives seats back, and an offer that paused itself by flipping
   * a stored flag would stay dark afterwards until somebody noticed. Nothing here edits the
   * admin's own pause, so "paused by me" and "paused because the room filled up" stay apart.
   */
  autoPaused: boolean;
}

/**
 * Whether a bundle can be sold right now, from the offer's run AND the seats actually left.
 *
 * The case this exists for: REGULAR holds 78, a "Group of 10" is on sale, and singles take the
 * category to 69 sold. Nine seats left cannot fill a group of ten, so the offer has to stop —
 * even though its own counter says every unit is still available. Before this, the buyer could
 * add it, reach Proceed to Pay and be refused by the reservation; the admin screen showed it
 * live with units remaining.
 *
 * `seatsTakenByCart` is what the cart in front of the buyer is already taking out of the same
 * category (their singles, and any units of this or another bundle on it), so the card goes
 * unavailable as they fill it rather than at checkout.
 */
export function bundleAvailability(
  bundle: TicketBundle,
  category: BundleSeatPool | null | undefined,
  seatsTakenByCart = 0,
): BundleAvailability {
  const size = Math.max(1, Math.floor(Number(bundle.size)) || 1);
  const run = bundlesLeft(bundle);

  const poolLeft = category ? seatsLeft(category) : 0;
  const taken = Math.max(0, Math.floor(Number(seatsTakenByCart)) || 0);
  const free = poolLeft == null ? null : Math.max(0, poolLeft - taken);
  const fromSeats = free == null ? null : Math.floor(free / size);

  const units = run == null ? fromSeats : fromSeats == null ? run : Math.min(run, fromSeats);

  // Ordered by what an admin would want to be told first: a closed category explains both of
  // the others, and the offer's own pause explains the seat count being irrelevant.
  let stop: BundleStop = null;
  if (!category || category.active === false || category.comp_only === true) stop = 'CATEGORY_CLOSED';
  else if (bundle.active === false) stop = 'PAUSED';
  else if (run !== null && run <= 0) stop = 'RUN_SOLD_OUT';
  else if (fromSeats !== null && fromSeats <= 0) stop = 'NOT_ENOUGH_SEATS';

  return {
    units,
    seatsLeft: poolLeft,
    seatsNeeded: size,
    stop,
    sellable: stop === null,
    autoPaused: stop === 'NOT_ENOUGH_SEATS',
  };
}

/**
 * One sentence for why a bundle is not sellable, so the buyer's card, the admin's card and the
 * checkout refusal all say the same thing.
 */
export function bundleStopReason(a: BundleAvailability, categoryName?: string | null): string | null {
  const cat = (categoryName || 'these tickets').toString();
  switch (a.stop) {
    case 'CATEGORY_CLOSED':
      return `${cat} is not on sale.`;
    case 'PAUSED':
      return 'Paused.';
    case 'RUN_SOLD_OUT':
      return 'Sold out.';
    case 'NOT_ENOUGH_SEATS':
      return a.seatsLeft === 0
        ? `${cat} is sold out.`
        : `Only ${a.seatsLeft} ${cat} left — a group takes ${a.seatsNeeded}.`;
    default:
      return null;
  }
}

export interface TicketCategory {
  id: string;
  name: string;
  prefix: string;
  price: number;
  capacity: number | null;
  sold: number | null;
  /** Seats given back by fully refunded orders (see seats.ts). Absent before the seat-release SQL is run. */
  released?: number | null;
  active?: boolean | null;
  /** Complimentary-pass categories (the ACCESS PASS). Never sellable. Absent before that migration. */
  comp_only?: boolean | null;
}

export interface EventCartInput {
  cart: unknown;
  categories: TicketCategory[];
  isLoggedIn: boolean;
  isMember: boolean;
  memberDiscountPercent: number;
  pointsToRedeem: unknown;
  loyaltyBalance: number;
  /** Passes this account already holds for the event, excluding bundle seats and free passes. */
  previouslyBought: number;
  /** Bundle offers available on this event, as stored. */
  bundles?: TicketBundle[];
  /** How many units of each bundle the buyer wants: { bundleId: units }. */
  bundleCart?: unknown;
  /**
   * A coupon the buyer typed, already looked up and CLAIMED in the database.
   *
   * Never the raw code: the usage cap is enforced under a row lock by claim_coupon, and a
   * quote that looked the code up itself would happily price an offer this buyer is not
   * entitled to. By the time it reaches here, the use has been granted.
   */
  coupon?: Coupon | null;
}

export interface EventCartQuote {
  lines: CartLine[];
  subtotal: number;      // after member discount, before the coupon
  /** Rupees a coupon took off. Zero when there is none. */
  couponDiscount: number;
  /** Bundle units in this cart, which is what a BUNDLE-scoped coupon multiplies by. */
  bundleUnits: number;
  /** What the coupon did, for the cart to show and the order to record. Null when there is none. */
  coupon: CouponOffer | null;
  pointsApplied: number; // whole rupees taken off by loyalty points
  total: number;         // what the buyer pays before the gateway fee
}

/**
 * Server-side price for an event cart. Everything the browser sends is
 * treated as untrusted: quantities, category ids and points are validated here.
 */
export function quoteEventCart(input: EventCartInput): EventCartQuote {
  const { cart, categories } = input;
  if (!cart || typeof cart !== 'object' || Array.isArray(cart)) {
    throw new PaymentInputError('Missing ticket data');
  }

  const lines: CartLine[] = [];
  let totalQty = 0;
  let singleQty = 0;
  let subtotal = 0;
  const discount = input.isMember ? Math.max(0, Math.min(100, input.memberDiscountPercent || 0)) : 0;

  for (const [categoryId, rawQty] of Object.entries(cart as Record<string, unknown>)) {
    const qty = Number(rawQty);
    if (qty === 0) continue;
    if (!Number.isInteger(qty) || qty < 0) throw new PaymentInputError('Invalid ticket quantity');

    const cat = categories.find((c) => String(c.id) === categoryId);
    if (!cat) throw new PaymentInputError('Invalid category selected');
    // A comp-only category is free and `active` (the reservation needs it active to issue from),
    // so nothing else here would stop it: a cart of one paid pass plus five ACCESS PASSes clears
    // the minimum-amount check and walks five people in for nothing. The booking page hides these
    // rows, but it hands every category id to the browser, so hiding is not a control. Refused
    // with the same words as an unknown id — a buyer never meets this, and it tells a prodder
    // nothing about what exists.
    if (cat.comp_only === true) throw new PaymentInputError('Invalid category selected');
    if (cat.active === false) throw new PaymentInputError(`"${cat.name}" is no longer on sale.`);
    if (cat.capacity != null && seatsInUse(cat) + qty > cat.capacity) {
      throw new PaymentInputError(`Oops! "${cat.name}" is sold out. Someone just bought the last ones.`, 409);
    }

    const unitPrice = cat.price - (cat.price * discount) / 100;
    lines.push({ categoryId, name: cat.name, prefix: cat.prefix, qty, unitPrice, numberWidth: ticketNumberWidth(cat.capacity) });
    subtotal += unitPrice * qty;
    totalQty += qty;
    singleQty += qty;
  }

  // --- bundles ------------------------------------------------------------------------------
  // Each unit becomes its own line so it can carry its own reference, which is what the
  // reservation stamps on the seats and what keeps the two account allowances apart.
  let bundleUnits = 0;
  const bundleCart = (input.bundleCart && typeof input.bundleCart === 'object' && !Array.isArray(input.bundleCart))
    ? (input.bundleCart as Record<string, unknown>)
    : {};

  for (const [bundleId, rawUnits] of Object.entries(bundleCart)) {
    const units = Number(rawUnits);
    if (units === 0) continue;
    if (!Number.isInteger(units) || units < 0) throw new PaymentInputError('Invalid bundle quantity');

    const bundle = (input.bundles || []).find((b) => String(b.id) === bundleId);
    if (!bundle) throw new PaymentInputError('Invalid bundle selected');
    if (bundle.active === false) throw new PaymentInputError(`"${bundle.name}" is no longer available.`);

    const unitsLeft = bundlesLeft(bundle);
    if (unitsLeft !== null && units > unitsLeft) {
      throw new PaymentInputError(
        unitsLeft === 0
          ? `"${bundle.name}" is sold out.`
          : `Only ${unitsLeft} "${bundle.name}" left.`,
        409,
      );
    }

    const cat = categories.find((c) => String(c.id) === String(bundle.category_id));
    if (!cat) throw new PaymentInputError('Invalid bundle selected');
    if (cat.active === false) throw new PaymentInputError(`"${bundle.name}" is no longer available.`);
    if (cat.comp_only === true) throw new PaymentInputError('Invalid bundle selected');

    const seats = bundle.size * units;
    // Only what this cart is already taking out of THIS category counts — singles above plus
    // any bundle lines already added. Counting totalQty would charge a REGULAR bundle for the
    // buyer's two BALCONY seats and refuse a sale the hall has room for.
    const seatsThisCart = lines.reduce((n, l) => n + (l.categoryId === String(cat.id) ? l.qty : 0), 0);
    if (cat.capacity != null && seatsInUse(cat) + seatsThisCart + seats > cat.capacity) {
      throw new PaymentInputError(`Oops! "${cat.name}" does not have ${seats} seats left for that bundle.`, 409);
    }

    // Priced per seat so the receipt reads "5 x 900" rather than one opaque figure, and so a
    // single pass out of a bundle can still be valued if it is ever voided.
    const perSeat = Math.round((bundle.price / bundle.size) * 100) / 100;
    for (let unit = 0; unit < units; unit += 1) {
      lines.push({
        categoryId: String(cat.id),
        name: `${bundle.name} (${cat.name})`,
        prefix: cat.prefix,
        qty: bundle.size,
        unitPrice: perSeat,
        numberWidth: ticketNumberWidth(cat.capacity),
        bundleId: String(bundle.id),
        bundleName: bundle.name,
      });
      subtotal += perSeat * bundle.size;
      totalQty += bundle.size;
      bundleUnits += 1;
    }
  }

  if (totalQty === 0) throw new PaymentInputError('Select at least one pass');

  // --- the coupon ---------------------------------------------------------------------------
  // After the member discount and on the same base it used: the two stack additively rather
  // than compounding, which is what the strike-through in the cart shows and what an admin
  // means by "20% off".
  //
  // Placed above the per-account limits on purpose. A free pass is a real seat held by this
  // account, the reservation counts it against the allowance, and the buyer should hear that
  // here in a sentence rather than from a raised Postgres exception moments later.
  let couponOffer: CouponOffer | null = null;
  if (input.coupon) {
    if (subtotal <= 0) {
      // Without this a free-ticket coupon on a cart of nothing is a pass for nothing — and the
      // order would then be refused by the gateway's minimum anyway, after the seats were
      // taken and the use spent.
      throw new PaymentInputError('Add a ticket to your cart before applying a coupon.');
    }
    couponOffer = applyCoupon(input.coupon, subtotal, categories as CouponCategory[], (c) => seatsLeft(c), bundleUnits);
    for (const line of couponOffer?.freeLines ?? []) {
      // Priced at zero and carried through the reservation like any other line, so a free pass
      // takes a real seat, gets a real number from the same pool, and cannot oversell.
      lines.push({ ...line, free: true, couponCode: couponOffer!.code });
      // Counted in the cart total but NOT against the per-account allowance. The database
      // excludes them the same way, over the free_pass flag on the seat itself; if these two
      // ever disagree the buyer is refused at the reservation having been told they could buy.
      totalQty += line.qty;
    }
  }
  const couponDiscount = couponOffer?.discount ?? 0;
  const afterCoupon = Math.max(0, Math.round((subtotal - couponDiscount) * 100) / 100);

  if (input.isLoggedIn && input.previouslyBought + singleQty > MAX_TICKETS_PER_ACCOUNT) {
    throw new PaymentInputError(
      `Limit Exceeded: Your main account has already secured ${input.previouslyBought} passes. You can only buy a maximum of ${MAX_TICKETS_PER_ACCOUNT} tickets total across all emails.`,
    );
  }

  const requestedPoints = Math.floor(Number(input.pointsToRedeem) || 0);
  if (requestedPoints < 0) throw new PaymentInputError('Invalid points value');

  let pointsApplied = 0;
  if (requestedPoints > 0) {
    if (!input.isLoggedIn) throw new PaymentInputError('Unauthorized redemption attempt.', 401);
    // Redemption unlocks once the BALANCE reaches the minimum (this is what the checkout page tells people).
    // It is not a minimum on how much a single order uses: a small order may use only a few points.
    if (input.loyaltyBalance < MIN_REDEEM_POINTS) {
      throw new PaymentInputError(`A minimum of ${MIN_REDEEM_POINTS} points is required to unlock redemption.`);
    }
    if (input.loyaltyBalance < requestedPoints) throw new PaymentInputError('Insufficient loyalty balance for redemption.');
    // Always leave at least Rs 1 to pay: the payment gateway cannot take less. Worked out
    // against what is left AFTER the coupon, or points could be spent driving an already
    // discounted cart below the minimum.
    pointsApplied = Math.max(0, Math.min(requestedPoints, Math.floor(afterCoupon - 1)));
  }

  const total = Math.round((afterCoupon - pointsApplied) * 100) / 100;
  if (total < 1) {
    // Reachable with a large coupon on a small cart. Said plainly rather than as "Invalid
    // amount", because it is something the buyer can actually act on.
    throw new PaymentInputError(
      couponDiscount > 0
        ? 'That coupon covers almost the whole order. Add another ticket, or remove the coupon.'
        : 'Invalid amount',
    );
  }

  return { lines, subtotal, couponDiscount, coupon: couponOffer, bundleUnits, pointsApplied, total };
}

export interface PriceSettings {
  [key: string]: unknown;
}

function num(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function membershipPrice(settings: PriceSettings | null): number {
  return num(settings?.membershipPrice) ?? num(settings?.membership_price) ?? 999;
}

export function martPlanPrice(settings: PriceSettings | null, plan: unknown): { plan: MartPlan; price: number } {
  const s = settings || {};
  switch (plan) {
    case 'MONTHLY':
      return { plan, price: num(s.martMonthlyPrice) ?? num(s.mart_monthly_price) ?? 99 };
    case 'YEARLY':
      return { plan, price: num(s.martYearlyPrice) ?? num(s.mart_yearly_price) ?? 899 };
    case 'LIFETIME':
      return { plan, price: num(s.martLifetimePrice) ?? num(s.mart_lifetime_price) ?? 2499 };
    default:
      throw new PaymentInputError('Invalid Mallu Mart plan');
  }
}

/** New mart expiry: extends from the current expiry if it is still in the future. */
export function nextMartExpiry(plan: string | null, currentExpiry: string | null, now: Date): Date | null {
  if (plan === 'LIFETIME') return null;
  const current = currentExpiry ? new Date(currentExpiry) : null;
  const base = new Date(current && current > now ? current : now);
  if (plan === 'MONTHLY') base.setMonth(base.getMonth() + 1);
  else if (plan === 'YEARLY') base.setFullYear(base.getFullYear() + 1);
  return base;
}
