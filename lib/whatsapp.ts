// WhatsApp Cloud API: send the ticket PDF to the buyer's WhatsApp, on top of the email.
//
// There is no API to ask "does this number have WhatsApp?" in advance. The way every business does it
// (BookMyShow included) is: the customer opts in at checkout, we try to send, and if the number is not
// on WhatsApp the send fails and that is recorded. Email is always sent too, so nothing is ever lost.
//
// Business-initiated messages must use a pre-approved TEMPLATE (see docs/whatsapp-template.md).
// Nothing here runs unless WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID are set.

const GRAPH = 'https://graph.facebook.com';
const TIMEOUT_MS = 15_000;

export interface WhatsAppConfig {
  token: string;
  phoneNumberId: string;
  version: string;
  template: string;
  language: string;
  /** WhatsApp Business Account id: lets the app read the template's definition from Meta and adapt to it. Optional. */
  wabaId?: string;
  /** Optional override: the template's placeholder names, in order, when it uses named placeholders. */
  paramNames?: string[];
}

export function whatsappConfig(env: Record<string, string | undefined> = process.env): WhatsAppConfig | null {
  const token = env.WHATSAPP_ACCESS_TOKEN?.trim();
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (!token || !phoneNumberId) return null;
  return {
    token,
    phoneNumberId,
    version: env.WHATSAPP_API_VERSION?.trim() || 'v21.0',
    template: env.WHATSAPP_TEMPLATE_NAME?.trim() || 'ticket_confirmation',
    language: env.WHATSAPP_TEMPLATE_LANG?.trim() || 'en',
    wabaId: env.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim() || undefined,
    paramNames: env.WHATSAPP_TEMPLATE_PARAMS?.split(',').map((n) => n.trim()).filter(Boolean),
  };
}

/**
 * Is WhatsApp delivery switched on? True when the credentials are set, unless WHATSAPP_ENABLED is set to
 * false/off/0/no (an easy kill switch that needs no redeploy of code, only of settings). The checkout page asks
 * the server this, so nothing depends on a build-time flag matching exactly.
 */
export function whatsappEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (!whatsappConfig(env)) return false;
  return !/^(false|off|0|no)$/i.test((env.WHATSAPP_ENABLED || '').trim());
}

/**
 * Digits-only international number, which is what the API wants ("919876543210").
 * Accepts "+91 98765 43210", "09876543210", or a bare 10-digit Indian mobile. Returns null if it can't be a mobile.
 */
export function normalizeWhatsAppNumber(input: string | null | undefined): string | null {
  const digits = String(input || '').replace(/[^\d]/g, '');
  if (/^[6-9]\d{9}$/.test(digits)) return `91${digits}`;
  if (/^0[6-9]\d{9}$/.test(digits)) return `91${digits.slice(1)}`;
  if (/^91[6-9]\d{9}$/.test(digits)) return digits;
  if (/^91\d{10}$/.test(digits)) return null; // an Indian number that is not a mobile (landline etc.)
  // Any other country: 8 to 15 digits, as E.164 allows (used only for explicit test sends).
  if (/^\d{8,15}$/.test(digits) && String(input).trim().startsWith('+')) return digits;
  return null;
}

/** "+91 98••• ••210" for showing back to the customer. */
export function maskNumber(number: string | null | undefined): string {
  const d = String(number || '').replace(/[^\d]/g, '');
  if (d.length < 8) return '';
  const cc = d.length > 10 ? `+${d.slice(0, d.length - 10)} ` : '';
  const local = d.slice(-10);
  return `${cc}${local.slice(0, 2)}••• ••${local.slice(-3)}`;
}

export type WhatsAppResult =
  | { ok: true; messageId: string }
  | { ok: false; code: number | null; error: string; /** true when retrying later could help (rate limit, outage); false for "not on WhatsApp", bad template, etc. */ retryable: boolean };

// Meta error codes worth knowing. Anything not listed is treated as final.
//   131026  recipient can't receive the message (not on WhatsApp, or hasn't accepted the latest terms)
//   131030  recipient not in the allowed list (test number / unverified business)
//   132000-132016 template problems (missing, not approved, wrong parameter count)
const RETRYABLE = new Set([1, 2, 4, 17, 80007, 130429, 131016, 131056]);

