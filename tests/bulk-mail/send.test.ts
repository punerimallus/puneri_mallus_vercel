import { describe, it, expect } from 'vitest';
import { sendCampaign, BATCH_SIZE, SendDeps } from '@/lib/bulk-mail/send';
import { makeUnsubscribeToken, readUnsubscribeToken } from '@/lib/bulk-mail/unsubscribe';
import { EMPTY_CAMPAIGN } from '@/lib/bulk-mail/templates';

const content = { ...EMPTY_CAMPAIGN, subject: 'Hi {{name}}', heading: 'H', body: 'B' };
const people = (n: number) => Array.from({ length: n }, (_, i) => ({ email: `u${i}@x.com`, name: `User ${i}` }));

function fakeDeps(failures: number[] = []) {
  const calls: { to: string; subject: string; headers?: Record<string, string> }[][] = [];
  const sleeps: number[] = [];
  let attempt = 0;
  const deps: SendDeps = {
    async sendBatch(messages) {
      attempt++;
      calls.push(messages.map((m) => ({ to: m.to, subject: m.subject, headers: m.headers })));
      if (failures.includes(attempt)) return { ids: [], error: 'rate limited' };
      return { ids: messages.map((_, i) => `id${i}`), error: null };
    },
    async sleep(ms) { sleeps.push(ms); },
  };
  return { deps, calls, sleeps };
}

const unsub = (email: string) => `https://punerimallus.com/api/email/unsubscribe?t=${email}`;

describe('sendCampaign', () => {
  it('sends one personalised email per recipient, in batches of 100', async () => {
    const { deps, calls } = fakeDeps();
    const r = await sendCampaign({ content, recipients: people(250), unsubscribeUrlFor: unsub, deps });
    expect(r).toEqual({ sent: 250, failed: [] });
    expect(calls.map((c) => c.length)).toEqual([BATCH_SIZE, BATCH_SIZE, 50]);
    expect(calls[0][0]).toMatchObject({ to: 'u0@x.com', subject: 'Hi User' });
    expect(calls[0][0].headers?.['List-Unsubscribe']).toContain('u0@x.com');
  });

  it('retries a failed batch once and then succeeds', async () => {
    const { deps, calls, sleeps } = fakeDeps([1]);
    const r = await sendCampaign({ content, recipients: people(3), unsubscribeUrlFor: unsub, deps });
    expect(r.sent).toBe(3);
    expect(calls.length).toBe(2);
    expect(sleeps).toContain(1500);
  });

  it('reports every address in a batch that fails twice, and keeps going', async () => {
    const { deps } = fakeDeps([1, 2]); // first batch fails both attempts
    const r = await sendCampaign({ content, recipients: people(150), unsubscribeUrlFor: unsub, deps });
    expect(r.sent).toBe(50);
    expect(r.failed.length).toBe(100);
    expect(r.failed[0]).toEqual({ email: 'u0@x.com', error: 'rate limited' });
  });

  it('treats a thrown error like a failed batch', async () => {
    const deps: SendDeps = { sendBatch: async () => { throw new Error('network down'); }, sleep: async () => {} };
    const r = await sendCampaign({ content, recipients: people(2), unsubscribeUrlFor: unsub, deps });
    expect(r.sent).toBe(0);
    expect(r.failed.map((f) => f.error)).toEqual(['network down', 'network down']);
  });
});

describe('unsubscribe tokens', () => {
  const secret = 'test-secret';
  it('round-trips an address, case-insensitively', () => {
    expect(readUnsubscribeToken(makeUnsubscribeToken('Asha@X.com', secret), secret)).toBe('asha@x.com');
  });
  it('rejects tampering, the wrong secret and junk', () => {
    const t = makeUnsubscribeToken('a@x.com', secret);
    const [payload, mac] = t.split('.');
    const other = Buffer.from('b@x.com').toString('base64url');
    expect(readUnsubscribeToken(`${other}.${mac}`, secret)).toBeNull();
    expect(readUnsubscribeToken(`${payload}.${mac}x`, secret)).toBeNull();
    expect(readUnsubscribeToken(t, 'different')).toBeNull();
    expect(readUnsubscribeToken('garbage', secret)).toBeNull();
    expect(readUnsubscribeToken(t, '')).toBeNull();
  });
});
