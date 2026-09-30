import { NextResponse } from 'next/server';
import { checkAdminAccess } from '@/lib/admin';
import { supabaseAdmin } from '@/lib/payments/server';
import { sendBatch, sendMail, siteUrl } from '@/lib/mail';
import { buildCampaignEmail, validateContent } from '@/lib/bulk-mail/build';
import { isPlaceholderEmail, isValidEmail, normalizeRecipients, Recipient } from '@/lib/bulk-mail/recipients';
import { sendCampaign } from '@/lib/bulk-mail/send';
import { makeUnsubscribeToken } from '@/lib/bulk-mail/unsubscribe';
import { emailsFromRows, groupSources } from '@/lib/bulk-mail/sources';
import { CampaignContent, EMPTY_CAMPAIGN } from '@/lib/bulk-mail/templates';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_RECIPIENTS = Number(process.env.BULK_EMAIL_MAX) || 500;
const PAGE = 1000; // Supabase returns at most 1000 rows per request

const fail = (message: string, status = 400, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error: message, ...extra }, { status });

const MIGRATION_HINT = 'The bulk email tables are missing. Run supabase/migrations/20261001_bulk_email.sql in the Supabase SQL editor.';

function readContent(raw: any): CampaignContent {
  const c = { ...EMPTY_CAMPAIGN };
  for (const k of Object.keys(EMPTY_CAMPAIGN) as (keyof CampaignContent)[]) c[k] = String(raw?.[k] ?? '');
  return c;
}

async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

async function unsubscribedAmong(emails: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < emails.length; i += 200) {
    const { data, error } = await supabaseAdmin().from('email_unsubscribes').select('email').in('email', emails.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const r of data || []) out.add(String(r.email).toLowerCase());
  }
  return out;
}

async function loadAudience(type: string, eventId: string | null): Promise<Recipient[]> {
  const db = supabaseAdmin();
  let raw: { email: string | null; name: string }[] = [];

  if (type === 'users' || type === 'members') {
    const rows = await fetchAll<any>((from, to) => {
      let q = db.from('profiles').select('email, full_name').not('email', 'is', null).order('email').range(from, to);
      if (type === 'members') q = q.eq('is_member', true);
      return q;
    });
    raw = rows.map((r) => ({ email: r.email, name: r.full_name || '' }));
  } else if (type === 'buyers') {
    const rows = await fetchAll<any>((from, to) => {
      let q = db.from('ticket_bookings').select('*').order('created_at').range(from, to);
      if (eventId) q = q.eq('event_id', eventId);
      return q;
    });
    raw = rows
      .filter((r) => r.status !== 'REFUNDED')
      .map((r) => ({ email: r.email, name: r.full_name || r.purchaser_name || r.name || '' }));
  } else {
    throw new Error('Unknown audience');
  }

  return normalizeRecipients(raw.map((r) => ({ email: r.email || '', name: r.name })));
}

// Tables that hold email addresses, as reported by the email_sources() database function.
// Table and column names come only from the database catalogue and are re-checked as plain identifiers.
async function discoverSources() {
  const { data, error } = await supabaseAdmin().rpc('email_sources');
  if (error) throw new Error('MIGRATION');
  return groupSources(data || []);
}

async function loadTableEmails(source: { table: string; columns: string[] }): Promise<Recipient[]> {
  const rows = await fetchAll<any>((from, to) =>
    supabaseAdmin().from(source.table).select(source.columns.join(',')).range(from, to),
  );
  return emailsFromRows(rows, source.columns);
}

export async function GET(req: Request) {
  const { isAdmin } = await checkAdminAccess();
  if (!isAdmin) return fail('Forbidden', 403);

  const url = new URL(req.url);
  const view = url.searchParams.get('view');
  const db = supabaseAdmin();

  try {
    if (view === 'history') {
      const { data, error } = await db
        .from('email_campaigns')
        .select('id, subject, status, recipients_total, sent, failed, skipped_unsubscribed, failures, created_by, created_at')
        .order('created_at', { ascending: false })
        .limit(25);
      if (error) return fail(MIGRATION_HINT, 500, { migrationMissing: true });
      return NextResponse.json(data);
    }

    if (view === 'sources') {
      const sources = await discoverSources();
      const out = [];
      for (const src of sources) {
        try {
          out.push({ table: src.table, columns: src.columns, count: (await loadTableEmails(src)).length });
        } catch (e) {
          out.push({ table: src.table, columns: src.columns, count: 0, error: e instanceof Error ? e.message : 'unreadable' });
        }
      }
      return NextResponse.json(out);
    }

    if (view === 'audience') {
      const type = url.searchParams.get('type') || '';
      let list: Recipient[];
      if (type === 'table' || type === 'others') {
        // 'others' = every discovered table except profiles. A named table must be one the database reported.
        const sources = await discoverSources();
        const wanted = type === 'others' ? sources : sources.filter((s) => s.table === url.searchParams.get('name'));
        if (wanted.length === 0) return fail('Unknown table');
        list = normalizeRecipients((await Promise.all(wanted.map(loadTableEmails))).flat());
      } else {
        list = await loadAudience(type, url.searchParams.get('eventId'));
      }
      const unsub = await unsubscribedAmong(list.map((r) => r.email));
      const recipients = list.filter((r) => !unsub.has(r.email));
      return NextResponse.json({ recipients, removedUnsubscribed: list.length - recipients.length });
    }

    if (view === 'status') {
      const { error } = await db.from('email_unsubscribes').select('email').limit(1);
      return NextResponse.json({
        ready: !error && !!process.env.EMAIL_UNSUBSCRIBE_SECRET && !!process.env.RESEND_API_KEY,
        migrationMissing: !!error,
        secretMissing: !process.env.EMAIL_UNSUBSCRIBE_SECRET,
        resendKeyMissing: !process.env.RESEND_API_KEY,
        max: MAX_RECIPIENTS,
      });
    }

    return fail('Unknown view');
  } catch (e) {
    console.error('[bulk-mail] GET failed', e);
    if (e instanceof Error && e.message === 'MIGRATION') return fail(MIGRATION_HINT, 500, { migrationMissing: true });
    return fail(e instanceof Error ? e.message : 'Failed', 500);
  }
}

