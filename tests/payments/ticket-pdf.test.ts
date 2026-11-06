import { afterEach, describe, expect, it, vi } from 'vitest';
import QRCode from 'qrcode';
import { buildTicketPdf, generateTicketPdf, TicketPdfInput } from '@/lib/payments/ticket-pdf';
import { TERMS } from '@/lib/events/terms';
import { SUPPORT_EMAIL, SUPPORT_PHONE } from '@/lib/events/support';
import { MAX_TICKET_NOTES } from '@/lib/events/description';

const base: TicketPdfInput = {
  bookingId: '7f3c2a10-5b9e-4c1d-9a6e-2d8f0b1c4e77',
  purchaserEmail: 'asha.nair@example.com',
  event: { title: 'Onam Night 2026', date: 'OCT 18, 2026', time: '6:00 PM', location: 'Balewadi Sports Complex, Baner, Pune' },
  tickets: [
    { categoryName: 'VIP', ticketNumber: 'VIP011', unitPrice: 424.15 },
    { categoryName: 'VIP', ticketNumber: 'VIP012', unitPrice: 424.15 },
  ],
  pointsApplied: 100,
  logoBase64: null,
  baseUrl: 'https://punerimallus.com',
  payment: { orderId: 'order_ABC', paymentId: 'pay_XYZ', totalPaidPaise: 76600, paidAt: '2026-10-01T16:10:00Z' },
};

// jsPDF defines text() per instance, so record draws through a thin subclass.
const drawn: string[] = [];
/** Shapes and images, in the order they are drawn, with the fill colour in force at the time. */
const shapes: { op: string; args: number[]; fill: string }[] = [];
vi.mock('jspdf', async (orig) => {
  const mod: any = await orig();
  const Real = mod.default ?? mod.jsPDF;
  class Recording extends Real {
    constructor(...a: any[]) {
      super(...a);
      const text = this.text.bind(this);
      this.text = (t: any, ...rest: any[]) => {
        (Array.isArray(t) ? t : [t]).forEach((x) => drawn.push(String(x)));
        return text(t, ...rest);
      };

      // Same trick for the shapes, so the header's draw ORDER can be asserted: a panel drawn
      // after the logo would hide it, and that is exactly the mistake worth catching.
      let fill = '';
      const setFillColor = this.setFillColor.bind(this);
      this.setFillColor = (...a: any[]) => {
        fill = a.join(',');
        return setFillColor(...a);
      };
      const roundedRect = this.roundedRect.bind(this);
      this.roundedRect = (...a: any[]) => {
        shapes.push({ op: 'roundedRect', args: a.slice(0, 4).map(Number), fill });
        return roundedRect(...a);
      };
      const addImage = this.addImage.bind(this);
      this.addImage = (...a: any[]) => {
        shapes.push({ op: 'addImage', args: a.filter((x: any) => typeof x === 'number').slice(0, 4).map(Number), fill });
        return addImage(...a);
      };
    }
  }
  return { ...mod, default: Recording, jsPDF: Recording };
});

/** Collects every string the PDF draws, so we can assert on what a customer would read. */
function captureText() {
  drawn.length = 0;
  return { drawn };
}

afterEach(() => { vi.restoreAllMocks(); drawn.length = 0; shapes.length = 0; });

