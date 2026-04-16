"use client";
import { useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { Mail, Lock, ArrowRight, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState('');
  const [showResend, setShowResend] = useState(false);
  
  const router = useRouter();

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setShowResend(false);

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    
    if (error) {
      if (error.message.toLowerCase().includes("email not confirmed")) {
        setError("ACCOUNT NOT ACTIVE: PLEASE CHECK YOUR EMAIL TO VERIFY.");
        setShowResend(true); 
      } else if (error.message.toLowerCase().includes("invalid login credentials")) {
        setError("INVALID EMAIL OR PASSWORD.");
      } else {
        setError(error.message.toUpperCase());
      }
      setLoading(false);
    } else {
      router.replace('/');
      router.refresh();
    }
  };

  const handleResendEmail = async () => {
    setResending(true);
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: email,
    });

    if (error) {
      setError("FAILED TO RESEND. PLEASE TRY AGAIN LATER.");
    } else {
      setError("ACTIVATION LINK RESENT! CHECK YOUR INBOX.");
      setShowResend(false);
    }
    setResending(false);
  };

  return (
    /* 🔥 UPDATED: items-start and pt-44 to push container down from navbar */
    <div className="min-h-screen bg-black flex items-start justify-center p-6 pt-32 md:pt-44 relative overflow-hidden">
      
      {/* BACKGROUND IMAGE */}
      <div className="absolute inset-0 z-0">
        <Image 
          src="/events/login.jpg" 
          alt="Background"
          fill
          className="object-cover object-right opacity-60 transition-all duration-700" 
          priority
        />
        <div className="absolute inset-0 bg-gradient-to-r from-black via-black/40 to-transparent hidden lg:block" />
        <div className="absolute inset-0 bg-black/50 lg:hidden" />
        <div className="absolute top-0 right-0 w-1/2 h-full bg-brandRed/5 blur-[120px] pointer-events-none" />
      </div>

      <div className="w-full max-w-[380px] relative z-10">
        <div className="relative bg-white/[0.03] backdrop-blur-2xl border border-white/10 px-8 py-8 md:px-10 md:py-10 rounded-[32px] shadow-2xl overflow-hidden text-left">
          <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-white/[0.03] to-transparent pointer-events-none" />

          {/* IMPACTFUL LOGO */}
          <div className="flex justify-center mb-6 relative z-10">
            <Link href="/">
              <Image 
                src="/logo.png" 
                alt="Logo" 
                width={400} 
                height={120} 
                className="h-16 md:h-20 w-auto object-contain drop-shadow-[0_0_20px_rgba(255,0,0,0.5)]" 
                priority 
              />
            </Link>
          </div>

          <div className="relative z-10">
            <h2 className="text-xl font-black uppercase italic tracking-tighter mb-6 text-center text-white">
              Welcome <span className="text-brandRed">Back.</span>
            </h2>

            <form onSubmit={handleLogin} className="space-y-4">
              <div className="relative group">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-brandRed transition-colors z-20" size={16} />
                <input 
                  type="email" 
                  placeholder="EMAIL ADDRESS" 
                  required
                  autoComplete="off"
                  suppressHydrationWarning
                  /* 🔥 UPDATED: Increased text size to 13px and tracking for better visibility */
                  className="relative w-full bg-black/40 border border-white/10 p-4 pl-12 rounded-xl font-bold text-[13px] tracking-wide focus:border-brandRed transition-all outline-none text-white placeholder:text-zinc-500 placeholder:text-[10px] placeholder:tracking-widest z-10"
                  value={email} 
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="relative group">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-brandRed transition-colors z-20" size={16} />
                <input 
                  type={showPassword ? "text" : "password"} 
                  placeholder="PASSWORD" 
                  required
                  /* 🔥 UPDATED: Increased text size to 13px and tracking for better visibility */
                  className="relative w-full bg-black/40 border border-white/10 p-4 pl-12 pr-12 rounded-xl font-bold text-[13px] tracking-wide focus:border-brandRed transition-all outline-none text-white placeholder:text-zinc-500 placeholder:text-[10px] placeholder:tracking-widest z-10"
                  value={password} 
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-brandRed transition-colors z-20"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              
              <div className="flex justify-end px-1">
                <Link 
                  href="/auth/forgot-password" 
                  className="text-[9px] font-black uppercase tracking-widest text-white/30 hover:text-brandRed transition-colors"
                >
                  Forgot Password?
                </Link>
              </div>

              <AnimatePresence>
                {error && (
                  <motion.div 
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    className="space-y-3"
                  >
                    <p className="text-brandRed text-[8px] font-black uppercase tracking-widest text-center py-2 px-4 bg-brandRed/10 border border-brandRed/20 rounded-lg animate-pulse">
                      {error}
                    </p>
                    
                    {showResend && (
                      <button
                        type="button"
                        onClick={handleResendEmail}
                        disabled={resending}
                        className="w-full flex items-center justify-center gap-2 text-[9px] font-black uppercase tracking-widest text-white/50 hover:text-white transition-colors"
                      >
                        <RefreshCw size={12} className={resending ? "animate-spin" : ""} />
                        {resending ? "RESENDING..." : "Resend Activation Email"}
                      </button>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              <button 
                disabled={loading} 
                className="w-full py-4 bg-brandRed text-white font-black uppercase tracking-[0.3em] rounded-xl hover:bg-white hover:text-black transition-all shadow-xl active:scale-95 text-[10px] flex items-center justify-center gap-2"
              >
                {loading ? 'Entering...' : 'Enter Tribe'} <ArrowRight size={14} />
              </button>
            </form>

            <div className="mt-6 text-center flex flex-col gap-2">
              <Link 
                href="/auth/signup" 
                className="text-[9px] font-black uppercase tracking-widest text-white/30 hover:text-brandRed transition-colors"
              >
                New here? <span className="text-white">Sign Up</span>
              </Link>
              <Link 
                href="/" 
                className="text-[8px] font-black uppercase tracking-[0.3em] text-white/10 hover:text-white transition-colors"
              >
                ← Home
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}