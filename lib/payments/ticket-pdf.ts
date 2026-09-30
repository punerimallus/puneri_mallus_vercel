import jsPDF from 'jspdf';
import QRCode from 'qrcode';
import { ticketFee } from './pricing';

export interface TicketPdfInput {
  bookingId: string;
  purchaserEmail: string;
  event: { title?: string; date?: string; time?: string; location?: string } | null;
  tickets: { categoryName: string; ticketNumber: string; unitPrice: number }[];
  pointsApplied: number;
  logoBase64: string | null;
  baseUrl: string;
}

export async function fetchLogoBase64(baseUrl: string): Promise<string | null> {
  try {
    const logoRes = await fetch(`${baseUrl}/logo_main.png`);
    if (!logoRes.ok) return null;
    const logoBuffer = await logoRes.arrayBuffer();
    return `data:image/png;base64,${Buffer.from(logoBuffer).toString('base64')}`;
  } catch {
    console.error('Failed to fetch Puneri Mallus logo');
    return null;
  }
}

/** Builds the e-ticket PDF (one page per pass) and returns it base64-encoded. */
export async function generateTicketPdf(input: TicketPdfInput): Promise<string> {
  const { bookingId, purchaserEmail, event, tickets, pointsApplied, logoBase64, baseUrl } = input;
  const doc = new jsPDF();

  for (let index = 0; index < tickets.length; index++) {
    const ticket = tickets[index];
    const catPrice = ticket.unitPrice;
    const fee = ticketFee(catPrice);
    const ticketTotal = catPrice + fee;

    if (index > 0) doc.addPage();

    // 1. HEADER SECTION
    if (logoBase64) {
      doc.setFillColor(15, 15, 15);
      doc.roundedRect(20, 15, 40, 30, 2, 2, 'F');
      doc.addImage(logoBase64, 'PNG', 22, 17, 36, 26);
    } else {
      doc.setTextColor(255, 0, 0);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(22);
      doc.text('PUNERI MALLUS', 20, 25);
    }

    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('OFFICIAL E-TICKET', 190, 32, { align: 'right' });

    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.5);
    doc.line(20, 52, 190, 52);

    // 2. ORDER INFO
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text(`Booking ID: ${bookingId.split('-')[0].toUpperCase()}`, 20, 60);
    doc.text(`Date Issued: ${new Date().toLocaleDateString('en-IN')}`, 20, 65);
    doc.text(`Purchaser: ${purchaserEmail}`, 20, 70);

    // 3. EVENT DETAILS BOX
    doc.setDrawColor(200, 200, 200);
    doc.roundedRect(20, 80, 170, 35, 2, 2, 'S');

    doc.setTextColor(0, 0, 0);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    const titleLines = doc.splitTextToSize((event?.title || 'EXCLUSIVE EVENT').toUpperCase(), 160);
    doc.text(titleLines, 25, 90);

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(80, 80, 80);
    doc.text(`Date: ${event?.date || 'TBA'}  |  Time: ${event?.time || 'TBA'}`, 25, 100);
    doc.text(`Venue: ${event?.location || 'TBA'}`, 25, 107);

    // 4. GUEST ACCESS PASS BOX
    doc.roundedRect(20, 122, 170, 45, 2, 2, 'S');

    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('GUEST ACCESS PASS', 25, 132);

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text('Category:', 25, 144);
    doc.text('Ticket No:', 25, 152);
    doc.text('Status:', 25, 160);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(220, 38, 38);
    doc.text(ticket.categoryName.toUpperCase(), 50, 144);
    doc.setTextColor(0, 0, 0);
    doc.text(ticket.ticketNumber, 50, 152);
    doc.setTextColor(34, 197, 94);
    doc.text('CONFIRMED', 50, 160);

    const scanUrl = `${baseUrl}/admin/scanner?bid=${bookingId}&tno=${ticket.ticketNumber}`;
    const qrCodeBase64 = await QRCode.toDataURL(scanUrl, { margin: 1, color: { dark: '#000', light: '#fff' } });

    doc.addImage(qrCodeBase64, 'PNG', 145, 127, 35, 35);
    doc.setFontSize(7);
    doc.setTextColor(0, 0, 0);
    doc.text('SCAN AT ENTRY', 162.5, 165, { align: 'center' });

    // 5. PRICE BREAKDOWN BOX
    const showDiscount = pointsApplied > 0 && index === 0;
    const boxHeight = showDiscount ? 52 : 45;

    doc.roundedRect(20, 175, 170, boxHeight, 2, 2, 'S');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('PAYMENT BREAKDOWN', 25, 185);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(80, 80, 80);
    doc.text('Base Ticket Price', 25, 195);
    doc.text(`Rs. ${catPrice.toLocaleString('en-IN')}`, 185, 195, { align: 'right' });

    doc.text('Taxes & Convenience Fee (2.36%)', 25, 202);
    doc.text(`Rs. ${fee.toLocaleString('en-IN')}`, 185, 202, { align: 'right' });

    let currentY = 202;

    if (showDiscount) {
      currentY += 7;
      doc.text('Tribe Points Applied', 25, currentY);
      doc.setTextColor(34, 197, 94);
      doc.text(`- Rs. ${pointsApplied.toLocaleString('en-IN')}`, 185, currentY, { align: 'right' });
      doc.setTextColor(80, 80, 80);
    }

    currentY += 5;
    doc.setDrawColor(220, 220, 220);
    doc.line(25, currentY, 185, currentY);

    currentY += 7;
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text('TOTAL PAID FOR THIS TICKET', 25, currentY);
    doc.setTextColor(220, 38, 38);

    const actualTicketTotal = showDiscount ? Math.max(0, ticketTotal - pointsApplied) : ticketTotal;
    doc.text(`Rs. ${actualTicketTotal.toLocaleString('en-IN')}`, 185, currentY, { align: 'right' });

    // 6. RULES & GUIDELINES
    const rulesStartY = showDiscount ? 240 : 233;

    doc.setTextColor(0, 0, 0);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('RULES & GUIDELINES', 20, rulesStartY);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(80, 80, 80);
    doc.text('1. Please present this e-ticket along with a valid Government ID at the entry gate.', 20, rulesStartY + 7);
    doc.text('2. This ticket is non-refundable, non-transferable, and valid for one person only.', 20, rulesStartY + 12);
    doc.text("3. Entry gates close 30 minutes prior to the show's commencement.", 20, rulesStartY + 17);
    doc.text('4. Any form of outside food, beverages, or hazardous items are strictly prohibited.', 20, rulesStartY + 22);
    doc.text('5. Management reserves the right of admission and may conduct security checks.', 20, rulesStartY + 27);
  }

  return doc.output('datauristring').split(',')[1];
}
