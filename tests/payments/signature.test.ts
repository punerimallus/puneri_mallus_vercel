import crypto from 'crypto';
import { describe, expect, it } from 'vitest';
import { isValidCheckoutSignature, isValidWebhookSignature } from '@/lib/payments/signature';

const secret = 'test_secret';
const sign = (s: string) => crypto.createHmac('sha256', secret).update(s).digest('hex');

describe('checkout signature', () => {
  it('accepts a genuine signature', () => {
    expect(isValidCheckoutSignature('order_1', 'pay_1', sign('order_1|pay_1'), secret)).toBe(true);
  });
  it('rejects a signature for a different payment or order', () => {
    expect(isValidCheckoutSignature('order_1', 'pay_2', sign('order_1|pay_1'), secret)).toBe(false);
    expect(isValidCheckoutSignature('order_2', 'pay_1', sign('order_1|pay_1'), secret)).toBe(false);
  });
  it('rejects junk input without throwing', () => {
    expect(isValidCheckoutSignature('order_1', 'pay_1', 'abc', secret)).toBe(false);
    expect(isValidCheckoutSignature('order_1', 'pay_1', undefined, secret)).toBe(false);
    expect(isValidCheckoutSignature(undefined, 'pay_1', sign('undefined|pay_1'), secret)).toBe(false);
    expect(isValidCheckoutSignature('order_1', 'pay_1', sign('order_1|pay_1'), '')).toBe(false);
  });
});

describe('webhook signature', () => {
  const body = JSON.stringify({ event: 'payment.captured' });
  it('accepts the raw body signed with the webhook secret', () => {
    expect(isValidWebhookSignature(body, sign(body), secret)).toBe(true);
  });
  it('rejects a modified body, missing header or unset secret', () => {
    expect(isValidWebhookSignature(body + ' ', sign(body), secret)).toBe(false);
    expect(isValidWebhookSignature(body, null, secret)).toBe(false);
    expect(isValidWebhookSignature(body, sign(body), '')).toBe(false);
  });
});
