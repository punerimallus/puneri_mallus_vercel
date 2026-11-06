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

/** The non-empty, trimmed points of a description, in order. */
export function descriptionBullets(raw: unknown): string[] {
  if (raw === null || raw === undefined) return [];
  return String(raw)
    .split('-')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}
