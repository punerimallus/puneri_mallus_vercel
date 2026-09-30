// Several existing tables (ticket_bookings.amount_paid, payments.amount) were created with integer columns,
// because the old code only ever wrote whole rupees. A member discount or a fractional price gives amounts
// like 1.6 or 424.15, and Postgres then rejects the insert with "invalid input syntax for type integer".
// That failure happens AFTER the customer has paid, so the order is captured but nothing is issued.
//
// The exact figure is always kept in payment_orders.base_amount (numeric). For these rows we try the exact
// amount first, so nothing is lost once a column is numeric, and fall back to whole rupees only when the
// database says it cannot store a fraction.

export const isIntegerColumnError = (message?: string | null): boolean =>
  /invalid input syntax for type (integer|bigint|smallint)/i.test(message || '');

type DbResult<R> = { data: R | null; error: { message: string; code?: string } | null };

export async function insertWithWholeRupeeFallback<T extends object, R>(
  row: T,
  field: keyof T & string,
  insert: (row: T) => PromiseLike<DbResult<R>>,
): Promise<DbResult<R>> {
  const first = await insert(row);
  const amount = row[field] as unknown as number;
  if (first.error && isIntegerColumnError(first.error.message) && typeof amount === 'number' && !Number.isInteger(amount)) {
    return insert({ ...row, [field]: Math.round(amount) });
  }
  return first;
}

export const insertBookingWithAmountFallback = <T extends { amount_paid: number }, R>(
  row: T,
  insert: (row: T) => PromiseLike<DbResult<R>>,
) => insertWithWholeRupeeFallback(row, 'amount_paid', insert);
