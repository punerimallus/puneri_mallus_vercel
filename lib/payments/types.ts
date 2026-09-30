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
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED';

export type FulfilmentSource = 'CLIENT' | 'WEBHOOK' | 'RECONCILE' | 'STATUS_POLL';

export interface CartLine {
  categoryId: string;
  name: string;
  prefix: string;
  qty: number;
  unitPrice: number; // rupees, after member discount, before gateway fee
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
  categoryName: string;
  ticketNumber: string;
  status: 'ISSUED' | 'CHECKED_IN' | 'REFUNDED';
}

export interface Allocation {
  categoryId: string;
  qty: number;
  endSold: number;
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
  ledger_recorded: boolean;
  email_status: 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED';
  email_attempts: number;
  email_error: string | null;
  last_emailed_at: string | null;
  fulfilled_via: FulfilmentSource | null;
  fulfilled_at: string | null;
  refunded_amount_paise: number;
  created_at: string;
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

export class PaymentInputError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
    this.name = 'PaymentInputError';
  }
}
