import nodemailer from 'nodemailer';

// 1. Create the transporter using your Gmail credentials
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

export const sendVerificationEmail = async (to: string, token: string) => {
  const mailOptions = {
    from: `"Puneri Mallus Tribe" <${process.env.EMAIL_USER}>`,
    to: to,
    subject: "🔐 Your Tribe Verification Code",
    html: `
      <div style="font-family: sans-serif; max-width: 400px; margin: auto; background: #000; color: #fff; padding: 30px; border-radius: 20px; border: 1px solid #333; text-align: center;">
        <h2 style="color: #ff0000; text-transform: uppercase;">Verify your Access</h2>
        <p style="font-size: 14px; color: #ccc;">Welcome to the tribe. Use the code below to complete your registration:</p>
        <div style="background: #111; padding: 20px; font-size: 36px; font-weight: 900; letter-spacing: 8px; margin: 20px 0; border: 1px dashed #ff0000; color: #fff;">
          ${token}
        </div>
        <p style="font-size: 10px; color: #666;">This code is valid for 10 minutes. If you didn't request this, ignore this email.</p>
      </div>
    `,
  };

  return await transporter.sendMail(mailOptions);
};
export interface MailOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  attachments?: {
    filename: string;
    content: string | Buffer;
    encoding?: string;
  }[];
}
export const sendMail = async ({ to, subject, text, html, attachments }: MailOptions) => {
  const mailOptions = {
    from: `"Puneri Mallus Box Office" <${process.env.EMAIL_USER}>`,
    to: to,
    subject: subject,
    text: text,
    html: html || text, // Fallback to text if html is not provided
    attachments: attachments,
  };

  try {
    return await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error("GENERIC_MAIL_SEND_ERROR:", error);
    throw new Error("Failed to send email");
  }
};

export const sendPendingCommunityEmail = async (to: string, communityName: string) => {
  const mailOptions = {
    from: `"Puneri Mallus Tribe" <${process.env.EMAIL_USER}>`,
    to: to,
    subject: "We've received your community submission!",
    html: `
      <div style="font-family: 'Segoe UI', Helvetica, Arial, sans-serif; max-width: 500px; margin: auto; background: #030303; color: #ffffff; padding: 50px 40px; border-radius: 40px; border: 1px solid #222; text-align: center;">
        <h2 style="font-weight: 900; text-transform: uppercase; font-size: 24px; margin-bottom: 15px; color: #fff;">Submission <span style="color: #ff0000;">Received</span></h2>
        
        <p style="font-size: 16px; color: #aaa; line-height: 1.6; margin-bottom: 30px;">
          Hi there! Thank you for adding <b style="color: #fff;">${communityName}</b> to our community list.
        </p>
        
        <div style="padding: 20px; background: rgba(255,0,0,0.05); border: 1px solid rgba(255,0,0,0.2); border-radius: 20px; margin-bottom: 30px;">
          <p style="margin: 0; font-size: 13px; font-weight: bold; color: #ff0000; text-transform: uppercase; letter-spacing: 1px;">Current Status: Pending Review</p>
        </div>

        <p style="font-size: 14px; color: #666; line-height: 1.6;">
          Our team is currently checking the details. We will send you another email as soon as it is approved and visible to everyone.
        </p>
        
        <hr style="border: 0; border-top: 1px solid #222; margin: 40px 0;" />
        <p style="font-size: 11px; color: #444; text-transform: uppercase; font-weight: bold; letter-spacing: 1px;">Puneri Mallus Tribe Community</p>
      </div>
    `,
  };
  return await transporter.sendMail(mailOptions);
};

/**
 * Sends a friendly email when a community is approved
 */
export const sendApprovedCommunityEmail = async (to: string, communityName: string, adminName: string, communityId: string) => {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://puneri-mallus-vercel.vercel.app';
  const directLink = `${baseUrl}/community/${communityId}`;

  const mailOptions = {
    from: `"Puneri Mallus Tribe" <${process.env.EMAIL_USER}>`,
    to: to,
    subject: "Great news! Your community is now live",
    html: `
      <div style="font-family: 'Segoe UI', Helvetica, Arial, sans-serif; max-width: 500px; margin: auto; background: #030303; color: #ffffff; padding: 50px 40px; border-radius: 40px; border: 1px solid #00ffff; text-align: center;">
        <h2 style="font-weight: 900; text-transform: uppercase; font-size: 24px; margin-bottom: 15px; color: #fff;">Now <span style="color: #00ffff;">Live!</span></h2>
        
        <p style="font-size: 16px; color: #aaa; line-height: 1.6; margin-bottom: 30px;">
          Congratulations! Your community <b style="color: #fff;">${communityName}</b> has been approved and is now visible on our website.
        </p>
        
        <div style="padding: 15px; background: rgba(0,255,255,0.05); border-radius: 20px; margin-bottom: 35px; border: 1px solid rgba(0,255,255,0.1);">
          <p style="margin: 0; font-size: 12px; color: #fff;">Approved by: <b>${adminName}</b></p>
        </div>

        <a href="${directLink}" style="display: inline-block; background: #00ffff; color: #000; padding: 18px 40px; border-radius: 50px; text-decoration: none; font-weight: 900; text-transform: uppercase; font-size: 13px; letter-spacing: 1px;">View Community Page</a>
        
        <p style="margin-top: 40px; font-size: 12px; color: #555;">
          Thank you for being a part of the Puneri Mallus Tribe!
        </p>
      </div>
    `,
  };
  return await transporter.sendMail(mailOptions);
};

