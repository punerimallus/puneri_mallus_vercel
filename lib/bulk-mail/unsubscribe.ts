import { createHmac, timingSafeEqual } from 'crypto';

// Signed, stateless unsubscribe tokens: base64url(email) + "." + HMAC. Nothing to look up,
// nothing to guess. Secret lives in EMAIL_UNSUBSCRIBE_SECRET.

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const unb64 = (s: string) => Buffer.from(s, 'base64url').toString('utf8');

const sign = (payload: string, secret: string) => createHmac('sha256', secret).update(payload).digest('base64url');

export function makeUnsubscribeToken(email: string, secret: string): string {
  const payload = b64(email.trim().toLowerCase());
  return `${payload}.${sign(payload, secret)}`;
}

/** Returns the email the token was issued for, or null if it is malformed or tampered with. */
export function readUnsubscribeToken(token: string, secret: string): string | null {
  if (!secret || typeof token !== 'string') return null;
  const [payload, mac, ...rest] = token.split('.');
  if (!payload || !mac || rest.length) return null;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const email = unb64(payload);
  return email.includes('@') ? email : null;
}
