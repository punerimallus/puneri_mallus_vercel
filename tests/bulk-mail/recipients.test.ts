import { describe, it, expect } from 'vitest';
import { parseRecipients, isPlaceholderEmail } from '@/lib/bulk-mail/recipients';

describe('parseRecipients', () => {
  it('reads one address per line, lower-cases and de-duplicates', () => {
    const r = parseRecipients('A@x.com\nb@y.org\na@X.com\n');
    expect(r.valid.map((v) => v.email)).toEqual(['a@x.com', 'b@y.org']);
    expect(r.duplicates).toBe(1);
    expect(r.invalid).toEqual([]);
  });

  it('understands names in the common formats', () => {
    const r = parseRecipients('Asha <asha@x.com>\nbob@x.com, Bob Kumar\nCara, cara@x.com\n"Dev, Jr" <dev@x.com>');
    expect(r.valid).toEqual([
      { email: 'asha@x.com', name: 'Asha' },
      { email: 'bob@x.com', name: 'Bob Kumar' },
      { email: 'cara@x.com', name: 'Cara' },
      { email: 'dev@x.com', name: 'Dev, Jr' },
    ]);
  });

  it('splits several addresses on one line and skips a CSV header row', () => {
    const r = parseRecipients('email,name\na@x.com; b@x.com, c@x.com');
    expect(r.valid.map((v) => v.email)).toEqual(['a@x.com', 'b@x.com', 'c@x.com']);
  });

  it('reports invalid lines instead of dropping them silently', () => {
    const r = parseRecipients('not-an-email\nfoo@bar\nok@x.com\n@x.com');
    expect(r.valid.map((v) => v.email)).toEqual(['ok@x.com']);
    expect(r.invalid).toEqual(['not-an-email', 'foo@bar', '@x.com']);
  });

  it('strips characters that could break a header or HTML from names', () => {
    const r = parseRecipients('a@x.com, <script>Bob');
    expect(r.valid[0].name).not.toMatch(/[<>"]/);
  });

  it('rejects the phone-login placeholder addresses, which would only bounce', () => {
    expect(isPlaceholderEmail('919876543210@punerimallus.com')).toBe(true);
    expect(isPlaceholderEmail('+919876543210@PunEriMallus.com')).toBe(true);
    expect(isPlaceholderEmail('hello@punerimallus.com')).toBe(false);
    expect(isPlaceholderEmail('919876543210@gmail.com')).toBe(false);
    const r = parseRecipients('919876543210@punerimallus.com\nreal@x.com');
    expect(r.valid.map((v) => v.email)).toEqual(['real@x.com']);
    expect(r.invalid).toEqual(['919876543210@punerimallus.com']);
  });
});
