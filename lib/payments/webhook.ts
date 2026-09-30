import { applyRefund, FulfilmentDeps, markOrderFailed } from './fulfil';

export interface RazorpayWebhookEvent {
  event: string;
  payload: {
    payment?: { entity: { id: string; order_id: string; status: string; amount: number; amount_refunded?: number; error_description?: string } };
    order?: { entity: { id: string } };
    refund?: { entity: { id: string; payment_id: string; amount: number } };
  };
}

export interface WebhookDeps extends FulfilmentDeps {
  fulfil(orderId: string, paymentId: string | null): Promise<{ outcome: string }>;
}

export interface WebhookResult {
  handled: boolean;
  outcome?: string;
  orderId: string | null;
  paymentId: string | null;
}

export async function handleWebhookEvent(event: RazorpayWebhookEvent, deps: WebhookDeps): Promise<WebhookResult> {
  const payment = event.payload?.payment?.entity;
  const orderId = payment?.order_id || event.payload?.order?.entity?.id || null;
  const paymentId = payment?.id || event.payload?.refund?.entity?.payment_id || null;

  switch (event.event) {
    case 'payment.authorized':
    case 'payment.captured':
    case 'order.paid': {
      if (!orderId) return { handled: false, orderId, paymentId };
      const res = await deps.fulfil(orderId, paymentId);
      return { handled: true, outcome: res.outcome, orderId, paymentId };
    }
    case 'payment.failed': {
      if (orderId) await markOrderFailed(orderId, paymentId, payment?.error_description || 'Payment failed', deps);
      return { handled: true, outcome: 'FAILED', orderId, paymentId };
    }
    case 'refund.processed': {
      const refund = event.payload?.refund?.entity;
      if (!refund) return { handled: false, orderId, paymentId };
      // payment.amount_refunded is the running total across partial refunds, when Razorpay includes it.
      const total = payment?.amount_refunded ?? refund.amount;
      const order = await applyRefund(refund.payment_id, total, deps);
      return { handled: !!order, outcome: 'REFUNDED', orderId: order?.razorpay_order_id ?? orderId, paymentId: refund.payment_id };
    }
    default:
      return { handled: false, orderId, paymentId };
  }
}
