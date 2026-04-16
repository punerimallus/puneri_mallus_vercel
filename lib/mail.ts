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
 * Sent to punerimallus@gmail.com to alert you of new documents.
 */
export async function sendAdminVerificationAlert(businessName: string) {
  const mailOptions = {
    from: `"Tribe System" <${process.env.EMAIL_USER}>`,
    to: "punerimallus@gmail.com", // Your admin email
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