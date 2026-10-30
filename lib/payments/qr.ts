// Reading a pass out of a scanned QR code.
//
// The camera hands back whatever text it saw. That text is untrusted — anyone can print a QR —
// so this does nothing but pull three fields out of it in a shape the gate API can check. The
// signature is verified on the server, never here; a QR that parses is not a QR that is valid.
//
// Kept free of any browser or server API so every odd thing a camera can read is testable.

export interface ScannedPass {
  bookingId: string;
  ticketNumber: string;
  /** Absent on passes printed before QR codes were signed. The server decides what to do then. */
  sig?: string;
}

/** Mirrors buildScanUrl in format.ts: /gate?bid=...&tno=...&sig=... */
const PATH = '/gate';
const MAX_FIELD = 128;

const clean = (value: string | null): string => String(value ?? '').trim();

const usable = (value: string): boolean => value.length > 0 && value.length <= MAX_FIELD;

/**
 * Turns a scanned string into a pass, or null if it is not one of ours.
 *
 * Accepts the full link a pass QR carries, and also a bare path or query, because some scanners
 * and some printed passes drop the origin. Anything else — a Wi-Fi QR, a UPI code, a random
 * website, a rival ticket — returns null so the scanner can say "not a Puneri Mallus pass"
 * rather than firing a pointless request at the gate API.
 */
export function parseScannedPass(raw: string): ScannedPass | null {
  const text = clean(raw);
  if (!text || text.length > 2048) return null;

  let params: URLSearchParams;
  try {
    if (/^https?:\/\//i.test(text)) {
      const url = new URL(text);
      // The path must be ours. The HOST deliberately is not checked.
      //
      // It would look safer to pin the host, but it buys nothing and costs something real. The
      // control that stops a forged pass is the HMAC the server checks: a QR naming another
      // host still has to carry a signature made with our secret, and anyone holding one of
      // those could simply use the real address instead. Meanwhile passes are printed with
      // whatever base URL was configured at the time, so pinning would refuse genuine passes
      // issued under an older domain — a real failure at the gate, traded for no gain.
      if (url.pathname.replace(/\/+$/, '').toLowerCase() !== PATH) return null;
      params = url.searchParams;
    } else if (text.startsWith(`${PATH}?`) || text.startsWith(`${PATH}/?`)) {
      params = new URL(text, 'https://punerimallus.com').searchParams;
    } else if (text.startsWith('?')) {
      params = new URLSearchParams(text.slice(1));
    } else {
      return null;
    }
  } catch {
    return null;
  }

  const bookingId = clean(params.get('bid'));
  const ticketNumber = clean(params.get('tno'));
  if (!usable(bookingId) || !usable(ticketNumber)) return null;

  const sig = clean(params.get('sig'));
  return { bookingId, ticketNumber, ...(usable(sig) ? { sig } : {}) };
}

/** Identifies one pass, for spotting the same QR being held in front of the camera. */
export const passKey = (p: ScannedPass): string => `${p.bookingId}|${p.ticketNumber}`;

/** How long the scanner ignores a QR it has just read, so one pass is not scanned ten times. */
export const RESCAN_COOLDOWN_MS = 3000;

/**
 * Should this scan be acted on, or is it the same pass still sitting in front of the lens?
 *
 * The camera reads 10+ frames a second and a pass stays in view for a second or two, so without
 * this every pass would fire a burst of identical requests and trip the gate's rate limiter.
 */
export function shouldHandleScan(
  pass: ScannedPass,
  lastKey: string | null,
  lastAt: number | null,
  now: number = Date.now(),
): boolean {
  if (lastKey !== passKey(pass)) return true;
  if (lastAt === null) return true;
  return now - lastAt >= RESCAN_COOLDOWN_MS;
}