export const sendAdminPendingAlert = async (communityName: string, pendingCount: number) => {
  const mailOptions = {
    from: `"Puneri Mallus Tribe" <${process.env.EMAIL_USER}>`,
    to: process.env.EMAIL_USER, // Sends to yourself/admin
    subject: "🚨 Action Required: New Community Pending",
    html: `
      <div style="font-family: sans-serif; max-width: 450px; margin: auto; background: #fff; color: #000; padding: 40px; border: 2px solid #ff0000; border-radius: 20px;">
        <h2 style="color: #ff0000; text-transform: uppercase;">New Submission</h2>
        <p>A new community <b>${communityName}</b> has been submitted and needs review.</p>
        
        <div style="background: #f0f0f0; padding: 20px; border-radius: 15px; margin: 20px 0; text-align: center;">
          <p style="margin: 0; font-size: 12px; color: #666; text-transform: uppercase;">Total Queue</p>
          <h1 style="margin: 5px 0; font-size: 48px; color: #000;">${pendingCount}</h1>
          <p style="margin: 0; font-size: 10px; font-weight: bold; color: #ff0000;">COMMUNITIES AWAITING APPROVAL</p>
        </div>

        <a href="https://puneri-mallus-vercel.vercel.app/admin/community" style="display: block; background: #000; color: #fff; text-align: center; padding: 15px; border-radius: 10px; text-decoration: none; font-weight: bold;">Open Admin Dashboard</a>
      </div>
    `,
  };
  return await transporter.sendMail(mailOptions);
};

export const sendMartPendingEmail = async (to: string, businessName: string) => {
  const mailOptions = {
    from: `"Puneri Mallus Tribe" <${process.env.EMAIL_USER}>`,
    to: to,
    subject: `🕒 Audit Pending: ${businessName}`,
    html: `
      <div style="font-family: 'Segoe UI', Helvetica, Arial, sans-serif; max-width: 500px; margin: auto; background: #030303; color: #ffffff; padding: 50px 40px; border-radius: 40px; border: 1px solid #222; text-align: center;">
        <h2 style="font-weight: 900; text-transform: uppercase; font-size: 24px; margin-bottom: 15px; color: #fff;">Broadcast <span style="color: #ff0000;">Received</span></h2>
        
        <p style="font-size: 16px; color: #aaa; line-height: 1.6; margin-bottom: 30px;">
          Your listing for <b style="color: #fff;">${businessName}</b> has been received and added to our audit queue.
        </p>
        
        <div style="padding: 20px; background: rgba(255,0,0,0.05); border: 1px solid rgba(255,0,0,0.2); border-radius: 20px; margin-bottom: 30px;">
          <p style="margin: 0; font-size: 13px; font-weight: bold; color: #ff0000; text-transform: uppercase; letter-spacing: 1px;">Current Status: Under Review</p>
        </div>

        <p style="font-size: 14px; color: #666; line-height: 1.6;">
          Our team is currently verifying the business details. You will receive another update as soon as your professional profile is live on the Mallu Mart grid.
        </p>
        
        <hr style="border: 0; border-top: 1px solid #222; margin: 40px 0;" />
        <p style="font-size: 11px; color: #444; text-transform: uppercase; font-weight: bold; letter-spacing: 1px;">Puneri Mallus Mart // Together for growth and good vibes</p>
      </div>
    `,
  };
  return await transporter.sendMail(mailOptions);
};

/**
 * Sends an email when a business listing goes live on Mallu Mart
 */