async function graph(cfg: WhatsAppConfig, path: string, init: RequestInit): Promise<{ status: number; json: any }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${GRAPH}/${cfg.version}/${path}`, { ...init, signal: ctl.signal, headers: { Authorization: `Bearer ${cfg.token}`, ...(init.headers || {}) } });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

function failure(status: number, json: any): WhatsAppResult {
  const code = typeof json?.error?.code === 'number' ? json.error.code : null;
  const detail = json?.error?.error_data?.details || json?.error?.message || `HTTP ${status}`;
  return { ok: false, code, error: String(detail).slice(0, 300), retryable: status >= 500 || (code !== null && RETRYABLE.has(code)) };
}

/** Uploads the PDF so it can be attached to the template message. Returns the media id. */
export async function uploadPdf(cfg: WhatsAppConfig, pdf: Buffer, filename: string): Promise<{ ok: true; mediaId: string } | Extract<WhatsAppResult, { ok: false }>> {
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', 'application/pdf');
  form.append('file', new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }), filename);
  try {
    const { status, json } = await graph(cfg, `${cfg.phoneNumberId}/media`, { method: 'POST', body: form });
    if (status >= 200 && status < 300 && json?.id) return { ok: true, mediaId: String(json.id) };
    return failure(status, json) as Extract<WhatsAppResult, { ok: false }>;
  } catch (e) {
    return { ok: false, code: null, error: e instanceof Error ? e.message : String(e), retryable: true };
  }
}

async function postMessage(cfg: WhatsAppConfig, body: Record<string, unknown>): Promise<WhatsAppResult> {
  try {
    const { status, json } = await graph(cfg, `${cfg.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', type: 'template', ...body }),
    });
    const id = json?.messages?.[0]?.id;
    if (status >= 200 && status < 300 && id) return { ok: true, messageId: String(id) };
    return failure(status, json);
  } catch (e) {
    return { ok: false, code: null, error: e instanceof Error ? e.message : String(e), retryable: true };
  }
}

export interface TicketMessage {
  to: string; // digits-only international number
  buyerName: string;
  eventTitle: string;
  eventWhen: string;
  eventVenue: string;
  ticketsLink: string;
  bookingRef: string;
  pdf: Buffer;
  filename: string;
}

