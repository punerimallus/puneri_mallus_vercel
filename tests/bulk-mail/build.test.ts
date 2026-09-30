import { describe, it, expect } from 'vitest';
import { buildCampaignEmail, mergeTags, validateContent } from '@/lib/bulk-mail/build';
import { EMPTY_CAMPAIGN, CAMPAIGN_TEMPLATES } from '@/lib/bulk-mail/templates';

const content = {
  ...EMPTY_CAMPAIGN,
  subject: 'Hello {{name}}',
  heading: 'Big news',
  body: 'Hi {{name}},\n\nWe **love** you. Visit https://punerimallus.com/events now.\nSecond line.',
  ctaLabel: 'Book',
  ctaUrl: 'https://punerimallus.com/events',
};

describe('buildCampaignEmail', () => {
  it('uses the shared layout and personalises name and email', () => {
    const m = buildCampaignEmail(content, { email: 'a@x.com', name: 'Asha Nair' }, 'https://punerimallus.com/api/email/unsubscribe?t=abc');
    expect(m.subject).toBe('Hello Asha');
    expect(m.html).toContain('Puneri Mallus');
    expect(m.html).toContain('Hi Asha,');
    expect(m.html).toContain('<strong');
    expect(m.html).toContain('>Book</a>');
    expect(m.text).toContain('Book: https://punerimallus.com/events');
    expect(m.text).not.toContain('**');
  });

  it("falls back to 'there' when there is no name", () => {
    expect(mergeTags('Hi {{name}}', { email: 'a@x.com' })).toBe('Hi there');
  });

  it('escapes admin-typed HTML and recipient names', () => {
    const m = buildCampaignEmail(
      { ...content, body: '<script>alert(1)</script> {{name}}' },
      { email: 'a@x.com', name: '<img src=x>' },
    );
    expect(m.html).not.toContain('<script>');
    expect(m.html).not.toContain('<img src=x>');
    expect(m.html).toContain('&lt;script&gt;');
  });

  it('adds one-click unsubscribe headers and a footer link only when given a URL', () => {
    const url = 'https://punerimallus.com/api/email/unsubscribe?t=abc';
    const withUrl = buildCampaignEmail(content, { email: 'a@x.com' }, url);
    expect(withUrl.headers['List-Unsubscribe']).toContain(url);
    expect(withUrl.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(withUrl.html).toContain(url);
    expect(withUrl.text).toContain(`Unsubscribe: ${url}`);
    expect(buildCampaignEmail(content, { email: 'a@x.com' }).headers).toEqual({});
  });

  it('never renders a non-https button, and only https links become clickable', () => {
    const m = buildCampaignEmail(
      { ...content, ctaUrl: 'javascript:alert(1)', body: 'see http://insecure.example and https://ok.example' },
      { email: 'a@x.com' },
    );
    expect(m.html).not.toContain('javascript:');
    expect(m.html).not.toContain('href="http://insecure');
    expect(m.html).toContain('href="https://ok.example"');
  });

  it('every built-in template renders', () => {
    for (const t of CAMPAIGN_TEMPLATES.filter((t) => t.id !== 'blank')) {
      const m = buildCampaignEmail(t.content, { email: 'a@x.com', name: 'Asha' });
      expect(m.html.length).toBeGreaterThan(500);
      expect(m.html).not.toMatch(/\{\{\s*name\s*\}\}/);
    }
  });
});

describe('validateContent', () => {
  it('accepts a complete message', () => expect(validateContent(content)).toBeNull());
  it('needs subject, heading and message', () => {
    expect(validateContent({ ...content, subject: ' ' })).toMatch(/subject/i);
    expect(validateContent({ ...content, heading: '' })).toMatch(/heading/i);
    expect(validateContent({ ...content, body: '' })).toMatch(/message/i);
  });
  it('needs button text and link together, and https', () => {
    expect(validateContent({ ...content, ctaUrl: '' })).toMatch(/link/i);
    expect(validateContent({ ...content, ctaLabel: '' })).toMatch(/text/i);
    expect(validateContent({ ...content, ctaUrl: 'http://x.com' })).toMatch(/https/);
  });
  it('blocks unreplaced template placeholders but allows name and email', () => {
    expect(validateContent({ ...content, subject: "You're invited: {{event name}}" })).toMatch(/event name/);
    expect(validateContent({ ...content, body: 'Hi {{ Name }}, {{email}}' })).toBeNull();
  });
});
