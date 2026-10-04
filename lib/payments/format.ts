// Pure formatting helpers shared by the ticket PDF, the ticket page and the checkout page,
// so a date, an amount or a QR link looks and behaves the same everywhere. No server-only imports.

import { grossUpToPaise } from './pricing';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Event dates are stored as text such as "OCT 18, 2026". Returns a readable "Sun, 18 Oct 2026",
 * or the original text when it can't be understood (never throws, never shows "Invalid Date").
 */
export function formatEventDate(date?: string | null): string {
  const raw = (date || '').trim();
  if (!raw) return 'To be announced';
  const m = raw.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/);
  const monthIdx = m ? MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) : -1;
  if (!m || monthIdx === -1) return raw;
  const d = new Date(Date.UTC(Number(m[3]), monthIdx, Number(m[2])));
  if (Number.isNaN(d.getTime()) || d.getUTCDate() !== Number(m[2])) return raw;
  // Built by hand (not toLocaleDateString) so the output is identical on every server's ICU data.
  return `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTH_LABELS[monthIdx]} ${d.getUTCFullYear()}`;
}

export function formatEventTime(time?: string | null): string {
  const raw = (time || '').trim();
  return raw || 'To be announced';
}

/** Amount in rupees with two decimals and Indian digit grouping, e.g. "Rs. 1,234.50". */
export function formatRupees(amount: number): string {
  const n = Number.isFinite(amount) ? amount : 0;
  return `Rs. ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "1 Oct 2026, 9:41 pm" in Indian time, whatever timezone the server runs in. */
export function formatIst(value: Date | string | number): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
}

/** The link encoded in every pass QR code. The gate scanner (/admin/scanner) reads exactly this. */
export function buildScanUrl(baseUrl: string, bookingId: string, ticketNumber: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/admin/scanner?bid=${encodeURIComponent(bookingId)}&tno=${encodeURIComponent(ticketNumber)}`;
}

export interface ReceiptLine {
  name: string;
  qty: number;
  unitPrice: number;
  amount: number;
}

export interface Receipt {
  lines: ReceiptLine[];
  subtotal: number;      // rupees, after member rate, before points and fee
  pointsApplied: number; // rupees
  base: number;          // subtotal - points
  fee: number;           // gateway fee in rupees
  total: number;         // what the buyer paid, in rupees
}

/**
 * Builds the receipt from the passes. When the real amount charged is known (paise from the order)
 * it is used as the total, so the receipt always matches the Razorpay charge to the paisa.
 * Otherwise the total is derived with the same formula the checkout uses.
 */
export function buildReceipt(
  tickets: { categoryName: string; unitPrice: number }[],
  pointsApplied: number,
  totalPaidPaise?: number | null,
): Receipt {
  const byName = new Map<string, ReceiptLine>();
  for (const t of tickets) {
    const key = `${t.categoryName}|${t.unitPrice}`;
    const line = byName.get(key) || { name: t.categoryName, qty: 0, unitPrice: t.unitPrice, amount: 0 };
    line.qty += 1;
    line.amount = Math.round((line.amount + t.unitPrice) * 100) / 100;
    byName.set(key, line);
  }
  const lines = [...byName.values()];
  const subtotal = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
  const points = Math.min(Math.max(0, pointsApplied || 0), subtotal);
  const base = Math.round((subtotal - points) * 100) / 100;
  const paise = totalPaidPaise && totalPaidPaise > 0 ? totalPaidPaise : grossUpToPaise(base);
  const total = paise / 100;
  const fee = Math.max(0, Math.round((total - base) * 100) / 100);
  return { lines, subtotal, pointsApplied: points, base, fee, total };
}

/** jsPDF's built-in fonts only cover Latin-1 and a few punctuation marks; drop anything else instead of printing garbage. */
export function pdfSafe(text: string): string {
  return (text || '').replace(/[^ -~ -ÿ–—‘’“”•…]/g, '').replace(/\s+/g, ' ').trim();
}
