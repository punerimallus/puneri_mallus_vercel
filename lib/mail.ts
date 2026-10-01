import { Resend } from 'resend';

// Created on first send, not at import: `new Resend()` throws without an API key,
// which broke `next build` in environments (e.g. Vercel previews) where it isn't set.
let resendClient: Resend | null = null;
function getResend(): Resend {
  if (!resendClient) {
    if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not set; cannot send email.");
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return resendClient;
}
const resend = {
  emails: {
    send: (...args: Parameters<Resend['emails']['send']>) => getResend().emails.send(...args),
  },
};

export const FROM = 'Puneri Mallus Tribe <hello@punerimallus.com>';

// ---------------------------------------------------------------------------
// Shared template. Every email uses the same layout as the ticket confirmation:
// brand header, one card, plain text alongside HTML, links on our own domain,
// no emoji or image icons, and user-supplied text HTML-escaped.
// ---------------------------------------------------------------------------

export const esc = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Always an absolute https link on our own domain, never a bare host or "undefined/...".
export function siteUrl(path = ''): string {
  const raw = (process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://punerimallus.com').trim().replace(/\/+$/, '');
  const base = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return `${base}${path}`;
}

export const para = (html: string) =>
  `<p style="margin: 0 0 14px; color: #4b5563; font-size: 14px; line-height: 1.6;">${html}</p>`;

export const panel = (html: string) =>
  `<div style="margin: 20px; background-color: #f9fafb; border-radius: 14px; padding: 22px; border: 1px solid #e5e7eb;">${html}</div>`;

export const detail = (label: string, valueHtml: string, mono = false) =>
  `<p style="margin: 0 0 10px; font-size: 13px; color: #4b5563;"><strong>${label}:</strong> <span${mono ? ' style="font-family: monospace;"' : ''}>${valueHtml}</span></p>`;

export function emailLayout(opts: {
  heading: string;
  subtitle?: string;
  body?: string;
  cta?: { label: string; url: string };
  footer?: string;
}): string {
  const { heading, subtitle, body = '', cta, footer } = opts;
  return `
    <div style="font-family: 'Segoe UI', Helvetica, Arial, sans-serif; background-color: #f4f5f9; padding: 40px 20px; color: #111827;">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.06);">
        <div style="text-align: center; padding: 36px 20px 16px;">
          <h1 style="color: #111827; font-size: 26px; font-weight: 700; margin: 0;">Puneri Mallus</h1>
          <h2 style="color: #111827; font-size: 18px; font-weight: 600; margin: 14px 0 5px;">${heading}</h2>
          ${subtitle ? `<p style="color: #6b7280; font-size: 13px; margin: 0;">${subtitle}</p>` : ''}
        </div>
        ${body}
        ${cta ? `
        <div style="text-align: center; margin: 28px 20px;">
          <a href="${cta.url}" target="_blank" style="display: inline-block; background-color: #111827; color: #fff; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 13px;">${cta.label}</a>
        </div>` : ''}
        <div style="text-align: center; padding: 16px; background-color: #f9fafb; margin-top: 16px;">
          <p style="margin: 0; color: #4b5563; font-size: 12px;">${footer || 'Puneri Mallus Tribe'}</p>
        </div>
      </div>
    </div>
  `;
}

export const sendVerificationEmail = async (to: string, token: string) => {
  return await resend.emails.send({
    from: FROM,
    to: to,
    subject: "Your verification code",
    text: `Welcome to the tribe. Your registration code is: ${token}. This code is valid for 10 minutes.`,
    html: emailLayout({
      heading: "Confirm it's you",
      subtitle: 'Welcome to the tribe. Use the code below to complete your registration.',
      body: panel(`<p style="margin: 0; text-align: center; font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #111827;">${esc(token)}</p>`),
      footer: "This code is valid for 10 minutes. If you didn't request it, you can ignore this email.",
    }),
  });
};

export interface MailOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  headers?: Record<string, string>;
  replyTo?: string;
  attachments?: {
    filename: string;
    content: string | Buffer;
  }[];
}

export const sendMail = async ({ to, subject, text, html, attachments, headers, replyTo }: MailOptions) => {
  try {
    return await resend.emails.send({
      from: FROM,
      to: to,
      subject: subject,
      text: text || "You have a new message from Puneri Mallus.",
      html: html || text,
      attachments: attachments,
      ...(headers ? { headers } : {}),
      ...(replyTo ? { replyTo } : {}),
    });
  } catch (error) {
    console.error("GENERIC_MAIL_SEND_ERROR:", error);
    throw new Error("Failed to send email via Resend");
  }
};

export const sendPendingCommunityEmail = async (to: string, communityName: string) => {
  return await resend.emails.send({
    from: FROM,
    to: to,
    subject: "We've received your community submission",
    text: `Thank you for adding ${communityName} to our community list. Current status: pending review. Our team will notify you once approved.`,
    html: emailLayout({
      heading: 'Submission received',
      subtitle: `Thank you for adding ${esc(communityName)} to our community list.`,
      body: panel(
        detail('Community', esc(communityName)) +
        detail('Status', 'Pending review') +
        para("Our team is checking the details. We'll send another email as soon as it's approved and visible to everyone.")
      ),
      footer: 'Puneri Mallus Tribe Community',
    }),
  });
};

export const sendApprovedCommunityEmail = async (to: string, communityName: string, adminName: string, communityId: string) => {
  const directLink = siteUrl(`/community/${communityId}`);

  return await resend.emails.send({
    from: FROM,
    to: to,
    subject: "Your community is now live",
    text: `Congratulations! Your community ${communityName} has been approved by ${adminName}. View it here: ${directLink}`,
    html: emailLayout({
      heading: 'Your community is now live',
      subtitle: `${esc(communityName)} has been approved and is visible on our website.`,
      body: panel(detail('Community', esc(communityName)) + detail('Approved by', esc(adminName))),
      cta: { label: 'View community page', url: directLink },
      footer: 'Thank you for being a part of the Puneri Mallus Tribe.',
    }),
  });
};

export const sendAdminPendingAlert = async (communityName: string, pendingCount: number) => {
  const adminUrl = siteUrl('/admin/community');
  return await resend.emails.send({
    from: FROM,
    to: process.env.EMAIL_USER || "punerimallus1@gmail.com",
    subject: "New community pending review",
    text: `A new community ${communityName} has been submitted. Communities awaiting approval: ${pendingCount}. Open admin dashboard: ${adminUrl}`,
    html: emailLayout({
      heading: 'New community submission',
      subtitle: `${esc(communityName)} needs review.`,
      body: panel(detail('Community', esc(communityName)) + detail('Awaiting approval', esc(pendingCount))),
      cta: { label: 'Open admin dashboard', url: adminUrl },
      footer: 'Puneri Mallus admin notification',
    }),
  });
};

export const sendMartPendingEmail = async (to: string, businessName: string) => {
  return await resend.emails.send({
    from: FROM,
    to: to,
    subject: `Listing received: ${businessName}`,
    text: `Your listing for ${businessName} has been received and added to our audit queue. Current status: under review. We'll update you once live.`,
    html: emailLayout({
      heading: 'Listing received',
      subtitle: `Your listing for ${esc(businessName)} has been added to our audit queue.`,
      body: panel(
        detail('Business', esc(businessName)) +
        detail('Status', 'Under review') +
        para("Our team is verifying the business details. You'll get another update once your profile is live in the directory.")
      ),
      footer: 'Puneri Mallus Mart',
    }),
  });
};

export const sendMartRejectedEmail = async (to: string, businessName: string) => {
  const directoryUrl = siteUrl('/directory');
  return await resend.emails.send({
    from: FROM,
    to: to,
    subject: `Update on your directory listing`,
    text: `Your listing for ${businessName} was not approved during our recent audit. Please ensure your details are complete. Edit your listing: ${directoryUrl}`,
    html: emailLayout({
      heading: 'Listing update',
      subtitle: `Your listing for ${esc(businessName)} wasn't approved during our recent audit.`,
      body: panel(para('Please make sure your details are complete and follow the community guidelines, then submit your listing again.')),
      cta: { label: 'Edit listing', url: directoryUrl },
      footer: 'Puneri Mallus Mart',
    }),
  });
};

export const sendAdminMartAlert = async (businessName: string, category: string) => {
  const adminUrl = siteUrl('/admin/mart');
  return await resend.emails.send({
    from: FROM,
    to: process.env.EMAIL_USER || "punerimallus1@gmail.com",
    subject: `New directory listing: ${businessName}`,
    text: `A new professional listing for ${businessName} (Category: ${category}) has been submitted and needs review. Open admin dashboard: ${adminUrl}`,
    html: emailLayout({
      heading: 'New listing submission',
      subtitle: `${esc(businessName)} needs review.`,
      body: panel(detail('Business', esc(businessName)) + detail('Category', esc(category))),
      cta: { label: 'Open admin dashboard', url: adminUrl },
      footer: 'Puneri Mallus admin notification',
    }),
  });
};

export const sendRejectedCommunityEmail = async (to: string, communityName: string) => {
  return await resend.emails.send({
    from: FROM,
    to: to,
    subject: "Update on your community submission",
    text: `Your submission for ${communityName} was not approved for the community grid at this time. Please make sure all fields are correctly filled and images are clear.`,
    html: emailLayout({
      heading: 'Submission update',
      subtitle: `Your submission for ${esc(communityName)} wasn't approved for the community grid at this time.`,
      body: panel(para('Please make sure all fields are correctly filled and the images are clear. You can re-submit or edit your listing anytime.')),
      footer: 'Puneri Mallus Tribe Community',
    }),
  });
};

export async function sendMartVerificationPendingEmail(userEmail: string, businessName: string) {
  try {
    await resend.emails.send({
      from: FROM,
      to: userEmail,
      subject: `Verification received: ${businessName}`,
      text: `We have received the verification documents for ${businessName}. Current status: pending audit. This process typically takes 24-48 hours.`,
      html: emailLayout({
        heading: 'Verification received',
        subtitle: `We've received the verification documents for ${esc(businessName)}.`,
        body: panel(
          detail('Business', esc(businessName)) +
          detail('Status', 'Pending audit') +
          para('Our moderation team is reviewing your submission. This typically takes 24 to 48 hours. Once verified, your listing will receive the Verified Badge.')
        ),
        footer: "If you didn't request this, please contact us.",
      }),
    });
  } catch (error) {
    console.error("MAIL_VERIFY_USER_ERROR:", error);
  }
}

export async function sendAdminVerificationAlert(businessName: string) {
  const adminUrl = siteUrl('/admin/mart');
  try {
    await resend.emails.send({
      from: FROM,
      to: process.env.EMAIL_USER || "punerimallus1@gmail.com",
      subject: `Verification review needed: ${businessName}`,
      text: `A business owner has submitted documents for ${businessName}. Priority: high. Open the admin dashboard to review documents: ${adminUrl}`,
      html: emailLayout({
        heading: 'New verification request',
        subtitle: 'A business owner has submitted documents for verification on Mallu Mart.',
        body: panel(
          detail('Business', esc(businessName)) +
          detail('Priority', 'High') +
          para('Please log in to the admin dashboard to review the Shop Act and ID documents.')
        ),
        cta: { label: 'Open admin dashboard', url: adminUrl },
        footer: 'Puneri Mallus admin notification',
      }),
    });
  } catch (error) {
    console.error("MAIL_ADMIN_VERIFY_ALERT_ERROR:", error);
  }
}

export async function sendMartVerificationSuccessEmail(userEmail: string, businessName: string) {
  const directoryUrl = siteUrl('/directory');
  try {
    await resend.emails.send({
      from: FROM,
      to: userEmail,
      subject: `${businessName} is now verified`,
      text: `Good news — your business ${businessName} has passed our manual audit. Your profile now features the Verified Badge. View your listing: ${directoryUrl}`,
      html: emailLayout({
        heading: 'Verification complete',
        subtitle: `${esc(businessName)} has passed our manual audit.`,
        body: panel(
          detail('Business', esc(businessName)) +
          detail('Status', 'Approved') +
          para('Your profile now features the Verified Badge. It shows the Tribe that your business is legitimate and increases your visibility in the directory.')
        ),
        cta: { label: 'View your verified listing', url: directoryUrl },
        footer: 'Puneri Mallus Mart',
      }),
    });
  } catch (error) {
    console.error("MAIL_VERIFY_SUCCESS_ERROR:", error);
  }
}

export async function sendMartSubscriptionEmail(to: string, plan: string, orderId: string, paymentId: string) {
  const { error: sendError } = await resend.emails.send({
      from: FROM,
      to: to,
      subject: `Mallu Mart ${plan} access unlocked`,
      text: `You now have full access to Mallu Mart professional profiles. Plan: Mallu Mart ${plan}. Order ID: ${orderId}. Payment ID: ${paymentId}.`,
      html: `
        <div style="font-family: 'Segoe UI', sans-serif; max-width: 480px; margin: auto; background: #ffffff; color: #111827; padding: 36px; border-radius: 20px; border: 1px solid #e5e7eb;">
          <h2 style="color: #111827; text-align: center; margin-top: 0;">Access granted</h2>
          <p style="text-align: center; color: #6b7280; font-size: 14px; margin-bottom: 28px;">Your transaction was successful. You now have full access to Mallu Mart professional profiles.</p>
          <div style="background: #f9fafb; padding: 18px; border-radius: 12px; border: 1px solid #e5e7eb; margin-bottom: 28px;">
            <p style="margin: 0 0 10px 0; font-size: 13px; color: #4b5563;"><strong>Plan:</strong> Mallu Mart ${plan}</p>
            <p style="margin: 0 0 10px 0; font-size: 13px; color: #4b5563;"><strong>Order ID:</strong> <span style="font-family: monospace;">${orderId}</span></p>
            <p style="margin: 0; font-size: 13px; color: #4b5563;"><strong>Payment ID:</strong> <span style="font-family: monospace;">${paymentId}</span></p>
          </div>
          <div style="margin-bottom: 28px;">
            <h4 style="color: #111827; font-size: 12px; letter-spacing: 0.5px; border-bottom: 1px solid #f0f0f0; padding-bottom: 6px;">Benefits unlocked</h4>
            <ul style="color: #4b5563; font-size: 13px; line-height: 1.8; padding-left: 20px;">
              <li>Instant access to hidden business portfolios</li>
              <li>Direct WhatsApp & calling integration</li>
              <li>Access to Google Maps navigation links</li>
            </ul>
          </div>
          <div style="text-align: center;">
            <a href="${siteUrl('/directory')}" style="display: inline-block; background: #dc2626; color: #fff; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 13px;">Open directory</a>
          </div>
          <p style="margin-top: 32px; font-size: 11px; color: #9ca3af; text-align: center;">
            If your account doesn't reflect these changes, reply to this email and we'll help.
          </p>
        </div>
      `,
    });
  // Throw so callers can record the failure and retry; a silent miss means a paid user never gets their email.
  if (sendError) throw new Error(`MAIL_MART_SUBSCRIPTION_ERROR: ${sendError.message}`);
}

export async function sendPremiumMembershipEmail(to: string, orderId: string, paymentId: string) {
  const profileUrl = siteUrl('/profile');

  const { error: sendError } = await resend.emails.send({
      from: FROM,
      to: to,
      subject: `Your Puneri Mallus membership is confirmed`,
      text: `Your membership is confirmed. Plan: Lifetime Premium. Order ID: ${orderId}. Payment ID: ${paymentId}. Your Premium badge is now active on your profile: ${profileUrl}`,
      html: emailLayout({
        heading: 'Your membership is confirmed',
        subtitle: 'Thank you for joining the Puneri Mallus Tribe.',
        body:
          panel(
            `<h3 style="margin: 0 0 14px; font-size: 15px; color: #111827; font-weight: 600;">Payment details</h3>` +
            detail('Plan', 'Lifetime Premium') +
            detail('Order ID', esc(orderId), true) +
            detail('Payment ID', esc(paymentId), true)
          ) +
          `<div style="margin: 20px;">
            <h4 style="color: #111827; font-size: 12px; letter-spacing: 0.5px; border-bottom: 1px solid #f0f0f0; padding-bottom: 6px;">Your benefits</h4>
            <ul style="color: #4b5563; font-size: 13px; line-height: 1.8; padding-left: 20px;">
              <li>Permanent Premium badge on your profile</li>
              <li>Free, unlimited access to all directory listings</li>
              <li>Event invitations and discounts</li>
              <li>A voice in community polls</li>
            </ul>
          </div>`,
        cta: { label: 'View your profile', url: profileUrl },
        footer: "If your account doesn't reflect these changes, reply to this email and we'll help.",
      }),
    });
  // Throw so callers can record the failure and retry; a silent miss means a paid user never gets their email.
  if (sendError) throw new Error(`MAIL_PREMIUM_SUBSCRIPTION_ERROR: ${sendError.message}`);
}

export async function sendAdminAccessEmail(to: string, tempPassword: string) {
  const loginUrl = siteUrl('/login');

  try {
    await resend.emails.send({
      from: FROM,
      to: to,
      subject: `Your admin access to Puneri Mallus`,
      text: `You have been granted admin access. Admin ID: ${to}. Temporary password: ${tempPassword}. Log in here: ${loginUrl}`,
      html: emailLayout({
        heading: "You've been granted admin access",
        subtitle: 'Use the details below to log in to the Puneri Mallus admin dashboard.',
        body: panel(
          detail('Login page', esc(loginUrl)) +
          detail('Admin ID', esc(to), true) +
          detail('Temporary password', esc(tempPassword), true) +
          para("You'll be asked to set a permanent password the first time you log in.")
        ),
        cta: { label: 'Log in', url: loginUrl },
        footer: "This email is confidential. Please don't forward it.",
      }),
    });
  } catch (error) {
    console.error("MAIL_ADMIN_ACCESS_ERROR:", error);
    throw new Error("Failed to dispatch admin credentials.");
  }
}

export const sendBusinessVerificationEmail = async (to: string, verifyLink: string, businessName: string) => {
  return await resend.emails.send({
    from: FROM,
    to: to,
    subject: "Confirm your email for the directory",
    text: `We received a request to list ${businessName} in the directory. Please confirm this email address to proceed: ${verifyLink}`,
    html: emailLayout({
      heading: 'Confirm your email',
      subtitle: `We received a request to list ${esc(businessName)} in the directory.`,
      body: panel(para('Use the button below to confirm this email address and continue.')),
      cta: { label: 'Confirm email', url: verifyLink },
      footer: "If you didn't request this, you can safely ignore this email.",
    }),
  });
};

// Notice the 3 arguments here! (to, businessName, businessId)
export const sendMartLiveEmail = async (to: string, businessName: string, businessId: string) => {
  const listingUrl = siteUrl(`/directory/${businessId}`);

  return await resend.emails.send({
    from: FROM,
    to: to,
    subject: "Your business is Live on Mallu Connect!",
    text: `Great news! ${businessName} is now live in the directory. View it here: ${listingUrl}. Don't forget to log in and upload your documents to get your free Verified Badge!`,
    html: emailLayout({
      heading: 'Your business is live',
      subtitle: `${esc(businessName)} has been approved and is now visible in the directory.`,
      body: panel(
        `<h3 style="margin: 0 0 8px; font-size: 15px; color: #111827; font-weight: 600;">Get the Verified Badge</h3>` +
        para('Log in to your listing and upload your business registration documents. Once reviewed, you will receive the Verified Badge next to your name.') +
        para('Your listing and verification are free for the first year.')
      ),
      cta: { label: 'View your listing', url: listingUrl },
      footer: 'The Mallu Connect Team',
    }),
  });
};

export const sendFootballReceiptEmail = async (to: string, teamName: string, orderId: string, paymentId: string) => {
  return await resend.emails.send({
    from: FROM,
    to: to,
    subject: `Registration confirmed: ${teamName}`,
    text: `Your team ${teamName} is officially registered for the tournament. Order ID: ${orderId}. Payment ref: ${paymentId}.`,
    html: emailLayout({
      heading: 'Registration confirmed',
      subtitle: `Your team ${esc(teamName)} is registered for the tournament.`,
      body: panel(
        detail('Team', esc(teamName)) +
        detail('Order ID', esc(orderId), true) +
        detail('Payment ref', esc(paymentId), true) +
        para('The organizing committee will contact the team representative shortly with the fixtures and rulebook.')
      ),
    }),
  });
};

export interface BatchMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
  replyTo?: string;
}

