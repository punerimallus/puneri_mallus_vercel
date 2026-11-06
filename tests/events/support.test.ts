// The support number, in the one place it is defined.
//
// This is pinned harder than it looks like it deserves. The number is printed into every ticket
// PDF, and a PDF that has already been emailed cannot be corrected — so a wrong or drifted
// number is wrong in people's inboxes permanently, and it is the copy they have in their hand
// at the gate. The failure mode is someone editing the page and not the PDF, or vice versa.

import { describe, expect, it } from 'vitest';
import {
  HELP_NOTE,
  PDF_SUPPORT_LINE,
  SUPPORT_EMAIL,
  SUPPORT_PHONE,
  SUPPORT_PHONE_E164,
  SUPPORT_TEL_HREF,
  SUPPORT_WHATSAPP_HREF,
  VIP_ENQUIRY,
} from '@/lib/events/support';

describe('the support number', () => {
  it('is the number the rest of the site already publishes', () => {
    // app/contact and app/football/closed link to this same number; if one moves they all must.
    expect(SUPPORT_PHONE_E164).toBe('919175981863');
  });

  it('has a printed form that is the same digits as the dialling form', () => {
    // The two are written separately — one for humans, one for tel:/wa.me — and nothing but
    // this stops them drifting apart.
    expect(SUPPORT_PHONE.replace(/\D/g, '')).toBe(SUPPORT_PHONE_E164);
  });

  it('builds links a phone will actually act on', () => {
    expect(SUPPORT_TEL_HREF).toBe('tel:+919175981863');
    expect(SUPPORT_WHATSAPP_HREF).toBe('https://wa.me/919175981863');
    expect(SUPPORT_WHATSAPP_HREF.startsWith('https://')).toBe(true);
  });

  it('uses the address that actually receives mail', () => {
    expect(SUPPORT_EMAIL).toBe('hello@punerimallus.com');
  });
});

describe('the PDF support line', () => {
  it('carries both the number and the email', () => {
    expect(PDF_SUPPORT_LINE).toContain(SUPPORT_PHONE);
    expect(PDF_SUPPORT_LINE).toContain(SUPPORT_EMAIL);
  });

  it('stays short enough for one line of an A4 footer', () => {
    // The footer draws it at 7.5pt from the left margin, with the booking reference right
    // aligned on the same line. Past about 80 characters they collide.
    expect(PDF_SUPPORT_LINE.length).toBeLessThan(80);
  });

  it('is plain ASCII, because the PDF fonts have no glyphs for anything else', () => {
    // A non-breaking space or a typographic dash sneaking in here renders as a black box.
    expect(PDF_SUPPORT_LINE).toMatch(/^[\x20-\x7E]+$/);
  });
});

describe('what the notices say', () => {
  it('tells VIP buyers who to call rather than implying there are none', () => {
    expect(VIP_ENQUIRY.body).toContain(SUPPORT_PHONE);
    expect(VIP_ENQUIRY.title.toLowerCase()).toContain('vip');
  });

  it('points a stuck buyer at the contact page', () => {
    expect(HELP_NOTE.body.toLowerCase()).toContain('contact page');
  });
});
