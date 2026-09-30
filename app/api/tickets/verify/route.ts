import { NextResponse, after } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { isValidCheckoutSignature } from '@/lib/payments/signature';
import { fulfilAndDeliver } from '@/lib/payments/server';

// Called by the event booking page's Razorpay handler. The cart, email, event and
// points the browser used to send are ignored: they were fixed on the server when
// the order was created. Fulfilment is idempotent, so replaying this request (or
// the webhook arriving first) never issues a second set of passes.
export async function POST(req: Request) {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = await req.json();

    if (!isValidCheckoutSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature, process.env.RAZORPAY_KEY_SECRET!)) {
      return NextResponse.json({ success: false, error: "Invalid payment signature." }, { status: 400 });
    }

    const cookieStore = await cookies();
    const supabaseAuth = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { get(name: string) { return cookieStore.get(name)?.value; } } }
    );
    const { data: { user } } = await supabaseAuth.auth.getUser();

    const result = await fulfilAndDeliver(razorpay_order_id, razorpay_payment_id, 'CLIENT', { defer: after });
    const mine = !!user && result.order?.user_id === user.id;

    switch (result.outcome) {
      case 'FULFILLED':
      case 'ALREADY_FULFILLED':
        return NextResponse.json({
          success: true,
          bookingId: mine ? result.bookingId : undefined,
        });
      case 'IN_PROGRESS':
        return NextResponse.json({ success: false, pending: true, orderId: razorpay_order_id }, { status: 202 });
      case 'NEEDS_ATTENTION':
        return NextResponse.json(
          { success: false, needsAttention: true, orderId: razorpay_order_id, error: mine ? result.reason : undefined },
          { status: 409 },
        );
      case 'UNKNOWN_ORDER':
        return NextResponse.json({ success: false, error: "Order not found" }, { status: 404 });
      default:
        return NextResponse.json({ success: false, error: "Payment not captured yet" }, { status: 402 });
    }
  } catch (error: unknown) {
    console.error("TICKET_VERIFY_ERROR:", error);
    return NextResponse.json({ success: false, pending: true, error: "Verification failed internally" }, { status: 500 });
  }
}
