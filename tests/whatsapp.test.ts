import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanParam, maskNumber, normalizeWhatsAppNumber, sendHelloWorld, sendTicketOnWhatsApp, whatsappConfig } from '@/lib/whatsapp';
import { deliverOrderEmail, DeliveryDeps } from '@/lib/payments/delivery';
import { makeOrder } from './payments/fakes';

afterEach(() => vi.restoreAllMocks());

describe('config', () => {
  it('is off unless both the token and the phone number id are set', () => {
    expect(whatsappConfig({})).toBeNull();
    expect(whatsappConfig({ WHATSAPP_ACCESS_TOKEN: 't' })).toBeNull();
    expect(whatsappConfig({ WHATSAPP_PHONE_NUMBER_ID: '1' })).toBeNull();
    expect(whatsappConfig({ WHATSAPP_ACCESS_TOKEN: ' t ', WHATSAPP_PHONE_NUMBER_ID: '1' })).toMatchObject({ token: 't', phoneNumberId: '1', version: 'v21.0', template: 'ticket_confirmation', language: 'en' });
  });
});

describe('phone numbers', () => {
  it('turns Indian mobiles in any common format into the digits WhatsApp wants', () => {
    for (const v of ['+91 98765 43210', '+919876543210', '09876543210', '9876543210', '91-98765-43210']) expect(normalizeWhatsAppNumber(v)).toBe('919876543210');
  });
  it('rejects landlines, short numbers, junk and empty values', () => {
    for (const v of ['1234567890', '98765', 'abc', '', null, undefined, '+91 5876543210']) expect(normalizeWhatsAppNumber(v as any)).toBeNull();
  });
  it('accepts other countries only with an explicit +', () => {
    expect(normalizeWhatsAppNumber('+1 (555) 645-2729')).toBe('15556452729');
    expect(normalizeWhatsAppNumber('15556452729')).toBeNull();
  });
  it('masks a number for display', () => {
    expect(maskNumber('919876543210')).toBe('+91 98••• ••210');
    expect(maskNumber('')).toBe('');
  });
  it('makes template parameters safe', () => {
    expect(cleanParam('Line one\nLine   two\t!')).toBe('Line one Line two !');
    expect(cleanParam('')).toBe('-');
    expect(cleanParam('x'.repeat(500))).toHaveLength(120);
  });
});

const cfg = { token: 'TOKEN', phoneNumberId: '555', version: 'v21.0', template: 'ticket_confirmation', language: 'en' };
const msg = { to: '919876543210', buyerName: 'Asha', eventTitle: 'Onam Night', eventWhen: 'Sun, 18 Oct 2026, 6:00 PM', eventVenue: 'Pune', ticketsLink: 'https://punerimallus.com/tickets/x', bookingRef: '7F3C2A10', pdf: Buffer.from('%PDF-1'), filename: 'tickets.pdf' };

function mockFetch(responses: { status: number; json: unknown }[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    const r = responses.shift() || { status: 500, json: {} };
    return new Response(JSON.stringify(r.json), { status: r.status });
  });
  return { calls, spy };
}

describe('sending the ticket', () => {
  it('uploads the PDF, then sends the template with the PDF as the header and the six details as the body', async () => {
    const { calls } = mockFetch([{ status: 200, json: { id: 'MEDIA1' } }, { status: 200, json: { messages: [{ id: 'wamid.ABC' }] } }]);
    const res = await sendTicketOnWhatsApp(cfg, msg);
    expect(res).toEqual({ ok: true, messageId: 'wamid.ABC' });

    expect(calls[0].url).toBe('https://graph.facebook.com/v21.0/555/media');
    expect((calls[0].init.headers as any).Authorization).toBe('Bearer TOKEN');
    expect(calls[1].url).toBe('https://graph.facebook.com/v21.0/555/messages');
    const body = JSON.parse(calls[1].init.body as string);
    expect(body).toMatchObject({ messaging_product: 'whatsapp', to: '919876543210', type: 'template' });
    expect(body.template.name).toBe('ticket_confirmation');
    expect(body.template.components[0]).toEqual({ type: 'header', parameters: [{ type: 'document', document: { id: 'MEDIA1', filename: 'tickets.pdf' } }] });
    expect(body.template.components[1].parameters.map((p: any) => p.text)).toEqual(['Asha', 'Onam Night', 'Sun, 18 Oct 2026, 6:00 PM', 'Pune', 'https://punerimallus.com/tickets/x', '7F3C2A10']);
  });

  it('reports a number that is not on WhatsApp as a final failure, not a retry', async () => {
    mockFetch([{ status: 200, json: { id: 'M' } }, { status: 400, json: { error: { code: 131026, message: 'Message undeliverable', error_data: { details: 'Message undeliverable' } } } }]);
    const res = await sendTicketOnWhatsApp(cfg, msg);
    expect(res).toMatchObject({ ok: false, code: 131026, retryable: false });
  });

  it('marks rate limits and outages as retryable', async () => {
    mockFetch([{ status: 200, json: { id: 'M' } }, { status: 429, json: { error: { code: 130429, message: 'Rate limit hit' } } }]);
    expect(await sendTicketOnWhatsApp(cfg, msg)).toMatchObject({ ok: false, retryable: true });
    mockFetch([{ status: 503, json: {} }]);
    expect(await sendTicketOnWhatsApp(cfg, msg)).toMatchObject({ ok: false, retryable: true });
  });

  it('stops after a failed upload and never sends the message', async () => {
    const { calls } = mockFetch([{ status: 400, json: { error: { code: 100, message: 'Invalid token' } } }]);
    const res = await sendTicketOnWhatsApp(cfg, msg);
    expect(res).toMatchObject({ ok: false, error: 'Invalid token' });
    expect(calls).toHaveLength(1);
  });

  it('survives a network error without throwing', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('socket hang up'));
    expect(await sendTicketOnWhatsApp(cfg, msg)).toMatchObject({ ok: false, retryable: true, error: 'socket hang up' });
  });

  it('hello_world check uses Meta built-in template', async () => {
    const { calls } = mockFetch([{ status: 200, json: { messages: [{ id: 'wamid.H' }] } }]);
    expect(await sendHelloWorld(cfg, '15556452729')).toEqual({ ok: true, messageId: 'wamid.H' });
    expect(JSON.parse(calls[0].init.body as string).template).toEqual({ name: 'hello_world', language: { code: 'en_US' } });
  });
});

