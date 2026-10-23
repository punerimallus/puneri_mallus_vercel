import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY! 
    );

    const { data: settings, error } = await supabaseAdmin
      .from('app_settings')
      .select('*')
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    const formattedSettings = settings ? {
      martEnabled: settings.mart_enabled,
      martNote: settings.mart_note,
      martMonthlyActive: settings.mart_monthly_active,
      martMonthlyPrice: settings.mart_monthly_price,
      martYearlyActive: settings.mart_yearly_active,
      martYearlyPrice: settings.mart_yearly_price,
      martLifetimeActive: settings.mart_lifetime_active,
      martLifetimePrice: settings.mart_lifetime_price,
      membershipPrice: settings.membership_price,
      membershipBenefits: settings.membership_benefits,
      // Open unless an admin has switched it off. A missing column (migration not run yet) also reads as open.
      membershipEnabled: settings.membership_enabled !== false,
      currency: settings.currency,
      // 🔥 NEW: Football Fee
      footballFee: settings.football_fee, 
    } : null;

    return NextResponse.json(formattedSettings || { 
      martEnabled: false, 
      martMonthlyPrice: 99,
      martYearlyPrice: 899,
      martLifetimePrice: 2499,
      membershipPrice: 499,
      membershipEnabled: true,
      footballFee: 1500 // Default fallback
    });
  } catch (e) {
    console.error("Supabase Settings Fetch Error:", e);
    return NextResponse.json({ error: "Failed to fetch settings" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const cookieStore = await cookies();
    const supabaseAuth = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { get(name: string) { return cookieStore.get(name)?.value; } } }
    );

    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();

    if (authError || !user || !user.email) {
      return NextResponse.json({ error: "Unauthorized access" }, { status: 401 });
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY! 
    );

    const { data: adminRecord, error: adminError } = await supabaseAdmin
      .from('authorized_admins')
      .select('email')
      .eq('email', user.email)
      .single();

    if (adminError || !adminRecord) {
      return NextResponse.json({ error: "Forbidden: Master Admin Access Required" }, { status: 403 });
    }

    const body = await req.json();

    // 🔥 DYNAMIC PAYLOAD: This will handle whatever is passed in the body
    // If you pass { football_fee: 1200 }, it updates only that.
    const dbPayload = {
      id: 1, 
      ...(body.martEnabled !== undefined && { mart_enabled: body.martEnabled }),
      ...(body.martNote !== undefined && { mart_note: body.martNote }),
      ...(body.martMonthlyActive !== undefined && { mart_monthly_active: body.martMonthlyActive }),
      ...(body.martMonthlyPrice !== undefined && { mart_monthly_price: body.martMonthlyPrice }),
      ...(body.martYearlyActive !== undefined && { mart_yearly_active: body.martYearlyActive }),
      ...(body.martYearlyPrice !== undefined && { mart_yearly_price: body.martYearlyPrice }),
      ...(body.martLifetimeActive !== undefined && { mart_lifetime_active: body.martLifetimeActive }),
      ...(body.martLifetimePrice !== undefined && { mart_lifetime_price: body.martLifetimePrice }),
      ...(body.membershipPrice !== undefined && { membership_price: body.membershipPrice }),
      ...(body.membershipBenefits !== undefined && { membership_benefits: body.membershipBenefits }),
      ...(body.membershipEnabled !== undefined && { membership_enabled: body.membershipEnabled === true }),
      ...(body.currency !== undefined && { currency: body.currency }),
      // 🔥 NEW: Football Fee update
      ...(body.football_fee !== undefined && { football_fee: body.football_fee }),
      updated_at: new Date().toISOString()
    };

    let { error: upsertError } = await supabaseAdmin
      .from('app_settings')
      .upsert(dbPayload);

    // The membership switch needs its column (supabase/migrations/20261023_membership_switch.sql). Until it exists,
    // still save everything else rather than failing the whole settings form, and say the switch was not saved.
    let membershipSwitchSaved = body.membershipEnabled !== undefined;
    if (upsertError && 'membership_enabled' in dbPayload && /membership_enabled/i.test(upsertError.message || '')) {
      const { membership_enabled: _skip, ...withoutSwitch } = dbPayload as Record<string, unknown>;
      ({ error: upsertError } = await supabaseAdmin.from('app_settings').upsert(withoutSwitch));
      membershipSwitchSaved = false;
    }

    if (upsertError) throw upsertError;

    return NextResponse.json({ success: true, membershipSwitchSaved });
  } catch (e: any) {
    console.error("Supabase Settings Update Error:", e.message);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}