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

/**
 * How the next-phase warning is painted: its colour, how hard it glows, and how it blinks.
 *
 * Named options rather than free input. An admin picking a hex code can land on something that
 * disappears against the black card, and a free blink rate can be set fast enough to be a
 * genuine accessibility problem - anything above about 3Hz is a seizure risk. Every option here
 * is legible on black and the quickest of them is a little over 1Hz.
 *
 * The values are handed to CSS as custom properties (see alertCssVars) so one rule in
 * globals.css paints both the live banner and the preview in the box office. A preview that
 * builds the look a second way is a preview that eventually lies.
 */

export const ALERT_COLOURS = {
  red:   { label: 'Red',   text: '#ff3b3b', glow: '255, 0, 0' },
  amber: { label: 'Amber', text: '#ffb020', glow: '255, 149, 0' },
  gold:  { label: 'Gold',  text: '#ffd84d', glow: '255, 196, 0' },
  green: { label: 'Green', text: '#39d98a', glow: '0, 214, 110' },
  cyan:  { label: 'Cyan',  text: '#3ad8ff', glow: '0, 183, 255' },
  pink:  { label: 'Pink',  text: '#ff5ec4', glow: '255, 0, 150' },
  white: { label: 'White', text: '#ffffff', glow: '255, 255, 255' },
} as const;

export type AlertColour = keyof typeof ALERT_COLOURS;

/**
 * Blink rates, in seconds for a full cycle.
 *
 * `steady` is the default and is the one that reads as "look at me" without being a strobe.
 * Even `fast` is one cycle a second, nowhere near the 3Hz flash threshold.
 */
export const ALERT_SPEEDS = {
  off:    { label: 'No blink', seconds: 0 },
  slow:   { label: 'Slow',     seconds: 2.4 },
  steady: { label: 'Steady',   seconds: 1.5 },
  fast:   { label: 'Fast',     seconds: 0.9 },
} as const;

export type AlertSpeed = keyof typeof ALERT_SPEEDS;

/** How hard it glows, and how far the blink dips. Never to zero: it stays readable mid-blink. */
export const ALERT_INTENSITIES = {
  soft:   { label: 'Soft',   glow: 0.6, dim: 0.6 },
  normal: { label: 'Normal', glow: 1,   dim: 0.4 },
  strong: { label: 'Strong', glow: 1.7, dim: 0.22 },
} as const;

export type AlertIntensity = keyof typeof ALERT_INTENSITIES;

export interface PhaseAlertStyle {
  colour: AlertColour;
  speed: AlertSpeed;
  intensity: AlertIntensity;
}

/** What an event with nothing chosen looks like: the red steady blink shipped before this. */
export const DEFAULT_ALERT_STYLE: PhaseAlertStyle = { colour: 'red', speed: 'steady', intensity: 'normal' };

const pick = <T extends string>(raw: unknown, allowed: Record<string, unknown>, fallback: T): T => {
  const key = String(raw ?? '').trim().toLowerCase();
  return (Object.prototype.hasOwnProperty.call(allowed, key) ? key : fallback) as T;
};

/**
 * The style an event has chosen, with anything unrecognised falling back to the default.
 *
 * Never throws and never returns a partial object: this drives a banner on the page where
 * tickets are sold, and a half-read style would paint an invisible warning rather than no
 * warning at all - which is the worse of the two failures.
 */
export function phaseAlertStyle(raw: unknown): PhaseAlertStyle {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    colour: pick(value.colour ?? value.color, ALERT_COLOURS, DEFAULT_ALERT_STYLE.colour),
    speed: pick(value.speed, ALERT_SPEEDS, DEFAULT_ALERT_STYLE.speed),
    intensity: pick(value.intensity, ALERT_INTENSITIES, DEFAULT_ALERT_STYLE.intensity),
  };
}

/** The custom properties globals.css reads. Spread onto the element's `style`. */
export function alertCssVars(style: PhaseAlertStyle): Record<string, string> {
  const colour = ALERT_COLOURS[style.colour];
  const speed = ALERT_SPEEDS[style.speed];
  const intensity = ALERT_INTENSITIES[style.intensity];
  return {
    '--pa-text': colour.text,
    '--pa-glow-rgb': colour.glow,
    '--pa-glow': String(intensity.glow),
    '--pa-dim': String(intensity.dim),
    '--pa-speed': `${speed.seconds}s`,
    // `none` rather than a zero duration: a zero-duration animation still applies its first
    // keyframe, which would leave the text stuck at the dimmed opacity.
    '--pa-anim': speed.seconds > 0 ? 'phase-alert-blink' : 'none',
  };
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