function deliveryWorld(over: Record<string, unknown> = {}, whatsapp?: DeliveryDeps['sendTicketWhatsApp']) {
  const o: any = { ...makeOrder({ status: 'FULFILLED', booking_id: 'b1', razorpay_payment_id: 'pay_1' }), ...over };
  const deps: DeliveryDeps = {
    getOrder: vi.fn(async () => ({ ...o })),
    updateOrder: vi.fn(async (_id, patch) => void Object.assign(o, patch)),
    sendTicketEmail: vi.fn(async () => undefined),
    sendMembershipEmail: vi.fn(async () => undefined),
    sendMartEmail: vi.fn(async () => undefined),
    markBookingEmail: vi.fn(async () => undefined),
    ...(whatsapp ? { sendTicketWhatsApp: whatsapp } : {}),
    log: vi.fn(),
    now: () => new Date('2026-10-12T10:00:00Z'),
  };
  return { o, deps };
}

describe('WhatsApp step in delivery', () => {
  it('sends on WhatsApp only when the buyer opted in, after the email', async () => {
    const send = vi.fn(async () => ({ status: 'SENT' as const, messageId: 'wamid.1' }));
    const w = deliveryWorld({ whatsapp_opt_in: true, whatsapp_to: '919876543210' }, send);
    expect((await deliverOrderEmail('order_1', w.deps)).status).toBe('SENT');
    expect(send).toHaveBeenCalledTimes(1);
    expect(w.o).toMatchObject({ whatsapp_status: 'SENT', whatsapp_message_id: 'wamid.1', whatsapp_error: null });
  });

  it('does nothing for buyers who did not opt in, or for non-ticket orders', async () => {
    const send = vi.fn(async () => ({ status: 'SENT' as const }));
    await deliverOrderEmail('order_1', deliveryWorld({}, send).deps);
    await deliverOrderEmail('order_1', deliveryWorld({ whatsapp_opt_in: true, payment_type: 'LIFETIME' }, send).deps);
    expect(send).not.toHaveBeenCalled();
  });

  it('records a number that is not on WhatsApp as FAILED, and the email is still SENT', async () => {
    const w = deliveryWorld({ whatsapp_opt_in: true }, async () => ({ status: 'FAILED', error: '131026 Message undeliverable' }));
    expect((await deliverOrderEmail('order_1', w.deps)).status).toBe('SENT');
    expect(w.o).toMatchObject({ email_status: 'SENT', whatsapp_status: 'FAILED', whatsapp_error: '131026 Message undeliverable' });
  });

  it('a WhatsApp crash can never fail or undo the email delivery', async () => {
    const w = deliveryWorld({ whatsapp_opt_in: true }, async () => { throw new Error('boom'); });
    expect((await deliverOrderEmail('order_1', w.deps)).status).toBe('SENT');
    expect(w.o.email_status).toBe('SENT');
    expect(w.deps.log).toHaveBeenCalledWith('WHATSAPP_DELIVERY_FAILED', expect.anything());
  });

  it('does not send the same WhatsApp twice when the email is resent', async () => {
    const send = vi.fn(async () => ({ status: 'SENT' as const, messageId: 'm' }));
    const w = deliveryWorld({ whatsapp_opt_in: true }, send);
    await deliverOrderEmail('order_1', w.deps);
    await deliverOrderEmail('order_1', w.deps, { force: true });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('works unchanged when no WhatsApp dependency is provided', async () => {
    const w = deliveryWorld({ whatsapp_opt_in: true });
    expect((await deliverOrderEmail('order_1', w.deps)).status).toBe('SENT');
  });
});