describe('ticket PDF', () => {
  it('has one page per pass, then a receipt, then the terms', async () => {
    const doc = await buildTicketPdf(base);
    expect(doc.getNumberOfPages()).toBe(base.tickets.length + 2);
  });

  it('prints the same terms the buyer accepted at checkout, word for word', async () => {
    // The screen and the pass both render lib/events/terms.ts. If they can ever disagree, the
    // wording somebody actually agreed to is the one that loses an argument at the door.
    const { drawn } = captureText();
    await buildTicketPdf(base);
    // Joined on spaces, not newlines: a long clause is word-wrapped across several draws, and
    // asserting on the unwrapped sentence is the point — it is the wording that must survive.
    const all = drawn.join(' ').replace(/\s+/g, ' ');
    for (const term of TERMS) expect(all).toContain(term);
    expect(all).toContain('TERMS & CONDITIONS');
    // The one clause that differs from the card printed for the venue.
    expect(all).toContain('above the age of 8');
  });

  it('prints a number to ring on every single page', async () => {
    // By the time someone needs it they are usually at a gate with a problem, and the website
    // is not what they have in their hand. One per page, so whichever page they print works.
    const { drawn } = captureText();
    const doc = await buildTicketPdf(base);
    const onEveryPage = drawn.filter((t) => typeof t === 'string' && t.includes(SUPPORT_PHONE));
    expect(onEveryPage.length).toBeGreaterThanOrEqual(doc.getNumberOfPages());
    expect(drawn.join(' ')).toContain(SUPPORT_EMAIL);
  });

  it('numbers the terms page as the last page', async () => {
    const { drawn } = captureText();
    const doc = await buildTicketPdf(base);
    const pages = doc.getNumberOfPages();
    expect(drawn.join('\n')).toContain(`Page ${pages} of ${pages}`);
  });

  it('prints each ticket number, a valid status, and the exact receipt total', async () => {
    const { drawn } = captureText();
    await buildTicketPdf(base);
    const all = drawn.join('\n');
    expect(all).toContain('VIP011');
    expect(all).toContain('VIP012');
    expect(all).toContain('VALID FOR ENTRY');
    expect(all).toContain('Pass 1 of 2');
    expect(all).toContain('Pass 2 of 2');
    expect(all).toContain('RECEIPT');
    expect(all).toContain('Rs. 766.00'); // what Razorpay charged
    expect(all).toContain('Rs. 848.30');
    expect(all).toContain('- Rs. 100.00');
    expect(all).toContain('order_ABC');
    expect(all).toContain('Sun, 18 Oct 2026');
    expect(all).not.toContain('Invalid Date');
  });

  it('encodes exactly the link the gate scanner expects in each pass QR', async () => {
    const qr = vi.spyOn(QRCode, 'toDataURL');
    await buildTicketPdf(base);
    const urls = qr.mock.calls.map((c) => c[0]);
    expect(urls).toEqual([
      'https://punerimallus.com/gate?bid=7f3c2a10-5b9e-4c1d-9a6e-2d8f0b1c4e77&tno=VIP011',
      'https://punerimallus.com/gate?bid=7f3c2a10-5b9e-4c1d-9a6e-2d8f0b1c4e77&tno=VIP012',
    ]);
  });

  it('signs each QR when a signer is supplied, so a hand-made code is refused at the gate', async () => {
    const qr = vi.spyOn(QRCode, 'toDataURL');
    await buildTicketPdf({ ...base, signTicket: (bid, tno) => `sig-${tno.toLowerCase()}` });
    expect(qr.mock.calls.map((c) => c[0])).toEqual([
      'https://punerimallus.com/gate?bid=7f3c2a10-5b9e-4c1d-9a6e-2d8f0b1c4e77&tno=VIP011&sig=sig-vip011',
      'https://punerimallus.com/gate?bid=7f3c2a10-5b9e-4c1d-9a6e-2d8f0b1c4e77&tno=VIP012&sig=sig-vip012',
    ]);
  });

  it('shows a checked-in pass differently from a valid one', async () => {
    const { drawn } = captureText();
    await buildTicketPdf({ ...base, tickets: [{ ...base.tickets[0], status: 'CHECKED_IN' }, base.tickets[1]] });
    const all = drawn.join('\n');
    expect(all).toContain('ALREADY CHECKED IN');
    expect(all).toContain('VALID FOR ENTRY');
  });

  it('still builds without payment details (older bookings) and derives the receipt', async () => {
    const { drawn } = captureText();
    const doc = await buildTicketPdf({ ...base, payment: undefined, pointsApplied: 0 });
    expect(doc.getNumberOfPages()).toBe(base.tickets.length + 2);
    expect(drawn.join('\n')).toContain('TOTAL PAID');
  });

  it('copes with a missing event, an enormous title and non-Latin text without throwing', async () => {
    const huge = 'GRAND ONAM '.repeat(40);
    await expect(buildTicketPdf({ ...base, event: null })).resolves.toBeTruthy();
    await expect(buildTicketPdf({ ...base, event: { title: huge, location: huge, date: 'soon' } })).resolves.toBeTruthy();
    const { drawn } = captureText();
    await buildTicketPdf({ ...base, event: { title: 'Party 🎉 മലയാളം Night', location: 'Pune' } });
    expect(drawn.join('\n')).toContain('PARTY NIGHT');
  });

  it('is small enough to email (images are compressed)', async () => {
    const b64 = await generateTicketPdf({ ...base, tickets: Array.from({ length: 7 }, (_, i) => ({ categoryName: 'VIP', ticketNumber: `VIP0${10 + i}`, unitPrice: 500 })) });
    expect(Buffer.from(b64, 'base64').length).toBeLessThan(400_000);
    expect(Buffer.from(b64, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('fetchLogoBase64', () => {
  it('falls back to the embedded logo when the site cannot be reached or returns an error', async () => {
    const { fetchLogoBase64 } = await import('@/lib/payments/ticket-pdf');
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'));
    expect(await fetchLogoBase64('https://x.test')).toMatch(/^data:image\/png;base64,.{1000,}/);
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('nope', { status: 404 }));
    expect(await fetchLogoBase64('https://x.test')).toMatch(/^data:image\/png;base64,.{1000,}/);
  });
});

describe('the logo sits on a black panel', () => {
  // A 1x1 PNG is enough: the test is about where the logo is placed, not what it looks like.
  const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  /** Shapes drawn since the last reset, in order. */
  function captureHeader() {
    shapes.length = 0;
    return shapes;
  }

  it('draws a black panel before the logo, enclosing it', async () => {
    const calls = captureHeader();
    await buildTicketPdf({ ...base, logoBase64: PIXEL });

    const panel = calls.find((c) => c.op === 'roundedRect' && c.fill === '0,0,0');
    expect(panel, 'a black rounded panel should be drawn').toBeTruthy();

    const logo = calls.find((c) => c.op === 'addImage');
    expect(logo).toBeTruthy();

    // Order matters: a panel drawn after the logo would hide it.
    expect(calls.indexOf(panel!)).toBeLessThan(calls.indexOf(logo!));

    // And it has to actually cover the logo on all four sides.
    const [px, py, pw, ph] = panel!.args;
    const [lx, ly, lw, lh] = logo!.args;
    expect(px).toBeLessThanOrEqual(lx);
    expect(py).toBeLessThanOrEqual(ly);
    expect(px + pw).toBeGreaterThanOrEqual(lx + lw);
    expect(py + ph).toBeGreaterThanOrEqual(ly + lh);
  });

  it('keeps the panel inside the header, clear of the red rule', async () => {
    const calls = captureHeader();
    await buildTicketPdf({ ...base, logoBase64: PIXEL });
    const panel = calls.find((c) => c.op === 'roundedRect' && c.fill === '0,0,0')!;
    const [px, py, , ph] = panel.args;

    expect(px).toBe(16);              // lines up with the page margin, like the title opposite
    expect(py).toBeGreaterThan(0);    // not bleeding off the top
    expect(py + ph).toBeLessThan(40); // the red divider starts at y = 40
  });

  it('draws no panel when there is no logo to put on it', async () => {
    const calls = captureHeader();
    await buildTicketPdf({ ...base, logoBase64: null });
    expect(calls.some((c) => c.op === 'roundedRect' && c.fill === '0,0,0')).toBe(false);
  });
});


describe("the event's own points, on the pass", () => {
  // The standing rules are true of every show. When the doors open is not, and it is the one
  // thing a ticket holder needs on the night, so it has to come off the event itself.
  const JOB_KURIAN =
    '-The date is set, the venue is locked, and the stage is ready.\n- Entry starts at 5.30pm\n '
    + '-Catch @jobkurian live on Saturday, January 9, 2027, at Phoenix Avenue of Stars. '
    + 'Get ready for an unforgettable night of music and vibes! \u{1F3B5}\u{26A1}';

  const withDescription = (description?: string): TicketPdfInput =>
    ({ ...base, event: { ...base.event!, description } });

  const textOf = async (input: TicketPdfInput) => {
    const { drawn } = captureText();
    await buildTicketPdf(input);
    return drawn.join(' ').replace(/\s+/g, ' ');
  };

  it('prints the entry time the admin wrote', async () => {
    expect(await textOf(withDescription(JOB_KURIAN))).toContain('Entry starts at 5.30pm');
  });

  it('prints it on every pass, not just the first', async () => {
    // People print one page and hand the other to a friend.
    const text = await textOf(withDescription('- Entry starts at 5.30pm'));
    expect(text.split('Entry starts at 5.30pm').length - 1).toBe(base.tickets.length);
  });

  it('keeps the standing rules as well', async () => {
    const text = await textOf(withDescription(JOB_KURIAN));
    expect(text).toContain('non-refundable, non-transferable');
    expect(text).toContain('valid Government ID');
  });

  it('numbers the event points after the rules', async () => {
    const text = await textOf(withDescription('- Entry starts at 5.30pm'));
    // One space, not the two that are drawn: textOf collapses runs of whitespace.
    expect(text).toContain('6. Entry starts at 5.30pm');
  });

  it('drops emoji rather than printing boxes', async () => {
    // jsPDF's built-in fonts are Latin-1; anything outside it renders as filled rectangles.
    const text = await textOf(withDescription(JOB_KURIAN));
    expect(text).toContain('unforgettable night of music and vibes!');
    expect(text).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });

  it('changes nothing for an event with no description', async () => {
    const text = await textOf(withDescription(undefined));
    expect(text).toContain('GOOD TO KNOW');
    // The five standing rules and nothing after them. Asserted on the fifth rule's wording
    // rather than on the absence of a '6.', which also matches money and dates elsewhere.
    expect(text).toContain('5. Management reserves the right of admission');
    expect(text).not.toContain('Entry starts at');
  });

  it('survives an admin who writes an essay', async () => {
    // Free text in a fixed-height box on an A4 page: the cap and the clamp both have to hold,
    // or the list runs through the footer and off the bottom of the page.
    const essay = Array.from({ length: 12 }, (_, i) => `Point ${i + 1} ` + 'x'.repeat(300)).join(' - ');
    const doc = await buildTicketPdf(withDescription(essay));
    expect(doc.getNumberOfPages()).toBe(base.tickets.length + 2);
  });

  it('prints at most the few points that fit', async () => {
    const many = Array.from({ length: 9 }, (_, i) => `Note ${i + 1}`).join(' - ');
    const text = await textOf(withDescription(many));
    expect(text).toContain('Note 1');
    expect(text).not.toContain(`Note ${MAX_TICKET_NOTES + 1}`);
  });

  it('keeps the box above the footer rule, however much is written', async () => {
    // The clamp is the only thing standing between a chatty admin and a panel drawn over the
    // booking reference, so it is measured rather than trusted. Every full-width panel in the
    // page body has to finish before the rule the footer draws at y=281.
    const panelsEndBefore = async (description?: string) => {
      shapes.length = 0;
      await buildTicketPdf(withDescription(description));
      const panels = shapes.filter((s) => s.op === 'roundedRect' && s.args[0] === 16 && s.args[2] === 178);
      expect(panels.length).toBeGreaterThan(0);
      return Math.max(...panels.map((s) => s.args[1] + s.args[3]));
    };

    expect(await panelsEndBefore(undefined)).toBeLessThanOrEqual(281);
    const long = Array.from({ length: 4 }, (_, i) => `Point ${i + 1} ` + 'word '.repeat(28)).join(' - ');
    expect(await panelsEndBefore(long)).toBeLessThanOrEqual(281);
    const essay = Array.from({ length: 20 }, (_, i) => `Point ${i + 1} ` + 'x'.repeat(200)).join(' - ');
    expect(await panelsEndBefore(essay)).toBeLessThanOrEqual(281);
  });
});