export async function POST(req: Request) {
  const { isAdmin, user } = await checkAdminAccess();
  if (!isAdmin || !user) return fail('Forbidden', 403);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return fail('Invalid request');
  }

  const action = String(body?.action || '');
  const content = readContent(body?.content);
  const recipients = normalizeRecipients(body?.recipients);

  // Preview: render exactly what will be sent, for the first recipient (or a sample).
  if (action === 'preview') {
    const sample = recipients[0] || { email: 'asha@example.com', name: 'Asha' };
    const built = buildCampaignEmail(content, sample, siteUrl('/api/email/unsubscribe?t=preview'));
    return NextResponse.json({ html: built.html, subject: built.subject, sampleName: sample.name || '' });
  }

  const invalid = validateContent(content);
  if (invalid) return fail(invalid);

  const secret = process.env.EMAIL_UNSUBSCRIBE_SECRET;
  if (!secret) return fail('Set EMAIL_UNSUBSCRIBE_SECRET in Vercel (any long random string) so every email can carry an unsubscribe link.', 500);
  if (!process.env.RESEND_API_KEY) return fail('RESEND_API_KEY is not set.', 500);

  const unsubscribeUrlFor = (email: string) => siteUrl(`/api/email/unsubscribe?t=${makeUnsubscribeToken(email, secret)}`);

  // Test: one copy to the admin's own inbox.
  if (action === 'test') {
    const to = (user.email || '').toLowerCase();
    if (!isValidEmail(to) || isPlaceholderEmail(to)) return fail('Your admin account has no real email address to send a test to.');
    const sample = recipients[0] || { email: to, name: '' };
    const built = buildCampaignEmail(content, { email: to, name: sample.name }, unsubscribeUrlFor(to));
    try {
      const res = await sendMail({ to, subject: `[TEST] ${built.subject}`, html: built.html, text: built.text, headers: built.headers, replyTo: 'hello@punerimallus.com' });
      if ((res as any)?.error) return fail((res as any).error.message || 'Send failed', 502);
    } catch (e) {
      return fail(e instanceof Error ? e.message : 'Send failed', 502);
    }
    return NextResponse.json({ ok: true, to });
  }

  if (action !== 'send') return fail('Unknown action');

  if (body?.confirmed !== true) return fail('Confirm the send first.');
  if (recipients.length === 0) return fail('Add at least one valid recipient.');
  if (recipients.length > MAX_RECIPIENTS) return fail(`Too many recipients (${recipients.length}). The limit per campaign is ${MAX_RECIPIENTS}; split the list, or raise BULK_EMAIL_MAX in Vercel.`);
  if (Number(body?.expectedCount) !== recipients.length) return fail('The recipient list changed since you confirmed. Review it and confirm again.');

  const db = supabaseAdmin();
  let skipped = 0;
  let sendable: Recipient[];
  try {
    const unsub = await unsubscribedAmong(recipients.map((r) => r.email));
    sendable = recipients.filter((r) => !unsub.has(r.email));
    skipped = recipients.length - sendable.length;
  } catch {
    return fail(MIGRATION_HINT, 500, { migrationMissing: true });
  }
  if (sendable.length === 0) return fail('Everyone on this list has unsubscribed.');

  // One campaign at a time: stops a double click or two admins from sending the same thing twice.
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: running } = await db.from('email_campaigns').select('id').eq('status', 'SENDING').gte('created_at', tenMinutesAgo).limit(1);
  if (running && running.length) return fail('Another campaign is still sending. Wait for it to finish.', 409);

  const { data: campaign, error: insertErr } = await db
    .from('email_campaigns')
    .insert({
      created_by: user.email || 'unknown',
      subject: content.subject,
      heading: content.heading,
      body: content.body,
      cta_label: content.ctaLabel || null,
      cta_url: content.ctaUrl || null,
      recipients_total: sendable.length,
      skipped_unsubscribed: skipped,
    })
    .select('id')
    .single();
  if (insertErr || !campaign) return fail(MIGRATION_HINT, 500, { migrationMissing: true });

  const result = await sendCampaign({
    content,
    recipients: sendable,
    unsubscribeUrlFor,
    deps: { sendBatch, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) },
  });

  const status = result.failed.length === 0 ? 'DONE' : result.sent > 0 ? 'PARTIAL' : 'FAILED';
  await db
    .from('email_campaigns')
    .update({ sent: result.sent, failed: result.failed.length, status, failures: result.failed.slice(0, 500), finished_at: new Date().toISOString() })
    .eq('id', campaign.id);

  return NextResponse.json({ campaignId: campaign.id, status, sent: result.sent, failed: result.failed.slice(0, 500), skippedUnsubscribed: skipped });
}
