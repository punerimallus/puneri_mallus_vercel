import { NextResponse } from 'next/server';
import { readUnsubscribeToken } from '@/lib/bulk-mail/unsubscribe';
import { supabaseAdmin } from '@/lib/payments/server';

export const dynamic = 'force-dynamic';

const page = (title: string, message: string, form?: { token: string }, status = 200) =>
  new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;background:#f4f5f9;font-family:'Segoe UI',Helvetica,Arial,sans-serif;color:#111827;">
  <div style="max-width:480px;margin:60px auto;padding:0 20px;">
    <div style="background:#fff;border-radius:16px;padding:36px 28px;text-align:center;box-shadow:0 4px 16px rgba(0,0,0,.06);">
      <h1 style="margin:0 0 6px;font-size:24px;">Puneri Mallus</h1>
      <h2 style="margin:0 0 14px;font-size:17px;font-weight:600;">${title}</h2>
      <p style="margin:0 0 22px;color:#4b5563;font-size:14px;line-height:1.6;">${message}</p>
      ${form ? `<form method="POST" action="/api/email/unsubscribe"><input type="hidden" name="t" value="${form.token.replace(/[^A-Za-z0-9._-]/g, '')}"><button type="submit" style="background:#111827;color:#fff;border:0;border-radius:8px;padding:14px 28px;font-weight:600;font-size:13px;cursor:pointer;">Yes, unsubscribe me</button></form>` : ''}
    </div>
  </div>
</body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
  );

const secret = () => process.env.EMAIL_UNSUBSCRIBE_SECRET || '';

// GET only shows a confirmation button. Mail scanners and link previews fetch GET links,
// so a GET must never change anything.
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('t') || '';
  const email = readUnsubscribeToken(token, secret());
  if (!email) return page('Link not valid', 'This unsubscribe link is invalid or has expired. Reply to any of our emails and we will remove you by hand.', undefined, 400);
  return page('Unsubscribe', `Stop receiving community emails at <strong>${email.replace(/[<>&"]/g, '')}</strong>? You will still get receipts and passes for anything you buy.`, { token });
}

// POST is used by the button above and by mail apps' one-click unsubscribe (RFC 8058).
export async function POST(req: Request) {
  let token = new URL(req.url).searchParams.get('t') || '';
  if (!token) {
    try {
      token = String((await req.formData()).get('t') || '');
    } catch {
      token = '';
    }
  }
  const email = readUnsubscribeToken(token, secret());
  if (!email) return page('Link not valid', 'This unsubscribe link is invalid or has expired.', undefined, 400);

  const { error } = await supabaseAdmin()
    .from('email_unsubscribes')
    .upsert({ email, source: 'link' }, { onConflict: 'email', ignoreDuplicates: true });
  if (error) {
    console.error('[bulk-mail] unsubscribe failed', error.message);
    return page('Something went wrong', 'We could not save your request. Please try again in a minute.', undefined, 500);
  }
  return page('You are unsubscribed', 'You will no longer receive community emails from us. Receipts and passes for purchases are not affected.');
}
