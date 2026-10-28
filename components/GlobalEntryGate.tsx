"use client";
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Phone, User, ArrowRight, X, Loader2, Smartphone, ShieldCheck } from 'lucide-react';
import { createBrowserClient } from '@supabase/ssr';
import { auth as firebaseAuth } from '@/lib/firebase';
import { RecaptchaVerifier, signInWithPhoneNumber, ConfirmationResult } from "firebase/auth";
import { friendlyError } from '@/lib/user-errors';

export default function GlobalEntryGate() {
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  
  // NEW: State to track if user is returning and store their real email
  const [isNewUser, setIsNewUser] = useState(false);
  const [realEmailState, setRealEmailState] = useState<string | null>(null);

  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null);
  const recaptchaVerifierRef = useRef<RecaptchaVerifier | null>(null);
  
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    const checkUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        const handleIntercept = (e: MouseEvent) => {
          const target = e.target as HTMLElement;
          if (target.closest('.auth-modal-content')) return;
          e.preventDefault();
          e.stopPropagation();
          setIsOpen(true);
        };
        document.addEventListener('click', handleIntercept, true);
        return () => document.removeEventListener('click', handleIntercept, true);
      }
    };
    checkUser();
  }, [supabase]);

  // 🔥 STEP 1 LOGIC: Check DB First
  const handlePhoneSubmit = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const formattedPhone = `+91${phone}`;
      
      // Check the Database securely via RPC
      const { data: realEmail, error: rpcError } = await supabase.rpc('get_auth_email_by_phone', { 
        p_phone: formattedPhone 
      });

      if (realEmail) {
        // RETURNING USER: Store email, skip Name step, send OTP
        setRealEmailState(realEmail);
        setIsNewUser(false);
        await sendOtp(); 
      } else {
        // NEW USER: Move to Name Step
        setIsNewUser(true);
        setStep(2);
      }
    } catch (err: any) {
      setErrorMsg(friendlyError(err, "Could not connect. Please check your network."));
    } finally {
      setLoading(false);
    }
  };

  // 🔥 STEP 2 LOGIC: Only for new users
  const handleNameSubmit = async () => {
    await sendOtp();
  };

  // HELPER: Send Firebase OTP
  const sendOtp = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      if (!recaptchaVerifierRef.current) {
        recaptchaVerifierRef.current = new RecaptchaVerifier(firebaseAuth, 'recaptcha-container', { size: 'invisible' });
      }
      const result = await signInWithPhoneNumber(firebaseAuth, `+91${phone}`, recaptchaVerifierRef.current);
      setConfirmationResult(result);
      setStep(3); // Move to OTP Step
    } catch (err: any) {
      setErrorMsg(friendlyError(err, "We could not send the code. Please check the number."));
      if (recaptchaVerifierRef.current) {
        recaptchaVerifierRef.current.clear();
        recaptchaVerifierRef.current = null;
      }
      setStep(1); // Reset on failure
    } finally { 
      setLoading(false); 
    }
  };

  // 🔥 STEP 3 LOGIC: Verify OTP & Finalize
  const verifyAndFinalize = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      if (!confirmationResult) return;
      
      // 1. Verify the code with Firebase
      await confirmationResult.confirm(otp);

      const formattedPhone = `+91${phone}`;
      const securePassword = `Tribe123!${phone}`;

      if (!isNewUser && realEmailState) {
        // --- RETURNING USER FLOW ---
        const { error: loginError } = await supabase.auth.signInWithPassword({
          email: realEmailState,
          password: securePassword,
        });

        if (loginError) throw new Error(`Login failed: ${loginError.message}`);
        
        setIsOpen(false);
        window.location.reload();

      } else {
        // --- NEW USER REGISTRATION FLOW ---
        const ghostEmail = `${phone}@punerimallus.com`;

        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
          email: ghostEmail,
          password: securePassword,
          options: { data: { full_name: name.toUpperCase() } }
        });

        // SELF-HEALING CORRUPTED TEST DATA
        if (signUpError && signUpError.message.includes("User already registered")) {
           const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
              email: ghostEmail,
              password: securePassword,
           });
           if (signInError) throw signInError;
           
           await supabase.from('profiles').insert({
              id: signInData.user.id,
              phone_number: formattedPhone,
              email: ghostEmail,
              full_name: name.toUpperCase(),
           });
           
           setIsOpen(false);
           window.location.reload();
           return;
        }

        if (signUpError) throw signUpError;
        if (!signUpData.user) throw new Error("Failed to create user session.");

        // Insert Profile
        const { error: profileError } = await supabase.from('profiles').insert({
          id: signUpData.user.id,
          phone_number: formattedPhone,
          email: ghostEmail,
          full_name: name.toUpperCase(),
        });

        if (profileError) throw profileError;

        setIsOpen(false);
        window.location.reload();
      }

    } catch (err: any) {
      setErrorMsg(friendlyError(err, "That code did not work. Please try again."));
    } finally { 
      setLoading(false); 
    }
  };

  return (
      <>
        {/* Firebase Needs this to ALWAYS exist in the DOM */}
        <div id="recaptcha-container" className="hidden"></div>
  
        <AnimatePresence>
          {isOpen && (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="absolute inset-0 bg-black/80 backdrop-blur-md"
                onClick={() => setIsOpen(false)}
                style={{ transform: 'translateZ(0)' }}
              />
              
              <motion.div 
                initial={{ scale: 0.95, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 20 }}
                className="auth-modal-content relative w-full max-w-[420px] bg-zinc-950/90 backdrop-blur-2xl border border-white/10 rounded-[40px] p-8 md:p-10 shadow-2xl text-center overflow-hidden"
                style={{ transform: 'translateZ(0)' }}
              >
                <button type="button" onClick={() => setIsOpen(false)} className="absolute top-6 right-6 text-zinc-500 hover:text-white transition-colors">
                  <X size={20} />
                </button>
  
                <AnimatePresence mode="wait">
                  
                  {/* STEP 1: PHONE */}
                  {step === 1 && (
                    <motion.form 
                      key="phone" 
                      initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} 
                      className="space-y-8"
                      onSubmit={(e) => { e.preventDefault(); handlePhoneSubmit(); }}
                    >
                      <div className="space-y-2">
                        <h2 className="text-3xl font-black italic uppercase text-white tracking-tighter">Enter <span className="text-brandRed">Tribe.</span></h2>
                        <p className="text-zinc-400 text-[11px] font-bold uppercase tracking-widest">Verify your phone to continue</p>
                      </div>
                      
                      <div className="space-y-4">
                        <div className="relative group">
                          <Phone className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-brandRed transition-colors" size={18} />
                          <input 
                            type="tel" placeholder="Phone Number" maxLength={10}
                            className="w-full bg-black/50 border border-white/10 p-4 pl-14 rounded-2xl text-white outline-none focus:border-brandRed transition-all font-bold text-[15px]" 
                            value={phone} onChange={e => { setPhone(e.target.value.replace(/\D/g, '')); setErrorMsg(''); }} 
                          />
                        </div>
                        {errorMsg && <p className="text-brandRed text-[10px] font-bold uppercase tracking-widest">{errorMsg}</p>}
                      </div>
  
                      <button 
                        type="submit" 
                        disabled={loading || phone.length !== 10} 
                        className="w-full bg-brandRed py-5 rounded-2xl font-black uppercase tracking-widest text-[11px] flex items-center justify-center gap-3 hover:bg-white hover:text-black transition-all shadow-xl active:scale-95 disabled:opacity-50"
                      >
                        {loading ? <Loader2 className="animate-spin" size={18} /> : <>Continue <ArrowRight size={18} /></>}
                      </button>
                    </motion.form>
                  )}

                  {/* STEP 2: NAME (ONLY FOR NEW USERS) */}
                  {step === 2 && (
                    <motion.form 
                      key="name" 
                      initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} 
                      className="space-y-8"
                      onSubmit={(e) => { e.preventDefault(); handleNameSubmit(); }}
                    >
                      <div className="space-y-2">
                        <h2 className="text-3xl font-black italic uppercase text-white tracking-tighter">Almost <span className="text-brandRed">Done.</span></h2>
                        <p className="text-zinc-400 text-[11px] font-bold uppercase tracking-widest">What should we call you?</p>
                      </div>
  
                      <div className="space-y-4">
                        <div className="relative group">
                          <User className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-brandRed transition-colors" size={18} />
                          <input 
                            type="text" placeholder="Your Full Name" 
                            className="w-full bg-black/50 border border-white/10 p-4 pl-14 rounded-2xl text-white outline-none focus:border-brandRed transition-all font-bold text-[15px]" 
                            value={name} onChange={e => { setName(e.target.value); setErrorMsg(''); }} 
                          />
                        </div>
                        {errorMsg && <p className="text-brandRed text-[10px] font-bold uppercase tracking-widest">{errorMsg}</p>}
                      </div>
  
                      <div className="flex gap-4">
                        <button 
                          type="button" 
                          onClick={() => { setStep(1); }}
                          className="flex-1 bg-zinc-900 border border-white/10 text-white py-5 rounded-2xl font-black uppercase tracking-widest text-[11px] hover:bg-zinc-800 transition-all"
                        >
                          Back
                        </button>
                        <button 
                          type="submit" 
                          disabled={loading || name.trim().length < 2} 
                          className="flex-[2] bg-brandRed py-5 rounded-2xl font-black uppercase tracking-widest text-[11px] flex items-center justify-center gap-3 hover:bg-white hover:text-black transition-all shadow-xl active:scale-95 disabled:opacity-50"
                        >
                          {loading ? <Loader2 className="animate-spin" size={18} /> : <>Get Code <ArrowRight size={16} /></>}
                        </button>
                      </div>
                    </motion.form>
                  )}
  
                  {/* STEP 3: OTP */}
                  {step === 3 && (
                    <motion.form 
                      key="otp" 
                      initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} 
                      className="space-y-8"
                      onSubmit={(e) => { e.preventDefault(); verifyAndFinalize(); }}
                    >
                      <div className="space-y-2">
                        <h2 className="text-3xl font-black italic uppercase text-white tracking-tighter">Identity <span className="text-brandRed">Check.</span></h2>
                        <p className="text-zinc-400 text-[11px] font-bold uppercase tracking-widest">Enter the 6-digit code</p>
                      </div>
  
                      <div className="space-y-4">
                        <div className="relative group">
                          <Smartphone className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-brandRed transition-colors" size={18} />
                          <input 
                            type="text" placeholder="------" maxLength={6}
                            className="w-full bg-black/50 border border-white/10 p-4 rounded-2xl text-white text-center text-2xl font-black tracking-[0.5em] outline-none focus:border-brandRed transition-all" 
                            value={otp} onChange={e => { setOtp(e.target.value.replace(/\D/g, '')); setErrorMsg(''); }} 
                          />
                        </div>
                        {errorMsg && <p className="text-brandRed text-[10px] font-bold uppercase tracking-widest">{errorMsg}</p>}
                      </div>
  
                      <div className="flex gap-4">
                        <button 
                          type="button" 
                          onClick={() => { setStep(isNewUser ? 2 : 1); setOtp(''); }}
                          className="flex-1 bg-zinc-900 border border-white/10 text-white py-5 rounded-2xl font-black uppercase tracking-widest text-[11px] hover:bg-zinc-800 transition-all"
                        >
                          Back
                        </button>
                        <button 
                          type="submit" 
                          disabled={loading || otp.length !== 6} 
                          className="flex-[2] bg-white text-black py-5 rounded-2xl font-black uppercase tracking-[0.2em] text-[11px] flex items-center justify-center hover:bg-zinc-200 transition-all shadow-xl active:scale-95 disabled:opacity-50"
                        >
                          {loading ? <Loader2 className="animate-spin" size={18} /> : "Verify Code"}
                        </button>
                      </div>
                    </motion.form>
                  )}
  
                </AnimatePresence>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </>
    );
}