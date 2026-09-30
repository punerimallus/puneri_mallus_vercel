import { emailLayout, esc, panel, siteUrl } from '../mail';
import type { CampaignContent } from './templates';

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
}

/** Replaces {{name}} and {{email}}. Unknown {{tags}} are left as typed so mistakes are visible in the preview. */
export function mergeTags(input: string, vars: { name?: string; email?: string }): string {
  const name = (vars.name || '').trim().split(/\s+/)[0] || 'there';
  return input
    .replace(/\{\{\s*name\s*\}\}/gi, name)
    .replace(/\{\{\s*email\s*\}\}/gi, vars.email || '');
}

const isHttps = (u: string) => /^https:\/\/[^\s"'<>]+$/i.test(u.trim());

/** Turns escaped text into inline HTML: **bold** and bare https links. Input MUST already be escaped. */
function inlineFormat(escaped: string): string {
  return escaped
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong style="color: #111827;">$1</strong>')
    .replace(
      /(^|[\s(])(https:\/\/[^\s<>"')]+)/g,
      '$1<a href="$2" target="_blank" style="color: #dc2626; text-decoration: underline;">$2</a>',
    );
}

/** Plain text in, email HTML out: blank line = new paragraph, single newline = line break. */
export function renderBodyHtml(body: string): string {
  return body
    .replace(/\r/g, '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        `<p style="margin: 0 0 14px; color: #374151; font-size: 14px; line-height: 1.7;">${inlineFormat(esc(p)).replace(/\n/g, '<br/>')}</p>`,
    )
    .join('');
}

export function renderBodyText(body: string): string {
  return body.replace(/\r/g, '').replace(/\*\*([^*\n]+)\*\*/g, '$1').trim();
}

export function validateContent(c: CampaignContent): string | null {
  if (!c.subject.trim()) return 'Add a subject.';
  if (c.subject.length > 150) return 'Subject is too long (150 characters max).';
  if (!c.heading.trim()) return 'Add a heading.';
  if (!c.body.trim()) return 'Write a message.';
  if (c.body.length > 20000) return 'Message is too long.';
  if (c.ctaLabel.trim() && !c.ctaUrl.trim()) return 'Add a button link, or clear the button text.';
  if (c.ctaUrl.trim() && !c.ctaLabel.trim()) return 'Add button text, or clear the button link.';
  if (c.ctaUrl.trim() && !isHttps(c.ctaUrl)) return 'Button link must start with https://';
  const leftover = [c.subject, c.preheader, c.heading, c.body, c.ctaLabel, c.footerNote]
    .join('\n')
    .match(/\{\{(?!\s*(?:name|email)\s*\}\})[^}]*\}\}/i);
  if (leftover) return `Replace the placeholder ${leftover[0]} before sending.`;
  return null;
}

/**
 * Builds one recipient's email in the site's standard layout. The unsubscribe URL is optional so the
 * live preview and test sends can render without one.
 */
export function buildCampaignEmail(
  content: CampaignContent,
  recipient: { email: string; name?: string },
  unsubscribeUrl?: string,
): BuiltEmail {
  const vars = { name: recipient.name, email: recipient.email };
  const subject = mergeTags(content.subject, vars).trim();
  const heading = esc(mergeTags(content.heading, vars));
  const body = mergeTags(content.body, vars);
  const preheader = mergeTags(content.preheader, vars).trim();
  const footerNote = content.footerNote.trim() ? esc(mergeTags(content.footerNote, vars)) : '';
  const cta = content.ctaLabel.trim() && isHttps(content.ctaUrl)
    ? { label: esc(mergeTags(content.ctaLabel, vars)), url: content.ctaUrl.trim() }
    : undefined;

  const footerLines = [
    footerNote,
    'Puneri Mallus Tribe, Pune',
    unsubscribeUrl
      ? `You are receiving this because you are part of the Puneri Mallus community. <a href="${unsubscribeUrl}" style="color: #4b5563; text-decoration: underline;">Unsubscribe</a>`
      : '',
  ].filter(Boolean);

  const hiddenPreheader = preheader
    ? `<div style="display: none; max-height: 0; overflow: hidden; opacity: 0; color: transparent;">${esc(preheader)}</div>`
    : '';

  const html = hiddenPreheader + emailLayout({
    heading,
    body: panel(renderBodyHtml(body) || ''),
    cta,
    footer: footerLines.join('<br/>'),
  });

  const text = [
    mergeTags(content.heading, vars),
    '',
    renderBodyText(body),
    cta ? `\n${mergeTags(content.ctaLabel, vars)}: ${cta.url}` : '',
    '',
    footerNote ? mergeTags(content.footerNote, vars) : '',
    'Puneri Mallus Tribe, Pune',
    unsubscribeUrl ? `Unsubscribe: ${unsubscribeUrl}` : '',
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n').trim();

  const headers: Record<string, string> = {};
  if (unsubscribeUrl) {
    headers['List-Unsubscribe'] = `<${unsubscribeUrl}>, <mailto:hello@punerimallus.com?subject=unsubscribe>`;
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }

  return { subject, html, text, headers };
}

export { siteUrl };
