import { describe, expect, it, vi } from 'vitest';
import { handleWebhookEvent } from '@/lib/payments/webhook';
import { makeOrder, makeWorld } from './fakes';

function deps() {
  const w = makeWorld([makeOrder({ status: 'FULFILLED', razorpay_payment_id: 'pay_1', booking_id: 'b1' })]);
  w.bookings.set('b1', {
    id: 'b1', status: 'CONFIRMED', event_id: 'evt_1', user_id: 'user_1', email: 'buyer@example.com',
    amount_paid: 1200, razorpay_payment_id: 'pay_1', razorpay_order_id: 'order_1', tickets_data: [],
  });
  const fulfil = vi.fn(async () => ({ outcome: 'FULFILLED' }));
  return { w, d: { ...w.deps, fulfil } };
}

const paymentEntity = { id: 'pay_1', order_id: 'order_1', status: 'captured', amount: 122904 };

describe('handleWebhookEvent', () => {
  it.each(['payment.captured', 'payment.authorized', 'order.paid'])('%s triggers fulfilment', async (event) => {
    const { d } = deps();
    const res = await handleWebhookEvent({ event, payload: { payment: { entity: paymentEntity } } }, d);
    expect(d.fulfil).toHaveBeenCalledWith('order_1', 'pay_1');
    expect(res.handled).toBe(true);
  });

  it('payment.failed does not downgrade an already fulfilled order', async () => {
    const { w, d } = deps();
    await handleWebhookEvent({ event: 'payment.failed', payload: { payment: { entity: { ...paymentEntity, status: 'failed' } } } }, d);
    expect(w.orders.get('order_1')!.status).toBe('FULFILLED');
  });

  it('refund.processed uses the running refunded total', async () => {
    const { w, d } = deps();
    await handleWebhookEvent(
      {
        event: 'refund.processed',
        payload: {
          refund: { entity: { id: 'rfnd_1', payment_id: 'pay_1', amount: 22904 } },
          payment: { entity: { ...paymentEntity, amount_refunded: 122904 } },
        },
      },
      d,
    );
    expect(w.orders.get('order_1')!.status).toBe('REFUNDED');
    expect(w.bookings.get('b1')!.status).toBe('REFUNDED');
  });

  it('ignores unrelated events', async () => {
    const { d } = deps();
    const res = await handleWebhookEvent({ event: 'settlement.processed', payload: {} }, d);
    expect(res.handled).toBe(false);
    expect(d.fulfil).not.toHaveBeenCalled();
  });
});
