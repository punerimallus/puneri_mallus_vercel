"use client";
import { useState, useEffect, useRef, useMemo } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import Image from 'next/image';
import Link from 'next/link';
import { 
  Mail, Lock, User, ArrowRight, Eye, EyeOff, 
  Phone, Smartphone, Briefcase, 
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
  
  const recaptchaVerifierRef = useRef<RecaptchaVerifier | null>(null);
  const [waitingUserId, setWaitingUserId] = useState<string | null>(null);
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const [isWaitingForEmail, setIsWaitingForEmail] = useState(false);

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

  useEffect(() => {
    let poller: any;
    const checkEmailStatus = async () => {
      if (!waitingUserId || !isWaitingForEmail) return;
      try {
        const res = await fetch('/api/auth/check-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: waitingUserId })
        });
        const { confirmed } = await res.json();
        if (confirmed) {
          setMessage("Email verified! Redirecting...");
          clearInterval(poller);
          setTimeout(() => { router.push('/auth/login'); }, 2000);
        }
      } catch (err) {
        console.error("Polling error", err);
      }
    };
    if (isWaitingForEmail && waitingUserId) {
      poller = setInterval(checkEmailStatus, 3000); 
    }
    return () => { if (poller) clearInterval(poller); };
  }, [isWaitingForEmail, waitingUserId, router]);

  const PUNE_AREAS = ["Akurdi", "Aundh", "Balewadi", "Baner", "Bavdhan", "Bhosari", "Bibwewadi", "Camp", "Chikhali", "Chinchwad", "Dapodi", "Deccan", "Dhanori", "Erandwane", "Fatima Nagar", "Ghorpadi", "Hadapsar", "Hinjewadi", "Kalyani Nagar", "Karve Nagar", "Kasarwadi", "Katraj", "Khadki", "Kondhwa", "Koregaon Park", "Kothrud", "Lohegaon", "Magarpatta", "Model Colony", "Moshi", "Mundhwa", "NIBM", "Nigdi", "Pashan", "Phugewadi", "Pimpri", "Pimple Gurav", "Pimple Nilakh", "Pimple Saudagar", "Pune City", "Punawale", "Rahatani", "Ravet", "Sadashiv Peth", "Sahakar Nagar", "Sangvi", "Shivajinagar", "Sinhagad Road", "Sus", "Swargate", "Talawade", "Tathawade", "Thergaon", "Undri", "Viman Nagar", "Vishrantwadi", "Wakad", "Wanowrie", "Warje", "Yerwada"].sort();

  const isPhoneValid = useMemo(() => phone.length === 10, [phone]);
  
  // 🔥 This perfectly calculates the exact date 16 years ago from today
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
    setMessage("Sending code..."); 
    try {
      if (DEV_MODE_PHONE) {
        await new Promise(res => setTimeout(res, 800));
        setShowOtpField(true);
        setTimer(60);
        setMessage("Debug mode: Use code 123456");
        setOtpLoading(false);
        return;
      }
      if (!recaptchaVerifierRef.current) {
        recaptchaVerifierRef.current = new RecaptchaVerifier(auth, 'recaptcha-container', { size: 'invisible' });
      }
      const phoneNumber = `+91${phone}`;
      const confirmation = await signInWithPhoneNumber(auth, phoneNumber, recaptchaVerifierRef.current);
      setConfirmationResult(confirmation);
      setShowOtpField(true);
      setTimer(60);
      setMessage("Code sent! Check your messages.");
    } catch (error: any) {
      if (recaptchaVerifierRef.current) {
        recaptchaVerifierRef.current.clear();
        recaptchaVerifierRef.current = null;
      }
      setMessage("Couldn't send code. Please try again.");
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
          setMessage("Phone verified (Dev Mode)");
        } else { setMessage("Invalid test code."); }
      } else {
        if (!confirmationResult) throw new Error("Session Expired");
        await confirmationResult.confirm(otp);
        setIsPhoneVerified(true);
        setShowOtpField(false);
        setMessage("Phone verified successfully.");
      }
    } catch (error) { 
      setMessage("Invalid code. Please check and try again.");
    } finally { setOtpLoading(false); }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isPhoneVerified) {
      setMessage("Please verify your phone number first.");
      return;
    }
    setLoading(true);
    setMessage('Creating your account...');
    try {
      const { data: existingUser } = await supabase.from('profiles').select('phone_number').eq('phone_number', `+91${phone}`).maybeSingle();
      if (existingUser) {
        setMessage("This number is already registered.");
        setIsPhoneVerified(false); 
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
          setMessage("Email already exists. Please log in.");
        } else if (DEV_MODE_EMAIL) {
          setMessage('Welcome to the Tribe! Logging in...');
          setTimeout(() => router.push('/auth/login'), 2000);
        } else {
          setWaitingUserId(data.user.id);
          setMessage('Verification email sent. Please check your inbox.');
          setIsWaitingForEmail(true); 
        }
      }
    } catch (err: any) { 
      setMessage(err.message);
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-6 py-12 relative overflow-hidden">
      
      <div className="absolute inset-0 z-0">
        <Image 
          src="/events/login.jpg" 
          alt="Atmospheric Background" 
          fill 
          sizes="100vw"
          className="object-cover object-right opacity-60 transition-all duration-700" 
          priority 
        />
        <div className="absolute inset-0 bg-gradient-to-r from-black via-black/40 to-transparent" />
      </div>

      <div className="w-full max-w-[420px] relative z-10">
        <div 
          className="relative bg-white/[0.03] backdrop-blur-2xl border border-white/10 px-6 py-8 md:px-10 md:py-10 rounded-[32px] shadow-2xl text-left"
          style={{ transform: 'translateZ(0)' }}
        >
          <div className="text-center mb-6 relative z-10">
            <h1 className="text-xl font-black uppercase italic tracking-tighter text-white">Join the <span className="text-brandRed">Tribe.</span></h1>
          </div>

          <form onSubmit={handleSignup} className="space-y-3.5 relative z-10">
            
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="firstName" className="sr-only">First Name</label>
                <input id="firstName" type="text" placeholder="First name" required className="w-full bg-black/40 border border-white/10 p-3.5 rounded-xl font-medium text-[15px] focus:border-brandRed outline-none text-white placeholder:text-zinc-500 transition-colors" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </div>
              <div>
                <label htmlFor="lastName" className="sr-only">Last Name</label>
                <input id="lastName" type="text" placeholder="Last name" required className="w-full bg-black/40 border border-white/10 p-3.5 rounded-xl font-medium text-[15px] focus:border-brandRed outline-none text-white placeholder:text-zinc-500 transition-colors" value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="relative group">
                <label htmlFor="profession" className="sr-only">Profession</label>
                <Briefcase className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-brandRed transition-colors" size={16} />
                <input id="profession" type="text" placeholder="Profession" required className="w-full bg-black/40 border border-white/10 p-3.5 pl-11 rounded-xl font-medium text-[15px] focus:border-brandRed outline-none text-white placeholder:text-zinc-500 transition-colors" value={profession} onChange={(e) => setProfession(e.target.value)} />
              </div>
              
              {/* 🔥 UPDATED CALENDAR INVOCATION */}
              <div className="relative" ref={dateContainerRef}>
                <div className="bg-black/40 border border-white/10 p-3.5 rounded-xl flex items-center gap-3 cursor-pointer hover:border-white/30 transition-colors h-full" onClick={() => setShowCalendar(!showCalendar)}>
                  <CalendarIcon size={16} className={dob ? "text-brandRed" : "text-zinc-500"} />
                  <span className={`font-medium text-[14px] truncate ${dob ? "text-white" : "text-zinc-500"}`}>{dob ? new Date(dob).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : "Birth date"}</span>
                </div>
                <AnimatePresence>
                  {showCalendar && (
                    <TribeCalendar 
                      value={dob} 
                      onChange={(date) => setDob(date)} 
                      onClose={() => setShowCalendar(false)} 
                      maxDate={maxDobDate} 
                      defaultDate={maxDobDate} // 🔥 Forces the calendar to open exactly at 2010
                      anchorRef={dateContainerRef} 
                    />
                  )}
                </AnimatePresence>
              </div>
            </div>

            <div className="relative group">
              <label htmlFor="location" className="sr-only">Location Area</label>
              <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-brandRed transition-colors" size={16} />
              <select id="location" required className="w-full bg-black/60 border border-white/10 p-3.5 pl-11 rounded-xl font-medium text-[15px] focus:border-brandRed outline-none text-white appearance-none cursor-pointer transition-colors" value={location} onChange={(e) => setLocation(e.target.value)}>
                <option value="" disabled>Select area</option>
                {PUNE_AREAS.map(area => <option key={area} value={area} className="bg-zinc-900">{area}</option>)}
              </select>
            </div>

            <div className="space-y-1.5">
              <div className="relative flex items-center group">
                <label htmlFor="phone" className="sr-only">Phone Number</label>
                <Phone className="absolute left-4 text-zinc-500 group-focus-within:text-brandRed transition-colors" size={16} />
                <input 
                  id="phone"
                  type="tel" 
                  placeholder="Phone number" 
                  required 
                  maxLength={10} 
                  disabled={otpLoading} 
                  className={`w-full bg-black/40 border p-3.5 pl-11 rounded-xl font-medium text-[15px] focus:border-brandRed outline-none text-white border-white/10 placeholder:text-zinc-500 transition-all ${isPhoneVerified ? 'border-green-500/50 bg-green-500/5' : ''}`}
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
                  <button type="button" onClick={sendPhoneOtp} disabled={timer > 0 || otpLoading} className="absolute right-2 px-3 py-1.5 bg-brandRed text-white text-[11px] font-bold rounded-lg hover:bg-white hover:text-black transition-all disabled:opacity-50 flex items-center gap-2">
                    {otpLoading ? <Loader2 size={12} className="animate-spin" /> : null}
                    {timer > 0 ? `Wait ${timer}s` : "Verify"}
                  </button>
                )}
                {isPhoneVerified && <CheckCircle2 className="absolute right-4 text-green-500" size={18} />}
              </div>

              <AnimatePresence>
                {showOtpField && !isPhoneVerified && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="relative flex items-center mt-2 overflow-hidden">
                    <label htmlFor="otp" className="sr-only">OTP Code</label>
                    <Smartphone className="absolute left-4 text-brandRed" size={16} />
                    <input id="otp" type="text" placeholder="Enter 6-digit code" maxLength={6} disabled={otpLoading} className="w-full bg-brandRed/10 border border-brandRed/30 p-3.5 pl-11 pr-24 rounded-xl font-bold text-[15px] tracking-widest outline-none text-white placeholder:text-zinc-500 transition-colors" value={otp} onChange={(e) => setOtp(e.target.value)} />
                    <button type="button" onClick={verifyPhoneOtp} disabled={otpLoading || otp.length < 6} className="absolute right-2 px-3 py-1.5 bg-white text-black text-[11px] font-bold rounded-lg transition-all hover:bg-zinc-200 disabled:opacity-50">
                      {otpLoading ? <Loader2 size={12} className="animate-spin" /> : "Submit"}
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="relative group">
              <label htmlFor="email" className="sr-only">Email Address</label>
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-brandRed transition-colors" size={16} />
              <input id="email" type="email" placeholder="Email address" required className="w-full bg-black/40 border border-white/10 p-3.5 pl-11 rounded-xl font-medium text-[15px] focus:border-brandRed outline-none text-white placeholder:text-zinc-500 transition-colors" value={email} suppressHydrationWarning onChange={(e) => setEmail(e.target.value)} />
            </div>

            <div className="relative group">
              <label htmlFor="password" className="sr-only">Password</label>
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-brandRed transition-colors" size={16} />
              <input id="password" type={showPassword ? "text" : "password"} placeholder="Create a password" required className="w-full bg-black/40 border border-white/10 p-3.5 pl-11 pr-11 rounded-xl font-medium text-[15px] focus:border-brandRed outline-none text-white placeholder:text-zinc-500 transition-colors" value={password} onChange={(e) => setPassword(e.target.value)} />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-brandRed transition-colors">
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>

            <AnimatePresence>
              {message && (
                <motion.p 
                  initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className={`text-[12px] font-semibold text-center py-2.5 px-4 rounded-lg bg-black/50 border ${message.includes('verified') || message.includes('sent') ? 'text-green-400 border-green-400/20' : 'text-brandRed border-brandRed/20'}`}
                >
                  {message}
                </motion.p>
              )}
            </AnimatePresence>

            <button 
              disabled={Boolean(loading || (dob && !isAdult) || (!isPhoneVerified && !DEV_MODE_PHONE))} 
              className={`w-full py-4 text-white font-black uppercase tracking-widest rounded-xl transition-all shadow-xl active:scale-95 text-xs flex items-center justify-center gap-2 mt-2 ${
                (loading || (dob && !isAdult) || (!isPhoneVerified && !DEV_MODE_PHONE)) ? "bg-zinc-800/80 text-zinc-500 cursor-not-allowed" : "bg-brandRed hover:bg-white hover:text-black"
              }`}
            >
              {loading ? 'Processing...' : 'Sign Up'} <ArrowRight size={16} />
            </button>
          </form>
          
          <div id="recaptcha-container" className="hidden"></div>
          <style jsx global>{` .grecaptcha-badge { visibility: hidden !important; } `}</style>

          <div className="mt-6 text-center flex flex-col gap-2 relative z-10">
            <Link href="/auth/login" className="text-[11px] font-medium text-zinc-400 hover:text-white transition-colors">
              Already a member? <span className="text-white font-bold underline decoration-brandRed underline-offset-4">Log in</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}