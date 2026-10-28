import { CartLine, MartPlan, PaymentInputError } from './types';
import { groupSizeOf } from './groups';
import { seatsInUse } from './seats';

// Razorpay's 2% fee + 18% GST on it, passed on to the buyer.
export const GATEWAY_FEE_RATE = 0.0236;
export const MAX_TICKETS_PER_ACCOUNT = 7;
// Group tickets (one QR for several people) are limited separately: this many per account, per event.
export const MAX_GROUP_TICKETS_PER_ACCOUNT = 2;
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
  group_size?: number | null;
}

export interface EventCartInput {
  cart: unknown;
  categories: TicketCategory[];
  isLoggedIn: boolean;
  isMember: boolean;
  memberDiscountPercent: number;
  pointsToRedeem: unknown;
  loyaltyBalance: number;
  /** Single-entry tickets this account already holds for the event. */
  previouslyBought: number;
  /** Group tickets this account already holds for the event. */
  previouslyBoughtGroups?: number;
}

export interface EventCartQuote {
  lines: CartLine[];
  subtotal: number;      // after member discount
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
  let groupQty = 0;
  let subtotal = 0;
  const discount = input.isMember ? Math.max(0, Math.min(100, input.memberDiscountPercent || 0)) : 0;

  for (const [categoryId, rawQty] of Object.entries(cart as Record<string, unknown>)) {
    const qty = Number(rawQty);
    if (qty === 0) continue;
    if (!Number.isInteger(qty) || qty < 0) throw new PaymentInputError('Invalid ticket quantity');

    const cat = categories.find((c) => String(c.id) === categoryId);
    if (!cat) throw new PaymentInputError('Invalid category selected');
    if (cat.active === false) throw new PaymentInputError(`"${cat.name}" is no longer on sale.`);
    if (cat.capacity != null && seatsInUse(cat) + qty > cat.capacity) {
      throw new PaymentInputError(`Oops! "${cat.name}" is sold out. Someone just bought the last ones.`, 409);
    }

    const unitPrice = cat.price - (cat.price * discount) / 100;
    const groupSize = groupSizeOf(cat.group_size);
    lines.push({ categoryId, name: cat.name, prefix: cat.prefix, qty, unitPrice, numberWidth: ticketNumberWidth(cat.capacity), ...(groupSize > 1 ? { groupSize } : {}) });
    subtotal += unitPrice * qty;
    totalQty += qty;
    if (groupSize > 1) groupQty += qty;
    else singleQty += qty;
  }

  if (totalQty === 0) throw new PaymentInputError('Select at least one pass');

  if (input.isLoggedIn && input.previouslyBought + singleQty > MAX_TICKETS_PER_ACCOUNT) {
    throw new PaymentInputError(
      `Limit Exceeded: Your main account has already secured ${input.previouslyBought} passes. You can only buy a maximum of ${MAX_TICKETS_PER_ACCOUNT} tickets total across all emails.`,
    );
  }
  const groupsBefore = input.previouslyBoughtGroups || 0;
  if (input.isLoggedIn && groupsBefore + groupQty > MAX_GROUP_TICKETS_PER_ACCOUNT) {
    throw new PaymentInputError(
      `Limit Exceeded: you can book at most ${MAX_GROUP_TICKETS_PER_ACCOUNT} group tickets per account for this event${groupsBefore ? ` (you already have ${groupsBefore})` : ''}.`,
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
    // Always leave at least Rs 1 to pay: the payment gateway cannot take less.
    pointsApplied = Math.max(0, Math.min(requestedPoints, Math.floor(subtotal - 1)));
  }

  const total = subtotal - pointsApplied;
  if (total < 1) throw new PaymentInputError('Invalid amount');

  return { lines, subtotal, pointsApplied, total };
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