export const sendMartLiveEmail = async (to: string, businessName: string) => {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://punerimallusvercel.vercel.app';
  const directLink = `${baseUrl}/directory`;

  const mailOptions = {
    from: `"Puneri Mallus Tribe" <${process.env.EMAIL_USER}>`,
    to: to,
    subject: `🚀 Broadcast Success: ${businessName} is Live!`,
    html: `
      <div style="font-family: 'Segoe UI', Helvetica, Arial, sans-serif; max-width: 500px; margin: auto; background: #030303; color: #ffffff; padding: 50px 40px; border-radius: 40px; border: 1px solid #ff0000; text-align: center;">
        <h2 style="font-weight: 900; text-transform: uppercase; font-size: 24px; margin-bottom: 15px; color: #fff;">Now <span style="color: #ff0000;">Live!</span></h2>
        
        <p style="font-size: 16px; color: #aaa; line-height: 1.6; margin-bottom: 30px;">
          Great news! Your business <b style="color: #fff;">${businessName}</b> has been approved and is now visible to the entire community on Mallu Mart.
        </p>
        
        <div style="padding: 15px; background: rgba(255,0,0,0.05); border-radius: 20px; margin-bottom: 35px; border: 1px solid rgba(255,0,0,0.1);">
          <p style="margin: 0; font-size: 12px; color: #fff;">Your profile is now discoverable by the tribe.</p>
        </div>

        <a href="${directLink}" style="display: inline-block; background: #ff0000; color: #fff; padding: 18px 40px; border-radius: 50px; text-decoration: none; font-weight: 900; text-transform: uppercase; font-size: 13px; letter-spacing: 1px;">View on Mallu Mart</a>
        
        <p style="margin-top: 40px; font-size: 12px; color: #555;">
          Thank you for powering the Puneri Mallus economy!
        </p>
      </div>
    `,
  };
  return await transporter.sendMail(mailOptions);
};

export const sendMartRejectedEmail = async (to: string, businessName: string) => {
  const mailOptions = {
    from: `"Puneri Mallus Tribe" <${process.env.EMAIL_USER}>`,
    to: to,
    subject: `⚠️ Action Required: Mart Listing Update`,
    html: `
      <div style="font-family: 'Segoe UI', sans-serif; max-width: 500px; margin: auto; background: #030303; color: #ffffff; padding: 50px 40px; border-radius: 40px; border: 1px solid #ffae00; text-align: center;">
        <h2 style="font-weight: 900; text-transform: uppercase; font-size: 24px; margin-bottom: 15px; color: #fff;">Audit <span style="color: #ffae00;">Update</span></h2>
        <p style="font-size: 16px; color: #aaa; line-height: 1.6; margin-bottom: 30px;">
          Your listing for <b style="color: #fff;">${businessName}</b> was not approved during our recent audit.
        </p>
        <div style="padding: 15px; background: rgba(255,174,0,0.05); border-radius: 20px; margin-bottom: 35px; border: 1px solid rgba(255,174,0,0.1);">
          <p style="margin: 0; font-size: 12px; color: #fff;">Please ensure your details are complete and follow community guidelines.</p>
        </div>
        <a href="https://punerimallusvercel.vercel.app/directory" style="display: inline-block; background: #ffae00; color: #000; padding: 18px 40px; border-radius: 50px; text-decoration: none; font-weight: 900; text-transform: uppercase; font-size: 13px;">Edit Listing</a>
      </div>
    `,
  };
  return await transporter.sendMail(mailOptions);
};

export const sendAdminMartAlert = async (businessName: string, category: string) => {
  const mailOptions = {
    from: `"Mart Monitor" <${process.env.EMAIL_USER}>`,
    to: "punerimallus1@gmail.com", // 🔥 Your Admin Email
    subject: `🚨 NEW MART LISTING: ${businessName}`,
    html: `
      <div style="font-family: sans-serif; max-width: 450px; margin: auto; background: #fff; color: #000; padding: 40px; border: 2px solid #ff0000; border-radius: 20px;">
        <h2 style="color: #ff0000; text-transform: uppercase;">New Mart Submission</h2>
        <p>A new professional listing for <b>${businessName}</b> has been broadcasted and needs review.</p>
        
        <div style="background: #f0f0f0; padding: 20px; border-radius: 15px; margin: 20px 0;">
          <p style="margin: 0; font-size: 10px; color: #666; text-transform: uppercase;">Category</p>
          <p style="margin: 5px 0; font-size: 16px; font-weight: bold; color: #000;">${category}</p>
        </div>

        <a href="https://punerimallusvercel.vercel.app/admin/mart" style="display: block; background: #000; color: #fff; text-align: center; padding: 15px; border-radius: 10px; text-decoration: none; font-weight: bold; text-transform: uppercase; font-size: 12px; letter-spacing: 1px;">Open Audit Dashboard</a>
      </div>
    `,
  };
  return await transporter.sendMail(mailOptions);
};

