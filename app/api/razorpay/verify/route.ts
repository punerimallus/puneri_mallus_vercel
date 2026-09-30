import { NextResponse, after } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { isValidCheckoutSignature } from '@/lib/payments/signature';
import { fulfilAndDeliver } from '@/lib/payments/server';

// Called by the browser's Razorpay handler for membership and Mallu Mart payments.
// The browser only tells us WHICH order was paid; what it was for and whether it
// really was paid come from payment_orders and Razorpay. The webhook does the same
// work, so if this request never arrives (tab closed) the user still gets access.
export async function POST(req: Request) {
  try {
    const cookieStore = await cookies();
    const supabaseAuth = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { get(name: string) { return cookieStore.get(name)?.value; } } }
    );
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized: Invalid Session" }, { status: 401 });
    }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = await req.json();

    if (!isValidCheckoutSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature, process.env.RAZORPAY_KEY_SECRET!)) {
      return NextResponse.json({ message: "Invalid signature", success: false }, { status: 400 });
    }

    const result = await fulfilAndDeliver(razorpay_order_id, razorpay_payment_id, 'CLIENT', { defer: after });
    const mine = result.order?.user_id === user.id;

    switch (result.outcome) {
      case 'FULFILLED':
      case 'ALREADY_FULFILLED':
        return NextResponse.json({ success: true, message: "Payment verified securely and databases synced.", orderId: razorpay_order_id });
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
    console.error("VERIFICATION_CRITICAL_ERROR:", error);
    // The order is left in a retryable state; the webhook / status poll will finish it.
    return NextResponse.json({ success: false, pending: true, error: "Verification failed internally" }, { status: 500 });
  }
}
