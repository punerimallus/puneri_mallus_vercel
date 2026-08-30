import { NextResponse } from 'next/server';
import Razorpay from 'razorpay';
import { createClient } from '@supabase/supabase-js';

const razorpay = new Razorpay({
  key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID!,
  key_secret: process.env.RAZORPAY_KEY_SECRET!,
});

export async function POST(req: Request) {
  try {
    // 🔥 NEW: Extract cart and eventId to calculate price and check availability securely
    const { paymentType, plan, cart, eventId } = await req.json();

    // 1. Initialize Supabase Admin to fetch dynamic pricing settings securely
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY! 
    );

    // Fetch the settings row safely without hardcoding id=1
    const { data: settings, error } = await supabaseAdmin
      .from('app_settings')
      .select('*')
      .limit(1)
      .single();

    if (error) {
      console.error("Failed to fetch settings from DB. Falling back to default pricing.", error.message);
    }

    let targetPrice = 99; // Absolute fallback
    
    if (paymentType === "LIFETIME") {
      targetPrice = settings?.membershipPrice || settings?.membership_price || 999;
    } 
    else if (paymentType === "MART") {
      if (plan === "MONTHLY") targetPrice = settings?.martMonthlyPrice || settings?.mart_monthly_price || 99;
      else if (plan === "YEARLY") targetPrice = settings?.martYearlyPrice || settings?.mart_yearly_price || 899;
      else if (plan === "LIFETIME") targetPrice = settings?.martLifetimePrice || settings?.mart_lifetime_price || 2499;
    }
    else if (paymentType === "FOOTBALL") {
      targetPrice = settings?.footballFee || settings?.football_fee || 1500;
    }
    // 🔥 SECURE EVENT TICKETING LOGIC
    else if (paymentType === "EVENT_TICKET") {
      if (!cart || !eventId) return NextResponse.json({ error: "Missing ticket data" }, { status: 400 });
      
      const { data: categories } = await supabaseAdmin
        .from('event_ticket_categories')
        .select('*')
        .eq('event_id', eventId);

      if (!categories) return NextResponse.json({ error: "Categories not found" }, { status: 404 });

      let backendCalculatedTotal = 0;
      
      for (const [catId, qty] of Object.entries(cart)) {
        const cat = categories.find(c => c.id === catId);
        if (!cat) throw new Error("Invalid category selected");
        
        // 🔥 CONCURRENCY CHECK: Prevent overbooking right before payment
        if (cat.sold + (qty as number) > cat.capacity) {
          throw new Error(`Oops! "${cat.name}" is sold out. Someone just bought the last ones.`);
        }
        // Securely calculate total
        backendCalculatedTotal += cat.price * (qty as number);
      }
      
      if (backendCalculatedTotal <= 0) throw new Error("Invalid amount");
      targetPrice = backendCalculatedTotal; 
    }

    // Add Razorpay Transaction Fee (2% + 18% GST = 2.36%)
    // This ensures you get exactly the `targetPrice` in your bank account
    const RAZORPAY_FEE_PERCENTAGE = 0.0236;
    const finalAmountWithTaxes = targetPrice / (1 - RAZORPAY_FEE_PERCENTAGE);

    // 3. Convert to Paise (Required by Razorpay, Integer only)
    const amountInPaise = Math.round(finalAmountWithTaxes * 100);

    if (amountInPaise < 100) {
      return NextResponse.json({ error: "Amount too low (Min ₹1)" }, { status: 400 });
    }

    // 4. Build the Razorpay Order Options
    const options = {
      amount: amountInPaise,
      currency: "INR",
      receipt: `rcpt_${paymentType}_${Date.now()}`,
      notes: {
        paymentType: paymentType, 
        plan: plan || "NONE" 
      }
    };

    // 5. Generate Order Token
    const order = await razorpay.orders.create(options);
    
    return NextResponse.json(order);
    
  } catch (error: any) {
    console.error("RAZORPAY_ORDER_ERROR:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create order" }, 
      { status: 500 }
    );
  }
}