export const sendRejectedCommunityEmail = async (to: string, communityName: string) => {
  const mailOptions = {
    from: `"Puneri Mallus Tribe" <${process.env.EMAIL_USER}>`,
    to: to,
    subject: "Update regarding your community submission",
    html: `
      <div style="font-family: 'Segoe UI', sans-serif; max-width: 500px; margin: auto; background: #030303; color: #ffffff; padding: 50px 40px; border-radius: 40px; border: 1px solid #ffae00; text-align: center;">
        <h2 style="font-weight: 900; text-transform: uppercase; font-size: 24px; margin-bottom: 15px; color: #fff;">Audit <span style="color: #ffae00;">Update</span></h2>
        <p style="font-size: 16px; color: #aaa; line-height: 1.6; margin-bottom: 30px;">
          Your submission for <b style="color: #fff;">${communityName}</b> was not approved for the community grid at this time.
        </p>
        <p style="font-size: 14px; color: #666; line-height: 1.6;">
          Please ensure all fields are correctly filled and the images are clear. You can re-submit or edit your listing anytime.
        </p>
        <hr style="border: 0; border-top: 1px solid #222; margin: 40px 0;" />
        <p style="font-size: 11px; color: #444; text-transform: uppercase;">Puneri Mallus Tribe Community</p>
      </div>
    `,
  };
  return await transporter.sendMail(mailOptions);
};


export async function sendMartVerificationPendingEmail(userEmail: string, businessName: string) {
  const mailOptions = {
    from: `"Puneri Mallus Admin" <${process.env.EMAIL_USER}>`,
    to: userEmail,
    subject: `VERIFICATION INITIATED: ${businessName}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: auto; background: #000; color: #fff; padding: 40px; border-radius: 20px; border: 1px solid #333;">
        <h2 style="color: #FF0000; text-transform: uppercase; font-style: italic; letter-spacing: -1px;">Protocol Initiated.</h2>
        <p style="color: #888; font-size: 12px; text-transform: uppercase; letter-spacing: 2px;">Verification Request Received</p>
        <hr style="border: 0; border-top: 1px solid #222; margin: 20px 0;">
        <p>Hello,</p>
        <p>We have successfully received the verification documents for <strong>${businessName}</strong>.</p>
        <p>Our moderation team is currently auditing your submission. This process typically takes <strong>24-48 hours</strong>. Once verified, your listing will receive the <strong>Shield Badge</strong>, increasing trust across the Tribe.</p>
        <div style="background: #111; padding: 20px; border-radius: 10px; margin-top: 20px; border: 1px solid #222;">
          <p style="margin: 0; font-size: 11px; color: #666; text-transform: uppercase;">Current Status:</p>
          <p style="margin: 5px 0 0 0; color: #FFA500; font-weight: bold;">PENDING AUDIT</p>
        </div>
        <p style="margin-top: 30px; font-size: 12px; color: #444;">If you did not initiate this request, please contact us immediately.</p>
      </div>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error("MAIL_VERIFY_USER_ERROR:", error);
  }
}

/**
 * 📧 NOTIFY ADMIN: New Verification Audit Required
 * Sent to punerimallus1@gmail.com to alert you of new documents.
 */
export async function sendAdminVerificationAlert(businessName: string) {
  const mailOptions = {
    from: `"Tribe System" <${process.env.EMAIL_USER}>`,
    to: "punerimallus1@gmail.com", // Your admin email
    subject: `🚨 ACTION REQUIRED: Verification Audit for ${businessName}`,
    html: `
      <div style="font-family: sans-serif; background: #f9f9f9; padding: 40px; color: #333;">
        <div style="max-width: 600px; margin: auto; background: #fff; padding: 30px; border-top: 4px solid #FF0000; box-shadow: 0 4px 10px rgba(0,0,0,0.1);">
          <h2 style="margin-top: 0;">New Verification Request</h2>
          <p>A business owner has submitted documents for verification on Mallu Mart.</p>
          <table style="width: 100%; margin: 20px 0; border-collapse: collapse;">
            <tr>
              <td style="padding: 10px; border-bottom: 1px solid #eee; font-weight: bold;">Business:</td>
              <td style="padding: 10px; border-bottom: 1px solid #eee;">${businessName}</td>
            </tr>
            <tr>
              <td style="padding: 10px; border-bottom: 1px solid #eee; font-weight: bold;">Priority:</td>
              <td style="padding: 10px; border-bottom: 1px solid #eee; color: #FF0000;">HIGH</td>
            </tr>
          </table>
          <p>Please log in to the <strong>Admin Terminal</strong> to audit the Shop Act and ID documents.</p>
          <a href="${process.env.NEXT_PUBLIC_BASE_URL}/admin/mart" 
             style="display: inline-block; background: #000; color: #fff; padding: 15px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; margin-top: 10px;">
             Open Admin Terminal
          </a>
        </div>
      </div>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error("MAIL_ADMIN_VERIFY_ALERT_ERROR:", error);
  }
}

