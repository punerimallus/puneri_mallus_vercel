"use client";
import { useState, useEffect, useRef, useMemo } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import Image from 'next/image';
import Link from 'next/link';
import { 
  Mail, Lock, User, ArrowRight, Eye, EyeOff, 
  Phone, Smartphone, RefreshCcw, Briefcase, 
  MapPin, Calendar as CalendarIcon, CheckCircle2, Loader2 
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import TribeCalendar from '@/components/ui/TribeCalendar';
import { auth } from '@/lib/firebase';
import { RecaptchaVerifier, signInWithPhoneNumber, ConfirmationResult } from "firebase/auth";

const DEV_MODE_PHONE = false; 
const DEV_MODE_EMAIL = false; 

export default function SignupPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [profession, setProfession] = useState('');
  const [location, setLocation] = useState('');
  const [dob, setDob] = useState('');
  const [otp, setOtp] = useState('');
  const [showOtpField, setShowOtpField] = useState(false);
  const [isPhoneVerified, setIsPhoneVerified] = useState(DEV_MODE_PHONE); 
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [otpLoading, setOtpLoading] = useState(false); 
  const [message, setMessage] = useState('');
  const [timer, setTimer] = useState(0);
  const router = useRouter();
  const [showCalendar, setShowCalendar] = useState(false);
  const dateContainerRef = useRef<HTMLDivElement>(null);
  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null);
  
  // 🔥 NEW: Store verifier in ref to prevent re-initialization lag
  const recaptchaVerifierRef = useRef<RecaptchaVerifier | null>(null);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const [isWaitingForEmail, setIsWaitingForEmail] = useState(false);

  // --- ⚡ SPEED OPTIMIZATION: Pre-warm reCAPTCHA ---
  useEffect(() => {
    if (typeof window !== "undefined" && !recaptchaVerifierRef.current) {
      recaptchaVerifierRef.current = new RecaptchaVerifier(auth, 'recaptcha-container', {
        size: 'invisible'
      });
    }
    return () => {
      if (recaptchaVerifierRef.current) {
        recaptchaVerifierRef.current.clear();
        recaptchaVerifierRef.current = null;
      }
    };
  }, []);

  // --- AUTOMATIC REDIRECT ENGINE ---
  useEffect(() => {
    let poller: any;
    const checkGlobalRegistration = async () => {
      if (!phone || !isWaitingForEmail) return;
      const { data, error } = await supabase
        .from('profiles')
        .select('id')
        .eq('phone_number', `+91${phone}`)
        .maybeSingle();

      if (data && !error) {
        setMessage("IDENTITY VERIFIED! SYNCING ACCESS...");
        clearInterval(poller);
        setTimeout(() => { router.push('/auth/login'); }, 2000);
      }
    };

    if (isWaitingForEmail) {
      poller = setInterval(checkGlobalRegistration, 3000);
    }
    return () => { if (poller) clearInterval(poller); };
  }, [isWaitingForEmail, phone, supabase, router]);

  const PUNE_AREAS = ["Akurdi", "Aundh", "Balewadi", "Baner", "Bavdhan", "Bhosari", "Bibwewadi", "Camp", "Chikhali", "Chinchwad", "Dapodi", "Deccan", "Dhanori", "Erandwane", "Fatima Nagar", "Ghorpadi", "Hadapsar", "Hinjewadi", "Kalyani Nagar", "Karve Nagar", "Kasarwadi", "Katraj", "Khadki", "Kondhwa", "Koregaon Park", "Kothrud", "Lohegaon", "Magarpatta", "Model Colony", "Moshi", "Mundhwa", "NIBM", "Nigdi", "Pashan", "Phugewadi", "Pimpri", "Pimple Gurav", "Pimple Nilakh", "Pimple Saudagar", "Pune City", "Punawale", "Rahatani", "Ravet", "Sadashiv Peth", "Sahakar Nagar", "Sangvi", "Shivajinagar", "Sinhagad Road", "Sus", "Swargate", "Talawade", "Tathawade", "Thergaon", "Undri", "Viman Nagar", "Vishrantwadi", "Wakad", "Wanowrie", "Warje", "Yerwada"].sort();

  const isPhoneValid = useMemo(() => phone.length === 10, [phone]);
  const maxDobDate = useMemo(() => {
    const date = new Date();
    date.setFullYear(date.getFullYear() - 16);
    return date.toISOString().split("T")[0];
  }, []);

  const isAdult = useMemo(() => {
    if (!dob) return false;
    const birthDate = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
    return age >= 16;
  }, [dob]);

  useEffect(() => {
    let interval: any;
    if (timer > 0) interval = setInterval(() => setTimer((prev) => prev - 1), 1000);
    return () => clearInterval(interval);
  }, [timer]);

  const sendPhoneOtp = async () => {
    if (!isPhoneValid || timer > 0 || otpLoading) return;
    setOtpLoading(true);
    setMessage("TRIBE SECURE: INITIALIZING GATEWAY..."); 
    try {
      if (DEV_MODE_PHONE) {
        await new Promise(res => setTimeout(res, 800));
        setShowOtpField(true);
        setTimer(60);
        setMessage("DEBUG MODE: USE CODE 123456");
        setOtpLoading(false);
        return;
      }

      // 🔥 USE PRE-WARMED VERIFIER (Much faster)
      if (!recaptchaVerifierRef.current) {
        recaptchaVerifierRef.current = new RecaptchaVerifier(auth, 'recaptcha-container', { size: 'invisible' });
      }
      
      const phoneNumber = `+91${phone}`;
      const confirmation = await signInWithPhoneNumber(auth, phoneNumber, recaptchaVerifierRef.current);
      setConfirmationResult(confirmation);
      setShowOtpField(true);
      setTimer(60);
      setMessage("BROADCAST SENT. CHECK YOUR DEVICE.");
    } catch (error: any) {
      if (recaptchaVerifierRef.current) {
        recaptchaVerifierRef.current.clear();
        recaptchaVerifierRef.current = null;
      }
      setMessage("GATEWAY ERROR. RETRYING...");
      setTimer(0);
    } finally { setOtpLoading(false); }
  };

  const verifyPhoneOtp = async () => {
    if (!otp || otpLoading) return;
    setOtpLoading(true);
    try {
      if (DEV_MODE_PHONE) {
        if (otp === "123456") {
          setIsPhoneVerified(true);
          setShowOtpField(false);
          setMessage("IDENTITY VERIFIED (DEV)");
        } else { setMessage("INVALID TEST CODE."); }
      } else {
        if (!confirmationResult) throw new Error("Session Expired");
        await confirmationResult.confirm(otp);
        setIsPhoneVerified(true);
        setShowOtpField(false);
        setMessage("PHONE VERIFIED SUCCESSFULLY");
      }
    } catch (error) { setMessage("INVALID OTP. PLEASE CHECK AGAIN.");
    } finally { setOtpLoading(false); }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isPhoneVerified) {
      setMessage("PLEASE VERIFY PHONE NUMBER.");
      return;
    }
    setLoading(true);
    setMessage('SYNCING TRIBE IDENTITY...');
    try {
      const { data: existingUser } = await supabase.from('profiles').select('phone_number').eq('phone_number', `+91${phone}`).maybeSingle();
      if (existingUser) {
        setMessage("NUMBER ALREADY REGISTERED. TRY ANOTHER.");
        setIsPhoneVerified(false); // Unlock the field
        setLoading(false);
        return;
      }
      const { data, error: signupError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { 
            first_name: firstName.toUpperCase().trim(),
            last_name: lastName.toUpperCase().trim(),
            full_name: `${firstName} ${lastName}`.toUpperCase().trim(),
            profession: profession.toUpperCase().trim(),
            location: location,
            dob: dob,
            phone: `+91${phone}`,
          },
        },
      });
      if (signupError) throw signupError;
      if (data.user) {
        if (data.user.identities?.length === 0) {
          setMessage("EMAIL ALREADY EXISTS. SIGN IN.");
        } else if (DEV_MODE_EMAIL) {
          setMessage('WELCOME TO THE TRIBE! ENTERING...');
          setTimeout(() => router.push('/auth/login'), 2000);
        } else {
          setMessage('VERIFICATION EMAIL SENT. CHECK YOUR MAIL...');
          setIsWaitingForEmail(true); 
        }
      }
    } catch (err: any) { setMessage(err.message.toUpperCase());
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-black flex items-start justify-center p-6 pt-24 md:pt-32 relative overflow-hidden">
      <div className="absolute inset-0 z-0">
        <Image src="/events/signup.jpg" alt="BG" fill className="object-cover object-right opacity-60" priority />
        <div className="absolute inset-0 bg-gradient-to-r from-black via-black/40 to-transparent" />
      </div>

      <div className="w-full max-w-[420px] relative z-10">
        <div className="relative bg-white/[0.03] backdrop-blur-2xl border border-white/10 px-8 py-8 md:px-10 md:py-10 rounded-[32px] shadow-2xl text-left">
          
          <div className="flex justify-center mb-6">
            <Link href="/">
              <Image src="/logo.png" alt="Logo" width={400} height={120} className="h-16 md:h-20 w-auto object-contain drop-shadow-[0_0_25px_rgba(255,0,0,0.5)]" priority />
            </Link>
          </div>

          <div className="text-center mb-6">
            <h2 className="text-xl font-black uppercase italic tracking-tighter text-white">Join the <span className="text-brandRed">Tribe.</span></h2>
          </div>

          <form onSubmit={handleSignup} className="space-y-3.5">
            <div className="grid grid-cols-2 gap-3">
              <input type="text" placeholder="FIRST NAME" required className="bg-black/40 border border-white/10 p-3.5 rounded-xl font-bold text-[10px] tracking-widest focus:border-brandRed outline-none text-white uppercase placeholder:text-zinc-500" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              <input type="text" placeholder="LAST NAME" required className="bg-black/40 border border-white/10 p-3.5 rounded-xl font-bold text-[10px] tracking-widest focus:border-brandRed outline-none text-white uppercase placeholder:text-zinc-500" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="relative">
                <Briefcase className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={14} />
                <input type="text" placeholder="PROFESSION" required className="w-full bg-black/40 border border-white/10 p-3.5 pl-11 rounded-xl font-bold text-[10px] tracking-widest focus:border-brandRed outline-none text-white uppercase placeholder:text-zinc-500" value={profession} onChange={(e) => setProfession(e.target.value)} />
              </div>
              
              <div className="relative" ref={dateContainerRef}>
                <div className="bg-black/40 border border-white/10 p-3.5 rounded-xl flex items-center gap-3 cursor-pointer" onClick={() => setShowCalendar(!showCalendar)}>
                  <CalendarIcon size={14} className={dob ? "text-brandRed" : "text-zinc-500"} />
                  <span className={`font-bold text-[9px] tracking-widest uppercase truncate ${dob ? "text-white" : "text-zinc-500"}`}>{dob ? new Date(dob).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : "BIRTH DATE"}</span>
                </div>
                <AnimatePresence>
                  {showCalendar && (
                    <TribeCalendar value={dob} onChange={(date) => setDob(date)} onClose={() => setShowCalendar(false)} maxDate={maxDobDate} anchorRef={dateContainerRef} />
                  )}
                </AnimatePresence>
              </div>
            </div>

            <div className="relative group">
              <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={14} />
              <select required className="w-full bg-black border border-white/10 p-3.5 pl-11 rounded-xl font-bold text-[11px] tracking-widest focus:border-brandRed outline-none text-white appearance-none cursor-pointer" value={location} onChange={(e) => setLocation(e.target.value)}>
                <option value="" disabled>SELECT AREA</option>
                {PUNE_AREAS.map(area => <option key={area} value={area} className="bg-zinc-900">{area}</option>)}
              </select>
            </div>

            <div className="space-y-1.5">
              <div className="relative flex items-center group">
                <Phone className="absolute left-4 text-zinc-500" size={14} />
                <input 
                  type="tel" 
                  placeholder="PHONE NUMBER" 
                  required 
                  maxLength={10} 
                  disabled={otpLoading} 
                  className={`w-full bg-black/40 border p-3.5 pl-11 rounded-xl font-bold text-[10px] tracking-widest focus:border-brandRed outline-none text-white border-white/10 placeholder:text-zinc-500 transition-all ${isPhoneVerified ? 'border-green-500/50 bg-green-500/5' : ''}`}
                  value={phone} 
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '');
                    setPhone(val);
                    if (isPhoneVerified) setIsPhoneVerified(false);
                    if (showOtpField) setShowOtpField(false);
                    setTimer(0); 
                    setMessage(""); 
                    setConfirmationResult(null);
                  }}
                />
                {!isPhoneVerified && isPhoneValid && (
                  <button type="button" onClick={sendPhoneOtp} disabled={timer > 0 || otpLoading} className="absolute right-2 px-3 py-1.5 bg-brandRed text-white text-[9px] font-black rounded-lg hover:bg-white hover:text-black transition-all disabled:opacity-50 flex items-center gap-2">
                    {otpLoading ? <Loader2 size={10} className="animate-spin" /> : null}
                    {timer > 0 ? `WAIT ${timer}s` : "VERIFY"}
                  </button>
                )}
                {isPhoneVerified && <CheckCircle2 className="absolute right-4 text-green-500" size={16} />}
              </div>

              <AnimatePresence>
                {showOtpField && !isPhoneVerified && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="relative flex items-center mt-2 overflow-hidden">
                    <Smartphone className="absolute left-4 text-brandRed" size={14} />
                    <input type="text" placeholder="ENTER 6-DIGIT OTP" maxLength={6} disabled={otpLoading} className="w-full bg-brandRed/10 border border-brandRed/30 p-3.5 pl-11 pr-24 rounded-xl font-black text-[10px] tracking-[0.3em] outline-none text-white placeholder:text-zinc-500" value={otp} onChange={(e) => setOtp(e.target.value)} />
                    <button type="button" onClick={verifyPhoneOtp} disabled={otpLoading || otp.length < 6} className="absolute right-2 px-3 py-1.5 bg-white text-black text-[9px] font-black rounded-lg transition-all">
                      {otpLoading ? <Loader2 size={10} className="animate-spin" /> : "SUBMIT"}
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={14} />
              <input type="email" placeholder="EMAIL ADDRESS" required className="w-full bg-black/40 border border-white/10 p-3.5 pl-11 rounded-xl font-bold text-[10px] tracking-widest focus:border-brandRed outline-none text-white placeholder:text-zinc-500" value={email} suppressHydrationWarning onChange={(e) => setEmail(e.target.value)} />
            </div>

            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={14} />
              <input type={showPassword ? "text" : "password"} placeholder="PASSWORD" required className="w-full bg-black/40 border border-white/10 p-3.5 pl-11 pr-11 rounded-xl font-bold text-[10px] tracking-widest focus:border-brandRed outline-none text-white placeholder:text-zinc-500" value={password} onChange={(e) => setPassword(e.target.value)} />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-brandRed">
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>

            {message && (
              <p className={`text-[8px] font-black uppercase text-center py-2 px-4 rounded-lg bg-black/50 border ${message.includes('VERIFIED') || message.includes('SENT') ? 'text-green-400 border-green-400/20' : 'text-brandRed border-brandRed/20'}`}>
                {message}
              </p>
            )}

            <button 
              disabled={Boolean(loading || (dob && !isAdult) || (!isPhoneVerified && !DEV_MODE_PHONE))} 
              className={`w-full py-4 text-white font-black uppercase tracking-[0.3em] rounded-xl transition-all shadow-xl active:scale-95 text-[10px] flex items-center justify-center gap-2 mt-2 ${
                (loading || (dob && !isAdult) || (!isPhoneVerified && !DEV_MODE_PHONE)) ? "bg-zinc-800 cursor-not-allowed opacity-50" : "bg-brandRed hover:bg-white hover:text-black"
              }`}
            >
              {loading ? 'Processing...' : 'Tap to Register'} <ArrowRight size={14} />
            </button>
          </form>
          
          <div id="recaptcha-container" className="hidden"></div>
          <style jsx global>{` .grecaptcha-badge { visibility: hidden !important; } `}</style>

          <div className="mt-6 text-center flex flex-col gap-2">
            <Link href="/auth/login" className="text-[9px] font-black uppercase tracking-widest text-white/30 hover:text-brandRed transition-colors">
              Already a member? <span className="text-white">Sign In</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}