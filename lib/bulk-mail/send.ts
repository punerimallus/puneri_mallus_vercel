import type { BatchMessage } from '../mail';
import { buildCampaignEmail } from './build';
import type { CampaignContent } from './templates';
import type { Recipient } from './recipients';

export interface SendDeps {
  sendBatch(messages: BatchMessage[]): Promise<{ ids: string[]; error: string | null }>;
  sleep(ms: number): Promise<void>;
}

export interface SendResult {
  sent: number;
  failed: { email: string; error: string }[];
}

export const BATCH_SIZE = 100; // Resend's limit per batch call
const PAUSE_BETWEEN_BATCHES_MS = 600; // stays under Resend's default 2 requests/second
const RETRY_DELAY_MS = 1500;

/**
 * Sends one personalised email per recipient, in batches. A failed batch is retried once; if it fails
 * again every address in it is reported as failed so the admin can retry just those.
 */
export async function sendCampaign(opts: {
  content: CampaignContent;
  recipients: Recipient[];
  unsubscribeUrlFor: (email: string) => string;
  deps: SendDeps;
}): Promise<SendResult> {
  const { content, recipients, unsubscribeUrlFor, deps } = opts;
  const result: SendResult = { sent: 0, failed: [] };

  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const chunk = recipients.slice(i, i + BATCH_SIZE);
    const messages: BatchMessage[] = chunk.map((r) => {
      const built = buildCampaignEmail(content, r, unsubscribeUrlFor(r.email));
      return { to: r.email, subject: built.subject, html: built.html, text: built.text, headers: built.headers, replyTo: 'hello@punerimallus.com' };
    });

    let outcome = await safeSend(deps, messages);
    if (outcome.error) {
      await deps.sleep(RETRY_DELAY_MS);
      outcome = await safeSend(deps, messages);
    }

    if (outcome.error) {
      for (const r of chunk) result.failed.push({ email: r.email, error: outcome.error });
    } else {
      result.sent += chunk.length;
    }

    if (i + BATCH_SIZE < recipients.length) await deps.sleep(PAUSE_BETWEEN_BATCHES_MS);
  }

  return result;
}

async function safeSend(deps: SendDeps, messages: BatchMessage[]) {
  try {
    return await deps.sendBatch(messages);
  } catch (e) {
    return { ids: [] as string[], error: e instanceof Error ? e.message : 'Send failed' };
  }
}
