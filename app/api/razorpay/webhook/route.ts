import { NextResponse, after } from 'next/server';
import { isValidWebhookSignature } from '@/lib/payments/signature';
import { handleWebhookEvent, RazorpayWebhookEvent } from '@/lib/payments/webhook';
import { fulfilAndDeliver, fulfilmentDeps, supabaseAdmin } from '@/lib/payments/server';

// Razorpay -> server notification. This is what guarantees fulfilment when the
// buyer closes the tab, loses network, or the browser handler fails.
// Configure in Razorpay Dashboard > Settings > Webhooks:
//   URL:     https://<your-domain>/api/razorpay/webhook
//   Secret:  same value as RAZORPAY_WEBHOOK_SECRET
//   Events:  payment.authorized, payment.captured, payment.failed, order.paid, refund.processed
export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get('x-razorpay-signature');

  if (!isValidWebhookSignature(rawBody, signature, process.env.RAZORPAY_WEBHOOK_SECRET || '')) {
    console.warn('[payments] webhook rejected: bad signature');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  let event: RazorpayWebhookEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const eventId = req.headers.get('x-razorpay-event-id') || '';
  const db = supabaseAdmin();

  if (eventId) {
    const { data: seen } = await db.from('payment_webhook_events').select('event_id').eq('event_id', eventId).maybeSingle();
    if (seen) return NextResponse.json({ ok: true, duplicate: true });
  }

  try {
    const result = await handleWebhookEvent(event, {
      ...fulfilmentDeps,
      fulfil: (orderId, paymentId) => fulfilAndDeliver(orderId, paymentId, 'WEBHOOK', { defer: after }),
    });

    if (eventId) {
      // Recorded only after success, so a failed attempt is retried by Razorpay.
      await db.from('payment_webhook_events').upsert(
        {
          event_id: eventId,
          event_type: event.event,
          order_id: result.orderId,
          payment_id: result.paymentId,
          payload: event,
        },
        { onConflict: 'event_id', ignoreDuplicates: true },
      );
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error('[payments] webhook processing failed', event.event, e);
    // 5xx makes Razorpay retry with backoff; the reconcile job is the final safety net.
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
}
