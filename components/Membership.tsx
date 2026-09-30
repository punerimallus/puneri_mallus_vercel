"use client";
import { useState, useRef, useMemo, useEffect } from 'react';
import { Crown, CheckCircle2, ArrowRight, ArrowLeft, ShieldCheck, Loader2, Mail, MapPin, Calendar as CalendarIcon, Briefcase, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAlert } from '@/context/AlertContext';
import { createBrowserClient } from '@supabase/ssr';
import TribeCalendar from '@/components/ui/TribeCalendar';
import { useRouter } from 'next/navigation'; // 🔥 NEW: Added router for success redirection
import { waitForOrder, orderRef } from '@/lib/payments/client';

interface MembershipCardProps {
  price: number;
  benefits: string[];
  userId: string;
  userEmail?: string;
}

const PUNE_AREAS = ["Akurdi", "Aundh", "Balewadi", "Baner", "Bavdhan", "Bhosari", "Bibwewadi", "Camp", "Chikhali", "Chinchwad", "Dapodi", "Deccan", "Dhanori", "Erandwane", "Fatima Nagar", "Ghorpadi", "Hadapsar", "Hinjewadi", "Kalyani Nagar", "Karve Nagar", "Kasarwadi","Kalewadi","Katraj", "Khadki", "Kondhwa", "Koregaon Park", "Kothrud", "Lohegaon", "Magarpatta", "Model Colony", "Moshi", "Mundhwa", "NIBM", "Nigdi", "Pashan", "Phugewadi", "Pimpri", "Pimple Gurav", "Pimple Nilakh", "Pimple Saudagar", "Pune City", "Punawale", "Rahatani", "Ravet", "Sadashiv Peth", "Sahakar Nagar", "Sangvi", "Shivajinagar", "Sinhagad Road", "Sus", "Swargate", "Talawade", "Tathawade", "Thergaon", "Undri", "Viman Nagar", "Vishrantwadi", "Wakad", "Wanowrie", "Warje", "Yerwada"].sort();

// Snappy animation variants to prevent mobile horizontal scrollbar bugs
const stepVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: { 
    opacity: 1, 
    y: 0, 
    transition: { duration: 0.3, ease: "easeOut" as const } 
  },
  exit: { 
    opacity: 0, 
    y: -10, 
    transition: { duration: 0.2, ease: "easeIn" as const } 
  }
};

