import { describe, expect, it } from 'vitest';
import { RESCAN_COOLDOWN_MS, parseScannedPass, passKey, shouldHandleScan } from '@/lib/payments/qr';
import { buildScanUrl } from '@/lib/payments/format';

describe('parseScannedPass', () => {
  it('reads the exact link the pass QR carries', () => {
    // The authority on what a pass QR contains is buildScanUrl, so parse what it builds.
    const url = buildScanUrl('https://punerimallus.com', 'b-123', 'VIP011', 'deadbeef');
    expect(parseScannedPass(url)).toEqual({ bookingId: 'b-123', ticketNumber: 'VIP011', sig: 'deadbeef' });
  });

  it('reads a pass printed before QR codes were signed', () => {
    const url = buildScanUrl('https://punerimallus.com', 'b-123', 'GEN001');
    expect(parseScannedPass(url)).toEqual({ bookingId: 'b-123', ticketNumber: 'GEN001' });
  });

  it('copes with the shapes a scanner or an old pass can produce', () => {
    const want = { bookingId: 'b1', ticketNumber: 'A1' };
    expect(parseScannedPass('https://www.punerimallus.com/gate?bid=b1&tno=A1')).toEqual(want);
    expect(parseScannedPass('http://localhost:3000/gate?bid=b1&tno=A1')).toEqual(want);
    expect(parseScannedPass('/gate?bid=b1&tno=A1')).toEqual(want);
    expect(parseScannedPass('?bid=b1&tno=A1')).toEqual(want);
    expect(parseScannedPass('  https://punerimallus.com/gate?bid=b1&tno=A1  ')).toEqual(want);
    expect(parseScannedPass('https://punerimallus.com/gate/?bid=b1&tno=A1')).toEqual(want);
  });

  it('decodes percent-encoded values', () => {
    expect(parseScannedPass('/gate?bid=b%201&tno=VIP%2F11')).toEqual({ bookingId: 'b 1', ticketNumber: 'VIP/11' });
  });

  it('keeps extra query parameters out of the result', () => {
    expect(parseScannedPass('/gate?bid=b1&tno=A1&utm_source=x')).toEqual({ bookingId: 'b1', ticketNumber: 'A1' });
  });

  // The camera reads whatever is in front of it. None of this should reach the gate API.
  it('refuses anything that is not one of our passes', () => {
    expect(parseScannedPass('https://punerimallus.com/profile?bid=b1&tno=A1')).toBeNull();
    expect(parseScannedPass('WIFI:S=CafeWifi;T=WPA;P=hunter2;;')).toBeNull();
    expect(parseScannedPass('upi://pay?pa=someone@okaxis&am=500')).toBeNull();
    expect(parseScannedPass('https://punerimallus.com/gate')).toBeNull();      // no pass
    expect(parseScannedPass('just some text')).toBeNull();
    expect(parseScannedPass('')).toBeNull();
    expect(parseScannedPass('   ')).toBeNull();
  });

  it('refuses a half-filled pass link', () => {
    expect(parseScannedPass('/gate?bid=b1')).toBeNull();
    expect(parseScannedPass('/gate?tno=A1')).toBeNull();
    expect(parseScannedPass('/gate?bid=&tno=A1')).toBeNull();
    expect(parseScannedPass('/gate?bid=b1&tno=   ')).toBeNull();
  });

  it('refuses absurd input rather than passing it on', () => {
    expect(parseScannedPass(`/gate?bid=${'a'.repeat(200)}&tno=A1`)).toBeNull();
    expect(parseScannedPass(`/gate?bid=b1&tno=${'a'.repeat(200)}`)).toBeNull();
    expect(parseScannedPass(`https://punerimallus.com/gate?bid=b1&tno=A1&x=${'y'.repeat(3000)}`)).toBeNull();
  });

  it('accepts a pass on any host, because the signature is what makes it genuine', () => {
    // Passes carry whatever base URL was configured when they were printed, so pinning the
    // host would refuse real passes issued under an older domain. A QR naming another host
    // still has to carry a signature made with our secret, which the server checks.
    expect(parseScannedPass('https://puneri-mallus.vercel.app/gate?bid=b1&tno=A1')).toEqual({ bookingId: 'b1', ticketNumber: 'A1' });
    expect(parseScannedPass('https://evil.example.com/gate?bid=b1&tno=A1')).toEqual({ bookingId: 'b1', ticketNumber: 'A1' });
  });

  it('ignores a signature that is empty or implausible, leaving the server to decide', () => {
    expect(parseScannedPass('/gate?bid=b1&tno=A1&sig=')).toEqual({ bookingId: 'b1', ticketNumber: 'A1' });
    expect(parseScannedPass(`/gate?bid=b1&tno=A1&sig=${'f'.repeat(200)}`)).toEqual({ bookingId: 'b1', ticketNumber: 'A1' });
  });

  it('never throws on malformed input', () => {
    for (const junk of ['http://', 'https://[', '%%%', '://x', 'gate?bid=b1&tno=A1']) {
      expect(() => parseScannedPass(junk)).not.toThrow();
    }
  });
});

describe('shouldHandleScan', () => {
  const pass = { bookingId: 'b1', ticketNumber: 'A1' };

  it('handles the first scan of anything', () => {
    expect(shouldHandleScan(pass, null, null)).toBe(true);
  });

  it('ignores the same pass still sitting in front of the lens', () => {
    // Without this, a pass held up for two seconds fires ~16 identical requests and trips the
    // gate's rate limiter, which then refuses the NEXT guest.
    const now = 1_000_000;
    expect(shouldHandleScan(pass, passKey(pass), now, now + 100)).toBe(false);
    expect(shouldHandleScan(pass, passKey(pass), now, now + RESCAN_COOLDOWN_MS - 1)).toBe(false);
  });

  it('allows the same pass again once the cooldown is up, for a group arriving in parts', () => {
    const now = 1_000_000;
    expect(shouldHandleScan(pass, passKey(pass), now, now + RESCAN_COOLDOWN_MS)).toBe(true);
  });

  it('never delays a different pass', () => {
    const now = 1_000_000;
    const other = { bookingId: 'b1', ticketNumber: 'A2' };
    expect(shouldHandleScan(other, passKey(pass), now, now + 10)).toBe(true);
    const otherBooking = { bookingId: 'b2', ticketNumber: 'A1' };
    expect(shouldHandleScan(otherBooking, passKey(pass), now, now + 10)).toBe(true);
  });
});

describe('passKey', () => {
  it('identifies one pass, not one booking', () => {
    expect(passKey({ bookingId: 'b1', ticketNumber: 'A1' })).not.toBe(passKey({ bookingId: 'b1', ticketNumber: 'A2' }));
    expect(passKey({ bookingId: 'b1', ticketNumber: 'A1' })).toBe(passKey({ bookingId: 'b1', ticketNumber: 'A1', sig: 'x' }));
  });
});
