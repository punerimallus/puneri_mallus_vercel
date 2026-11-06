// Phased ticket sales: the headline an admin puts above the box office, and the scheduled
// moment an event becomes bookable at all.
//
// Both live on the MongoDB event document because that is what /api/events reads, and the
// public listing has to be able to hide a not-yet-live event without a second database round
// trip on every page load.

/** Longest headline that still fits the banner on a phone without wrapping to three lines. */
export const MAX_HEADLINE = 60;

/**
 * The "buy now, it only gets dearer" notice, shown once the buyer is choosing passes.
 *
 * Deliberately a flat statement of how the pricing works rather than a countdown: we cannot
 * promise when the next phase starts, and a timer that is wrong is worse than no timer.
 */
export const PHASE_NOTICE = {
  title: 'Prices only go up from here',
  body: 'We release tickets in phases. Every new phase costs at least 15% more than this one — so today is the cheapest these passes will ever be. Book now and pay the lowest price.',
} as const;

/**
 * The next-phase warning, shown large and glowing above the box office on every step.
 *
 * Separate from the headline on purpose. The headline says which phase is ON ("Phase 1 is
 * live") and is small, factual chrome. This says what is ABOUT to change ("Phase 2 starts in
 * 48 hours") - the one thing on the screen that costs the buyer money if they ignore it - so
 * it is given its own line, its own size and its own colour.
 *
 * Longer than the headline because it is a sentence rather than a label, but still capped: at
 * this size, more than about eighty characters wraps to four lines on a 390px phone and stops
 * reading as an alert.
 */
export const MAX_PHASE_ALERT = 80;

/** Starting points an admin can tap rather than type. The number is theirs to fill in. */
export const PHASE_ALERT_IDEAS: readonly string[] = [
  'Phase 2 starts in 48 hours',
  'Phase 2 starts tomorrow — prices up 15%',
  'Early bird ends tonight',
  'Last few at this price',
];

/** What the admin typed for the next-phase warning, tidied, or null when there is none. */
export function phaseAlert(raw: unknown): string | null {
  const clean = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_PHASE_ALERT);
  return clean || null;
}

/** The headline an admin typed, tidied, or null when they have not set one. */
export function saleHeadline(raw: unknown): string | null {
  const clean = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_HEADLINE);
  return clean || null;
}

/**
 * When the event should appear on the site, as an ISO string, or null for "right away".
 *
 * Anything unreadable becomes null rather than throwing: a corrupt value must never be able to
 * hide a live event from the people trying to buy tickets for it.
 */
export function goLiveAt(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const d = raw instanceof Date ? raw : new Date(String(raw));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Is this event's sale open to the public yet? No schedule set means yes. */
export function isSaleLive(raw: unknown, now: Date = new Date()): boolean {
  const at = goLiveAt(raw);
  return at === null || new Date(at).getTime() <= now.getTime();
}

/**
 * The value a <input type="datetime-local"> wants, in IST.
 *
 * The browser's own timezone is deliberately not used: the admin scheduling this is in Pune
 * and the event is in Pune, so a laptop still set to another timezone would otherwise show —
 * and save — the wrong hour.
 */
const IST_OFFSET_MS = 330 * 60_000;

export function toLocalInput(iso: string | null | undefined): string {
  const at = goLiveAt(iso);
  if (!at) return '';
  return new Date(new Date(at).getTime() + IST_OFFSET_MS).toISOString().slice(0, 16);
}

/** The reverse: what the datetime-local field holds, read as an IST wall-clock time. */
export function fromLocalInput(value: string): string | null {
  const v = (value || '').trim();
  if (!v) return null;
  const ms = Date.parse(`${v}:00.000Z`);
  return Number.isNaN(ms) ? null : new Date(ms - IST_OFFSET_MS).toISOString();
}

/** How an admin sees the schedule: "Live now", or when it opens. */
export function scheduleLabel(raw: unknown, now: Date = new Date()): string {
  const at = goLiveAt(raw);
  if (!at) return 'On sale now';
  const d = new Date(at);
  const when = d.toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
    timeZone: 'Asia/Kolkata',
  });
  return d.getTime() <= now.getTime() ? `On sale since ${when}` : `Goes live ${when}`;
}
