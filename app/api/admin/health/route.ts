import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { supabaseAdmin } from '@/lib/payments/server';
import { asMarkerDb, checkSchema } from '@/lib/payments/schema-check';

export const dynamic = 'force-dynamic';

/**
 * What an admin needs to know is working before an event goes on sale.
 *
 * All three of these used to fail silently: a missing migration meant the app quietly ran in a
 * degraded mode, and a missing webhook secret meant every Razorpay webhook was rejected as
 * unsigned — so the safety net that fulfils a payment when the buyer's tab closes was simply
 * off, with nothing to show it.
 */
export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const schema = await checkSchema(asMarkerDb(supabaseAdmin()));

  return NextResponse.json({
    schema: {
      ok: schema.ok,
      appliedAt: schema.appliedAt ?? null,
      error: schema.error ?? null,
      migration: 'supabase/migrations/20261028_ticketing_integrity.sql',
    },
    // Only ever whether a secret is set, never any part of its value.
    webhookSecret: {
      ok: !!process.env.RAZORPAY_WEBHOOK_SECRET,
      why: 'Without it every Razorpay webhook is rejected, so a buyer who closes their tab is only fulfilled by the slower status poll or the daily reconcile.',
    },
    cronSecret: {
      ok: !!process.env.CRON_SECRET,
      why: 'Without it the nightly reconcile cannot authenticate and only runs when an admin presses the button.',
    },
    qrSigning: {
      ok: !!(process.env.TICKET_QR_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY),
      unsignedRefused: process.env.TICKET_QR_UNSIGNED_OK !== 'true',
      why: 'Pass QR codes are signed, and an unsigned code is refused at the gate.',
    },
  });
}
