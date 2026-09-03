import { Resend } from 'resend';

// Initialize Resend with your API key from .env
const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = 'Puneri Mallus Tribe <hello@punerimallus.com>';

export const sendVerificationEmail = async (to: string, token: string) => {
  return await resend.emails.send({
    from: FROM,
    to: to,
    subject: "Your verification code",
    text: `Welcome to the tribe. Your registration code is: ${token}. This code is valid for 10 minutes.`,
    html: `
      <div style="font-family: 'Segoe UI', Helvetica, Arial, sans-serif; max-width: 420px; margin: auto; background: #ffffff; color: #111827; padding: 32px; border-radius: 16px; border: 1px solid #e5e7eb; text-align: center;">
        <h2 style="color: #111827; margin-bottom: 8px;">Confirm it's you</h2>
        <p style="font-size: 14px; color: #6b7280;">Welcome to the tribe. Use the code below to complete your registration:</p>
        <div style="background: #f9fafb; padding: 20px; font-size: 32px; font-weight: 700; letter-spacing: 6px; margin: 20px 0; border: 1px solid #e5e7eb; border-radius: 10px; color: #111827;">
          ${token}
        </div>
        <p style="font-size: 12px; color: #9ca3af;">This code is valid for 10 minutes. If you didn't request this, you can ignore this email.</p>
      </div>
    `,
  });
};

export interface MailOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  attachments?: {
    filename: string;
    content: string | Buffer;
  }[];
}

