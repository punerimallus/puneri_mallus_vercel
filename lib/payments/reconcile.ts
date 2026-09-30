import { MAX_EMAIL_ATTEMPTS, STALE_PROCESSING_MS } from './fulfil';
import { deliverOrderEmail } from './delivery';
import { deliveryDeps, fulfilAndDeliver, supabaseAdmin } from './server';

// Orders younger than this are left alone: the browser handler or webhook is probably still on it.
const MIN_AGE_MS = 2 * 60 * 1000;

export interface ReconcileSummary {
  checked: number;
  fulfilled: string[];
  needsAttention: string[];
  errors: { orderId: string; error: string }[];
  emailsRetried: number;
  emailsSent: number;
}

/**
 * Sweep for paid orders nobody fulfilled (tab closed, webhook missed, a crash
 * mid-way) and for fulfilled orders whose email failed.
 */
export async function reconcilePayments(opts: { maxAgeDays?: number; limit?: number } = {}): Promise<ReconcileSummary> {
  const maxAgeDays = opts.maxAgeDays ?? 7;
  const limit = opts.limit ?? 200;
  const now = Date.now();
  const db = supabaseAdmin();
  const summary: ReconcileSummary = { checked: 0, fulfilled: [], needsAttention: [], errors: [], emailsRetried: 0, emailsSent: 0 };

  const staleIso = new Date(now - STALE_PROCESSING_MS).toISOString();
  const { data: pending, error } = await db
    .from('payment_orders')
    .select('razorpay_order_id')
    .gte('created_at', new Date(now - maxAgeDays * 86400000).toISOString())
    .lte('created_at', new Date(now - MIN_AGE_MS).toISOString())
    .or(`status.in.(CREATED,FAILED,PAID),and(status.eq.PROCESSING,processing_started_at.lt."${staleIso}")`)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);

  for (const row of pending || []) {
    summary.checked++;
    try {
      const res = await fulfilAndDeliver(row.razorpay_order_id, null, 'RECONCILE');
      if (res.outcome === 'FULFILLED') summary.fulfilled.push(row.razorpay_order_id);
      if (res.outcome === 'NEEDS_ATTENTION') summary.needsAttention.push(row.razorpay_order_id);
    } catch (e) {
      summary.errors.push({ orderId: row.razorpay_order_id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  const { data: unsent, error: unsentErr } = await db
    .from('payment_orders')
    .select('razorpay_order_id')
    .eq('status', 'FULFILLED')
    .in('email_status', ['PENDING', 'FAILED'])
    .lt('email_attempts', MAX_EMAIL_ATTEMPTS)
    .lte('updated_at', new Date(now - MIN_AGE_MS).toISOString())
    .limit(limit);
  if (unsentErr) throw new Error(unsentErr.message);

  for (const row of unsent || []) {
    summary.emailsRetried++;
    const res = await deliverOrderEmail(row.razorpay_order_id, deliveryDeps).catch(() => ({ status: 'FAILED' as const }));
    if (res.status === 'SENT') summary.emailsSent++;
  }

  return summary;
}
