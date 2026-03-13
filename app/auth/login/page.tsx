"use client";
import { useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { Mail, Lock, ArrowRight, Eye, EyeOff } from 'lucide-react';

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

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    
    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      router.push('/');
      router.refresh();
    }
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4 relative overflow-hidden">
      
      {/* BACKGROUND IMAGE */}
      <div className="absolute inset-0 z-0">
  <Image 
    src="/events/login.jpg" 
    alt="Background"
    fill
    
    className="object-cover object-right opacity-60 transition-all duration-700" 
    priority
  />
  
  {/* COLOR ENHANCEMENT OVERLAYS */}
  {/* Desktop: A deeper gradient that preserves the colorful right side */}
  <div className="absolute inset-0 bg-gradient-to-r from-black via-black/40 to-transparent hidden lg:block" />
  
  {/* Mobile: A slight tint to keep text readable without killing the color */}
  <div className="absolute inset-0 bg-black/50 lg:hidden" />

  {/* VIBRANCY BOOST: Optional subtle red/purple glow to match the 'Tribe' vibe */}
  <div className="absolute top-0 right-0 w-1/2 h-full bg-brandRed/5 blur-[120px] pointer-events-none" />
</div>

      {/* COMPACT LOGIN CARD */}
      <div className="w-full max-w-[420px] relative z-10">
        <div className="relative bg-white/[0.03] backdrop-blur-2xl border border-white/10 px-8 py-10 md:px-10 md:py-12 rounded-[45px] shadow-2xl overflow-hidden">
          
          <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-white/[0.03] to-transparent pointer-events-none" />

          {/* IMPACTFUL LOGO */}
          <div className="flex justify-center mb-8 relative z-10">
            <Link href="/">
              <Image 
                src="/logo.png" 
                alt="Logo" 
                width={500} 
                height={150} 
                className="h-24 md:h-32 w-auto object-contain drop-shadow-[0_0_25px_rgba(255,0,0,0.5)]" 
                priority
              />
            </Link>
          </div>

          <div className="relative z-10">
            <h2 className="text-2xl font-black uppercase italic tracking-tighter mb-6 text-center text-white">
              Welcome <span className="text-brandRed">Back.</span>
            </h2>

            <form onSubmit={handleLogin} className="space-y-4">
              <div className="relative group">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20 group-focus-within:text-brandRed transition-colors" size={16} />
                <input 
                  type="email" 
                  placeholder="EMAIL" 
                  required
                 
                  suppressHydrationWarning // Add this line
                  className="w-full bg-black/40 border border-white/10 p-3.5 pl-11 rounded-xl font-bold text-[11px] tracking-widest focus:border-brandRed transition-all outline-none text-white placeholder:text-white/10"
                  value={email} 
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="relative group">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20 group-focus-within:text-brandRed transition-colors" size={16} />
                <input 
                  type={showPassword ? "text" : "password"} 
                  placeholder="PASSWORD" 
                  required
                  className="w-full bg-black/40 border border-white/10 p-3.5 pl-11 pr-11 rounded-xl font-bold text-[11px] tracking-widest focus:border-brandRed transition-all outline-none text-white placeholder:text-white/10"
                  value={password} 
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-white/20 hover:text-brandRed transition-colors"
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

              {error && (
                <p className="text-brandRed text-[9px] font-black uppercase tracking-widest text-center py-1">{error}</p>
              )}

              <button 
                disabled={loading} 
                className="w-full py-4 bg-brandRed text-white font-black uppercase tracking-[0.3em] rounded-xl hover:bg-white hover:text-black transition-all shadow-xl active:scale-95 text-[10px] flex items-center justify-center gap-2"
              >
                {loading ? 'Entering...' : 'Enter Tribe'} <ArrowRight size={14} />
              </button>
            </form>

            <div className="mt-8 text-center flex flex-col gap-3">
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