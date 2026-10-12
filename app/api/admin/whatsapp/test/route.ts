import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { normalizeWhatsAppNumber, sendHelloWorld, sendTicketOnWhatsApp, whatsappConfig } from '@/lib/whatsapp';
import { fetchLogoBase64, generateTicketPdf } from '@/lib/payments/ticket-pdf';
import { baseUrl } from '@/lib/payments/server';
import { siteUrl } from '@/lib/mail';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Admin-only WhatsApp check. Sends ONE message to the number you type, so you can see the setup working.
 *   { to: "+919876543210", mode: "hello" }   Meta's built-in hello_world template (works before ours is approved)
 *   { to: "+919876543210", mode: "ticket" }  a sample ticket PDF through our real ticket template
 * While the WhatsApp number is still in Meta's test mode, `to` must be one of the recipients added in Meta's API Setup.
 */
export async function POST(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const cfg = whatsappConfig();
  if (!cfg) return NextResponse.json({ ok: false, error: 'WhatsApp is not configured. Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID in Vercel.' }, { status: 400 });

  const { to, mode } = await req.json().catch(() => ({}));
  const number = normalizeWhatsAppNumber(typeof to === 'string' ? to : '');
  if (!number) return NextResponse.json({ ok: false, error: 'Enter a valid mobile number, for example +919876543210.' }, { status: 400 });

  if (mode === 'ticket') {
    const base = baseUrl();
    const pdf = Buffer.from(
      await generateTicketPdf({
        bookingId: '00000000-0000-4000-8000-000000000000',
        purchaserEmail: 'test@example.com',
        event: { title: 'Sample Event', date: 'JAN 9, 2027', time: '5:00 PM', location: 'Pune' },
        tickets: [{ categoryName: 'GENERAL', ticketNumber: 'TEST-001', unitPrice: 1 }],
        pointsApplied: 0,
        logoBase64: await fetchLogoBase64(base),
        baseUrl: base,
      }),
      'base64',
    );
    const res = await sendTicketOnWhatsApp(cfg, { to: number, buyerName: 'there', eventTitle: 'Sample Event', eventWhen: 'Sat, 9 Jan 2027, 5:00 PM', eventVenue: 'Pune', ticketsLink: siteUrl('/profile#my-tickets'), bookingRef: 'TEST0001', pdf, filename: 'test-ticket.pdf' });
    return NextResponse.json(res, { status: res.ok ? 200 : 502 });
  }

  const res = await sendHelloWorld(cfg, number);
  return NextResponse.json(res, { status: res.ok ? 200 : 502 });
}
