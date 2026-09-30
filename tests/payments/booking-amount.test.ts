import { describe, it, expect } from 'vitest';
import { insertBookingWithAmountFallback, isIntegerColumnError } from '@/lib/payments/booking-amount';

const INT_ERR = { message: 'invalid input syntax for type integer: "1.6"', code: '22P02' };

describe('insertBookingWithAmountFallback', () => {
  it('stores the exact amount when the column accepts it', async () => {
    const seen: number[] = [];
    const r = await insertBookingWithAmountFallback({ amount_paid: 1.6 }, async (row) => {
      seen.push(row.amount_paid);
      return { data: { id: 'b1' }, error: null };
    });
    expect(seen).toEqual([1.6]);
    expect(r.data).toEqual({ id: 'b1' });
  });

  it('retries once with whole rupees when the column is an integer', async () => {
    const seen: number[] = [];
    const r = await insertBookingWithAmountFallback({ amount_paid: 424.15 }, async (row) => {
      seen.push(row.amount_paid);
      return Number.isInteger(row.amount_paid) ? { data: { id: 'b1' }, error: null } : { data: null, error: INT_ERR };
    });
    expect(seen).toEqual([424.15, 424]);
    expect(r.error).toBeNull();
  });

  it('does not retry for other errors, or when the amount is already whole', async () => {
    let calls = 0;
    const dup = await insertBookingWithAmountFallback({ amount_paid: 1.6 }, async () => {
      calls++;
      return { data: null, error: { message: 'duplicate key', code: '23505' } };
    });
    expect(calls).toBe(1);
    expect(dup.error?.code).toBe('23505');

    calls = 0;
    await insertBookingWithAmountFallback({ amount_paid: 500 }, async () => {
      calls++;
      return { data: null, error: INT_ERR };
    });
    expect(calls).toBe(1);
  });

  it('recognises the Postgres message', () => {
    expect(isIntegerColumnError('invalid input syntax for type integer: "1.6"')).toBe(true);
    expect(isIntegerColumnError('invalid input syntax for type bigint: "2.5"')).toBe(true);
    expect(isIntegerColumnError('duplicate key value')).toBe(false);
    expect(isIntegerColumnError(undefined)).toBe(false);
  });
});
