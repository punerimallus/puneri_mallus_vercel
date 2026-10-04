import jsPDF from 'jspdf';
import { LOGO_DATA_URI } from './logo-data';
import QRCode from 'qrcode';
import { admitsLabel, groupSizeOf, isGroup } from './groups';
import { buildReceipt, buildScanUrl, formatEventDate, formatEventTime, formatIst, formatRupees, pdfSafe } from './format';

export interface TicketPdfInput {
  bookingId: string;
  purchaserEmail: string;
  event: { title?: string; date?: string; time?: string; location?: string } | null;
  tickets: { categoryName: string; ticketNumber: string; unitPrice: number; status?: 'ISSUED' | 'CHECKED_IN' | 'REFUNDED'; groupSize?: number; admitted?: number }[];
  pointsApplied: number;
  logoBase64: string | null;
  baseUrl: string;
  /** Known payment details make the receipt exact. Optional: without them the receipt is derived from the passes. */
  payment?: { orderId?: string | null; paymentId?: string | null; totalPaidPaise?: number | null; paidAt?: Date | string | null };
}

export async function fetchLogoBase64(baseUrl: string): Promise<string | null> {
  try {
    const logoRes = await fetch(`${baseUrl}/logo_main.png`);
    if (!logoRes.ok) return LOGO_DATA_URI;
    const logoBuffer = await logoRes.arrayBuffer();
    return `data:image/png;base64,${Buffer.from(logoBuffer).toString('base64')}`;
  } catch {
    console.error('Failed to fetch Puneri Mallus logo, using the embedded copy');
    return LOGO_DATA_URI;
  }
}

// ---- layout (millimetres, A4 portrait) ------------------------------------------------------------
const W = 210;
const H = 297;
const M = 16; // page margin
const CW = W - M * 2; // content width

const RED: [number, number, number] = [220, 38, 38];
const INK: [number, number, number] = [17, 24, 39];
const MUTED: [number, number, number] = [107, 114, 128];
const LINE: [number, number, number] = [209, 213, 219];
const PANEL: [number, number, number] = [249, 250, 251];
const GREEN: [number, number, number] = [22, 163, 74];
const AMBER: [number, number, number] = [217, 119, 6];

const RULES = [
  'Please present this e-ticket along with a valid Government ID at the entry gate.',
  'This ticket is non-refundable, non-transferable, and valid for one person only.',
  "Entry gates close 30 minutes prior to the show's commencement.",
  'Any form of outside food, beverages, or hazardous items are strictly prohibited.',
  'Management reserves the right of admission and may conduct security checks.',
];

type Doc = jsPDF;

/** Width of text that is drawn with letter spacing (getTextWidth alone ignores the spacing). */
const spacedWidth = (doc: Doc, text: string, spacing: number) => doc.getTextWidth(text) + text.length * spacing;

const label = (doc: Doc, text: string, x: number, y: number, align: 'left' | 'right' | 'center' = 'left') => {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...MUTED);
  doc.setCharSpace(0.5);
  doc.text(text, x, y, { align });
  doc.setCharSpace(0);
};

function header(doc: Doc, logo: string | null, title: string, subtitle: string) {
  if (logo) {
    // Logo is 552x472; keep its proportions.
    doc.addImage(logo, 'PNG', M, 6, 32, 32 * (472 / 552), 'pm-logo', 'FAST');
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(...INK);
    doc.text('PUNERI', M, 20);
    doc.setTextColor(...RED);
    doc.text('MALLUS', M + doc.getTextWidth('PUNERI '), 20);
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...INK);
  doc.setCharSpace(0.6);
  doc.text(title, W - M, 21, { align: 'right' });
  doc.setCharSpace(0);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(subtitle, W - M, 28, { align: 'right' });
  doc.setFillColor(...RED);
  doc.rect(0, 40, W, 2.2, 'F');
}

