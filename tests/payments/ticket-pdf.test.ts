import { afterEach, describe, expect, it, vi } from 'vitest';
import QRCode from 'qrcode';
import { buildTicketPdf, generateTicketPdf, TicketPdfInput } from '@/lib/payments/ticket-pdf';

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
    }
  }
  return { ...mod, default: Recording, jsPDF: Recording };
});

/** Collects every string the PDF draws, so we can assert on what a customer would read. */
function captureText() {
  drawn.length = 0;
  return { drawn };
}

afterEach(() => { vi.restoreAllMocks(); drawn.length = 0; });

describe('ticket PDF', () => {
  it('has one page per pass plus a receipt', async () => {
    const doc = await buildTicketPdf(base);
    expect(doc.getNumberOfPages()).toBe(3);
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
      'https://punerimallus.com/admin/scanner?bid=7f3c2a10-5b9e-4c1d-9a6e-2d8f0b1c4e77&tno=VIP011',
      'https://punerimallus.com/admin/scanner?bid=7f3c2a10-5b9e-4c1d-9a6e-2d8f0b1c4e77&tno=VIP012',
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
    expect(doc.getNumberOfPages()).toBe(3);
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