export const sendMail = async ({ to, subject, text, html, attachments }: MailOptions) => {
  try {
    return await resend.emails.send({
      from: FROM,
      to: to,
      subject: subject,
      text: text || "You have a new message from Puneri Mallus.",
      html: html || text,
      attachments: attachments,
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
    html: `
      <div style="font-family: 'Segoe UI', Helvetica, Arial, sans-serif; max-width: 480px; margin: auto; background: #ffffff; color: #111827; padding: 40px; border-radius: 20px; border: 1px solid #e5e7eb; text-align: center;">
        <h2 style="font-weight: 700; font-size: 22px; margin-bottom: 15px; color: #111827;">Submission received</h2>
        <p style="font-size: 15px; color: #4b5563; line-height: 1.6; margin-bottom: 28px;">
          Hi there! Thank you for adding <b style="color: #111827;">${communityName}</b> to our community list.
        </p>
        <div style="padding: 16px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px; margin-bottom: 28px;">
          <p style="margin: 0; font-size: 13px; font-weight: 600; color: #6b7280;">Current status: pending review</p>
        </div>
        <p style="font-size: 13px; color: #9ca3af; line-height: 1.6;">
          Our team is currently checking the details. We'll send another email as soon as it's approved and visible to everyone.
        </p>
        <hr style="border: 0; border-top: 1px solid #f0f0f0; margin: 32px 0;" />
        <p style="font-size: 11px; color: #9ca3af;">Puneri Mallus Tribe Community</p>
      </div>
    `,
  });
};

export const sendApprovedCommunityEmail = async (to: string, communityName: string, adminName: string, communityId: string) => {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://puneri-mallus-vercel.vercel.app';
  const directLink = `${baseUrl}/community/${communityId}`;

  return await resend.emails.send({
    from: FROM,
    to: to,
    subject: "Your community is now live",
    text: `Congratulations! Your community ${communityName} has been approved by ${adminName}. View it here: ${directLink}`,
    html: `
      <div style="font-family: 'Segoe UI', Helvetica, Arial, sans-serif; max-width: 480px; margin: auto; background: #ffffff; color: #111827; padding: 40px; border-radius: 20px; border: 1px solid #e5e7eb; text-align: center;">
        <h2 style="font-weight: 700; font-size: 22px; margin-bottom: 15px; color: #111827;">You're live!</h2>
        <p style="font-size: 15px; color: #4b5563; line-height: 1.6; margin-bottom: 28px;">
          Congratulations! Your community <b style="color: #111827;">${communityName}</b> has been approved and is now visible on our website.
        </p>
        <div style="padding: 12px; background: #f9fafb; border-radius: 12px; margin-bottom: 28px; border: 1px solid #e5e7eb;">
          <p style="margin: 0; font-size: 12px; color: #4b5563;">Approved by: <b>${adminName}</b></p>
        </div>
        <a href="${directLink}" style="display: inline-block; background: #dc2626; color: #ffffff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">View community page</a>
        <p style="margin-top: 32px; font-size: 12px; color: #9ca3af;">
          Thank you for being a part of the Puneri Mallus Tribe.
        </p>
      </div>
    `,
  });
};

export const sendAdminPendingAlert = async (communityName: string, pendingCount: number) => {
  return await resend.emails.send({
    from: FROM,
    to: process.env.EMAIL_USER || "punerimallus1@gmail.com",
    subject: "New community pending review",
    text: `A new community ${communityName} has been submitted. Communities awaiting approval: ${pendingCount}. Open admin dashboard: https://puneri-mallus-vercel.vercel.app/admin/community`,
    html: `
      <div style="font-family: sans-serif; max-width: 450px; margin: auto; background: #fff; color: #111827; padding: 36px; border: 1px solid #e5e7eb; border-radius: 16px;">
        <h2 style="color: #111827; font-size: 20px;">New submission</h2>
        <p>A new community <b>${communityName}</b> has been submitted and needs review.</p>
        <div style="background: #f9fafb; padding: 20px; border-radius: 12px; margin: 20px 0; text-align: center; border: 1px solid #e5e7eb;">
          <p style="margin: 0; font-size: 12px; color: #6b7280;">Total queue</p>
          <h1 style="margin: 5px 0; font-size: 40px; color: #111827;">${pendingCount}</h1>
          <p style="margin: 0; font-size: 11px; color: #6b7280;">Communities awaiting approval</p>
        </div>
        <a href="https://puneri-mallus-vercel.vercel.app/admin/community" style="display: block; background: #111827; color: #fff; text-align: center; padding: 14px; border-radius: 8px; text-decoration: none; font-weight: 600;">Open admin dashboard</a>
      </div>
    `,
  });
};

export const sendMartPendingEmail = async (to: string, businessName: string) => {
  return await resend.emails.send({
    from: FROM,
    to: to,
    subject: `Listing received: ${businessName}`,
    text: `Your listing for ${businessName} has been received and added to our audit queue. Current status: under review. We'll update you once live.`,
    html: `
      <div style="font-family: 'Segoe UI', Helvetica, Arial, sans-serif; max-width: 480px; margin: auto; background: #ffffff; color: #111827; padding: 40px; border-radius: 20px; border: 1px solid #e5e7eb; text-align: center;">
        <h2 style="font-weight: 700; font-size: 22px; margin-bottom: 15px; color: #111827;">Listing received</h2>
        <p style="font-size: 15px; color: #4b5563; line-height: 1.6; margin-bottom: 28px;">
          Your listing for <b style="color: #111827;">${businessName}</b> has been received and added to our audit queue.
        </p>
        <div style="padding: 16px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px; margin-bottom: 28px;">
          <p style="margin: 0; font-size: 13px; font-weight: 600; color: #6b7280;">Current status: under review</p>
        </div>
        <p style="font-size: 13px; color: #9ca3af; line-height: 1.6;">
          Our team is currently verifying the business details. You'll get another update once your profile is live in the directory.
        </p>
        <hr style="border: 0; border-top: 1px solid #f0f0f0; margin: 32px 0;" />
        <p style="font-size: 11px; color: #9ca3af;">Puneri Mallus Mart — together for growth and good vibes</p>
      </div>
    `,
  });
};

export const sendMartLiveEmail = async (to: string, businessName: string) => {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'punerimallus.com';
  const directLink = `${baseUrl}/directory`;

  return await resend.emails.send({
    from: FROM,
    to: to,
    subject: `${businessName} is live in the directory`,
    text: `Great news! Your business ${businessName} has been approved and is now visible to the entire community. View your profile here: ${directLink}`,
    html: `
      <div style="font-family: 'Segoe UI', Helvetica, Arial, sans-serif; max-width: 480px; margin: auto; background: #ffffff; color: #111827; padding: 40px; border-radius: 20px; border: 1px solid #e5e7eb; text-align: center;">
        <h2 style="font-weight: 700; font-size: 22px; margin-bottom: 15px; color: #111827;">You're live!</h2>
        <p style="font-size: 15px; color: #4b5563; line-height: 1.6; margin-bottom: 28px;">
          Great news! Your business <b style="color: #111827;">${businessName}</b> has been approved and is now visible to the entire community in the directory.
        </p>
        <div style="padding: 12px; background: #f9fafb; border-radius: 12px; margin-bottom: 28px; border: 1px solid #e5e7eb;">
          <p style="margin: 0; font-size: 12px; color: #4b5563;">Your profile is now discoverable by the tribe.</p>
        </div>
        <a href="${directLink}" style="display: inline-block; background: #dc2626; color: #ffffff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">View in directory</a>
        <p style="margin-top: 32px; font-size: 12px; color: #9ca3af;">
          Thank you for powering the Puneri Mallus economy.
        </p>
      </div>
    `,
  });
};

export const sendMartRejectedEmail = async (to: string, businessName: string) => {
  return await resend.emails.send({
    from: FROM,
    to: to,
    subject: `Update on your directory listing`,
    text: `Your listing for ${businessName} was not approved during our recent audit. Please ensure your details are complete. Edit your listing: punerimallus.com/directory`,
    html: `
      <div style="font-family: 'Segoe UI', sans-serif; max-width: 480px; margin: auto; background: #ffffff; color: #111827; padding: 40px; border-radius: 20px; border: 1px solid #e5e7eb; text-align: center;">
        <h2 style="font-weight: 700; font-size: 22px; margin-bottom: 15px; color: #111827;">Listing update</h2>
        <p style="font-size: 15px; color: #4b5563; line-height: 1.6; margin-bottom: 28px;">
          Your listing for <b style="color: #111827;">${businessName}</b> wasn't approved during our recent audit.
        </p>
        <div style="padding: 14px; background: #fffbeb; border-radius: 12px; margin-bottom: 28px; border: 1px solid #fde68a;">
          <p style="margin: 0; font-size: 12px; color: #92400e;">Please make sure your details are complete and follow community guidelines.</p>
        </div>
        <a href="https://punerimallus.com/directory" style="display: inline-block; background: #111827; color: #fff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">Edit listing</a>
      </div>
    `,
  });
};

export const sendAdminMartAlert = async (businessName: string, category: string) => {
  return await resend.emails.send({
    from: FROM,
    to: process.env.EMAIL_USER || "punerimallus1@gmail.com",
    subject: `New directory listing: ${businessName}`,
    text: `A new professional listing for ${businessName} (Category: ${category}) has been submitted and needs review. Open admin dashboard: punerimallus.com/admin/mart`,
    html: `
      <div style="font-family: sans-serif; max-width: 450px; margin: auto; background: #fff; color: #111827; padding: 36px; border: 1px solid #e5e7eb; border-radius: 16px;">
        <h2 style="color: #111827; font-size: 20px;">New listing submission</h2>
        <p>A new professional listing for <b>${businessName}</b> has been submitted and needs review.</p>
        <div style="background: #f9fafb; padding: 16px; border-radius: 12px; margin: 20px 0; border: 1px solid #e5e7eb;">
          <p style="margin: 0; font-size: 10px; color: #6b7280; text-transform: uppercase;">Category</p>
          <p style="margin: 5px 0; font-size: 16px; font-weight: 600; color: #111827;">${category}</p>
        </div>
        <a href="https://punerimallus.com/admin/mart" style="display: block; background: #111827; color: #fff; text-align: center; padding: 14px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 13px;">Open admin dashboard</a>
      </div>
    `,
  });
};

export const sendRejectedCommunityEmail = async (to: string, communityName: string) => {
  return await resend.emails.send({
    from: FROM,
    to: to,
    subject: "Update on your community submission",
    text: `Your submission for ${communityName} was not approved for the community grid at this time. Please make sure all fields are correctly filled and images are clear.`,
    html: `
      <div style="font-family: 'Segoe UI', sans-serif; max-width: 480px; margin: auto; background: #ffffff; color: #111827; padding: 40px; border-radius: 20px; border: 1px solid #e5e7eb; text-align: center;">
        <h2 style="font-weight: 700; font-size: 22px; margin-bottom: 15px; color: #111827;">Submission update</h2>
        <p style="font-size: 15px; color: #4b5563; line-height: 1.6; margin-bottom: 28px;">
          Your submission for <b style="color: #111827;">${communityName}</b> wasn't approved for the community grid at this time.
        </p>
        <p style="font-size: 13px; color: #9ca3af; line-height: 1.6;">
          Please make sure all fields are correctly filled and the images are clear. You can re-submit or edit your listing anytime.
        </p>
        <hr style="border: 0; border-top: 1px solid #f0f0f0; margin: 32px 0;" />
        <p style="font-size: 11px; color: #9ca3af;">Puneri Mallus Tribe Community</p>
      </div>
    `,
  });
};

export async function sendMartVerificationPendingEmail(userEmail: string, businessName: string) {
  try {
    await resend.emails.send({
      from: FROM,
      to: userEmail,
      subject: `Verification received: ${businessName}`,
      text: `We have received the verification documents for ${businessName}. Current status: pending audit. This process typically takes 24-48 hours.`,
      html: `
        <div style="font-family: sans-serif; max-width: 560px; margin: auto; background: #ffffff; color: #111827; padding: 36px; border-radius: 16px; border: 1px solid #e5e7eb;">
          <h2 style="color: #111827; font-size: 20px; margin-bottom: 4px;">Verification received</h2>
          <p style="color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Request received</p>
          <hr style="border: 0; border-top: 1px solid #f0f0f0; margin: 20px 0;">
          <p>Hello,</p>
          <p>We've successfully received the verification documents for <strong>${businessName}</strong>.</p>
          <p>Our moderation team is currently reviewing your submission. This process typically takes <strong>24–48 hours</strong>. Once verified, your listing will receive the <strong>Verified Badge</strong>, increasing trust across the Tribe.</p>
          <div style="background: #f9fafb; padding: 18px; border-radius: 10px; margin-top: 20px; border: 1px solid #e5e7eb;">
            <p style="margin: 0; font-size: 11px; color: #6b7280;">Current status:</p>
            <p style="margin: 5px 0 0 0; color: #b45309; font-weight: 600;">Pending audit</p>
          </div>
          <p style="margin-top: 28px; font-size: 12px; color: #9ca3af;">If you didn't request this, please contact us.</p>
        </div>
      `,
    });
  } catch (error) {
    console.error("MAIL_VERIFY_USER_ERROR:", error);
  }
}

export async function sendAdminVerificationAlert(businessName: string) {
  try {
    await resend.emails.send({
      from: FROM,
      to: process.env.EMAIL_USER || "punerimallus1@gmail.com",
      subject: `Verification review needed: ${businessName}`,
      text: `A business owner has submitted documents for ${businessName}. Priority: high. Open the admin dashboard to review documents.`,
      html: `
        <div style="font-family: sans-serif; background: #f9fafb; padding: 40px; color: #111827;">
          <div style="max-width: 600px; margin: auto; background: #fff; padding: 30px; border-radius: 16px; border: 1px solid #e5e7eb;">
            <h2 style="margin-top: 0;">New verification request</h2>
            <p>A business owner has submitted documents for verification on Mallu Mart.</p>
            <table style="width: 100%; margin: 20px 0; border-collapse: collapse;">
              <tr>
                <td style="padding: 10px; border-bottom: 1px solid #eee; font-weight: 600;">Business:</td>
                <td style="padding: 10px; border-bottom: 1px solid #eee;">${businessName}</td>
              </tr>
              <tr>
                <td style="padding: 10px; border-bottom: 1px solid #eee; font-weight: 600;">Priority:</td>
                <td style="padding: 10px; border-bottom: 1px solid #eee; color: #b45309;">High</td>
              </tr>
            </table>
            <p>Please log in to the admin dashboard to review the Shop Act and ID documents.</p>
            <a href="${process.env.NEXT_PUBLIC_BASE_URL}/admin/mart" 
               style="display: inline-block; background: #111827; color: #fff; padding: 14px 24px; text-decoration: none; border-radius: 8px; font-weight: 600; margin-top: 10px;">
               Open admin dashboard
            </a>
          </div>
        </div>
      `,
    });
  } catch (error) {
    console.error("MAIL_ADMIN_VERIFY_ALERT_ERROR:", error);
  }
}

export async function sendMartVerificationSuccessEmail(userEmail: string, businessName: string) {
  try {
    await resend.emails.send({
      from: FROM,
      to: userEmail,
      subject: `${businessName} is now verified`,
      text: `Good news — your business ${businessName} has passed our manual audit. Your profile now features the Verified Badge.`,
      html: `
        <div style="font-family: sans-serif; max-width: 560px; margin: auto; background: #ffffff; color: #111827; padding: 36px; border-radius: 16px; border: 1px solid #e5e7eb;">
          <div style="text-align: center; margin-bottom: 16px;">
             <h1 style="font-size: 36px; margin: 0;">🛡️</h1>
          </div>
          <h2 style="color: #111827; text-align: center; font-size: 20px;">Verification complete</h2>
          <p style="color: #6b7280; font-size: 12px; text-align: center; text-transform: uppercase; letter-spacing: 1px;">Status: approved</p>
          <hr style="border: 0; border-top: 1px solid #f0f0f0; margin: 20px 0;">
          <p>Good news,</p>
          <p>Your business <strong>${businessName}</strong> has passed our manual audit. Your profile now features the <strong>Verified Badge</strong>.</p>
          <p>This badge signals to the Tribe that your business is legitimate, increasing your trust score and visibility in the directory.</p>
          <div style="background: #f9fafb; padding: 18px; border-radius: 10px; margin-top: 20px; border: 1px solid #e5e7eb; text-align: center;">
            <a href="${process.env.NEXT_PUBLIC_BASE_URL}/directory" style="color: #dc2626; text-decoration: none; font-weight: 600; font-size: 13px;">View your verified listing →</a>
          </div>
        </div>
      `,
    });
  } catch (error) {
    console.error("MAIL_VERIFY_SUCCESS_ERROR:", error);
  }
}

export async function sendMartSubscriptionEmail(to: string, plan: string, orderId: string, paymentId: string) {
  try {
    await resend.emails.send({
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
            <a href="${process.env.NEXT_PUBLIC_BASE_URL || 'punerimallus.com'}/directory" style="display: inline-block; background: #dc2626; color: #fff; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 13px;">Open directory</a>
          </div>
          <p style="margin-top: 32px; font-size: 11px; color: #9ca3af; text-align: center;">
            If your account doesn't reflect these changes, reply to this email and we'll help.
          </p>
        </div>
      `,
    });
  } catch (error) {
    console.error("MAIL_MART_SUBSCRIPTION_ERROR:", error);
  }
}

export async function sendPremiumMembershipEmail(to: string, orderId: string, paymentId: string) {
  try {
    await resend.emails.send({
      from: FROM,
      to: to,
      subject: `Welcome to Premium membership`,
      text: `Welcome to the premium tier of the Puneri Mallus Tribe. Plan: Lifetime Premium. Order ID: ${orderId}. Payment ID: ${paymentId}. Your permanent Premium Badge is now active.`,
      html: `
        <div style="font-family: 'Segoe UI', sans-serif; max-width: 480px; margin: auto; background: #ffffff; color: #111827; padding: 36px; border-radius: 20px; border: 1px solid #e5e7eb;">
          <div style="text-align: center; margin-bottom: 12px;">
             <h1 style="font-size: 36px; margin: 0;">👑</h1>
          </div>
          <h2 style="color: #111827; text-align: center; margin-top: 0;">Welcome to Premium</h2>
          <p style="text-align: center; color: #6b7280; font-size: 14px; margin-bottom: 28px;">Your transaction was successful. Welcome to the premium tier of the Puneri Mallus Tribe.</p>
          <div style="background: #f9fafb; padding: 18px; border-radius: 12px; border: 1px solid #e5e7eb; margin-bottom: 28px;">
            <p style="margin: 0 0 10px 0; font-size: 13px; color: #4b5563;"><strong>Plan:</strong> Lifetime Premium</p>
            <p style="margin: 0 0 10px 0; font-size: 13px; color: #4b5563;"><strong>Order ID:</strong> <span style="font-family: monospace;">${orderId}</span></p>
            <p style="margin: 0; font-size: 13px; color: #4b5563;"><strong>Payment ID:</strong> <span style="font-family: monospace;">${paymentId}</span></p>
          </div>
          <div style="margin-bottom: 28px;">
            <h4 style="color: #111827; font-size: 12px; letter-spacing: 0.5px; border-bottom: 1px solid #f0f0f0; padding-bottom: 6px;">Your benefits</h4>
            <ul style="color: #4b5563; font-size: 13px; line-height: 1.8; padding-left: 20px;">
              <li><strong>Permanent Premium Badge</strong> on your profile</li>
              <li>Free, unlimited access to all directory listings</li>
              <li>Event invitations and discounts</li>
              <li>A voice in community polls</li>
            </ul>
          </div>
          <div style="text-align: center;">
            <a href="${process.env.NEXT_PUBLIC_BASE_URL || 'punerimallus.com'}/profile" style="display: inline-block; background: #dc2626; color: #fff; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 13px;">View your profile</a>
          </div>
          <p style="margin-top: 32px; font-size: 11px; color: #9ca3af; text-align: center;">
            If your account doesn't reflect these changes, reply to this email and we'll help.
          </p>
        </div>
      `,
    });
  } catch (error) {
    console.error("MAIL_PREMIUM_SUBSCRIPTION_ERROR:", error);
  }
}

export async function sendAdminAccessEmail(to: string, tempPassword: string) {
  const loginUrl = `${process.env.NEXT_PUBLIC_BASE_URL || 'punerimallus.com'}/login`;

  try {
    await resend.emails.send({
      from: FROM,
      to: to,
      subject: `Your admin access to Puneri Mallus`,
      text: `You have been granted admin access. Admin ID: ${to}. Temporary password: ${tempPassword}. Log in here: ${loginUrl}`,
      html: `
        <div style="font-family: 'Segoe UI', sans-serif; max-width: 480px; margin: auto; background: #ffffff; color: #111827; padding: 36px; border-radius: 20px; border: 1px solid #e5e7eb;">
          <h2 style="color: #111827; text-align: center; margin-top: 0;">You've been granted admin access</h2>
          <p style="text-align: center; color: #6b7280; font-size: 14px; margin-bottom: 28px;">Use the credentials below to log in to the Puneri Mallus admin dashboard.</p>
          <div style="background: #f9fafb; padding: 22px; border-radius: 12px; border: 1px solid #e5e7eb; margin-bottom: 28px;">
            <p style="margin: 0 0 12px 0; font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Login page</p>
            <a href="${loginUrl}" style="color: #dc2626; word-break: break-all; font-size: 13px; text-decoration: none;">${loginUrl}</a>
            <p style="margin: 20px 0 12px 0; font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Admin ID</p>
            <p style="margin: 0; font-family: monospace; color: #111827; font-size: 14px;">${to}</p>
            <p style="margin: 20px 0 12px 0; font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Temporary password</p>
            <p style="margin: 0; font-family: monospace; color: #111827; font-size: 16px; font-weight: 600;">${tempPassword}</p>
          </div>
          <div style="background: #fffbeb; padding: 14px; border-radius: 10px; border: 1px solid #fde68a; margin-bottom: 28px;">
            <p style="margin: 0; font-size: 12px; color: #92400e; line-height: 1.5;">You'll be asked to set a permanent password the first time you log in.</p>
          </div>
          <div style="text-align: center;">
            <a href="${loginUrl}" style="display: inline-block; background: #111827; color: #fff; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 13px;">Log in</a>
          </div>
          <p style="margin-top: 32px; font-size: 11px; color: #9ca3af; text-align: center;">
            This email is confidential. Please don't forward it.
          </p>
        </div>
      `,
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
    html: `
      <div style="font-family: sans-serif; max-width: 420px; margin: auto; background: #ffffff; color: #111827; padding: 32px; border-radius: 16px; border: 1px solid #e5e7eb; text-align: center;">
        <h2 style="color: #111827; margin-bottom: 8px;">Confirm your email</h2>
        <p style="font-size: 14px; color: #6b7280; line-height: 1.6; margin-bottom: 28px;">
          Hi, we received a request to list <br/><strong style="color: #111827; font-size: 16px;">${businessName}</strong><br/> in the directory. Click below to confirm this email address.
        </p>
        <a href="${verifyLink}" style="display: inline-block; background: #dc2626; color: #fff; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px;">
          Confirm email
        </a>
        <p style="font-size: 11px; color: #9ca3af; margin-top: 32px; line-height: 1.5;">
          If you didn't request this, you can safely ignore this email.
        </p>
      </div>
    `,
  });
};

export const sendFootballReceiptEmail = async (to: string, teamName: string, orderId: string, paymentId: string) => {
  return await resend.emails.send({
    from: FROM,
    to: to,
    subject: `Registration confirmed: ${teamName}`,
    text: `Your team ${teamName} is officially registered for the tournament. Order ID: ${orderId}. Payment ref: ${paymentId}.`,
    html: `
      <div style="font-family: sans-serif; max-width: 420px; margin: auto; background: #ffffff; color: #111827; padding: 32px; border-radius: 16px; border: 1px solid #e5e7eb; text-align: center;">
        <h2 style="color: #111827; margin-bottom: 8px;">Slot secured</h2>
        <p style="font-size: 14px; color: #6b7280; line-height: 1.6; margin-bottom: 20px;">
          Your team <strong style="color: #111827; font-size: 16px;">${teamName}</strong> is officially registered for the tournament.
        </p>
        <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; text-align: left; margin-bottom: 28px;">
          <p style="font-size: 11px; color: #6b7280; margin: 0 0 5px 0;">Order ID</p>
          <p style="font-size: 13px; font-family: monospace; color: #111827; margin: 0 0 14px 0;">${orderId}</p>
          <p style="font-size: 11px; color: #6b7280; margin: 0 0 5px 0;">Payment ref</p>
          <p style="font-size: 13px; font-family: monospace; color: #111827; margin: 0;">${paymentId}</p>
        </div>
        <p style="font-size: 11px; color: #9ca3af; line-height: 1.5;">
          The organizing committee will contact the team representative shortly with the fixtures and rulebook.
        </p>
      </div>
    `,
  });
};

export async function sendEventTicketEmail(to: string, bookingId: string, tickets: any[], totalAmount: number, pdfBase64: string, eventData: any) {
  const ticketNumbers = tickets.map(t => t.ticketNumber).join(', ');

  const calTitle = encodeURIComponent(eventData?.title || 'Puneri Mallus Event');
  const calLocation = encodeURIComponent(eventData?.location || 'Pune');
  const calDetails = encodeURIComponent('Your event passes are attached in your email!');
  const googleCalendarUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${calTitle}&location=${calLocation}&details=${calDetails}`;

  try {
    return await resend.emails.send({
      from: FROM,
      to: to,
      subject: `Your passes are confirmed — ${eventData?.title || 'Puneri Mallus'}`,
      text: `Your passes are ready! Booking ID: ${bookingId.split('-')[0].toUpperCase()}. Total paid: ₹${totalAmount.toLocaleString('en-IN')}. Please open the attached PDF to view and scan your passes.`,
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
                <td align="right" style="color: #111827; font-size: 17px; font-weight: 700; padding-right: 20px;">₹${totalAmount.toLocaleString('en-IN')}</td>
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
  } catch (error) {
    console.error("MAIL_TICKET_ERROR:", error);
  }
}