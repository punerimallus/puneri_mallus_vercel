import { NextResponse } from 'next/server';
import { whatsappEnabled } from '@/lib/whatsapp';

export const dynamic = 'force-dynamic';

// Whether the checkout should offer "send my tickets on WhatsApp". Reveals nothing but a yes or no.
export async function GET() {
  return NextResponse.json({ enabled: whatsappEnabled() });
}
