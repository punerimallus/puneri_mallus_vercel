// An event's own description, as the bullets it is written as.
//
// Admins type these into one textarea, separating points with a hyphen:
//
//   - Tournament: Mallu Premier League 2026 - Dates: 25-26 July 2026 - Fee: Rs. 5000
//
// Three screens render that list - the events page, the event card and the booking page - and
// each one had its own copy of the split. This is that split, once, so a change to how the
// text is read cannot apply to two of the three.
//
// The hyphen is a blunt separator and it will cut a hyphenated word in half. That behaviour is
// deliberately preserved rather than improved: every event already in the database was written
// against it, and making the rule cleverer here would silently re-flow descriptions that read
// correctly today.

/** Most points printed on a pass. Beyond this the "good to know" box runs into the footer. */
export const MAX_TICKET_NOTES = 4;

/** Longest point printed on a pass, before it is cut short. */
export const MAX_TICKET_NOTE_LENGTH = 150;

/**
 * The event's own points, as they go onto the printed pass.
 *
 * The standing rules on a ticket are the same for every show. What differs is the thing
 * somebody actually needs on the night - when the doors open, what the entry policy is - and
 * that only exists in the description the admin wrote. So it is carried onto the pass.
 *
 * Capped on both counts because this is free text landing in a fixed-height box on an A4 page:
 * an admin writing ten points, or one very long one, must not be able to push the box into the
 * footer. The PDF clamps again when it lays the box out; this is the cheap first cut.
 */
export function ticketNotes(raw: unknown): string[] {
  return descriptionBullets(raw)
    .slice(0, MAX_TICKET_NOTES)
    .map((point) =>
      point.length > MAX_TICKET_NOTE_LENGTH
        ? `${point.slice(0, MAX_TICKET_NOTE_LENGTH - 1).trimEnd()}…`
        : point,
    );
}

/** The non-empty, trimmed points of a description, in order. */
export function descriptionBullets(raw: unknown): string[] {
  if (raw === null || raw === undefined) return [];
  return String(raw)
    .split('-')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}
