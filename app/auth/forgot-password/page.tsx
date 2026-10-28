"use client";
import { useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import Link from 'next/link';
import { Mail, ArrowLeft, CheckCircle } from 'lucide-react';
import { friendlyError } from '@/lib/user-errors';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const handleReset = async (e: React.FormEvent) => {
  e.preventDefault();
  setLoading(true);
  setError('');

  try {
    // 1. Verify existence in Supabase Auth via our new API
    // Change this line:
const checkRes = await fetch(`/api/profile/check-email?email=${encodeURIComponent(email)}`);
    const data = await checkRes.json();

    if (!data.exists) {
      setError("This email is not registered with the Puneri Mallus tribe.");
      setLoading(false);
      return;
    }

    // 2. Email exists, proceed with reset
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/update-password`,
    });

    if (error) {
      setError(friendlyError(error, "Could not send the reset link. Please try again."));
    } else {
      setSubmitted(true);
    }
  } catch (err) {
    setError("API Issue.");
  } finally {
    setLoading(false);
  }
};

  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-6">
      <div className="max-w-md w-full">
        {!submitted ? (
          <div className="bg-zinc-900/40 border border-white/5 p-10 rounded-[40px] backdrop-blur-xl">
            <Link href="/auth/login" className="flex items-center gap-2 text-zinc-500 hover:text-white transition-colors mb-8 text-[10px] font-black uppercase tracking-widest">
              <ArrowLeft size={14} /> Back to Login
            </Link>
            
            <h1 className="text-4xl font-black italic uppercase tracking-tighter mb-2">Lost your <span className="text-brandRed">Key?</span></h1>
            <p className="text-zinc-500 text-sm mb-8 font-medium">Enter your email and we'll send a reset link to the Tribe.</p>

            <form onSubmit={handleReset} className="space-y-6">
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600" size={18} />
                <input 
                  type="email" 
                  placeholder="EMAIL ADDRESS" 
                  required
                  className="w-full bg-black border border-white/10 p-5 pl-12 rounded-2xl text-sm font-bold focus:border-brandRed outline-none transition-all"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              {error && <p className="text-brandRed text-[10px] font-black uppercase">{error}</p>}

              <button 
                type="submit" 
                disabled={loading}
                className="w-full bg-brandRed text-white py-5 rounded-2xl font-black uppercase text-[11px] tracking-[0.2em] hover:scale-[1.02] transition-all shadow-[0_0_20px_rgba(255,0,0,0.3)]"
              >
                {loading ? 'Sending...' : 'Send Reset Link'}
              </button>
            </form>
          </div>
        ) : (
          <div className="bg-zinc-900/40 border border-white/5 p-12 rounded-[40px] text-center backdrop-blur-xl">
            <CheckCircle size={60} className="text-green-500 mx-auto mb-6" />
            <h2 className="text-3xl font-black italic uppercase tracking-tighter mb-4">Email Sent!</h2>
            <p className="text-zinc-500 text-sm mb-8">Check your inbox for the reset link. If you don't see it, check the <span className="text-brandRed">Spam</span> folder.</p>
            <Link href="/auth/login">
              <button className="w-full bg-white text-black py-4 rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-brandRed hover:text-white transition-all">
                Return to Login
              </button>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}