/**
 * 📧 NOTIFY USER: Verification Successful
 * Sent when Admin hits the "Verify" button.
 */
export async function sendMartVerificationSuccessEmail(userEmail: string, businessName: string) {
  const mailOptions = {
    from: `"Puneri Mallus Admin" <${process.env.EMAIL_USER}>`,
    to: userEmail,
    subject: `SHIELD EARNED: ${businessName} is now Verified!`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: auto; background: #000; color: #fff; padding: 40px; border-radius: 20px; border: 1px solid #333;">
        <div style="text-align: center; margin-bottom: 20px;">
           <h1 style="color: #FF0000; font-size: 40px; margin: 0;">🛡️</h1>
        </div>
        <h2 style="color: #fff; text-transform: uppercase; font-style: italic; text-align: center; letter-spacing: -1px;">Trust Protocol Complete.</h2>
        <p style="color: #888; font-size: 12px; text-transform: uppercase; text-align: center; letter-spacing: 2px;">Verification Status: APPROVED</p>
        <hr style="border: 0; border-top: 1px solid #222; margin: 20px 0;">
        <p>Excellent news,</p>
        <p>Your business <strong>${businessName}</strong> has passed our manual audit. Your profile now features the <strong>Verified Shield Badge</strong>.</p>
        <p>This badge signals to the Tribe that your business is legitimate, significantly increasing your trust score and visibility in the directory.</p>
        <div style="background: #111; padding: 20px; border-radius: 10px; margin-top: 20px; border: 1px solid #222; text-align: center;">
          <a href="${process.env.NEXT_PUBLIC_BASE_URL}/directory" style="color: #FF0000; text-decoration: none; font-weight: bold; text-transform: uppercase; font-size: 12px; letter-spacing: 1px;">View Your Verified Listing →</a>
        </div>
      </div>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error("MAIL_VERIFY_SUCCESS_ERROR:", error);
  }
}