/** Sends up to 100 separate emails in one Resend call. Each message keeps its own single recipient. */
export async function sendBatch(messages: BatchMessage[]): Promise<{ ids: string[]; error: string | null }> {
  const { data, error } = await getResend().batch.send(
    messages.map((m) => ({
      from: FROM,
      to: m.to,
      subject: m.subject,
      html: m.html,
      text: m.text,
      ...(m.headers ? { headers: m.headers } : {}),
      ...(m.replyTo ? { replyTo: m.replyTo } : {}),
    })),
  );
  if (error) return { ids: [], error: error.message };
  return { ids: (data?.data || []).map((d) => d.id), error: null };
}

// "766" for whole rupees, "766.40" when there are paise.
const inr = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });

export async function sendEventTicketEmail(to: string, bookingId: string, tickets: { categoryName: string; ticketNumber: string }[], totalAmount: number, pdfBase64: string, eventData: { title?: string; location?: string } | null) {
  const ticketNumbers = tickets.map(t => t.ticketNumber).join(', ');

  const calTitle = encodeURIComponent(eventData?.title || 'Puneri Mallus Event');
  const calLocation = encodeURIComponent(eventData?.location || 'Pune');
  const calDetails = encodeURIComponent('Your event passes are attached in your email!');
  const googleCalendarUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${calTitle}&location=${calLocation}&details=${calDetails}`;

  const { error: sendError } = await resend.emails.send({
      from: FROM,
      to: to,
      subject: `Your passes are confirmed — ${eventData?.title || 'Puneri Mallus'}`,
      text: `Your passes are ready! Booking ID: ${bookingId.split('-')[0].toUpperCase()}. Total paid: ₹${inr(totalAmount)}. Please open the attached PDF to view and scan your passes.`,
      html: `
        <div style="font-family: 'Segoe UI', Helvetica, Arial, sans-serif; background-color: #f4f5f9; padding: 40px 20px; color: #111827;">
          <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.06);">
            <div style="text-align: center; padding: 36px 20px 16px;">
              <h1 style="color: #111827; font-size: 26px; font-weight: 700; margin: 0;">Puneri Mallus</h1>
              <h2 style="color: #111827; font-size: 18px; font-weight: 600; margin: 14px 0 5px;">Your passes are ready</h2>
              <p style="color: #6b7280; font-size: 13px; margin: 0;">Booking ID: <strong style="color: #111827;">${bookingId.split('-')[0].toUpperCase()}</strong></p>
            </div>
            <div style="margin: 20px; background-color: #f9fafb; border-radius: 14px; padding: 22px; border: 1px solid #e5e7eb;">
              <h3 style="margin: 0 0 14px; font-size: 15px; color: #111827; font-weight: 600;">Your access</h3>
              ${tickets.map(t => `
                <div style="margin-bottom: 12px;">
                  <p style="margin: 0; color: #6b7280; font-size: 11px; letter-spacing: 0.5px;">Category</p>
                  <p style="margin: 2px 0 0; color: #dc2626; font-size: 15px; font-weight: 600;">${t.categoryName}</p>
                </div>
              `).join('')}
              <div style="margin-top: 20px; padding-top: 16px; border-top: 1px dashed #e5e7eb;">
                <p style="margin: 0; color: #6b7280; font-size: 11px; letter-spacing: 0.5px;">Pass identifiers</p>
                <p style="margin: 5px 0 0; color: #111827; font-size: 16px; font-weight: 600;">${ticketNumbers}</p>
              </div>
            </div>
            <div style="text-align: center; margin: 28px 20px;">
              <a href="${googleCalendarUrl}" target="_blank" style="display: inline-block; background-color: #111827; color: #fff; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 13px;">
                Add to Google Calendar
              </a>
            </div>
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top: 16px; border-top: 1px solid #f0f0f0; padding-top: 16px;">
              <tr>
                <td align="left" style="color: #6b7280; font-size: 13px; font-weight: 600; padding-left: 20px;">Total paid</td>
                <td align="right" style="color: #111827; font-size: 17px; font-weight: 700; padding-right: 20px;">₹${inr(totalAmount)}</td>
              </tr>
            </table>
            <div style="text-align: center; padding: 16px; background-color: #f9fafb; margin-top: 16px;">
              <p style="margin: 0; color: #4b5563; font-size: 12px;">Open the attached PDF to view your passes</p>
            </div>
          </div>
        </div>
      `,
      attachments: [
        {
          filename: `PM_Passes_${bookingId.split('-')[0]}.pdf`,
          content: pdfBase64,
        }
      ]
    });
  // Throw so callers can record the failure and retry; a silent miss means a paid user never gets their email.
  if (sendError) throw new Error(`MAIL_TICKET_ERROR: ${sendError.message}`);
}

export async function sendAdminPaymentAlert(subject: string, body: string) {
  const { error: sendError } = await resend.emails.send({
    from: FROM,
    to: process.env.PAYMENT_ALERT_EMAIL || process.env.EMAIL_USER || "punerimallus1@gmail.com",
    subject,
    text: body,
  });
  if (sendError) throw new Error(`MAIL_ADMIN_PAYMENT_ALERT_ERROR: ${sendError.message}`);
}
