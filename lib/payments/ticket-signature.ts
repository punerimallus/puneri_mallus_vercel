// Signed pass QR codes.
//
// A QR code used to say nothing more than "booking X, pass Y". The booking id is a UUID, so it
// was not guessable, but it was the only secret: anyone who learned one — a forwarded PDF, a
// screenshot, a shoulder-glance at an admin screen — could write a working QR for any pass
// number in that booking. A short HMAC binds the pair to a key only the server holds, so a
// hand-made QR is rejected at the gate.
//
// Signing landed before ticket sales opened, so an unsigned code is never a real pass and the
// gate refuses it outright.

import crypto from 'crypto';

/** Long enough that guessing is hopeless, short enough to keep the QR easy to scan. */
const SIG_LENGTH = 16;

function secret(): string {
  // A dedicated key if one is configured; otherwise one derived from a server-only secret that
  // is always present, so signing never silently turns itself off for want of configuration.
  const explicit = process.env.TICKET_QR_SECRET;
  if (explicit) return explicit;
  const base = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.RAZORPAY_KEY_SECRET;
  if (!base) throw new Error('Cannot sign ticket QR codes: set TICKET_QR_SECRET');
  return crypto.createHmac('sha256', base).update('puneri-mallus/ticket-qr/v1').digest('hex');
}

/** The signature carried in a pass QR code. */
export function signTicket(bookingId: string, ticketNumber: string): string {
  return crypto
    .createHmac('sha256', secret())
    .update(`${bookingId}|${ticketNumber}`)
    .digest('hex')
    .slice(0, SIG_LENGTH);
}

export type SignatureVerdict = 'VALID' | 'INVALID' | 'UNSIGNED';

/**
 * Are unsigned passes still allowed through the gate?
 *
 * They are not, by default. Signing landed before ticket sales opened, so no unsigned pass was
 * ever in circulation and accepting one would only ever mean accepting a forgery — a hand-made
 * QR with the `sig` left off would otherwise sail through the legacy path.
 *
 * TICKET_QR_UNSIGNED_OK=true re-opens it, which is only useful if passes somehow get issued
 * without a signing key configured.
 */
export function unsignedPassesAllowed(): boolean {
  return process.env.TICKET_QR_UNSIGNED_OK === 'true';
}

/** Whether a scanned code really came from us. */
export function verifyTicketSignature(bookingId: string, ticketNumber: string, signature: unknown): SignatureVerdict {
  if (signature === undefined || signature === null || signature === '') return 'UNSIGNED';
  if (typeof signature !== 'string') return 'INVALID';

  const expected = signTicket(bookingId, ticketNumber);
  if (signature.length !== expected.length) return 'INVALID';
  const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  return ok ? 'VALID' : 'INVALID';
}

