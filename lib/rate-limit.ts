// A small sliding-window rate limiter.
//
// Honest about what it is: the counters live in this process's memory, so on a serverless
// platform each instance keeps its own. That makes it a guard against a single client hammering
// an endpoint in a loop — the thing that was completely unguarded before — and NOT a global
// quota. Anything that must hold across instances (per-account purchase limits, loyalty points)
// is enforced in Postgres instead, where it actually can be.

export interface RateLimitResult {
  ok: boolean;
  /** Requests left in the current window. */
  remaining: number;
  /** Seconds until the window frees up, for Retry-After. */
  retryAfter: number;
}

export interface RateRule {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Requests allowed per key per window. */
  max: number;
}

const BUCKETS = new Map<string, number[]>();
/** Stops an unbounded key space (one entry per IP) from leaking memory. */
const MAX_KEYS = 20_000;

function sweep(now: number, windowMs: number): void {
  if (BUCKETS.size <= MAX_KEYS) return;
  for (const [key, hits] of BUCKETS) {
    const live = hits.filter((t) => now - t < windowMs);
    if (live.length === 0) BUCKETS.delete(key);
    else BUCKETS.set(key, live);
  }
}

export function rateLimit(key: string, rule: RateRule, now: number = Date.now()): RateLimitResult {
  const hits = (BUCKETS.get(key) || []).filter((t) => now - t < rule.windowMs);

  if (hits.length >= rule.max) {
    const oldest = hits[0];
    BUCKETS.set(key, hits);
    return { ok: false, remaining: 0, retryAfter: Math.max(1, Math.ceil((rule.windowMs - (now - oldest)) / 1000)) };
  }

  hits.push(now);
  BUCKETS.set(key, hits);
  sweep(now, rule.windowMs);
  return { ok: true, remaining: rule.max - hits.length, retryAfter: 0 };
}

/** Test seam. */
export function resetRateLimits(): void {
  BUCKETS.clear();
}

/** Best-effort client address, for limiting people who are not logged in. */
export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip') || 'unknown';
}

/** Prefer the account; fall back to the address. */
export function rateKey(route: string, userId: string | null | undefined, req: Request): string {
  return `${route}:${userId ? `u_${userId}` : `ip_${clientIp(req)}`}`;
}

export const RATE_RULES = {
  /** Creating checkout orders: enough for honest retries, not enough to mint hundreds. */
  createOrder: { windowMs: 60_000, max: 8 } satisfies RateRule,
  /** Verifying a payment: the browser may legitimately retry a few times. */
  verifyPayment: { windowMs: 60_000, max: 20 } satisfies RateRule,
  /** Re-sending a passes email, on top of the per-booking interval. */
  resendEmail: { windowMs: 10 * 60_000, max: 5 } satisfies RateRule,
  /** Gate scanning is fast work by trusted staff; this only catches a stuck client. */
  scan: { windowMs: 60_000, max: 240 } satisfies RateRule,
  /** Reading your own bookings. */
  readTickets: { windowMs: 60_000, max: 60 } satisfies RateRule,
} as const;
