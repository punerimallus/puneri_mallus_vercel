import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // This is the magic line that fixes the "Invalid Refresh Token" error.
  // It automatically refreshes the session if it's about to expire.
  const { data: { user } } = await supabase.auth.getUser()

  // --- THE GLOBAL API BOUNCER ---
  // Only intercept requests going to the /api/ folder
  if (request.nextUrl.pathname.startsWith('/api/')) {
    
    // Always allow CORS preflight requests to pass through
    if (request.method === 'OPTIONS') {
      return supabaseResponse;
    }

    // 🛡️ THE MASTER WHITELIST (Path + Method matching)
    const isPublicRoute = [
      // 🟢 Fully Public Interactions (Guests sending data to you)
      { path: '/api/contact', methods: ['POST'] },
      { path: '/api/auth/check-status', methods: ['POST'] },

      // 🟡 Public Read / Protected Write (Guests can view, but only logged-in users can modify)
      { path: '/api/community', methods: ['GET'] },
      { path: '/api/test-email', methods: ['GET'] },
      { path: '/api/events', methods: ['GET'] },
      { path: '/api/mart', methods: ['GET'] },
      { path: '/api/partners', methods: ['GET'] },
      { path: '/api/team', methods: ['GET'] },
      { path: '/api/profile/check-email', methods: ['GET'] },
      { path: '/api/business/verify', methods: ['GET'] },

      // ⚙️ Site Configurations (Allows your homepage and UI to render for guests)
      { path: '/api/admin/popup', methods: ['GET'] },
      { path: '/api/admin/settings', methods: ['GET'] },
      { path: '/api/settings/slider', methods: ['GET'] },
      { path: '/api/settings/gallery', methods: ['GET'] },
      { path: '/api/settings/social', methods: ['GET'] },
      
      // 💸 Razorpay (Uncomment if you add a webhook later)
      // { path: '/api/razorpay/webhook', methods: ['POST'] }
    ].some(rule => 
      // Allow exact matches OR sub-paths (like /api/events/123), as long as the method matches!
      (request.nextUrl.pathname === rule.path || request.nextUrl.pathname.startsWith(`${rule.path}/`)) 
      && rule.methods.includes(request.method)
    );

    // IF THEY ARE NOT LOGGED IN AND TRIED TO HIT A SECURE ROUTE: KICK THEM OUT.
    if (!user && !isPublicRoute) {
      console.warn(`🔒 Bouncer blocked unauthorized ${request.method} request at: ${request.nextUrl.pathname}`);
      return NextResponse.json(
        { error: 'Unauthorized: Global Security Enforced.' }, 
        { status: 401 }
      );
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * Feel free to add other uploads/public folders here.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}