import { type EmailOtpType } from '@supabase/supabase-js'
import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  
  // Look for the 'next' parameter we added in the email template
  const next = searchParams.get('next') ?? '/auth/verified'

  const redirectTo = request.nextUrl.clone()
  redirectTo.pathname = next
  
  if (token_hash && type) {
    const cookieStore = await cookies() // Build-safe for Next.js 15
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) { return cookieStore.get(name)?.value },
          set(name: string, value: string, options: any) { cookieStore.set({ name, value, ...options }) },
          remove(name: string, options: any) { cookieStore.set({ name, value: '', ...options }) },
        },
      }
    )

    const { error } = await supabase.auth.verifyOtp({ type, token_hash })

    if (!error) {
      // SUCCESS: The user is now verified.
      // The Phone goes to /auth/verified
      // The Laptop (polling the DB) will see the new profile and jump to Login!
      return NextResponse.redirect(redirectTo)
    }
  }

  // FALLBACK
  return NextResponse.redirect(new URL('/auth/login', request.url))
}