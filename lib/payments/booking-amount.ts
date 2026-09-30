// ticket_bookings.amount_paid was created as an integer column (the old code always wrote whole rupees),
// but a member discount or a fractional price gives amounts like 1.6 or 424.15. Postgres then rejects the
// insert with "invalid input syntax for type integer" and a paid order is never fulfilled.
//
// The exact figure is always kept in payment_orders.base_amount (numeric). For the booking row we try the
// exact amount first, so nothing is lost once the column is numeric, and fall back to whole rupees only when
// the database says it cannot store a fraction.

export const isIntegerColumnError = (message?: string | null): boolean =>
  /invalid input syntax for type (integer|bigint|smallint)/i.test(message || '');

export async function insertBookingWithAmountFallback<T extends { amount_paid: number }, R>(
  row: T,
  insert: (row: T) => PromiseLike<{ data: R | null; error: { message: string; code?: string } | null }>,
): Promise<{ data: R | null; error: { message: string; code?: string } | null }> {
  const first = await insert(row);
  if (first.error && isIntegerColumnError(first.error.message) && !Number.isInteger(row.amount_paid)) {
    return insert({ ...row, amount_paid: Math.round(row.amount_paid) });
  }
  return first;
}
