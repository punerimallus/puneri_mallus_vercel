import { CartLine, MartPlan, PaymentInputError } from './types';

// Razorpay's 2% fee + 18% GST on it, passed on to the buyer.
export const GATEWAY_FEE_RATE = 0.0236;
export const MAX_TICKETS_PER_ACCOUNT = 7;
export const MIN_REDEEM_POINTS = 50;

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
  active?: boolean | null;
}

export interface EventCartInput {
  cart: unknown;
  categories: TicketCategory[];
  isLoggedIn: boolean;
  isMember: boolean;
  memberDiscountPercent: number;
  pointsToRedeem: unknown;
  loyaltyBalance: number;
  previouslyBought: number;
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
  let subtotal = 0;
  const discount = input.isMember ? Math.max(0, Math.min(100, input.memberDiscountPercent || 0)) : 0;

  for (const [categoryId, rawQty] of Object.entries(cart as Record<string, unknown>)) {
    const qty = Number(rawQty);
    if (qty === 0) continue;
    if (!Number.isInteger(qty) || qty < 0) throw new PaymentInputError('Invalid ticket quantity');

    const cat = categories.find((c) => String(c.id) === categoryId);
    if (!cat) throw new PaymentInputError('Invalid category selected');
    if (cat.active === false) throw new PaymentInputError(`"${cat.name}" is no longer on sale.`);
    if (cat.capacity != null && (cat.sold || 0) + qty > cat.capacity) {
      throw new PaymentInputError(`Oops! "${cat.name}" is sold out. Someone just bought the last ones.`, 409);
    }

    const unitPrice = cat.price - (cat.price * discount) / 100;
    lines.push({ categoryId, name: cat.name, prefix: cat.prefix, qty, unitPrice });
    subtotal += unitPrice * qty;
    totalQty += qty;
  }

  if (totalQty === 0) throw new PaymentInputError('Select at least one pass');

  if (input.isLoggedIn && input.previouslyBought + totalQty > MAX_TICKETS_PER_ACCOUNT) {
    throw new PaymentInputError(
      `Limit Exceeded: Your main account has already secured ${input.previouslyBought} passes. You can only buy a maximum of ${MAX_TICKETS_PER_ACCOUNT} tickets total across all emails.`,
    );
  }

  const requestedPoints = Math.floor(Number(input.pointsToRedeem) || 0);
  if (requestedPoints < 0) throw new PaymentInputError('Invalid points value');

  let pointsApplied = 0;
  if (requestedPoints > 0) {
    if (!input.isLoggedIn) throw new PaymentInputError('Unauthorized redemption attempt.', 401);
    if (requestedPoints < MIN_REDEEM_POINTS) {
      throw new PaymentInputError(`A minimum of ${MIN_REDEEM_POINTS} points is required to unlock redemption.`);
    }
    if (input.loyaltyBalance < requestedPoints) throw new PaymentInputError('Insufficient loyalty balance for redemption.');
    pointsApplied = Math.min(requestedPoints, Math.floor(subtotal));
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
