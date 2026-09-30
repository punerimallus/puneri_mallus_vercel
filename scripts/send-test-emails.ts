// Sends one copy of every email the app can send to a single inbox, so you can see
// which ones land in spam. Uses the real functions from lib/mail.ts, so what you
// receive is exactly what customers receive.
//
//   npx tsx --env-file=.env.local scripts/send-test-emails.ts                 # to the default address
//   npx tsx --env-file=.env.local scripts/send-test-emails.ts a@x.com b@y.com # to one or more addresses
//
// Needs RESEND_API_KEY in .env.local (or the shell). Nothing is sent to real customers
// or to the real admin inbox: admin alerts are redirected to the same test address.

const RECIPIENTS = process.argv.slice(2).filter((a) => a.includes('@'));
if (RECIPIENTS.length === 0) RECIPIENTS.push('vineetpuliyath19@gmail.com');

if (!process.env.RESEND_API_KEY) {
  console.error('RESEND_API_KEY is not set. Put it in .env.local and run with --env-file=.env.local');
  process.exit(1);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// These lib/mail.ts functions catch and log their own errors instead of throwing,
// so a failure shows up as a "[Resend API Error]" / MAIL_* line above, not as FAILED.
const SWALLOWS_ERRORS = new Set([
  'Directory: verification received',
  'Directory: verified badge',
  'Admin: verification review',
]);

async function sendAllTo(TO: string) {
  // Admin alerts are normally addressed to these; point them at the test inbox.
  process.env.EMAIL_USER = TO;
  process.env.PAYMENT_ALERT_EMAIL = TO;

  const mail = await import('../lib/mail');
  const { generateTicketPdf, fetchLogoBase64 } = await import('../lib/payments/ticket-pdf');
  const { buildCampaignEmail } = await import('../lib/bulk-mail/build');
  const { CAMPAIGN_TEMPLATES } = await import('../lib/bulk-mail/templates');

  const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL || 'https://punerimallus.com').replace(/\/+$/, '');
  const bookingId = '7f3c2a10-5b9e-4c1d-9a6e-2d8f0b1c4e77';
  const tickets = [
    { categoryName: 'General', ticketNumber: 'PM-0001' },
    { categoryName: 'General', ticketNumber: 'PM-0002' },
  ];
  const event = { title: 'Sample Event', date: '2026-10-18', time: '6:00 PM', location: 'Pune' };
  const pdf = await generateTicketPdf({
    bookingId,
    purchaserEmail: TO,
    event,
    tickets: tickets.map((t) => ({ ...t, unitPrice: 500 })),
    pointsApplied: 0,
    logoBase64: await fetchLogoBase64(baseUrl),
    baseUrl,
  });

  const jobs: [string, () => Promise<unknown>][] = [
    ['Event passes (PDF)', () => mail.sendEventTicketEmail(TO, bookingId, tickets, 1050, pdf, event)],
    ['Premium membership', () => mail.sendPremiumMembershipEmail(TO, 'order_TEST123', 'pay_TEST123')],
    ['Mallu Mart access', () => mail.sendMartSubscriptionEmail(TO, 'Monthly', 'order_TEST123', 'pay_TEST123')],
    ['Verification code', () => mail.sendVerificationEmail(TO, '123456')],
    ['Community: pending', () => mail.sendPendingCommunityEmail(TO, 'Sample Community')],
    ['Community: approved', () => mail.sendApprovedCommunityEmail(TO, 'Sample Community', 'Admin', 'sample-id')],
    ['Community: rejected', () => mail.sendRejectedCommunityEmail(TO, 'Sample Community')],
    ['Admin: community pending', () => mail.sendAdminPendingAlert('Sample Community', 3)],
    ['Directory: listing received', () => mail.sendMartPendingEmail(TO, 'Sample Business')],
    ['Directory: listing rejected', () => mail.sendMartRejectedEmail(TO, 'Sample Business')],
    ['Directory: business live', () => mail.sendMartLiveEmail(TO, 'Sample Business', 'sample-id')],
    ['Directory: confirm email', () => mail.sendBusinessVerificationEmail(TO, `${baseUrl}/api/business/verify?token=sample`, 'Sample Business')],
    ['Directory: verification received', () => mail.sendMartVerificationPendingEmail(TO, 'Sample Business')],
    ['Directory: verified badge', () => mail.sendMartVerificationSuccessEmail(TO, 'Sample Business')],
    ['Admin: new listing', () => mail.sendAdminMartAlert('Sample Business', 'Food')],
    ['Admin: verification review', () => mail.sendAdminVerificationAlert('Sample Business')],
    ['Admin: access granted', () => mail.sendAdminAccessEmail(TO, 'Temp-Pass-123')],
    ['Football registration', () => mail.sendFootballReceiptEmail(TO, 'Sample FC', 'order_TEST123', 'pay_TEST123')],
    ['Bulk: announcement (Email Studio)', async () => {
      const tpl = CAMPAIGN_TEMPLATES.find((t) => t.id === 'announcement')!.content;
      const built = buildCampaignEmail(tpl, { email: TO, name: 'Friend' }, `${baseUrl}/api/email/unsubscribe?t=sample`);
      return mail.sendMail({ to: TO, subject: built.subject, html: built.html, text: built.text, headers: built.headers, replyTo: 'hello@punerimallus.com' });
    }],
    ['Admin: payment needs attention', () => mail.sendAdminPaymentAlert('Payment needs attention (test)', 'This is a test alert. No action needed.')],
  ];

  console.log(`Sending ${jobs.length} emails to ${TO}\n`);
  let failed = 0;
  for (const [name, run] of jobs) {
    try {
      const res = (await run()) as { error?: { message?: string } | null } | undefined;
      if (res && res.error) throw new Error(res.error.message || 'Resend returned an error');
      console.log(`  ${SWALLOWS_ERRORS.has(name) ? 'sent?   ' : 'sent    '}${name}${SWALLOWS_ERRORS.has(name) ? '  (check the log above for errors)' : ''}`);
    } catch (e) {
      failed++;
      console.log(`  FAILED  ${name}: ${e instanceof Error ? e.message : e}`);
    }
    await sleep(800); // stay under Resend's rate limit
  }

  console.log(`\nDone: ${jobs.length - failed} sent, ${failed} failed.`);
  console.log('Check the inbox AND the Spam/Promotions tabs, then note which subjects landed where.');
  return failed;
}

async function main() {
  let failed = 0;
  for (const to of RECIPIENTS) failed += await sendAllTo(to);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