export async function sendMartSubscriptionEmail(to: string, plan: string, orderId: string, paymentId: string) {
  const mailOptions = {
    from: `"Puneri Mallus Tribe" <${process.env.EMAIL_USER}>`,
    to: to,
    subject: `🔓 Unlocked: Mallu Mart ${plan} Access`,
    html: `
      <div style="font-family: 'Segoe UI', sans-serif; max-width: 500px; margin: auto; background: #030303; color: #ffffff; padding: 40px; border-radius: 30px; border: 1px solid #ff0000;">
        <h2 style="color: #FF0000; text-transform: uppercase; font-style: italic; font-weight: 900; letter-spacing: -1px; text-align: center; margin-top: 0;">Access Granted</h2>
        <p style="text-align: center; color: #aaa; font-size: 14px; margin-bottom: 30px;">Your transaction was successful. You now have full access to Mallu Mart professional profiles.</p>
        
        <div style="background: #111; padding: 20px; border-radius: 15px; border: 1px solid #222; margin-bottom: 30px;">
          <p style="margin: 0 0 10px 0; font-size: 13px; color: #ccc;"><strong>Plan:</strong> <span style="color: #fff; font-weight: bold;">Mallu Mart ${plan}</span></p>
          <p style="margin: 0 0 10px 0; font-size: 13px; color: #ccc;"><strong>Order ID:</strong> <span style="font-family: monospace; color: #ff0000;">${orderId}</span></p>
          <p style="margin: 0; font-size: 13px; color: #ccc;"><strong>Payment ID:</strong> <span style="font-family: monospace; color: #ff0000;">${paymentId}</span></p>
        </div>

        <div style="margin-bottom: 30px;">
          <h4 style="color: #fff; text-transform: uppercase; font-size: 12px; letter-spacing: 1px; border-bottom: 1px solid #333; padding-bottom: 5px;">Benefits Unlocked</h4>
          <ul style="color: #aaa; font-size: 13px; line-height: 1.8; padding-left: 20px;">
            <li>Instant access to hidden business portfolios</li>
            <li>Direct WhatsApp & Calling integration</li>
            <li>Access to Google Maps navigation links</li>
          </ul>
        </div>

        <div style="text-align: center;">
          <a href="${process.env.NEXT_PUBLIC_BASE_URL || 'https://punerimallusvercel.vercel.app'}/directory" style="display: inline-block; background: #ff0000; color: #fff; padding: 15px 30px; border-radius: 50px; text-decoration: none; font-weight: 900; text-transform: uppercase; font-size: 12px; letter-spacing: 1px;">Open Directory</a>
        </div>
        
        <p style="margin-top: 40px; font-size: 10px; color: #555; text-align: center;">
          If your account does not reflect these changes, please reply to this email.
        </p>
      </div>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error("MAIL_MART_SUBSCRIPTION_ERROR:", error);
  }
}

/**
 * 📧 NOTIFY USER: Lifetime Premium Membership Purchased
 */
export async function sendPremiumMembershipEmail(to: string, orderId: string, paymentId: string) {
  const mailOptions = {
    from: `"Puneri Mallus VIP" <${process.env.EMAIL_USER}>`,
    to: to,
    subject: `👑 Welcome to the Inner Circle`,
    html: `
      <div style="font-family: 'Segoe UI', sans-serif; max-width: 500px; margin: auto; background: #030303; color: #ffffff; padding: 40px; border-radius: 30px; border: 1px solid #EAB308;">
        <div style="text-align: center; margin-bottom: 15px;">
           <h1 style="color: #EAB308; font-size: 40px; margin: 0; text-shadow: 0 0 20px rgba(234,179,8,0.5);">👑</h1>
        </div>
        <h2 style="color: #EAB308; text-transform: uppercase; font-style: italic; font-weight: 900; letter-spacing: -1px; text-align: center; margin-top: 0;">Inner Circle Access</h2>
        <p style="text-align: center; color: #aaa; font-size: 14px; margin-bottom: 30px;">Your transaction was successful. Welcome to the elite tier of the Puneri Mallus Tribe.</p>
        
        <div style="background: #111; padding: 20px; border-radius: 15px; border: 1px solid #333; margin-bottom: 30px;">
          <p style="margin: 0 0 10px 0; font-size: 13px; color: #ccc;"><strong>Plan:</strong> <span style="color: #EAB308; font-weight: bold;">Lifetime Premium</span></p>
          <p style="margin: 0 0 10px 0; font-size: 13px; color: #ccc;"><strong>Order ID:</strong> <span style="font-family: monospace; color: #EAB308;">${orderId}</span></p>
          <p style="margin: 0; font-size: 13px; color: #ccc;"><strong>Payment ID:</strong> <span style="font-family: monospace; color: #EAB308;">${paymentId}</span></p>
        </div>

        <div style="margin-bottom: 30px;">
          <h4 style="color: #fff; text-transform: uppercase; font-size: 12px; letter-spacing: 1px; border-bottom: 1px solid #333; padding-bottom: 5px;">Your VIP Benefits</h4>
          <ul style="color: #aaa; font-size: 13px; line-height: 1.8; padding-left: 20px;">
            <li><strong style="color: #EAB308;">Permanent Gold Premium Badge</strong> on your profile</li>
            <li>Free, unlimited access to all Mallu Mart listings</li>
            <li>Exclusive VIP Event Invitations & Discounts</li>
            <li>Decision-making power in community polls</li>
          </ul>
        </div>

        <div style="text-align: center;">
          <a href="${process.env.NEXT_PUBLIC_BASE_URL || 'https://punerimallusvercel.vercel.app'}/profile" style="display: inline-block; background: #EAB308; color: #000; padding: 15px 30px; border-radius: 50px; text-decoration: none; font-weight: 900; text-transform: uppercase; font-size: 12px; letter-spacing: 1px;">View Your VIP Profile</a>
        </div>
        
        <p style="margin-top: 40px; font-size: 10px; color: #555; text-align: center;">
          If your account does not reflect these changes, please reply to this email.
        </p>
      </div>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error("MAIL_PREMIUM_SUBSCRIPTION_ERROR:", error);
  }
}

/**
 * 📧 NOTIFY NEW ADMIN: Secure Access Credentials
 */
