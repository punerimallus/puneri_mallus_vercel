"use client";
import { useState } from 'react';
import { useRouter } from 'next/navigation'; // 🔥 NEW: For redirecting
import { motion, AnimatePresence } from 'framer-motion';
import { User, Phone, Mail, MapPin, Users, ShieldCheck, ArrowRight, ArrowLeft, Loader2, Trophy, CheckSquare, CalendarDays } from 'lucide-react';
import { useAlert } from '@/context/AlertContext';
import { onEnter } from '@/lib/ui/enter';

const TEAM_TYPES = ["Locality Team", "Friends Team", "Corporate Team", "Club Team", "Other"];
const PUNE_AREAS = ["Akurdi", "Aundh", "Balewadi", "Baner", "Bavdhan", "Bhosari", "Bibwewadi", "Camp", "Chikhali", "Chinchwad", "Dapodi", "Deccan", "Dhanori", "Erandwane", "Fatima Nagar", "Ghorpadi", "Hadapsar", "Hinjewadi", "Kalyani Nagar", "Karve Nagar", "Kasarwadi","Kalewadi","Katraj", "Khadki", "Kondhwa", "Koregaon Park", "Kothrud", "Lohegaon", "Magarpatta", "Model Colony", "Moshi", "Mundhwa", "NIBM", "Nigdi", "Pashan", "Phugewadi", "Pimpri", "Pimple Gurav", "Pimple Nilakh", "Pimple Saudagar", "Pune City", "Punawale", "Rahatani", "Ravet", "Sadashiv Peth", "Sahakar Nagar", "Sangvi", "Shivajinagar", "Sinhagad Road", "Sus", "Swargate", "Talawade", "Tathawade", "Thergaon", "Undri", "Viman Nagar", "Vishrantwadi", "Wakad", "Wanowrie", "Warje", "Yerwada"].sort();

const stepVariants = {
  hidden: { opacity: 0, x: 20 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.3 } },
  exit: { opacity: 0, x: -20, transition: { duration: 0.2 } }
};

