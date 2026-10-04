// Shared by the admin event form, the events page and the API, so the button text and the
// "where does this event send people" rule are decided in one place.

export const DEFAULT_CTA = 'Register Now';
export const CTA_PRESETS = ['Register Now', 'Book Now', 'Get Tickets', 'Buy Tickets', 'RSVP', 'Join Now'];
export const CTA_MAX_LENGTH = 24;

/** The button text for an event: what the admin typed, or "Register Now" when blank. */
export function ctaLabel(label?: string | null): string {
  const clean = (label || '').replace(/\s+/g, ' ').trim().slice(0, CTA_MAX_LENGTH);
  return clean || DEFAULT_CTA;
}

/** Events booked through our own box office store the marker "INTERNAL" as their ticket URL. */
export function isInternalTicketing(ticketUrl?: string | null): boolean {
  return (ticketUrl || '').toUpperCase().includes('INTERNAL');
}

/** Where clicking an event card or its button should go, and whether it leaves the site. */
export function eventTarget(event: { _id: string; ticketUrl?: string | null }): { href: string; external: boolean } | null {
  if (isInternalTicketing(event.ticketUrl)) return { href: `/events/${event._id}/book`, external: false };
  const url = (event.ticketUrl || '').trim();
  return url ? { href: url, external: true } : null;
}
