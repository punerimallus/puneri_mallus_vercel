import { describe, expect, it } from 'vitest';
import { buildReceipt, buildScanUrl, formatEventDate, formatIst, formatRupees, pdfSafe } from '@/lib/payments/format';
import { grossUpToPaise } from '@/lib/payments/pricing';

describe('formatEventDate', () => {
  it('turns the stored text into a readable date with the weekday', () => {
    expect(formatEventDate('OCT 18, 2026')).toBe('Sun, 18 Oct 2026');
    expect(formatEventDate('Dec 5, 2026')).toBe('Sat, 5 Dec 2026');
  });
  it('never shows "Invalid Date": unreadable text is returned as typed, empty becomes a placeholder', () => {
    expect(formatEventDate('Diwali weekend')).toBe('Diwali weekend');
    expect(formatEventDate('FEB 31, 2026')).toBe('FEB 31, 2026'); // not a real day
    expect(formatEventDate('')).toBe('To be announced');
    expect(formatEventDate(undefined)).toBe('To be announced');
  });
});

describe('formatRupees', () => {
  it('always uses two decimals and Indian grouping', () => {
    expect(formatRupees(500)).toBe('Rs. 500.00');
    expect(formatRupees(424.15)).toBe('Rs. 424.15');
    expect(formatRupees(123456.5)).toBe('Rs. 1,23,456.50');
    expect(formatRupees(NaN)).toBe('Rs. 0.00');
  });
});

describe('formatIst', () => {
  it('shows Indian time regardless of the server timezone', () => {
    expect(formatIst('2026-10-01T16:10:00Z')).toMatch(/1 Oct 2026, 9:40\s?pm/i);
    expect(formatIst('nonsense')).toBe('');
  });
});

describe('buildScanUrl', () => {
  it('matches the link the gate scanner reads and tolerates a trailing slash', () => {
    expect(buildScanUrl('https://punerimallus.com/', 'abc-123', 'VIP011')).toBe('https://punerimallus.com/admin/scanner?bid=abc-123&tno=VIP011');
  });
});

describe('buildReceipt', () => {
  const vip = (price: number) => ({ categoryName: 'VIP', unitPrice: price });

  it('groups passes by category and price', () => {
    const r = buildReceipt([vip(500), vip(500), { categoryName: 'General', unitPrice: 200 }], 0);
    expect(r.lines).toEqual([
      { name: 'VIP', qty: 2, unitPrice: 500, amount: 1000 },
      { name: 'General', qty: 1, unitPrice: 200, amount: 200 },
    ]);
    expect(r.subtotal).toBe(1200);
  });

  it('derives the total with the same formula as checkout when the charge is unknown', () => {
    const r = buildReceipt([vip(500), vip(500)], 0);
    expect(r.total).toBe(grossUpToPaise(1000) / 100);
    expect(r.fee).toBeCloseTo(r.total - 1000, 2);
  });

  it('uses the real amount charged when it is known, so the receipt matches Razorpay exactly', () => {
    const r = buildReceipt([vip(424.15), vip(424.15)], 100, 76600);
    expect(r.subtotal).toBe(848.3);
    expect(r.base).toBe(748.3);
    expect(r.total).toBe(766);
    expect(r.fee).toBe(17.7);
    expect(r.base + r.fee).toBeCloseTo(r.total, 2);
  });

  it('never applies more points than the subtotal', () => {
    expect(buildReceipt([vip(100)], 500).pointsApplied).toBe(100);
    expect(buildReceipt([vip(100)], -5).pointsApplied).toBe(0);
  });
});

describe('pdfSafe', () => {
  it('keeps normal text and drops characters the PDF font cannot draw', () => {
    expect(pdfSafe('Onam Night - Baner, Pune')).toBe('Onam Night - Baner, Pune');
    expect(pdfSafe('Café  Mallu—Night')).toBe('Café Mallu—Night');
    expect(pdfSafe('Party 🎉 മലയാളം')).toBe('Party');
  });
});
