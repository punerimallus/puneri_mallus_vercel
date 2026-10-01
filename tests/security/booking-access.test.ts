import { beforeEach, describe, expect, it, vi } from 'vitest';

// Tickets are private: only the booking's owner or an admin can read a booking or download its PDF.

let user: { id: string } | null = null;
let isAdmin = false;
let booking: any = null;

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@supabase/ssr', () => ({ createServerClient: () => ({ auth: { getUser: async () => ({ data: { user } }) } }) }));
vi.mock('@/lib/admin', () => ({ checkAdminAccess: async () => ({ isAdmin, user }) }));
vi.mock('@/lib/payments/server', () => ({
  loadBookingView: vi.fn(async () => booking),
  renderBookingPdf: vi.fn(async () => ({ base64: Buffer.from('%PDF-x').toString('base64'), filename: 'x.pdf' })),
}));
vi.mock('@/lib/mongodb', () => ({ default: Promise.resolve({ db: () => ({ collection: () => ({ findOne: async () => ({ image: 'p.png' }) }) }) }) }));

const mkBooking = (userId: string) => ({ id: 'b1', userId, email: 'a@b.c', status: 'CONFIRMED', createdAt: null, eventId: '507f1f77bcf86cd799439011', tickets: [], event: null, pointsApplied: 0, totalPaidPaise: null, payment: { orderId: null, paymentId: null, paidAt: null } });

beforeEach(() => { user = null; isAdmin = false; booking = mkBooking('owner'); });

describe('ticket booking + pdf access', () => {
  it('refuses a logged-out visitor on both endpoints', async () => {
    const { GET: bookingGet } = await import('@/app/api/tickets/booking/route');
    const { GET: pdfGet } = await import('@/app/api/tickets/pdf/route');
    expect((await bookingGet(new Request('http://x/api/tickets/booking?bid=b1'))).status).toBe(401);
    expect((await pdfGet(new Request('http://x/api/tickets/pdf?bid=b1'))).status).toBe(401);
  });

  it("hides another customer's booking as 'not found'", async () => {
    user = { id: 'someone-else' };
    const { GET } = await import('@/app/api/tickets/booking/route');
    const { GET: pdfGet } = await import('@/app/api/tickets/pdf/route');
    expect((await GET(new Request('http://x/api/tickets/booking?bid=b1'))).status).toBe(404);
    expect((await pdfGet(new Request('http://x/api/tickets/pdf?bid=b1'))).status).toBe(404);
  });

  it('lets the owner read it, without leaking the user id', async () => {
    user = { id: 'owner' };
    const { GET } = await import('@/app/api/tickets/booking/route');
    const res = await GET(new Request('http://x/api/tickets/booking?bid=b1'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.booking.email).toBe('a@b.c');
    expect(body.booking).not.toHaveProperty('userId');
    expect(body.image).toBe('p.png');
  });

  it('lets an admin read any booking and serves the PDF with the right headers', async () => {
    user = { id: 'admin-1' }; isAdmin = true;
    const { GET: pdfGet } = await import('@/app/api/tickets/pdf/route');
    const res = await pdfGet(new Request('http://x/api/tickets/pdf?bid=b1'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toContain('attachment');
  });

  it('refuses a PDF for a refunded booking and a missing bid', async () => {
    user = { id: 'owner' };
    booking = { ...mkBooking('owner'), status: 'REFUNDED' };
    const { GET: pdfGet } = await import('@/app/api/tickets/pdf/route');
    expect((await pdfGet(new Request('http://x/api/tickets/pdf?bid=b1'))).status).toBe(409);
    expect((await pdfGet(new Request('http://x/api/tickets/pdf'))).status).toBe(400);
  });
});
