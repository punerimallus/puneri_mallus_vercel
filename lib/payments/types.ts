// Shared payment types. Kept free of Next/Supabase imports so the fulfilment
// logic can be unit tested with in-memory fakes.

export type PaymentType = 'EVENT_TICKET' | 'LIFETIME' | 'MART';
export type MartPlan = 'MONTHLY' | 'YEARLY' | 'LIFETIME';

export type OrderStatus =
  | 'CREATED'            // Razorpay order exists, no confirmed payment yet
  | 'FAILED'             // last attempt failed; the user may still retry and pay
  | 'PROCESSING'         // one worker is fulfilling it right now
  | 'PAID'               // payment confirmed but a fulfilment step errored; retried automatically
  | 'FULFILLED'          // tickets / membership / mart access delivered
  | 'NEEDS_ATTENTION'    // money taken but we could not deliver (sold out, amount mismatch, duplicate)
  | 'REFUND_INITIATED'   // undeliverable, so we asked Razorpay to refund it automatically
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED';

export type FulfilmentSource = 'CLIENT' | 'WEBHOOK' | 'RECONCILE' | 'STATUS_POLL';

export interface CartLine {
  categoryId: string;
  name: string;
  prefix: string;
  qty: number;
  unitPrice: number; // rupees, after member discount, before gateway fee
  /** People admitted by one ticket of this category. Absent means 1. */
  groupSize?: number;
  /**
   * How many digits a pass number is padded to, fixed at checkout from the category's capacity
   * so every pass in a category is the same width: GEN-001 at capacity 100, GEN-0001 at 1000.
   * Absent means three.
   */
  numberWidth?: number;
}

export interface EventSnapshot {
  title?: string;
  date?: string;
  time?: string;
  location?: string;
  memberPoints?: number;
  nonMemberPoints?: number;
  memberDiscount?: number;
}

export interface IssuedTicket {
  /** Which category this pass came from. Prices and voiding key off this rather than the name,
   *  so renaming a category can no longer orphan a pass. Absent on older passes. */
  categoryId?: string;
  categoryName: string;
  ticketNumber: string;
  status: 'ISSUED' | 'CHECKED_IN' | 'REFUNDED';
  /** Only stored for group tickets (more than one person). Absent means 1. */
  groupSize?: number;
}

export interface Allocation {
  categoryId: string;
  qty: number;
  /** Seats in use in this category after the reservation took its share. Reporting only. */
  endSold: number;
  /** The exact numbers reserved: the lowest ones nobody holds. Always written by the reservation. */
  numbers: number[];
}

export interface PaymentOrder {
  razorpay_order_id: string;
  razorpay_payment_id: string | null;
  user_id: string | null;
  payment_type: PaymentType;
  plan: string | null;
  event_id: string | null;
  cart: CartLine[] | null;
  event_snapshot: EventSnapshot | null;
  points_to_redeem: number;
  is_member_at_order: boolean;
  receipt_email: string | null;
  base_amount: number;
  amount_paise: number;
  currency: string;
  status: OrderStatus;
  status_reason: string | null;
  processing_started_at: string | null;
  allocated_tickets: Allocation[] | null;
  booking_id: string | null;
  loyalty_applied: boolean;
  /** Set once a full refund has taken the earned points back and returned the redeemed ones. */
  loyalty_reversed?: boolean;
  /** Set once a full refund has given the order's seats back to the categories. */
  seats_released?: boolean;
  /** The inventory reservation owning this order's seats, numbers and redeemed points. */
  reservation_id?: string | null;
  /** Razorpay refund id, set when we refunded automatically because we could not deliver. */
  auto_refund_id?: string | null;
  auto_refund_at?: string | null;
  ledger_recorded: boolean;
  email_status: 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED';
  email_attempts: number;
  email_error: string | null;
  last_emailed_at: string | null;
  fulfilled_via: FulfilmentSource | null;
  fulfilled_at: string | null;
  refunded_amount_paise: number;
  created_at: string;
  /** Buyer ticked "send my tickets on WhatsApp" at checkout. Optional: older rows and old databases don't have these. */
  whatsapp_opt_in?: boolean;
  /** Digits-only number to send to, taken from the buyer's verified profile phone when the order was created. */
  whatsapp_to?: string | null;
  whatsapp_status?: 'SENT' | 'FAILED' | 'SKIPPED' | null;
  whatsapp_message_id?: string | null;
  whatsapp_error?: string | null;
}

// The subset of a Razorpay payment entity we rely on.
export interface GatewayPayment {
  id: string;
  order_id: string;
  status: 'created' | 'authorized' | 'captured' | 'refunded' | 'failed' | string;
  amount: number;
  currency: string;
  amount_refunded?: number;
  error_description?: string | null;
}

export class SoldOutError extends Error {
  constructor(public categoryName: string) {
    super(`SOLD_OUT:${categoryName}`);
    this.name = 'SoldOutError';
  }
}

/** A reservation that should have been ours has gone (expired, swept or released). */
export class ReservationLostError extends Error {
  constructor(public reservationId: string) {
    super(`RESERVATION_LOST:${reservationId}`);
    this.name = 'ReservationLostError';
  }
}

/** The buyer already holds as many passes for this event as the rules allow. */
export class TicketLimitError extends Error {
  constructor(public kind: 'SINGLE' | 'GROUP', public max: number) {
    super(`LIMIT_${kind}:${max}`);
    this.name = 'TicketLimitError';
  }
}

/** Fewer loyalty points are available than the buyer asked to redeem. */
export class PointsUnavailableError extends Error {
  constructor(public available: number) {
    super(`POINTS_UNAVAILABLE:${available}`);
    this.name = 'PointsUnavailableError';
  }
}

export class PaymentInputError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
    this.name = 'PaymentInputError';
  }
}