function footer(doc: Doc, bookingRef: string, page: number, pages: number) {
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.3);
  doc.line(M, 281, W - M, 281);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  doc.text('Need help?  hello@punerimallus.com   |   punerimallus.com', M, 287);
  doc.text(`Booking ${bookingRef}   |   Page ${page} of ${pages}`, W - M, 287, { align: 'right' });
}

const wrap = (doc: Doc, text: string, width: number, maxLines: number): string[] => {
  const lines: string[] = doc.splitTextToSize(text, width);
  if (lines.length <= maxLines) return lines;
  const cut = lines.slice(0, maxLines);
  cut[maxLines - 1] = cut[maxLines - 1].replace(/\s*\S{0,3}$/, '') + '...';
  return cut;
};

/** Builds the e-ticket PDF: one page per pass, then a payment summary. */
export async function buildTicketPdf(input: TicketPdfInput): Promise<jsPDF> {
  const { bookingId, purchaserEmail, event, tickets, pointsApplied, logoBase64, baseUrl, payment } = input;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const ref = bookingId.split('-')[0].toUpperCase();
  const issued = payment?.paidAt ? formatIst(payment.paidAt) : formatIst(new Date());
  const totalPages = tickets.length + 1;

  const title = pdfSafe(event?.title || 'Puneri Mallus Event').toUpperCase();
  const venue = pdfSafe(event?.location || 'Venue to be announced');
  const dateText = pdfSafe(formatEventDate(event?.date));
  const timeText = pdfSafe(formatEventTime(event?.time));

  for (let index = 0; index < tickets.length; index++) {
    const ticket = tickets[index];
    if (index > 0) doc.addPage();

    header(doc, logoBase64, 'E-TICKET', `Pass ${index + 1} of ${tickets.length}`);

    // Category chip + event title
    const category = pdfSafe(ticket.categoryName).toUpperCase() || 'GENERAL';
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setCharSpace(0.6);
    const chipW = spacedWidth(doc, category, 0.6) + 10;
    doc.setFillColor(...RED);
    doc.roundedRect(M, 51, chipW, 7.5, 3.75, 3.75, 'F');
    doc.setTextColor(255, 255, 255);
    doc.text(category, M + 4.5, 56.2); // left-aligned: centred text drifts with letter-spacing
    doc.setCharSpace(0);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(21);
    doc.setTextColor(...INK);
    const titleLines = wrap(doc, title, CW, 3);
    doc.text(titleLines, M, 69, { lineHeightFactor: 1.2 });
    let y = 69 + titleLines.length * 8.9 + 5;

    // Date / time / admits
    const cols = [M, M + 64, M + 128];
    label(doc, 'DATE', cols[0], y);
    label(doc, 'TIME', cols[1], y);
    label(doc, 'ADMITS', cols[2], y);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...INK);
    doc.text(dateText, cols[0], y + 6.5);
    doc.text(timeText, cols[1], y + 6.5);
    doc.text(admitsLabel(ticket.groupSize), cols[2], y + 6.5);
    y += 16;

    label(doc, 'VENUE', M, y);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...INK);
    const venueLines = wrap(doc, venue, CW, 2);
    doc.text(venueLines, M, y + 6, { lineHeightFactor: 1.25 });
    y += 6 + venueLines.length * 5 + 9;

    // Ticket stub
    const cardH = 66;
    const perfX = M + 118;
    doc.setFillColor(...PANEL);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.4);
    doc.roundedRect(M, y, CW, cardH, 3, 3, 'FD');
    doc.setLineDashPattern([1.6, 1.6], 0);
    doc.line(perfX, y + 4, perfX, y + cardH - 4);
    doc.setLineDashPattern([], 0);
    doc.setFillColor(255, 255, 255);
    doc.circle(perfX, y, 3.4, 'FD');
    doc.circle(perfX, y + cardH, 3.4, 'FD');
    // Hide the card edge inside the notches so they read as cut-outs.
    doc.setDrawColor(255, 255, 255);
    doc.setLineWidth(1);
    doc.line(perfX - 2.4, y + 0.5, perfX + 2.4, y + 0.5);
    doc.line(perfX - 2.4, y + cardH - 0.5, perfX + 2.4, y + cardH - 0.5);

    const lx = M + 8;
    label(doc, 'TICKET NUMBER', lx, y + 11);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(30);
    doc.setTextColor(...INK);
    doc.text(pdfSafe(ticket.ticketNumber), lx, y + 24);

    label(doc, 'BOOKING ID', lx, y + 36);
    label(doc, 'ISSUED TO', lx + 36, y + 36);
    doc.setFont('courier', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...INK);
    doc.text(ref, lx, y + 42);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const holder = wrap(doc, pdfSafe(purchaserEmail), 62, 2);
    doc.text(holder, lx + 36, y + 41.5, { lineHeightFactor: 1.2 });

    const partial = isGroup(ticket.groupSize) && ticket.status !== 'CHECKED_IN' && (ticket.admitted || 0) > 0;
    const status = ticket.status === 'CHECKED_IN'
      ? { text: 'ALREADY CHECKED IN', color: AMBER }
      : partial
        ? { text: `${ticket.admitted} OF ${groupSizeOf(ticket.groupSize)} ADMITTED`, color: AMBER }
        : { text: 'VALID FOR ENTRY', color: GREEN };
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setCharSpace(0.4);
    const badgeW = spacedWidth(doc, status.text, 0.4) + 11.5;
    doc.setFillColor(...status.color);
    doc.roundedRect(lx, y + 52, badgeW, 6.5, 3.25, 3.25, 'F');
    doc.setTextColor(255, 255, 255);
    doc.text(status.text, lx + 5.5, y + 56.3);
    doc.setCharSpace(0);

    // QR
    const scanUrl = buildScanUrl(baseUrl, bookingId, ticket.ticketNumber);
    const qr = await QRCode.toDataURL(scanUrl, { margin: 1, width: 480, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } });
    const qrSize = 46;
    const qrX = perfX + (M + CW - perfX - qrSize) / 2;
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(qrX - 2, y + 6, qrSize + 4, qrSize + 4, 2, 2, 'F');
    doc.addImage(qr, 'PNG', qrX, y + 8, qrSize, qrSize);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...INK);
    doc.setCharSpace(0.5);
    doc.text('SCAN AT ENTRY', qrX + qrSize / 2, y + 58.5, { align: 'center' });
    doc.setCharSpace(0);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(isGroup(ticket.groupSize) ? `One scan admits all ${groupSizeOf(ticket.groupSize)}` : 'One scan, one person', qrX + qrSize / 2, y + 62.5, { align: 'center' });

    y += cardH + 11;

    // Good to know
    const boxH = 12 + RULES.length * 6;
    doc.setFillColor(...PANEL);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.3);
    doc.roundedRect(M, y, CW, boxH, 2.5, 2.5, 'FD');
    label(doc, 'GOOD TO KNOW', M + 6, y + 8);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(55, 65, 81);
    const rules = isGroup(ticket.groupSize)
      ? RULES.map((r, i) => (i === 1 ? `Group ticket: admits ${groupSizeOf(ticket.groupSize)} people together on one scan. Non-refundable, non-transferable.` : r))
      : RULES;
    rules.forEach((rule, i) => doc.text(`${i + 1}.  ${rule}`, M + 6, y + 15 + i * 6));

    footer(doc, ref, index + 1, totalPages);
  }

  // ---- payment summary -------------------------------------------------------------------------------
  doc.addPage();
  header(doc, logoBase64, 'RECEIPT', `Booking ${ref}`);
  const receipt = buildReceipt(tickets, pointsApplied, payment?.totalPaidPaise);

  let y = 56;
  label(doc, 'EVENT', M, y);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...INK);
  const evLines = wrap(doc, title, CW, 2);
  doc.text(evLines, M, y + 7, { lineHeightFactor: 1.2 });
  y += 7 + evLines.length * 6.5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  doc.text(`${dateText}   |   ${timeText}`, M, y + 2);
  const recVenue = wrap(doc, venue, CW, 2);
  doc.text(recVenue, M, y + 8, { lineHeightFactor: 1.25 });
  y += 8 + recVenue.length * 5 + 10;

  // table header
  doc.setFillColor(...INK);
  doc.rect(M, y, CW, 9, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);
  doc.setCharSpace(0.4);
  doc.text('PASS', M + 4, y + 5.9);
  doc.text('QTY', M + 106, y + 5.9, { align: 'center' });
  doc.text('RATE', M + 140, y + 5.9, { align: 'right' });
  doc.text('AMOUNT', M + CW - 4, y + 5.9, { align: 'right' });
  doc.setCharSpace(0);
  y += 9;

  doc.setFontSize(10);
  receipt.lines.forEach((l, i) => {
    if (i % 2 === 1) {
      doc.setFillColor(...PANEL);
      doc.rect(M, y, CW, 9, 'F');
    }
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...INK);
    doc.text(pdfSafe(l.name).toUpperCase(), M + 4, y + 6);
    doc.setFont('helvetica', 'normal');
    doc.text(String(l.qty), M + 106, y + 6, { align: 'center' });
    doc.text(formatRupees(l.unitPrice), M + 140, y + 6, { align: 'right' });
    doc.text(formatRupees(l.amount), M + CW - 4, y + 6, { align: 'right' });
    y += 9;
  });
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.3);
  doc.line(M, y, W - M, y);
  y += 4;

  const row = (text: string, amount: string, color: [number, number, number] = INK) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...MUTED);
    doc.text(text, M + 100, y + 5, { align: 'left' });
    doc.setTextColor(...color);
    doc.text(amount, M + CW - 4, y + 5, { align: 'right' });
    y += 8;
  };
  row('Subtotal', formatRupees(receipt.subtotal));
  if (receipt.pointsApplied > 0) row('Tribe Points applied', `- ${formatRupees(receipt.pointsApplied)}`, GREEN);
  row('Convenience fee (2.36%)', formatRupees(receipt.fee));

  y += 2;
  doc.setFillColor(...PANEL);
  doc.setDrawColor(...LINE);
  doc.roundedRect(M + 96, y, CW - 96, 15, 2.5, 2.5, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...INK);
  doc.setCharSpace(0.5);
  doc.text('TOTAL PAID', M + 102, y + 9.4);
  doc.setCharSpace(0);
  doc.setFontSize(14);
  doc.setTextColor(...RED);
  doc.text(formatRupees(receipt.total), M + CW - 4, y + 10, { align: 'right' });
  y += 28;

  // payment details
  label(doc, 'PAYMENT DETAILS', M, y);
  y += 5;
  doc.setDrawColor(...LINE);
  doc.line(M, y, W - M, y);
  const detail = (k: string, v: string | null | undefined, x: number, yy: number) => {
    if (!v) return;
    label(doc, k, x, yy);
    doc.setFont('courier', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...INK);
    doc.text(pdfSafe(v), x, yy + 5.5);
  };
  detail('ORDER ID', payment?.orderId, M, y + 8);
  detail('PAYMENT ID', payment?.paymentId, M + 90, y + 8);
  label(doc, 'PAID ON', M, y + 24);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...INK);
  doc.text(issued || '-', M, y + 29.5);
  label(doc, 'PURCHASER', M + 90, y + 24);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...INK);
  doc.text(wrap(doc, pdfSafe(purchaserEmail), 80, 1), M + 90, y + 29.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text('This receipt confirms your booking. The convenience fee covers payment-gateway charges and applicable taxes.', M, y + 44);

  footer(doc, ref, totalPages, totalPages);
  return doc;
}

/** Builds the e-ticket PDF and returns it base64-encoded (what the email attaches). */
export async function generateTicketPdf(input: TicketPdfInput): Promise<string> {
  const doc = await buildTicketPdf(input);
  return doc.output('datauristring').split(',')[1];
}
