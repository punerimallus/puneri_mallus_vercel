// How to reach a human about a ticket.
//
// One definition, because the same number has to appear on the booking page, on the printed
// pass and in the PDF receipt — and a pass that is already in somebody's inbox cannot be
// corrected. A number that is right on the website and stale on the ticket is worse than no
// number at all: it is the ticket people have in their hand at the gate.

/** Digits only, international, for tel: and wa.me links. */
export const SUPPORT_PHONE_E164 = '919175981863';

/** How it is printed, in the grouping Indian numbers are normally read in. */
export const SUPPORT_PHONE = '+91 91759 81863';

export const SUPPORT_EMAIL = 'hello@punerimallus.com';

export const SUPPORT_TEL_HREF = `tel:+${SUPPORT_PHONE_E164}`;
export const SUPPORT_WHATSAPP_HREF = `https://wa.me/${SUPPORT_PHONE_E164}`;

/**
 * VIP and bulk passes are not sold through the box office: they are arranged by hand, because
 * they usually come with seating, timing or invoicing that a checkout cannot ask about. Said
 * plainly on the pass list so nobody concludes we have none.
 */
export const VIP_ENQUIRY = {
  title: 'Looking for VIP or bulk passes?',
  body: `Those are arranged personally. Call or WhatsApp ${SUPPORT_PHONE} and we will sort it out.`,
} as const;

/** Shown on the terms screen, where someone stuck has not yet reached anything else. */
export const HELP_NOTE = {
  title: 'Something not working?',
  body: 'Tell us on the contact page and we will come back to you.',
} as const;

/** The single line the PDF prints in its footer. Kept short: it has to fit one line on A4. */
export const PDF_SUPPORT_LINE = `Questions?  ${SUPPORT_PHONE}   |   ${SUPPORT_EMAIL}   |   punerimallus.com`;
