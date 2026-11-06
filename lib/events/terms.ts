// The event terms and conditions, in one place.
//
// They are shown twice and must read identically in both: on the gate screen a buyer has to
// accept before the box office opens, and on the PDF that lands in their email. Keeping two
// copies in step by hand is exactly the sort of thing that drifts — and a printed pass that
// contradicts what someone agreed to is the version that loses an argument at the door.

/**
 * Bumped whenever the wording below changes materially. It is stored with the acceptance so
 * "which terms did they actually agree to" has an answer later.
 */
export const TERMS_VERSION = 'v2-2026-11';

/** The age from which a child needs their own ticket. Quoted in TERMS, so change it there too. */
export const CHILD_TICKET_AGE = 8;

export const TERMS: readonly string[] = [
  'Entry permitted only with a valid ticket to be presented at the venue.',
  'Tickets are non-refundable, non-transferable, and cannot be reissued if lost or damaged.',
  'Outside food, beverages, alcohol, or illegal substances & weapons are strictly prohibited inside the venue.',
  'The event organizer reserves the right to deny entry or evict any person behaving inappropriately or violating event rules.',
  'Entry will be subject to security checks and bag inspection.',
  `Children above the age of ${CHILD_TICKET_AGE} need to have a ticket to watch the show.`,
  'The organizer is not responsible for loss, theft, or damage to personal belongings.',
  "Parking at the venue is at the owner's risk.",
  'All attendees must follow venue safety and crowd control instructions.',
] as const;

/** "01.", "02." ... so the screen and the printed page number them the same way. */
export const termsNumber = (index: number): string => String(index + 1).padStart(2, '0') + '.';

/** What we record when someone ticks the box, so an acceptance can be traced to a wording. */
export interface TermsAcceptance {
  version: string;
  acceptedAt: string;
}

export const acceptTerms = (now: Date = new Date()): TermsAcceptance => ({
  version: TERMS_VERSION,
  acceptedAt: now.toISOString(),
});