export async function sendAdminAccessEmail(to: string, tempPassword: string) {
  const loginUrl = `${process.env.NEXT_PUBLIC_BASE_URL || 'https://punerimallusvercel.vercel.app'}/login`;
  
  const mailOptions = {
    from: `"Tribe Protocol" <${process.env.EMAIL_USER}>`,
    to: to,
    subject: `🔐 SYSTEM ACCESS: Admin Protocol Authorized`,
    html: `
      <div style="font-family: 'Segoe UI', sans-serif; max-width: 500px; margin: auto; background: #030303; color: #ffffff; padding: 40px; border-radius: 30px; border: 1px solid #ff0000;">
        <div style="text-align: center; margin-bottom: 15px;">
           <h1 style="color: #ff0000; font-size: 40px; margin: 0; text-shadow: 0 0 20px rgba(255,0,0,0.5);">🛡️</h1>
        </div>
        <h2 style="color: #ff0000; text-transform: uppercase; font-style: italic; font-weight: 900; letter-spacing: -1px; text-align: center; margin-top: 0;">Protocol Authorized</h2>
        <p style="text-align: center; color: #aaa; font-size: 14px; margin-bottom: 30px;">You have been granted administrative access to the Puneri Mallus network. Use the secure credentials below to authenticate.</p>
        
        <div style="background: #111; padding: 25px; border-radius: 15px; border: 1px solid #333; margin-bottom: 30px;">
          <p style="margin: 0 0 15px 0; font-size: 11px; color: #666; text-transform: uppercase; font-weight: bold; letter-spacing: 1px;">Access Terminal</p>
          <a href="${loginUrl}" style="color: #ff0000; word-break: break-all; font-size: 13px; text-decoration: none;">${loginUrl}</a>
          
          <p style="margin: 25px 0 15px 0; font-size: 11px; color: #666; text-transform: uppercase; font-weight: bold; letter-spacing: 1px;">Admin ID</p>
          <p style="margin: 0; font-family: monospace; color: #fff; font-size: 14px;">${to}</p>

          <p style="margin: 25px 0 15px 0; font-size: 11px; color: #666; text-transform: uppercase; font-weight: bold; letter-spacing: 1px;">Temporary Key</p>
          <p style="margin: 0; font-family: monospace; color: #ff0000; font-size: 18px; font-weight: bold; letter-spacing: 2px;">${tempPassword}</p>
        </div>

        <div style="background: rgba(255,0,0,0.1); padding: 15px; border-radius: 10px; border-left: 4px solid #ff0000; margin-bottom: 30px;">
          <p style="margin: 0; font-size: 12px; color: #ff0000; font-weight: bold; line-height: 1.5;">SECURITY REQUIREMENT: <span style="color: #fff; font-weight: normal;">You will be forced to configure a permanent, high-entropy password immediately upon initial connection.</span></p>
        </div>

        <div style="text-align: center;">
          <a href="${loginUrl}" style="display: inline-block; background: #ff0000; color: #fff; padding: 15px 30px; border-radius: 50px; text-decoration: none; font-weight: 900; text-transform: uppercase; font-size: 12px; letter-spacing: 1px;">Initiate Login</a>
        </div>
        
        <p style="margin-top: 40px; font-size: 10px; color: #555; text-align: center; text-transform: uppercase; letter-spacing: 1px;">
          Strictly Confidential. Do not forward this transmission.
        </p>
      </div>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error("MAIL_ADMIN_ACCESS_ERROR:", error);
    throw new Error("Failed to dispatch admin credentials.");
  }
}

export const sendBusinessVerificationEmail = async (to: string, verifyLink: string, businessName: string) => {
  const mailOptions = {
    from: `"Puneri Mallus Tribe" <${process.env.EMAIL_USER}>`,
    to: to,
    subject: "🏢 Verify your Business Identity",
    html: `
      <div style="font-family: sans-serif; max-width: 400px; margin: auto; background: #000; color: #fff; padding: 30px; border-radius: 20px; border: 1px solid #333; text-align: center;">
        <h2 style="color: #ff0000; text-transform: uppercase;">Identity Check</h2>
        <p style="font-size: 14px; color: #ccc; line-height: 1.6; margin-bottom: 30px;">
          Hi, we received a request to list <br/><strong style="color: #fff; font-size: 18px;">${businessName}</strong><br/> in the directory. Please verify this email address to proceed.
        </p>
        <a href="${verifyLink}" style="display: inline-block; background: #ff0000; color: #fff; padding: 16px 32px; text-decoration: none; border-radius: 12px; font-weight: 900; text-transform: uppercase; letter-spacing: 2px; transition: opacity 0.2s;">
          Verify Email
        </a>
        <p style="font-size: 10px; color: #666; margin-top: 40px; line-height: 1.5;">
          This is a secure magic link. If you didn't request this, you can safely ignore this email.
        </p>
      </div>
    `,
  };

  return await transporter.sendMail(mailOptions);
};

export const sendFootballReceiptEmail = async (to: string, teamName: string, orderId: string, paymentId: string) => {
  const mailOptions = {
    from: `"Puneri Mallus Tribe" <${process.env.EMAIL_USER}>`,
    to: to,
    subject: `⚽ Registration Confirmed: ${teamName}`,
    html: `
      <div style="font-family: sans-serif; max-width: 400px; margin: auto; background: #000; color: #fff; padding: 30px; border-radius: 20px; border: 1px solid #333; text-align: center;">
        <h2 style="color: #ff0000; text-transform: uppercase;">Slot Secured</h2>
        <p style="font-size: 14px; color: #ccc; line-height: 1.6; margin-bottom: 20px;">
          Your team <strong style="color: #fff; font-size: 18px;">${teamName}</strong> is officially registered for the tournament.
        </p>
        <div style="background: #111; border: 1px solid #222; border-radius: 12px; padding: 15px; text-align: left; margin-bottom: 30px;">
          <p style="font-size: 11px; color: #888; margin: 0 0 5px 0; text-transform: uppercase;">Order ID</p>
          <p style="font-size: 13px; font-family: monospace; color: #fff; margin: 0 0 15px 0;">${orderId}</p>
          <p style="font-size: 11px; color: #888; margin: 0 0 5px 0; text-transform: uppercase;">Payment Ref</p>
          <p style="font-size: 13px; font-family: monospace; color: #fff; margin: 0;">${paymentId}</p>
        </div>
        <p style="font-size: 10px; color: #666; line-height: 1.5;">
          The organizing committee will contact the Team Representative shortly with the fixtures and rulebook.
        </p>
      </div>
    `,
  };

  return await transporter.sendMail(mailOptions);
};

export async function sendEventTicketEmail(to: string, bookingId: string, tickets: any[], totalAmount: number, pdfBase64: string, eventData: any) {
  const ticketNumbers = tickets.map(t => t.ticketNumber).join(', ');
  
  // Create Google Calendar Link dynamically
  const calTitle = encodeURIComponent(eventData?.title || 'Puneri Mallus Event');
  const calLocation = encodeURIComponent(eventData?.location || 'Pune');
  const calDetails = encodeURIComponent('Your event passes are attached in your email!');
  const googleCalendarUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${calTitle}&location=${calLocation}&details=${calDetails}`;

  const mailOptions = {
    from: `"Puneri Mallus Box Office" <${process.env.EMAIL_USER}>`,
    to: to,
    subject: `🎟️ Your Passes are Confirmed! - ${eventData?.title || 'Puneri Mallus'}`,
    html: `
      <div style="font-family: 'Segoe UI', Helvetica, Arial, sans-serif; background-color: #f4f5f9; padding: 40px 20px; color: #000;">
        <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 20px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.1);">
          
          <!-- Header -->
          <div style="text-align: center; padding: 40px 20px 20px;">
            <h1 style="color: #FF0000; font-size: 32px; font-weight: 900; font-style: italic; text-transform: uppercase; letter-spacing: -1px; margin: 0;">Puneri Mallus</h1>
            <h2 style="color: #000; font-size: 20px; font-weight: 900; margin: 15px 0 5px; text-transform: uppercase;">Your passes are ready!</h2>
            <p style="color: #666; font-size: 14px; margin: 0;">Booking ID: <strong style="color: #000;">${bookingId.split('-')[0].toUpperCase()}</strong></p>
          </div>

          <!-- Ticket Card -->
          <div style="margin: 20px; background-color: #fafafa; border-radius: 16px; padding: 25px; border: 1px dashed #ccc; position: relative;">
            <h3 style="margin: 0 0 15px; font-size: 18px; color: #000; text-transform: uppercase; font-weight: 900;">Exclusive Access</h3>
            
            ${tickets.map(t => `
              <div style="margin-bottom: 15px;">
                <p style="margin: 0; color: #888; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; font-weight: bold;">Category</p>
                <p style="margin: 2px 0 0; color: #FF0000; font-size: 16px; font-weight: 900;">${t.categoryName}</p>
              </div>
            `).join('')}

            <div style="margin-top: 25px; padding-top: 20px; border-top: 1px dashed #ddd;">
              <p style="margin: 0; color: #888; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; font-weight: bold;">Pass Identifiers</p>
              <p style="margin: 5px 0 0; color: #000; font-size: 18px; font-weight: 900; letter-spacing: 1px;">${ticketNumbers}</p>
            </div>
          </div>

          <!-- Add to Calendar Button -->
          <div style="text-align: center; margin: 30px 20px;">
            <a href="${googleCalendarUrl}" target="_blank" style="display: inline-block; background-color: #000; color: #fff; padding: 16px 32px; border-radius: 50px; text-decoration: none; font-weight: bold; text-transform: uppercase; font-size: 12px; letter-spacing: 1px;">
              🗓️ Add to Google Calendar
            </a>
          </div>

          <!-- Order Summary (Fixed Spacing with Table) -->
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top: 20px; border-top: 1px solid #eee; padding-top: 20px;">
            <tr>
              <td align="left" style="color: #666; font-size: 14px; font-weight: bold; text-transform: uppercase;">Total Paid</td>
              <td align="right" style="color: #FF0000; font-size: 20px; font-weight: 900;">₹${totalAmount.toLocaleString('en-IN')}</td>
            </tr>
          </table>

          <div style="text-align: center; padding: 20px; background-color: #FF0000;">
            <p style="margin: 0; color: #fff; font-size: 12px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px;">Open the attached PDF to view your passes</p>
          </div>

        </div>
      </div>
    `,
    attachments: [
      {
        filename: `PM_Passes_${bookingId.split('-')[0]}.pdf`,
        content: pdfBase64,
        encoding: 'base64'
      }
    ]
  };

  try {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });
    return await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error("MAIL_TICKET_ERROR:", error);
  }
}