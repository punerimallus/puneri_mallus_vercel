// Browser helpers shared by every checkout page.

export interface OrderStatusResponse {
  status: 'CREATED' | 'FAILED' | 'PROCESSING' | 'PAID' | 'FULFILLED' | 'NEEDS_ATTENTION' | 'REFUNDED' | 'PARTIALLY_REFUNDED' | 'UNKNOWN';
  paymentType?: string;
  bookingId?: string | null;
  emailStatus?: string;
  reason?: string | null;
}

const FINAL = new Set(['FULFILLED', 'NEEDS_ATTENTION', 'REFUNDED', 'PARTIALLY_REFUNDED']);

/**
 * Ask the server what happened to an order until it settles or we give up.
 * The server checks Razorpay directly, so this also completes orders whose
 * browser handler never ran or failed half-way.
 */
export async function waitForOrder(
  orderId: string,
  {
    timeoutMs = 45_000,
    intervalMs = 3_000,
    stopIfUnpaid = false,
  }: { timeoutMs?: number; intervalMs?: number; stopIfUnpaid?: boolean } = {},
): Promise<OrderStatusResponse> {
  const deadline = Date.now() + timeoutMs;
  let unpaidChecks = 0;
  let last: OrderStatusResponse = { status: 'UNKNOWN' };
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`/api/razorpay/status?orderId=${encodeURIComponent(orderId)}`, { cache: 'no-store' });
      if (res.ok) {
        last = await res.json();
        if (FINAL.has(last.status)) return last;
        // Modal closed and Razorpay has no payment for this order: the user simply cancelled.
        if (stopIfUnpaid && (last.status === 'CREATED' || last.status === 'FAILED') && ++unpaidChecks >= 2) return last;
      }
    } catch {
      // Network blip; keep trying until the deadline.
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return last;
}

/** Friendly reference the user can quote to support. */
export function orderRef(orderId: string) {
  return orderId.replace(/^order_/, '').toUpperCase();
}
