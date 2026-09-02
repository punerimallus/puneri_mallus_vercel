import { NextResponse } from 'next/server';
import { Resend } from 'resend';

export async function GET() {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    return NextResponse.json({
      success: false,
      error: 'RESEND_API_KEY is not defined in environment variables.',
    }, { status: 500 });
  }

  const resend = new Resend(apiKey);

  try {
    const response = await resend.emails.send({
      from: 'Puneri Mallus Box Office <tickets@punerimallus.com>',
      to: 'your-personal-email@gmail.com', // 👈 Replace with your actual email
      subject: '🧪 Resend Local Test',
      html: '<strong>If you see this, Resend is fully working locally!</strong>',
    });

    return NextResponse.json({ success: true, response });
  } catch (err: any) {
    return NextResponse.json({ success: false, caughtError: err.message }, { status: 500 });
  }
}