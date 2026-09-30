// Pure helpers (safe to import from client components).

export interface Recipient {
  email: string;
  name: string;
}

export interface ParsedRecipients {
  valid: Recipient[];
  invalid: string[];
  duplicates: number;
}

const EMAIL_RE = /^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i;

export const isValidEmail = (value: string): boolean => value.length <= 254 && EMAIL_RE.test(value);

/**
 * Phone-login users are given a placeholder address like 919876543210@punerimallus.com (see GlobalEntryGate).
 * Nobody reads it, so mailing it only produces bounces that hurt the domain's reputation.
 */
export const isPlaceholderEmail = (value: string): boolean => /^\+?\d{6,}@punerimallus\.com$/i.test(value.trim());

/**
 * Accepts whatever an admin pastes or uploads: one address per line, or separated by
 * commas, semicolons or tabs. Names are optional:
 *   a@x.com
 *   Asha <a@x.com>
 *   a@x.com, Asha          (CSV: email first, name second)
 *   Asha, a@x.com          (CSV: name first, email second)
 * Addresses are lower-cased and de-duplicated; the first name seen for an address wins.
 */
export function parseRecipients(raw: string): ParsedRecipients {
  const valid: Recipient[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  let duplicates = 0;

  const lines = raw.replace(/\r/g, '\n').split('\n');
  for (let line of lines) {
    line = line.trim();
    if (!line || /^(e-?mail|email address)\b/i.test(line)) continue; // blank line or CSV header row

    const angle = line.match(/^"?([^"<]*?)"?\s*<([^>]+)>$/);
    let email = '';
    let name = '';
    let extras: string[] = [];
    if (angle) {
      name = angle[1].trim();
      email = angle[2].trim();
    } else {
      const cells = line.split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, '')).filter(Boolean);
      const idx = cells.findIndex((c) => c.includes('@'));
      if (idx === -1) {
        invalid.push(line);
        continue;
      }
      email = cells[idx];
      name = cells.find((_, i) => i !== idx && !_.includes('@')) || '';
      // A line with several addresses and no names ("a@x.com, b@y.com") is several recipients.
      extras = cells.filter((c, i) => i !== idx && c.includes('@'));
    }
    add(email, name);
    for (const extra of extras) add(extra, '');
  }

  function add(rawEmail: string, rawName: string) {
    const email = rawEmail.trim().toLowerCase();
    if (!isValidEmail(email) || isPlaceholderEmail(email)) {
      invalid.push(rawEmail.trim());
      return;
    }
    if (seen.has(email)) {
      duplicates++;
      return;
    }
    seen.add(email);
    valid.push({ email, name: rawName.replace(/[<>"]/g, '').trim().slice(0, 80) });
  }

  return { valid, invalid, duplicates };
}

/** Re-validates a list sent by the browser: drops bad or placeholder addresses and duplicates. */
export function normalizeRecipients(list: unknown): Recipient[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: Recipient[] = [];
  for (const item of list) {
    const email = String((item as Recipient)?.email ?? '').trim().toLowerCase();
    if (!isValidEmail(email) || isPlaceholderEmail(email) || seen.has(email)) continue;
    seen.add(email);
    out.push({ email, name: String((item as Recipient)?.name ?? '').replace(/[<>"]/g, '').trim().slice(0, 80) });
  }
  return out;
}
