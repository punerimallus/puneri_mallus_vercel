import crypto from 'crypto';

function safeEqualHex(expected: string, received: unknown): boolean {
  if (typeof received !== 'string' || received.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

/** Signature Razorpay Checkout hands to the browser after a successful payment. */
export function isValidCheckoutSignature(
  orderId: unknown,
  paymentId: unknown,
  signature: unknown,
  secret: string,
): boolean {
  if (typeof orderId !== 'string' || typeof paymentId !== 'string' || !orderId || !paymentId || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
  return safeEqualHex(expected, signature);
}

/** X-Razorpay-Signature on webhooks: HMAC-SHA256 of the raw request body with the webhook secret. */
export function isValidWebhookSignature(rawBody: string, signature: unknown, secret: string): boolean {
  if (!secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqualHex(expected, signature);
}
