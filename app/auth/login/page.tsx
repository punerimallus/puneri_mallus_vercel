"use client";
import { useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { Mail, Lock, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const router = useRouter();

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    // 1. Authenticate with Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });
    
    if (authError) {
      if (authError.message.toLowerCase().includes("invalid login credentials")) {
        setError("Incorrect email or password.");
      } else {
        setError(authError.message.charAt(0).toUpperCase() + authError.message.slice(1));
      }
      setLoading(false);
      return;
    }

    // 2. Verify they are an authorized admin
    const { data: adminData, error: adminError } = await supabase
      .from('authorized_admins')
      .select('requires_password_change')
      .eq('id', authData.user.id)
      .single();

    if (adminError || !adminData) {
      // Imposter! Kick them out immediately.
      await supabase.auth.signOut();
      setError("Unauthorized access. You are not an admin.");
      setLoading(false);
      return;
    }

    // 3. Route based on temp password status
    if (adminData.requires_password_change) {
      router.push('/auth/update-password');
    } else {
      router.push('/admin');
    }
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-6 relative overflow-hidden">
      
      {/* BACKGROUND IMAGE */}
      <div className="absolute inset-0 z-0">
        <Image 
          src="/events/login.jpg" 
          alt="Atmospheric Background"
          fill
          sizes="100vw"
          className="object-cover object-right opacity-60 transition-all duration-700" 
          priority
        />
        <div className="absolute inset-0 bg-gradient-to-r from-black via-black/40 to-transparent hidden lg:block" />
        <div className="absolute inset-0 bg-black/50 lg:hidden" />
        <div className="absolute top-0 right-0 w-1/2 h-full bg-brandRed/5 blur-[120px] pointer-events-none" />
      </div>

      <div className="w-full max-w-[380px] relative z-20">
        <div 
          className="relative bg-white/[0.03] backdrop-blur-2xl border border-white/10 px-8 py-8 md:px-10 md:py-10 rounded-[32px] shadow-2xl text-left"
          style={{ transform: 'translateZ(0)' }}
        >
          <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-white/[0.03] to-transparent pointer-events-none rounded-[32px]" />

          <div className="relative z-10">
            <h1 className="text-xl font-black uppercase italic tracking-tighter mb-6 text-center text-white">
              Admin <span className="text-brandRed">Portal.</span>
            </h1>

            <form onSubmit={handleLogin} className="space-y-4">
              
              <div className="relative group">
                <label htmlFor="email" className="sr-only">Email Address</label>
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-brandRed transition-colors z-20" size={16} />
                <input 
                  id="email"
                  type="email" 
                  placeholder="Admin Email" 
                  required
                  autoComplete="email"
                  suppressHydrationWarning
                  className="relative w-full bg-black/40 border border-white/10 p-4 pl-12 rounded-xl font-medium text-sm transition-all outline-none text-white placeholder:text-zinc-500 focus:border-brandRed focus:bg-black/60 z-10"
                  value={email} 
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="relative group">
                <label htmlFor="password" className="sr-only">Password</label>
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-brandRed transition-colors z-20" size={16} />
                <input 
                  id="password"
                  type={showPassword ? "text" : "password"} 
                  placeholder="Password" 
                  required
                  autoComplete="current-password"
                  className="relative w-full bg-black/40 border border-white/10 p-4 pl-12 pr-12 rounded-xl font-medium text-sm transition-all outline-none text-white placeholder:text-zinc-500 focus:border-brandRed focus:bg-black/60 z-10"
                  value={password} 
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 p-3 text-zinc-500 hover:text-brandRed transition-colors z-20"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              
              <div className="flex justify-end px-1">
                <Link 
                  href="/auth/forgot-password" 
                  className="text-[11px] font-bold text-zinc-400 hover:text-white transition-colors py-2 -my-2"
                >
                  Forgot password?
                </Link>
              </div>

              <AnimatePresence>
                {error && (
                  <motion.div 
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                  >
                    <p className="text-brandRed text-xs font-semibold text-center py-3 px-4 bg-brandRed/10 border border-brandRed/20 rounded-lg">
                      {error}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>

              <button 
                disabled={loading} 
                className="w-full py-4 bg-brandRed text-white font-black uppercase tracking-widest rounded-xl hover:bg-white hover:text-black transition-all shadow-xl active:scale-95 text-xs flex items-center justify-center gap-2"
              >
                {loading ? 'Authenticating...' : 'Secure Login'} <ArrowRight size={16} />
              </button>
            </form>

            <div className="mt-6 text-center flex flex-col gap-3">
              <Link 
                href="/" 
                className="text-[11px] font-bold text-zinc-500 hover:text-white transition-colors flex items-center justify-center gap-1 mt-2 py-3 -my-1"
              >
                ← Back to Home
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}