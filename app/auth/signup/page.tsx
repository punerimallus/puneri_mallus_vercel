"use client";
import { useState, useEffect, useRef, useMemo } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import Image from 'next/image';
import Link from 'next/link';
import { 
  Mail, Lock, User, ArrowRight, Eye, EyeOff, 
  Phone, Smartphone, RefreshCcw, Briefcase, 
  MapPin, Calendar as CalendarIcon 
} from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function SignupPage() {
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [profession, setProfession] = useState('');
  const [location, setLocation] = useState('');
  const [dob, setDob] = useState('');
  const [otp, setOtp] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const router = useRouter();
  const [timer, setTimer] = useState(0);
  const dateInputRef = useRef<HTMLInputElement>(null);

  const PUNE_AREAS = [
    "Pune", "Shivajinagar", "Kothrud", "Karve Nagar", "Erandwane", "Deccan", 
    "Sadashiv Peth", "Swargate", "Bibwewadi", "Dhankawadi", "Sahakar Nagar", 
    "Parvati", "Camp", "Koregaon Park", "Mundhwa", "Hadapsar", "Magarpatta", 
    "Wanowrie", "Fatima Nagar", "Kondhwa", "NIBM", "Undri", "Katraj", 
    "Sinhagad Road", "Warje", "Baner", "Balewadi", "Aundh", "Pashan", 
    "Sus", "Bavdhan", "Model Colony", "Viman Nagar", "Yerwada", 
    "Kalyani Nagar", "Lohegaon", "Dhanori", "Vishrantwadi", "Khadki", 
    "Ghorpadi", "Pimpri", "Chinchwad", "Akurdi", "Nigdi", "Bhosari", 
    "Wakad", "Hinjewadi", "Ravet", "Pimple Saudagar", "Pimple Gurav", 
    "Pimple Nilakh", "Kalewadi", "Thergaon", "Rahatani", "Moshi", 
    "Chikhali", "Talawade", "Punawale", "Tathawade", "Dapodi", 
    "Sangvi", "Kasarwadi", "Phugewadi"
  ].sort();

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

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
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age >= 16;
  }, [dob]);

  useEffect(() => {
    let interval: any;
    if (timer > 0) {
      interval = setInterval(() => {
        setTimer((prev) => prev - 1);
      }, 1000);
    } else {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [timer]);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();

    if (step === 1 && dob && !isAdult) {
      setMessage("MEMBERSHIP DENIED: YOU MUST BE 16+ TO JOIN.");
      return;
    }

    setLoading(true);
    setMessage('');

    if (step === 1) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        phone: phone, 
        options: {
          data: { 
            first_name: firstName.toUpperCase(),
            last_name: lastName.toUpperCase(),
            full_name: `${firstName} ${lastName}`.toUpperCase(),
            profession: profession.toUpperCase(),
            location: location,
            dob: dob,
          },
        },
      });

      if (error) {
        // CATCHING TRIGGER EXCEPTION: If the Supabase trigger returns an age error
        if (error.message.toLowerCase().includes("16") || error.message.toLowerCase().includes("denied")) {
          setMessage("MEMBERSHIP DENIED: AGE MUST BE 16 OR OLDER.");
        } else {
          setMessage(error.message);
        }
        setLoading(false);
      } else {
        await supabase.auth.signOut();
        setMessage('REGISTRATION SUCCESSFUL! Head back to Login.');
        setLoading(false);
        setTimeout(() => router.push('/auth/login'), 3000);
      }
    } else {
      const { error } = await supabase.auth.verifyOtp({ phone, token: otp, type: 'sms' });
      if (error) setMessage(error.message);
      else router.push('/'); 
      setLoading(false);
    }
  };

  return (
    // UPDATED: Changed items-center to items-end and added pb-12 to push the card down
    <div className="min-h-screen bg-black flex items-end justify-center p-6 pb-12 relative overflow-hidden">
      
      <div className="absolute inset-0 z-0 flex items-center justify-center">
        <Image 
          src="/events/signup.jpg" 
          alt="Background" 
          fill 
          className="object-cover object-right opacity-60" 
          priority 
        />
        <div className="absolute inset-0 bg-gradient-to-r from-black via-black/40 to-transparent hidden lg:block" />
        <div className="absolute inset-0 bg-black/60 lg:hidden" />
      </div>

      <div className="w-full max-w-[460px] relative z-10">
        <div className="relative bg-white/[0.03] backdrop-blur-2xl border border-white/10 px-8 py-10 md:px-10 md:py-12 rounded-[45px] shadow-2xl overflow-hidden text-left">
          
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
              {step === 1 ? <>Join the <span className="text-brandRed">Tribe.</span></> : <>Verify <span className="text-brandRed">Phone.</span></>}
            </h2>

            <form onSubmit={handleSignup} className="space-y-3.5">
              {step === 1 ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <input 
                      type="text" placeholder="FIRST NAME" required
                      className="bg-black/40 border border-white/10 p-4 rounded-xl font-bold text-[10px] tracking-widest focus:border-brandRed transition-all outline-none text-white"
                      value={firstName} onChange={(e) => setFirstName(e.target.value)}
                    />
                    <input 
                      type="text" placeholder="LAST NAME" required
                      className="bg-black/40 border border-white/10 p-4 rounded-xl font-bold text-[10px] tracking-widest focus:border-brandRed transition-all outline-none text-white"
                      value={lastName} onChange={(e) => setLastName(e.target.value)}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="relative group">
                      <Briefcase className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20" size={14} />
                      <input 
                        type="text" placeholder="PROFESSION" required
                        className="w-full bg-black/40 border border-white/10 p-4 pl-11 rounded-xl font-bold text-[10px] tracking-widest focus:border-brandRed transition-all outline-none text-white"
                        value={profession} onChange={(e) => setProfession(e.target.value)}
                      />
                    </div>
                    
                    <div 
                      className="relative group cursor-pointer bg-black/40 border border-white/10 p-4 rounded-xl flex items-center gap-3 focus-within:border-brandRed transition-all"
                      onClick={() => dateInputRef.current?.showPicker()}
                    >
                      <CalendarIcon size={14} className={dob ? "text-brandRed" : "text-white/20"} />
                      <span className={`font-bold text-[9px] tracking-widest uppercase truncate ${dob ? "text-white" : "text-zinc-500"}`}>
                        {dob ? new Date(dob).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : "BIRTH DATE"}
                      </span>
                      <input 
                        ref={dateInputRef}
                        type="date" 
                        required
                        max={maxDobDate} 
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                        value={dob} 
                        onChange={(e) => setDob(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="relative group">
                    <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20" size={14} />
                    <select 
                      required
                      className="w-full bg-black border border-white/10 p-4 pl-11 rounded-xl font-bold text-[11px] tracking-widest focus:border-brandRed transition-all outline-none text-white appearance-none cursor-pointer"
                      value={location} onChange={(e) => setLocation(e.target.value)}
                    >
                      <option value="" disabled className="bg-zinc-900">SELECT PUNE AREA</option>
                      {PUNE_AREAS.map(area => (
                        <option key={area} value={area} className="bg-zinc-900">{area}</option>
                      ))}
                    </select>
                  </div>

                  <div className="relative group">
                    <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20" size={14} />
                    <input 
                      type="tel" placeholder="PHONE NUMBER" required
                      className="w-full bg-black/40 border border-white/10 p-4 pl-11 rounded-xl font-bold text-[11px] tracking-widest focus:border-brandRed transition-all outline-none text-white"
                      value={phone} onChange={(e) => setPhone(e.target.value)}
                    />
                  </div>

                  <div className="relative group">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20" size={14} />
                    <input 
                      type="email" placeholder="EMAIL" required
                      className="w-full bg-black/40 border border-white/10 p-4 pl-11 rounded-xl font-bold text-[11px] tracking-widest focus:border-brandRed transition-all outline-none text-white"
                      value={email} onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>

                  <div className="relative group">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20" size={14} />
                    <input 
                      type={showPassword ? "text" : "password"} placeholder="PASSWORD" required
                      className="w-full bg-black/40 border border-white/10 p-4 pl-11 pr-11 rounded-xl font-bold text-[11px] tracking-widest focus:border-brandRed transition-all outline-none text-white"
                      value={password} onChange={(e) => setPassword(e.target.value)}
                    />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-white/20 hover:text-brandRed transition-colors">
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </>
              ) : (
                <div className="space-y-6 text-center">
                  <p className="text-[10px] text-zinc-400 font-bold tracking-widest uppercase leading-relaxed">
                    OTP sent to <span className="text-white">{phone}</span>
                  </p>
                  
                  <div className="relative group">
                    <Smartphone className="absolute left-4 top-1/2 -translate-y-1/2 text-brandRed" size={18} />
                    <input 
                      type="text" placeholder="######" required maxLength={6}
                      className="w-full bg-black/60 border border-brandRed/50 p-5 pl-12 rounded-2xl font-black text-xl tracking-[0.5em] focus:border-brandRed transition-all outline-none text-white text-center"
                      value={otp} onChange={(e) => setOtp(e.target.value)}
                    />
                  </div>
                </div>
              )}

              {/* DYNAMIC ERROR/SUCCESS MESSAGE */}
              {message && (
                <p className={`text-[9px] font-black uppercase text-center py-2 px-4 rounded-lg bg-black/50 border ${message.includes('SUCCESSFUL') ? 'text-green-500 border-green-500/20' : 'text-brandRed border-brandRed/20'}`}>
                  {message}
                </p>
              )}

              {!isAdult && dob && (
                <div className="flex flex-col items-center gap-1 animate-pulse">
                  <p className="text-[8px] font-black uppercase text-center text-brandRed tracking-widest">
                    Restricted: Age must be 16+
                  </p>
                  <div className="h-[1px] w-12 bg-brandRed/30" />
                </div>
              )}

              <button 
                disabled={Boolean(loading || (step === 1 && dob && !isAdult))} 
                className={`w-full py-4 text-white font-black uppercase tracking-[0.3em] rounded-xl transition-all shadow-xl active:scale-95 text-[10px] flex items-center justify-center gap-2 mt-4 ${
                  (step === 1 && dob && !isAdult) ? "bg-zinc-800 cursor-not-allowed opacity-50" : "bg-brandRed hover:bg-white hover:text-black"
                }`}
              >
                {loading ? 'Processing...' : step === 1 ? 'Tap to Verify' : 'Join Tribe'} <ArrowRight size={14} />
              </button>
            </form>

            <div className="mt-8 text-center flex flex-col gap-3">
              <Link href="/auth/login" className="text-[9px] font-black uppercase tracking-widest text-white/30 hover:text-brandRed transition-colors">
                Already a member? <span className="text-white">Sign In</span>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}