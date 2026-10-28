// Seat, ticket-number and loyalty-point reservations.
//
// The rule this module exists to enforce: nothing is ever sold that we cannot deliver. Seats and
// points are taken BEFORE the buyer reaches Razorpay, so a checkout either starts with its
// inventory already in hand or never starts at all. Previously allocation happened after
// payment, which meant a popular drop could take money for seats that no longer existed.
//
// The database does the hard part (see supabase/migrations/20261028_ticketing_integrity.sql);
// this file is the typed surface over it and turns Postgres' raised messages into real errors.

import {
  Allocation,
  PaymentInputError,
  PointsUnavailableError,
  ReservationLostError,
  SoldOutError,
  TicketLimitError,
} from './types';

/** How long a checkout holds its seats before the sweeper takes them back. */
export const HOLD_TTL_SECONDS = 15 * 60;

export interface ReserveRequest {
  reservationId: string;
  userId: string | null;
  items: { categoryId: string; qty: number }[];
  points?: number;
  ttlSeconds?: number;
  maxSingle: number;
  maxGroup: number;
}

export interface InventoryDb {
  // PromiseLike, not Promise: Supabase's query builder is thenable but not a real Promise.
  rpc<T = unknown>(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: T | null; error: { message: string; code?: string } | null }>;
}

/** Postgres raises these as messages; turn each back into something the caller can act on. */
export function translateInventoryError(message: string): Error {
  const soldOut = /SOLD_OUT:(.*)/.exec(message);
  if (soldOut) return new SoldOutError(soldOut[1].trim());

  const single = /LIMIT_SINGLE:(\d+)/.exec(message);
  if (single) return new TicketLimitError('SINGLE', Number(single[1]));

  const group = /LIMIT_GROUP:(\d+)/.exec(message);
  if (group) return new TicketLimitError('GROUP', Number(group[1]));

  const points = /POINTS_UNAVAILABLE:(\d+)/.exec(message);
  if (points) return new PointsUnavailableError(Number(points[1]));

  const lost = /RESERVATION_LOST:(.*)/.exec(message);
  if (lost) return new ReservationLostError(lost[1].trim());

  if (/MIXED_EVENT_CART/.test(message)) return new PaymentInputError('Please book one event at a time.');
  if (/UNKNOWN_CATEGORY/.test(message)) return new PaymentInputError('Invalid category selected');
  if (/EMPTY_CART/.test(message)) return new PaymentInputError('Select at least one pass');

  return new Error(message);
}

/** A readable sentence for each reason a reservation can be refused, shown at checkout. */
export function reservationMessage(e: unknown): { message: string; status: number } | null {
  if (e instanceof SoldOutError) {
    return { message: `"${e.categoryName}" just sold out. Nothing has been charged.`, status: 409 };
  }
  if (e instanceof TicketLimitError) {
    return e.kind === 'SINGLE'
      ? { message: `You can hold at most ${e.max} passes for this event on one account.`, status: 409 }
      : { message: `You can hold at most ${e.max} group passes for this event on one account.`, status: 409 };
  }
  if (e instanceof PointsUnavailableError) {
    return {
      message: e.available > 0
        ? `Only ${e.available} points are available right now — the rest are held by another checkout of yours.`
        : 'Your points are held by another checkout. Finish or cancel that one first.',
      status: 409,
    };
  }
  return null;
}

/**
 * Takes the seats, picks the numbers, enforces the per-account limits and reserves the points,
 * all in one database transaction. Throws (never returns partial state) if any of it fails.
 */
export async function reserveInventory(db: InventoryDb, req: ReserveRequest): Promise<Allocation[]> {
  const { data, error } = await db.rpc<Allocation[]>('reserve_order_inventory', {
    p_reservation_id: req.reservationId,
    p_user_id: req.userId,
    p_items: req.items,
    p_points: Math.max(0, Math.floor(req.points || 0)),
    p_ttl_seconds: req.ttlSeconds ?? HOLD_TTL_SECONDS,
    p_max_single: req.maxSingle,
    p_max_group: req.maxGroup,
  });
  if (error) throw translateInventoryError(`${error.message}`);

  // The function raises rather than returning nothing, so an empty or short result means
  // something is wrong with it. Catching that HERE matters: this runs before the buyer is sent
  // to Razorpay, so the sale is refused rather than taken and then refunded.
  const allocations = (data || []) as Allocation[];
  const wanted = req.items.filter((i) => i.qty > 0);
  if (allocations.length !== wanted.length) {
    throw new Error(`RESERVATION_INCOMPLETE: asked for ${wanted.length} categories, got ${allocations.length}`);
  }
  for (const want of wanted) {
    const got = allocations.find((a) => String(a.categoryId) === String(want.categoryId));
    if (!got || !Array.isArray(got.numbers) || got.numbers.length !== want.qty) {
      throw new Error(
        `RESERVATION_INCOMPLETE: ${want.categoryId} wanted ${want.qty}, got ${got?.numbers?.length ?? 0}`,
      );
    }
  }
  return allocations;
}

/** The payment went through: the held numbers become issued and the reserved points are spent. */
export async function confirmInventory(db: InventoryDb, reservationId: string): Promise<{ alreadyConfirmed: boolean; pointsSpent: number }> {
  const { data, error } = await db.rpc<{ alreadyConfirmed: boolean; pointsSpent: number }>('confirm_order_inventory', {
    p_reservation_id: reservationId,
  });
  if (error) throw translateInventoryError(`${error.message}`);
  return data ?? { alreadyConfirmed: true, pointsSpent: 0 };
}

/** Gives the seats back and undoes the points. Safe to call repeatedly and from any state. */
export async function releaseInventory(db: InventoryDb, reservationId: string): Promise<number> {
  const { data, error } = await db.rpc<number>('release_order_inventory', { p_reservation_id: reservationId });
  if (error) throw translateInventoryError(`${error.message}`);
  return Number(data) || 0;
}

/**
 * Drops holds nobody completed. Deliberately its own transaction: sweeping takes locks on other
 * people's reservations, and doing it inside a reservation could deadlock against a concurrent one.
 */
export async function expireStaleHolds(db: InventoryDb): Promise<number> {
  const { data, error } = await db.rpc<number>('expire_stale_holds', {});
  if (error) throw translateInventoryError(`${error.message}`);
  return Number(data) || 0;
}

/** Frees a single pass's number when an admin voids just that pass. */
export async function voidTicketNumber(
  db: InventoryDb,
  reservationId: string,
  categoryId: string,
  number: number,
): Promise<boolean> {
  const { data, error } = await db.rpc<number>('void_ticket_number', {
    p_reservation_id: reservationId,
    p_category_id: categoryId,
    p_number: number,
  });
  if (error) throw translateInventoryError(`${error.message}`);
  return (Number(data) || 0) > 0;
}

/** The numeric part of a pass number ("GA-013" with prefix "GA-" is 13). */
export function ticketNumberValue(ticketNumber: string, prefix?: string | null): number | null {
  const raw = String(ticketNumber || '');
  const body = prefix && raw.toUpperCase().startsWith(prefix.toUpperCase()) ? raw.slice(prefix.length) : raw;
  const digits = /(\d+)\s*$/.exec(body);
  if (!digits) return null;
  const n = Number(digits[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}
