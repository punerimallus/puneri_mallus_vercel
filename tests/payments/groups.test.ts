import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_GROUP_SIZE, admitsLabel, groupSizeOf, isGroup, pricePerPerson } from '@/lib/payments/groups';
import { quoteEventCart } from '@/lib/payments/pricing';
import { buildIssuedTickets } from '@/lib/payments/fulfil';
import { buildTicketPdf } from '@/lib/payments/ticket-pdf';
import QRCode from 'qrcode';

describe('group size', () => {
  it('treats missing, blank and nonsense values as a single-entry ticket', () => {
    for (const v of [undefined, null, '', 0, -3, 'abc', NaN]) expect(groupSizeOf(v)).toBe(1);
  });
  it('accepts whole numbers, rounds down and caps at the maximum', () => {
    expect(groupSizeOf(5)).toBe(5);
    expect(groupSizeOf('7')).toBe(7);
    expect(groupSizeOf(5.9)).toBe(5);
    expect(groupSizeOf(10_000)).toBe(MAX_GROUP_SIZE);
  });
  it('words and prices it for customers', () => {
    expect(admitsLabel(1)).toBe('1 Person');
    expect(admitsLabel(5)).toBe('5 People');
    expect(isGroup(1)).toBe(false);
    expect(isGroup(5)).toBe(true);
    expect(pricePerPerson(1000, 5)).toBe(200);
    expect(pricePerPerson(999, 7)).toBe(142.71);
    expect(pricePerPerson(500, undefined)).toBe(500);
  });
});

const cats = [
  { id: 'single', name: 'GENERAL', prefix: 'GEN-', price: 500, capacity: 100, sold: 0 },
  { id: 'grp5', name: 'GROUP OF 5 - GENERAL', prefix: 'G5-', price: 2000, capacity: 20, sold: 0, group_size: 5 },
];
const base = { isLoggedIn: true, isMember: false, memberDiscountPercent: 0, pointsToRedeem: 0, loyaltyBalance: 0, previouslyBought: 0 };

describe('group tickets at checkout', () => {
  it('prices a group ticket as one ticket and records its size from the database, not the browser', () => {
    const q = quoteEventCart({ ...base, cart: { grp5: 2, single: 1 }, categories: cats as any });
    expect(q.total).toBe(4500);
    expect(q.lines.find((l) => l.categoryId === 'grp5')).toMatchObject({ qty: 2, unitPrice: 2000, groupSize: 5 });
    expect(q.lines.find((l) => l.categoryId === 'single')).not.toHaveProperty('groupSize');
  });
  it('rejects extra fields in the cart, so the browser cannot choose a group size', () => {
    expect(() => quoteEventCart({ ...base, cart: { single: 1, groupSize: 99 } as any, categories: cats as any })).toThrow(/Invalid category/);
  });
  it('limits group tickets to 2 per account, separately from the 7 single tickets', () => {
    const q = (cart: any, over: any = {}) => quoteEventCart({ ...base, cart, categories: cats as any, ...over });
    expect(() => q({ grp5: 2 })).not.toThrow();
    expect(() => q({ grp5: 3 })).toThrow(/at most 2 group tickets/);
    expect(() => q({ grp5: 1 }, { previouslyBoughtGroups: 1 })).not.toThrow();
    expect(() => q({ grp5: 2 }, { previouslyBoughtGroups: 1 })).toThrow(/already have 1/);
    // groups never use up the single-ticket allowance, and singles never use up the group allowance
    expect(() => q({ single: 7, grp5: 2 })).not.toThrow();
    expect(() => q({ single: 8 })).toThrow(/maximum of 7/);
    expect(() => q({ single: 1 }, { previouslyBought: 7 })).toThrow(/maximum of 7/);
    expect(() => q({ single: 1 }, { previouslyBoughtGroups: 2 })).not.toThrow();
  });
  it('gives each group ticket one number (one QR) that carries the group size', () => {
    const order: any = { cart: [{ categoryId: 'grp5', name: 'GROUP OF 5 - GENERAL', prefix: 'G5-', qty: 2, unitPrice: 2000, groupSize: 5 }, { categoryId: 'single', name: 'GENERAL', prefix: 'GEN-', qty: 1, unitPrice: 500 }] };
    const t = buildIssuedTickets(order, [{ categoryId: 'grp5', qty: 2, endSold: 4 }, { categoryId: 'single', qty: 1, endSold: 10 }]);
    expect(t).toEqual([
      { categoryName: 'GROUP OF 5 - GENERAL', ticketNumber: 'G5-003', status: 'ISSUED', groupSize: 5 },
      { categoryName: 'GROUP OF 5 - GENERAL', ticketNumber: 'G5-004', status: 'ISSUED', groupSize: 5 },
      { categoryName: 'GENERAL', ticketNumber: 'GEN-010', status: 'ISSUED' },
    ]);
  });
});

const drawn: string[] = [];
vi.mock('jspdf', async (orig) => {
  const mod: any = await orig();
  const Real = mod.default ?? mod.jsPDF;
  class Recording extends Real {
    constructor(...a: any[]) {
      super(...a);
      const text = this.text.bind(this);
      this.text = (t: any, ...rest: any[]) => { (Array.isArray(t) ? t : [t]).forEach((x) => drawn.push(String(x))); return text(t, ...rest); };
    }
  }
  return { ...mod, default: Recording, jsPDF: Recording };
});

describe('group ticket PDF', () => {
  beforeEach(() => { drawn.length = 0; });
  const input: any = {
    bookingId: '7f3c2a10-5b9e-4c1d-9a6e-2d8f0b1c4e77', purchaserEmail: 'a@b.c', event: { title: 'Onam Night' }, pointsApplied: 0, logoBase64: null, baseUrl: 'https://punerimallus.com',
  };

  it('shows the number of people and one QR for the whole group', async () => {
    const qr = vi.spyOn(QRCode, 'toDataURL');
    const doc = await buildTicketPdf({ ...input, tickets: [{ categoryName: 'GROUP OF 5', ticketNumber: 'G5-003', unitPrice: 2000, groupSize: 5 }] });
    const all = drawn.join('\n');
    expect(doc.getNumberOfPages()).toBe(2); // one ticket page + receipt
    expect(qr).toHaveBeenCalledTimes(1);
    expect(all).toContain('5 People');
    expect(all).toContain('One scan admits all 5');
    expect(all).toContain('Group ticket: admits 5 people together on one scan');
  });
  it('keeps the usual wording for single tickets', async () => {
    await buildTicketPdf({ ...input, tickets: [{ categoryName: 'GENERAL', ticketNumber: 'GEN-010', unitPrice: 500 }] });
    const all = drawn.join('\n');
    expect(all).toContain('1 Person');
    expect(all).toContain('One scan, one person');
    expect(all).toContain('valid for one person only');
    expect(all).not.toContain('Group ticket');
  });
});