/** Strips characters WhatsApp rejects in template parameters (newlines, tabs, runs of spaces) and keeps them short. */
export const cleanParam = (v: string, max = 120): string => (String(v || '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, max) || '-');

// ---- the template's shape -------------------------------------------------------------------------------
// A template's placeholders are either numbered ({{1}}) or named ({{customer_name}}). The API must be called the
// matching way ("Parameter name is missing or empty" means a named template got numbered values), so the app
// reads the template's definition from Meta once and builds the message to fit it.

export interface TemplateInfo {
  status: string;
  language: string;
  format: 'NAMED' | 'POSITIONAL';
  /** Body placeholders in order of appearance: ["1","2"] or ["customer_name","event_name"]. */
  bodyParams: string[];
  documentHeader: boolean;
}

/** Placeholders in order of first appearance. */
export function placeholdersOf(text: string): string[] {
  const seen: string[] = [];
  for (const m of text.matchAll(/\{\{\s*([^}\s]+)\s*\}\}/g)) if (!seen.includes(m[1])) seen.push(m[1]);
  return seen;
}

export function parseTemplate(t: any, language: string): TemplateInfo | null {
  if (!t) return null;
  const comps: any[] = Array.isArray(t.components) ? t.components : [];
  const body = comps.find((c) => String(c.type).toUpperCase() === 'BODY');
  const header = comps.find((c) => String(c.type).toUpperCase() === 'HEADER');
  const bodyParams = placeholdersOf(String(body?.text || ''));
  const named = String(t.parameter_format || '').toUpperCase() === 'NAMED' || bodyParams.some((p) => !/^\d+$/.test(p));
  return {
    status: String(t.status || 'UNKNOWN'),
    language: String(t.language || language),
    format: named ? 'NAMED' : 'POSITIONAL',
    bodyParams,
    documentHeader: String(header?.format || '').toUpperCase() === 'DOCUMENT',
  };
}

let templateCache: { key: string; at: number; info: TemplateInfo | null } | null = null;
const TEMPLATE_CACHE_MS = 10 * 60_000;

export async function fetchTemplateInfo(cfg: WhatsAppConfig, force = false): Promise<{ info: TemplateInfo | null; error?: string }> {
  if (!cfg.wabaId) return { info: null, error: 'Set WHATSAPP_BUSINESS_ACCOUNT_ID so the app can read the template.' };
  const key = `${cfg.wabaId}|${cfg.template}|${cfg.language}`;
  if (!force && templateCache && templateCache.key === key && Date.now() - templateCache.at < TEMPLATE_CACHE_MS && templateCache.info) return { info: templateCache.info };
  try {
    const { status, json } = await graph(cfg, `${cfg.wabaId}/message_templates?name=${encodeURIComponent(cfg.template)}&fields=name,status,language,parameter_format,components&limit=20`, { method: 'GET' });
    if (status < 200 || status >= 300) return { info: null, error: String(json?.error?.message || `HTTP ${status}`).slice(0, 200) };
    const rows: any[] = Array.isArray(json?.data) ? json.data : [];
    const row = rows.find((r) => r.language === cfg.language) || rows.find((r) => String(r.language).startsWith(cfg.language.split('_')[0])) || rows[0];
    if (!row) return { info: null, error: `No template called "${cfg.template}" exists on this WhatsApp account.` };
    const info = parseTemplate(row, cfg.language);
    templateCache = { key, at: Date.now(), info };
    return { info };
  } catch (e) {
    return { info: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Which of our values a placeholder name is asking for, judged from the name. */
export function valueKeyFor(name: string): 'link' | 'ref' | 'venue' | 'when' | 'event' | 'name' | null {
  const n = name.toLowerCase();
  if (/(link|url)/.test(n)) return 'link';
  if (/(ref|booking|code|ticket_?id|order)/.test(n)) return 'ref';
  if (/(venue|location|place|address)/.test(n)) return 'venue';
  if (/(date|time|when|schedule)/.test(n)) return 'when';
  if (/(event|show|title)/.test(n)) return 'event';
  if (/(name|customer|user|buyer|guest)/.test(n)) return 'name';
  return null;
}

/** The body parameters for the template, in the form its definition demands. */
export function buildBodyParams(m: TicketMessage, info: TemplateInfo | null, overrideNames?: string[]): Record<string, unknown>[] {
  const values = { name: m.buyerName, event: m.eventTitle, when: m.eventWhen, venue: m.eventVenue, link: m.ticketsLink, ref: m.bookingRef };
  const inOrder = [values.name, values.event, values.when, values.venue, values.link, values.ref];
  const names = info?.format === 'NAMED' ? info.bodyParams : overrideNames?.length ? overrideNames : null;
  if (names) {
    return names.map((n, i) => {
      const key = valueKeyFor(n);
      return { type: 'text', parameter_name: n, text: cleanParam(key ? values[key] : inOrder[i] ?? '-') };
    });
  }
  const count = info?.bodyParams.length || inOrder.length;
  return inOrder.slice(0, count).map((t) => ({ type: 'text', text: cleanParam(t) }));
}

/**
 * Sends the ticket template with the PDF attached as its header, shaped to the template's real definition.
 * Default body order, for numbered templates: 1 name, 2 event, 3 date and time, 4 venue, 5 tickets link, 6 booking ref.
 */
export async function sendTicketOnWhatsApp(cfg: WhatsAppConfig, m: TicketMessage): Promise<WhatsAppResult> {
  const { info } = await fetchTemplateInfo(cfg);
  if (info && info.status !== 'APPROVED') {
    return { ok: false, code: null, error: `Template "${cfg.template}" is ${info.status}, not APPROVED yet. WhatsApp will not deliver it until Meta approves it.`, retryable: false };
  }
  const components: Record<string, unknown>[] = [];
  let mediaId: string | null = null;
  if (!info || info.documentHeader) {
    const up = await uploadPdf(cfg, m.pdf, m.filename);
    if (!up.ok) return up;
    mediaId = up.mediaId;
    components.push({ type: 'header', parameters: [{ type: 'document', document: { id: mediaId, filename: m.filename } }] });
  }
  const params = buildBodyParams(m, info, cfg.paramNames);
  if (params.length) components.push({ type: 'body', parameters: params });
  return postMessage(cfg, { to: m.to, template: { name: cfg.template, language: { code: info?.language || cfg.language }, components } });
}

/** Meta's built-in "hello_world" template exists on every account, so it works for checking credentials before our own template is approved. */
export async function sendHelloWorld(cfg: WhatsAppConfig, to: string): Promise<WhatsAppResult> {
  return postMessage(cfg, { to, template: { name: 'hello_world', language: { code: 'en_US' } } });
}
