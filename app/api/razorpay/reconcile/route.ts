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

async function run(req: Request) {
  if (!(await authorised(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const summary = await reconcilePayments();
    console.log('[payments] reconcile', JSON.stringify(summary));
    return NextResponse.json(summary);
  } catch (e) {
    console.error('[payments] reconcile failed', e);
    return NextResponse.json({ error: 'Reconcile failed' }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
