// app/api/admin/payments/route.ts
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { checkAdminAccess } from '@/lib/admin';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { isAdmin } = await checkAdminAccess();
    if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY! 
    );

    // ?view=orders: checkout orders that are stuck, failed, need a refund or whose email bounced
    if (new URL(req.url).searchParams.get('view') === 'orders') {
      const { data: orders, error } = await supabaseAdmin
        .from('payment_orders')
        .select('razorpay_order_id, razorpay_payment_id, payment_type, plan, receipt_email, amount_paise, status, status_reason, email_status, email_error, booking_id, created_at, fulfilled_via')
        .or('status.in.(PAID,PROCESSING,NEEDS_ATTENTION,PARTIALLY_REFUNDED),email_status.eq.FAILED')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return NextResponse.json(orders);
    }

    // Fetch all payments, sorted by newest first
    const { data: payments, error } = await supabaseAdmin
      .from('payments')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json(payments);
  } catch (error) {
    console.error("ADMIN_PAYMENT_FETCH_ERROR:", error);
    return NextResponse.json({ error: "Failed to fetch ledger" }, { status: 500 });
  }
}