import { NextResponse } from 'next/server';
import { checkAdminAccess } from '@/lib/admin';
import { reconcilePayments } from '@/lib/payments/reconcile';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Safety net for payments that neither the browser nor the webhook completed.
// Runs daily from Vercel Cron (Authorization: Bearer $CRON_SECRET) and on demand
// from the admin Payments page.
async function authorised(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') === `Bearer ${secret}`) return true;
  const { isAdmin } = await checkAdminAccess();
  return isAdmin;
}

/**
 * How far back to look, in days.
 *
 * Every order in the window is re-checked against Razorpay on every run, so the window decides
 * how much work a run is. The default of seven days is right for the nightly deep sweep; it is
 * far too much for a job running every five minutes, where it would mean thousands of gateway
 * calls a day re-asking about orders that have been settled for a week — and, worse, a run long
 * enough to hit the sixty-second function limit. The hold sweep happens at the END of a run, so
 * a run that times out reclaims no seats at all: exactly the thing this is here to do.
 *
 * So the frequent caller passes ?maxAgeDays=1 and stays small; the nightly one keeps the full
 * window and catches anything the short runs could not see.
 */
function windowFrom(req: Request): { maxAgeDays?: number; limit?: number } {
  const q = new URL(req.url).searchParams;
  const days = Number(q.get('maxAgeDays'));
  const limit = Number(q.get('limit'));
  return {
    ...(Number.isFinite(days) && days > 0 ? { maxAgeDays: Math.min(30, days) } : {}),
    ...(Number.isFinite(limit) && limit > 0 ? { limit: Math.min(500, Math.floor(limit)) } : {}),
  };
}

async function run(req: Request) {
  if (!(await authorised(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const summary = await reconcilePayments(windowFrom(req));
    console.log('[payments] reconcile', JSON.stringify(summary));
    return NextResponse.json(summary);
  } catch (e) {
    console.error('[payments] reconcile failed', e);
    return NextResponse.json({ error: 'Reconcile failed' }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