export default function FootballRegistration() {
  const router = useRouter(); // 🔥 NEW: Router instance
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [checkingEmail, setCheckingEmail] = useState(false);
  const { showAlert } = useAlert();

  const [form, setForm] = useState({
    repName: '', contact: '', altContact: '', email: '',
    ageCategory: '', 
    locality: '', teamType: '', customTeamType: '',
    teamName: '', capName: '', capContact: ''
  });

  const [declarations, setDeclarations] = useState([false, false, false]);

  const isStep1Valid = form.repName && form.contact.length === 10 && form.email.includes('@') && form.ageCategory !== '';
  const isStep2Valid = form.locality && (form.teamType === 'Other' ? form.customTeamType.trim() !== '' : form.teamType !== '');
  const isStep3Valid = form.teamName && form.capName && form.capContact.length === 10;
  const isStep4Valid = declarations.every(Boolean); 

  const handleStep1Next = async () => {
    setCheckingEmail(true);
    try {
      const res = await fetch('/api/football/check-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email })
      });
      
      const data = await res.json();

      if (data.exists) {
        showAlert("This email is already registered with a team.", "error");
      } else {
        setStep(2); 
      }
    } catch (err) {
      showAlert("Network error while verifying email. Please try again.", "error");
    } finally {
      setCheckingEmail(false);
    }
  };

  // 🔥 NEW: Replaced Razorpay with direct database submission and redirect
  const submitRegistration = async () => {
    setLoading(true);
    try {
      // 1. Prepare data mapping to match your Supabase columns exactly
      const finalData = {
        rep_name: form.repName,
        contact: `+91${form.contact}`,
        alt_contact: form.altContact ? `+91${form.altContact}` : null,
        email: form.email,
        age_category: form.ageCategory,
        locality: form.locality,
        team_type: form.teamType === 'Other' ? form.customTeamType : form.teamType,
        team_name: form.teamName.toUpperCase(),
        captain_name: form.capName,
        captain_contact: `+91${form.capContact}`
      };

      // 2. Send data to backend API
      const response = await fetch('/api/football/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(finalData)
      });

      if (!response.ok) {
        throw new Error("Failed to save registration data.");
      }

      // 3. Show success and Redirect to closed page
      showAlert("Details submitted successfully!", "success");
      router.push('/football/closed');

    } catch (err: any) {
      showAlert(err.message || "Failed to submit. Please try again.", "error");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#030303] flex items-center justify-center p-6 relative overflow-hidden text-white selection:bg-brandRed/30 pt-32">
      <div className="absolute inset-0 z-0 bg-[url('/events/footback.png')] bg-cover bg-center opacity-50" />
      <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black z-0" />
      <div className="w-full max-w-xl relative z-10">
        <div className="text-center mb-10">
          <Trophy size={40} className="text-brandRed mx-auto mb-4" />
          <h1 className="text-4xl md:text-5xl font-black italic uppercase tracking-tighter leading-none">
            Tournament <span className="text-brandRed">Entry</span>
          </h1>
          <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-[0.3em] mt-2">Post Registration Request</p>
        </div>

        <div className="bg-zinc-950/80 backdrop-blur-2xl border border-white/10 rounded-[40px] p-8 md:p-10 shadow-2xl relative overflow-hidden">
          
          <div className="flex gap-2 mb-8">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className={`h-1.5 flex-1 rounded-full transition-colors duration-500 ${step >= i ? 'bg-brandRed' : 'bg-white/10'}`} />
            ))}
          </div>

          <AnimatePresence mode="wait">
            
            {step === 1 && (
              <motion.div key="step1" variants={stepVariants} initial="hidden" animate="visible" exit="exit" className="space-y-6" onKeyDown={onEnter(handleStep1Next, !!isStep1Valid && !checkingEmail)}>
                <h3 className="text-xl font-black uppercase italic text-white border-b border-white/5 pb-4">Representative Details</h3>
                
                <div className="space-y-4">
                  <div className="relative">
                    <User className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={16} />
                    <input type="text" placeholder="Team Representative Full Name *" required value={form.repName} onChange={e => setForm({...form, repName: e.target.value})} className="w-full bg-black/50 border border-white/10 p-4 pl-12 rounded-2xl text-sm outline-none focus:border-brandRed text-white" />
                  </div>
                  <div className="relative">
                    <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={16} />
                    <input type="tel" placeholder="Contact Number *" maxLength={10} required value={form.contact} onChange={e => setForm({...form, contact: e.target.value.replace(/\D/g, '')})} className="w-full bg-black/50 border border-white/10 p-4 pl-12 rounded-2xl text-sm outline-none focus:border-brandRed text-white" />
                  </div>
                  <div className="relative">
                    <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={16} />
                    <input type="tel" placeholder="Alt Contact (Optional)" maxLength={10} value={form.altContact} onChange={e => setForm({...form, altContact: e.target.value.replace(/\D/g, '')})} className="w-full bg-black/50 border border-white/10 p-4 pl-12 rounded-2xl text-sm outline-none focus:border-brandRed text-white" />
                  </div>
                  <div className="relative">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={16} />
                    <input type="email" placeholder="Email Address (For Receipts) *" required value={form.email} onChange={e => setForm({...form, email: e.target.value})} className="w-full bg-black/50 border border-white/10 p-4 pl-12 rounded-2xl text-sm outline-none focus:border-brandRed text-white" suppressHydrationWarning />
                  </div>
                  
                  <div className="relative">
                    <CalendarDays className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={16} />
                    <select required value={form.ageCategory} onChange={e => setForm({...form, ageCategory: e.target.value})} className="w-full bg-black/50 border border-white/10 p-4 pl-12 rounded-2xl text-sm outline-none focus:border-brandRed text-white appearance-none cursor-pointer">
                      <option value="" disabled>Select Age Category *</option>
                      <option value="Above 35" className="bg-zinc-900">Senior (Above 35): Born on or before 31-Dec-1991</option>
                      <option value="Below 35" className="bg-zinc-900">Junior (Below 35): Born on or after  1-Jan-1992</option>
                    </select>
                  </div>
                </div>

                <button 
                  disabled={!isStep1Valid || checkingEmail} 
                  onClick={handleStep1Next} 
                  className="w-full py-5 bg-white text-black font-black uppercase tracking-widest rounded-2xl hover:bg-brandRed hover:text-white transition-all disabled:opacity-50 flex items-center justify-center gap-2 text-xs"
                >
                  {checkingEmail ? (
                    <><Loader2 className="animate-spin" size={16} /> Verifying...</>
                  ) : (
                    <>Continue <ArrowRight size={16} /></>
                  )}
                </button>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div key="step2" variants={stepVariants} initial="hidden" animate="visible" exit="exit" className="space-y-6" onKeyDown={onEnter(() => setStep(3), !!isStep2Valid)}>
                <div className="flex items-center gap-4 border-b border-white/5 pb-4">
                  <button onClick={() => setStep(1)} className="text-zinc-500 hover:text-white"><ArrowLeft size={18} /></button>
                  <h3 className="text-xl font-black uppercase italic text-white">Origin & Type</h3>
                </div>
                
                <div className="space-y-4">
                  <div className="relative">
                    <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={16} />
                    <select required value={form.locality} onChange={e => setForm({...form, locality: e.target.value})} className="w-full bg-black/50 border border-white/10 p-4 pl-12 rounded-2xl text-sm outline-none focus:border-brandRed text-white appearance-none cursor-pointer">
                      <option value="" disabled>Select Area (Pune) *</option>
                      {PUNE_AREAS.map(area => <option key={area} value={area} className="bg-zinc-900">{area}</option>)}
                    </select>
                  </div>
                  
                  <div className="relative">
                    <Users className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={16} />
                    <select required value={form.teamType} onChange={e => setForm({...form, teamType: e.target.value})} className="w-full bg-black/50 border border-white/10 p-4 pl-12 rounded-2xl text-sm outline-none focus:border-brandRed text-white appearance-none cursor-pointer">
                      <option value="" disabled>Select Team Type *</option>
                      {TEAM_TYPES.map(type => <option key={type} value={type} className="bg-zinc-900">{type}</option>)}
                    </select>
                  </div>

                  <AnimatePresence>
                    {form.teamType === 'Other' && (
                      <motion.div
                        initial={{ opacity: 0, height: 0, marginTop: 0 }}
                        animate={{ opacity: 1, height: 'auto', marginTop: 16 }}
                        exit={{ opacity: 0, height: 0, marginTop: 0 }}
                        className="relative overflow-hidden"
                      >
                        <Users className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={16} />
                        <input 
                          type="text" 
                          placeholder="Please specify Team Type *" 
                          required 
                          value={form.customTeamType} 
                          onChange={e => setForm({...form, customTeamType: e.target.value})} 
                          className="w-full bg-black/50 border border-white/10 p-4 pl-12 rounded-2xl text-sm outline-none focus:border-brandRed text-white" 
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <button disabled={!isStep2Valid} onClick={() => setStep(3)} className="w-full py-5 bg-white text-black font-black uppercase tracking-widest rounded-2xl hover:bg-brandRed hover:text-white transition-all disabled:opacity-50 flex items-center justify-center gap-2 text-xs">
                  Continue <ArrowRight size={16} />
                </button>
              </motion.div>
            )}

            {step === 3 && (
              <motion.div key="step3" variants={stepVariants} initial="hidden" animate="visible" exit="exit" className="space-y-6" onKeyDown={onEnter(() => setStep(4), !!isStep3Valid)}>
                <div className="flex items-center gap-4 border-b border-white/5 pb-4">
                  <button onClick={() => setStep(2)} className="text-zinc-500 hover:text-white"><ArrowLeft size={18} /></button>
                  <h3 className="text-xl font-black uppercase italic text-white">Squad Details</h3>
                </div>
                
                <div className="space-y-4">
                  <div className="relative">
                    <ShieldCheck className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={16} />
                    <input type="text" placeholder="Team / Organization Name *" required value={form.teamName} onChange={e => setForm({...form, teamName: e.target.value})} className="w-full bg-black/50 border border-white/10 p-4 pl-12 rounded-2xl text-sm outline-none focus:border-brandRed text-white uppercase font-black tracking-widest" />
                  </div>
                  <div className="relative">
                    <User className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={16} />
                    <input type="text" placeholder="Captain Name *" required value={form.capName} onChange={e => setForm({...form, capName: e.target.value})} className="w-full bg-black/50 border border-white/10 p-4 pl-12 rounded-2xl text-sm outline-none focus:border-brandRed text-white" />
                  </div>
                  <div className="relative">
                    <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={16} />
                    <input type="tel" placeholder="Captain Contact Number *" maxLength={10} required value={form.capContact} onChange={e => setForm({...form, capContact: e.target.value.replace(/\D/g, '')})} className="w-full bg-black/50 border border-white/10 p-4 pl-12 rounded-2xl text-sm outline-none focus:border-brandRed text-white" />
                  </div>
                </div>

                <button disabled={!isStep3Valid} onClick={() => setStep(4)} className="w-full py-5 bg-white text-black font-black uppercase tracking-widest rounded-2xl hover:bg-brandRed hover:text-white transition-all disabled:opacity-50 flex items-center justify-center gap-2 text-xs">
                  Review & Declare <ArrowRight size={16} />
                </button>
              </motion.div>
            )}

            {step === 4 && (
              <motion.div key="step4" variants={stepVariants} initial="hidden" animate="visible" exit="exit" className="space-y-6">
                <div className="flex items-center gap-4 border-b border-white/5 pb-4">
                  <button onClick={() => setStep(3)} className="text-zinc-500 hover:text-white"><ArrowLeft size={18} /></button>
                  <h3 className="text-xl font-black uppercase italic text-white">Declaration *</h3>
                </div>
                
                <div className="space-y-4 bg-white/[0.02] p-6 rounded-3xl border border-white/5">
                  <div className="mb-4">
                    <a 
                      href="https://bhfrgcphqmbocplfcvbg.supabase.co/storage/v1/object/public/assets/MPL%202026%20General%20Info%20&%20Rules%20(1).pdf" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-[10px] font-black uppercase tracking-widest text-brandRed hover:text-white underline transition-colors"
                    >
                      View Tournament Rules & Regulations (PDF)
                    </a>
                  </div>

                  {[
                    "I confirm that all information provided is accurate.",
                    "I agree to follow the tournament rules and decisions of the organizers.",
                    "I understand that registration does not guarantee participation until confirmed by the organizers."
                  ].map((text, idx) => (
                    <label key={idx} className="flex items-start gap-4 cursor-pointer group">
                      <div className="mt-0.5 shrink-0">
                        <input 
                          type="checkbox" 
                          className="hidden" 
                          checked={declarations[idx]} 
                          onChange={(e) => {
                            const newDecs = [...declarations];
                            newDecs[idx] = e.target.checked;
                            setDeclarations(newDecs);
                          }}
                        />
                        <div className={`w-5 h-5 rounded-md flex items-center justify-center border transition-all ${declarations[idx] ? 'bg-brandRed border-brandRed' : 'border-zinc-600 group-hover:border-zinc-400'}`}>
                          {declarations[idx] && <CheckSquare size={14} className="text-white" />}
                        </div>
                      </div>
                      <span className="text-xs text-zinc-300 leading-relaxed font-medium">{text}</span>
                    </label>
                  ))}
                </div>

                {/* 🔥 UPDATED: Triggers database insertion and redirects to closed page */}
                <button 
                  disabled={!isStep4Valid || loading} 
                  onClick={submitRegistration} 
                  className="w-full py-5 bg-brandRed text-white font-black uppercase tracking-[0.3em] rounded-2xl hover:bg-white hover:text-black transition-all disabled:opacity-50 flex items-center justify-center gap-2 text-xs shadow-[0_0_30px_rgba(255,0,0,0.3)] active:scale-95"
                >
                  {loading ? <Loader2 className="animate-spin" size={16} /> : <>Submit Registration <CheckSquare size={16} /></>}
                </button>
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}