export default function MembershipCard({ price, benefits, userId, userEmail }: MembershipCardProps) {
  const [upgrading, setUpgrading] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1); 
  const { showAlert } = useAlert();
  const router = useRouter(); // 🔥 NEW: Initialize router
  
  const initialEmail = userEmail?.includes('@punerimallus.com') ? '' : (userEmail || '');

  const [email, setEmail] = useState(initialEmail);
  const [dob, setDob] = useState('');
  const [location, setLocation] = useState('');
  const [profession, setProfession] = useState('');
  
  const [showCalendar, setShowCalendar] = useState(false);
  const dateContainerRef = useRef<HTMLDivElement>(null);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const maxDobDate = useMemo(() => {
    const date = new Date();
    date.setFullYear(date.getFullYear() - 16);
    return date.toISOString().split("T")[0];
  }, []);

  const isFormValid = useMemo(() => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email) && dob && location && profession;
  }, [email, dob, location, profession]);

  const displayBenefits = benefits.length > 0 ? benefits : [
    "Lifetime Inner Circle Access",
    "VIP Access to Offline Events",
    "Priority Directory Listings",
    "Exclusive Community Offers",
    "Verified Member Badge"
  ];

  // CROSS-DEVICE SYNC HOOK
  useEffect(() => {
    let interval: NodeJS.Timeout;
    
    if (step === 3) { 
      interval = setInterval(async () => {
        const { data: { user } } = await supabase.auth.getUser();
        
        if (user && user.email === email.trim().toLowerCase()) {
          clearInterval(interval);
          setStep(4); 
          showAlert("Identity Verified! Initiating secure payment gateway...", "success");
          setTimeout(() => { triggerRazorpay(); }, 1000);
        }
      }, 3000);
    }
    
    return () => clearInterval(interval);
  }, [step, email, supabase]);

  const handleDataSaveAndProceed = async () => {
    if (!userId) {
      showAlert("Identity Required. Please login.", "error");
      return;
    }
    
    setUpgrading(true);
    try {
      const cleanEmail = email.trim().toLowerCase();

      const { error: authError } = await supabase.auth.updateUser({ email: cleanEmail });
      if (authError) throw new Error(authError.message);

      const { error: profileError } = await supabase.from('profiles').update({ 
        email: cleanEmail,
        dob: dob,
        location: location,
        profession: profession.toUpperCase()
      }).eq('id', userId);
      if (profileError) throw profileError;

      const { error: membershipError } = await supabase.from('memberships').upsert({
        user_id: userId,
        email: cleanEmail,
        dob: dob,
        location: location,
        profession: profession.toUpperCase(),
        status: 'PENDING'
      }, { onConflict: 'user_id' }); 

      if (membershipError) throw membershipError;
      
      setStep(3); // Proceed to waiting room

    } catch (err: any) {
      showAlert(err.message || "Failed to save details.", "error");
      setUpgrading(false);
    }
  };

  // Called after the Razorpay handler fails or the modal closes without one. The
  // server checks Razorpay itself, so a paid order is activated either way.
  const settleOrder = async (orderId: string, { fromDismiss = false } = {}) => {
    if (!fromDismiss) showAlert("Payment received. Activating your membership...", "success");
    const result = await waitForOrder(orderId, { stopIfUnpaid: fromDismiss, timeoutMs: fromDismiss ? 12_000 : 45_000 });
    if (result.status === 'FULFILLED') {
      showAlert("Welcome to the Inner Circle!", "success");
      window.location.href = '/membership/success';
      return;
    }
    setUpgrading(false);
    if (result.status === 'NEEDS_ATTENTION') {
      showAlert(`We received your payment but could not activate it automatically. Our team has been alerted. Ref: ${orderRef(orderId)}`, "error");
    } else if (result.status === 'CREATED' || result.status === 'FAILED') {
      if (!fromDismiss) showAlert(`Payment not confirmed. If money was debited it will be auto-refunded or activated shortly. Ref: ${orderRef(orderId)}`, "error");
    } else if (!fromDismiss || result.status !== 'UNKNOWN') {
      showAlert(`Payment received. Your membership will activate shortly and a receipt will be emailed. Ref: ${orderRef(orderId)}`, "success");
    }
  };

  const triggerRazorpay = async () => {
    setUpgrading(true);
    try {
      const orderRes = await fetch('/api/razorpay/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentType: 'LIFETIME', email })
      });

      const orderData = await orderRes.json();
      if (!orderRes.ok) throw new Error(orderData.error);

      let handled = false;
      const options = {
        key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
        amount: orderData.amount,
        currency: "INR",
        name: "PUNERI MALLUS",
        description: "Lifetime Inner Circle Access",
        order_id: orderData.id,
        method: { netbanking: true, card: true, upi: true, wallet: true, emi: false, paylater: false },
        config: { display: { sequence: ['block.banks', 'block.cards'], preferences: { show_default_blocks: true } } },
        handler: async function (response: any) {
          handled = true;
          setUpgrading(true);
          try {
            const verifyRes = await fetch('/api/razorpay/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              })
            });

            const verifyData = await verifyRes.json();
            if (verifyData.success) {
              showAlert("Welcome to the Inner Circle!", "success");
              // 🔥 NEW: Route directly to the elegant success page
              window.location.href = '/membership/success';
              return;
            }
          } catch {
            // Fall through to polling: the payment may well have gone through.
          }
          await settleOrder(orderData.id);
        },
        prefill: { email: email },
        theme: { color: "#FF0000" },
        modal: {
          ondismiss: () => {
            setUpgrading(false);
            if (!handled) settleOrder(orderData.id, { fromDismiss: true });
          }
        }
      };

      const rzp = new (window as any).Razorpay(options);
      rzp.on('payment.failed', (resp: any) => {
        showAlert(resp?.error?.description || "Payment failed. You can retry.", "error");
      });
      rzp.open();
    } catch (err: any) {
      showAlert(err.message || "Checkout failed", "error");
      setUpgrading(false);
    }
  };

  return (
    <motion.div 
      layout 
      initial={{ opacity: 0, scale: 0.95 }}
      whileInView={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="w-full max-w-lg mx-auto bg-zinc-950/95 backdrop-blur-xl border border-white/10 rounded-[32px] md:rounded-[40px] p-6 md:p-10 relative overflow-visible group shadow-2xl"
      style={{ transform: 'translateZ(0)', willChange: 'transform, height' }}
    >
      <div className="absolute -top-24 -right-24 w-80 h-80 bg-brandRed/10 blur-[80px] md:blur-[120px] rounded-full group-hover:bg-brandRed/20 transition-all duration-700 pointer-events-none" />
      
      <div className="relative z-10">
        
        {/* HEADER: ALWAYS VISIBLE */}
        <div className="flex items-start justify-between gap-4 mb-8 border-b border-white/5 pb-8">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 md:w-14 md:h-14 bg-brandRed rounded-2xl flex items-center justify-center shadow-[0_0_30px_rgba(255,0,0,0.3)] shrink-0">
              <Crown className="text-white" size={24} />
            </div>
            <div>
              <h3 className="text-xl md:text-2xl font-black uppercase italic tracking-tighter text-white">Lifetime</h3>
              <p className="text-[9px] md:text-[10px] font-bold uppercase tracking-widest text-brandRed">Official Tribe Member</p>
            </div>
          </div>
          <div className="bg-black/40 px-4 py-2 rounded-2xl border border-white/5 text-right shrink-0">
            <p className="text-[8px] md:text-[9px] font-bold uppercase tracking-widest text-zinc-500 mb-0.5">One-Time</p>
            <h4 className="text-xl md:text-2xl font-black italic text-white uppercase tracking-tighter">
              ₹{price}<span className="text-brandRed text-xs not-italic">.00</span>
            </h4>
          </div>
        </div>

        <AnimatePresence mode="wait">
          
          {/* STEP 1: BENEFITS OVERVIEW */}
          {step === 1 && (
            <motion.div 
              key="step1" 
              variants={stepVariants} 
              initial="hidden" animate="visible" exit="exit" 
              className="space-y-8"
            >
              <div className="space-y-2 text-center md:text-left">
                <h4 className="text-xl font-black uppercase tracking-tight text-white italic">Unlock Your Tribe</h4>
                <p className="text-xs text-zinc-400 font-medium">Join the inner circle and get lifetime access to premium features.</p>
              </div>
              
              <div className="space-y-4 bg-zinc-900/30 p-6 rounded-3xl border border-white/5">
                {displayBenefits.map((benefit, i) => (
                  <div key={i} className="flex items-start gap-4 group/item">
                    <div className="mt-0.5 shrink-0 bg-brandRed/20 p-1.5 rounded-full">
                      <Zap size={14} className="text-brandRed" />
                    </div>
                    <p className="text-[13px] font-bold uppercase tracking-tight text-zinc-300 leading-relaxed">
                      {benefit}
                    </p>
                  </div>
                ))}
              </div>

              <button 
                onClick={() => setStep(2)}
                className="w-full py-5 bg-white text-black font-black uppercase tracking-widest rounded-2xl hover:bg-brandRed hover:text-white transition-all shadow-xl active:scale-95 flex items-center justify-center gap-3 text-xs"
              >
                Proceed to Registration <ArrowRight size={16} />
              </button>
            </motion.div>
          )}

          {/* STEP 2: DATA COLLECTION FORM */}
          {step === 2 && (
            <motion.div 
              key="step2" 
              variants={stepVariants} 
              initial="hidden" animate="visible" exit="exit" 
              className="space-y-6"
            >
              <div className="flex items-center gap-4 border-b border-white/5 pb-6">
                <button onClick={() => setStep(1)} className="p-2.5 bg-zinc-900 rounded-xl hover:bg-brandRed text-zinc-400 hover:text-white transition-all active:scale-90">
                  <ArrowLeft size={18} />
                </button>
                <div>
                  <h4 className="text-lg font-black uppercase tracking-tight text-white italic">Identity Details</h4>
                  <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Required to activate membership</p>
                </div>
              </div>

              <div className="space-y-4">
                {/* 1. EMAIL */}
                <div className="relative group">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-brandRed transition-colors" size={16} />
                  <input type="email" placeholder="Email Address" required className="w-full bg-black/50 border border-white/10 p-4 pl-12 rounded-2xl font-medium text-base md:text-[13px] focus:border-brandRed outline-none text-white placeholder:text-zinc-500 transition-colors" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>

                {/* 2. BIRTH DATE */}
                <div className="relative" ref={dateContainerRef}>
                  <div className="bg-black/50 border border-white/10 p-4 rounded-2xl flex items-center gap-3 cursor-pointer hover:border-white/30 transition-colors h-full" onClick={() => setShowCalendar(!showCalendar)}>
                    <CalendarIcon size={16} className={dob ? "text-brandRed" : "text-zinc-500"} />
                    <span className={`font-medium text-base md:text-[13px] truncate ${dob ? "text-white" : "text-zinc-500"}`}>{dob ? new Date(dob).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : "Birth Date"}</span>
                  </div>
                  <AnimatePresence>
                    {showCalendar && (
                      <TribeCalendar value={dob} onChange={(date) => { setDob(date); setShowCalendar(false); }} onClose={() => setShowCalendar(false)} maxDate={maxDobDate} defaultDate={maxDobDate} anchorRef={dateContainerRef} />
                    )}
                  </AnimatePresence>
                </div>

                {/* 3. PROFESSION */}
                <div className="relative group">
                  <Briefcase className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-brandRed transition-colors" size={16} />
                  <input type="text" placeholder="Profession" required className="w-full bg-black/50 border border-white/10 p-4 pl-12 rounded-2xl font-medium text-base md:text-[13px] focus:border-brandRed outline-none text-white placeholder:text-zinc-500 transition-colors uppercase" value={profession} onChange={(e) => setProfession(e.target.value)} />
                </div>

                {/* 4. LOCATION */}
                <div className="relative group">
                  <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-brandRed transition-colors" size={16} />
                  <select required className="w-full bg-black/60 border border-white/10 p-4 pl-12 rounded-2xl font-medium text-base md:text-[13px] focus:border-brandRed outline-none text-white appearance-none cursor-pointer transition-colors" value={location} onChange={(e) => setLocation(e.target.value)}>
                    <option value="" disabled>Select Area (Pune)</option>
                    {PUNE_AREAS.map(area => <option key={area} value={area} className="bg-zinc-900">{area}</option>)}
                  </select>
                </div>
              </div>

              <button 
                disabled={!isFormValid || upgrading}
                onClick={handleDataSaveAndProceed}
                className="w-full py-5 bg-white text-black font-black uppercase tracking-widest rounded-2xl hover:bg-brandRed hover:text-white transition-all shadow-xl active:scale-95 flex items-center justify-center gap-3 text-xs disabled:opacity-50 mt-2"
              >
                {upgrading ? <Loader2 className="animate-spin" size={16} /> : <>Save & Proceed <ArrowRight size={16} /></>}
              </button>
            </motion.div>
          )}

          {/* STEP 3: CROSS-DEVICE SYNC WAITING ROOM */}
          {step === 3 && (
            <motion.div 
              key="step3" 
              variants={stepVariants} 
              initial="hidden" animate="visible" exit="exit" 
              className="py-8 text-center space-y-6"
            >
              <div className="relative w-24 h-24 mx-auto">
                <div className="absolute inset-0 bg-brandRed/20 rounded-full animate-ping" />
                <div className="relative w-full h-full bg-zinc-900 border border-brandRed/50 rounded-full flex items-center justify-center">
                  <Mail size={32} className="text-brandRed" />
                </div>
              </div>
              <div>
                <h4 className="text-2xl font-black uppercase tracking-tight text-white italic mb-2">Check Your Inbox</h4>
                <p className="text-sm text-zinc-400 font-medium leading-relaxed">
                  We sent a secure link to <strong className="text-white">{email}</strong>.<br/>
                  Open it on your phone or desktop to continue.
                </p>
              </div>
              <div className="flex items-center justify-center gap-3 text-[10px] font-black uppercase tracking-widest text-zinc-500 animate-pulse pt-4">
                <Loader2 size={14} className="animate-spin" /> Waiting for Verification...
              </div>
            </motion.div>
          )}

          {/* STEP 4: PAYMENT OVERVIEW */}
          {step === 4 && (
            <motion.div 
              key="step4" 
              variants={stepVariants} 
              initial="hidden" animate="visible" exit="exit" 
              className="space-y-8 py-4"
            >
              <div className="text-center space-y-2">
                <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-4 shadow-[0_0_20px_rgba(34,197,94,0.2)]">
                  <CheckCircle2 size={32} className="text-green-500" />
                </div>
                <h4 className="text-xl font-black uppercase tracking-tight text-white italic">Identity Verified</h4>
                <p className="text-xs text-zinc-400 font-medium">Complete your payment below to unlock the vault.</p>
              </div>

              <div className="pt-4 space-y-4">
                <button 
                  disabled={upgrading}
                  onClick={triggerRazorpay}
                  className="w-full py-5 bg-white text-black font-black uppercase tracking-[0.3em] rounded-2xl hover:bg-brandRed hover:text-white transition-all shadow-xl active:scale-95 flex items-center justify-center gap-3 text-xs disabled:opacity-50"
                >
                  {upgrading ? <Loader2 className="animate-spin" size={16} /> : <>Pay Securely <ArrowRight size={16} /></>}
                </button>
                
                <div className="flex items-center justify-center gap-2 opacity-40">
                  <ShieldCheck size={14} className="text-zinc-500" />
                  <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Razorpay Verified Gateway</span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </motion.div>
  );
}