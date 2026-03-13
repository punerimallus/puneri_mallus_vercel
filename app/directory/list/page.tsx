"use client";
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { createBrowserClient } from '@supabase/ssr';
import { Upload, CheckCircle, ArrowRight, Loader2, ShieldCheck } from 'lucide-react';

export default function ListProfession() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    category: '',
    area: '',
    description: '',
    contact: '',
  });

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      let imagePath = '';
      
      // 1. Upload to Supabase (mallu-mart bucket)
      if (file) {
        const fileExt = file.name.split('.').pop();
        const fileName = `${Math.random()}.${fileExt}`;
        const { data, error } = await supabase.storage
          .from('mallu-mart')
          .upload(fileName, file);
        
        if (error) throw error;
        imagePath = data.path;
      }

      // 2. Save to MongoDB (punerimallus database)
      const res = await fetch('/api/mart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          imagePath,
          // userEmail: session.user.email (Get this from your auth)
        }),
      });

      if (res.ok) setStep(3);
    } catch (err) {
      console.error("Submission failed", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#030303] text-white pt-32 pb-20 px-6">
      <div className="max-w-3xl mx-auto">
        
        {/* PROGRESS INDICATOR */}
        <div className="flex gap-2 mb-12">
          {[1, 2, 3].map((s) => (
            <div key={s} className={`h-1 flex-1 rounded-full transition-all duration-500 ${step >= s ? 'bg-brandRed shadow-[0_0_10px_#FF0000]' : 'bg-zinc-800'}`} />
          ))}
        </div>

        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <h1 className="text-5xl font-black italic uppercase tracking-tighter mb-4">Tell the <span className="text-brandRed">Tribe</span> Who You Are</h1>
              <p className="text-zinc-500 font-bold uppercase tracking-widest text-xs mb-10">Basic Details // Step 01</p>
              
              <div className="space-y-6">
                <div className="group">
                  <label className="text-[10px] font-black uppercase text-zinc-500 tracking-widest ml-2 mb-2 block">Business / Professional Name</label>
                  <input 
                    className="w-full bg-zinc-900/50 border border-white/10 rounded-2xl p-5 outline-none focus:border-brandRed transition-all font-bold italic"
                    placeholder="E.g. Nair Dental Clinic"
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                  />
                </div>
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <label className="text-[10px] font-black uppercase text-zinc-500 tracking-widest ml-2 mb-2 block">Category</label>
                    <input 
                      className="w-full bg-zinc-900/50 border border-white/10 rounded-2xl p-5 outline-none focus:border-brandRed transition-all font-bold uppercase italic text-xs"
                      placeholder="HEALTH, FOOD, TECH..."
                      onChange={(e) => setFormData({...formData, category: e.target.value})}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase text-zinc-500 tracking-widest ml-2 mb-2 block">Area in Pune</label>
                    <input 
                      className="w-full bg-zinc-900/50 border border-white/10 rounded-2xl p-5 outline-none focus:border-brandRed transition-all font-bold italic"
                      placeholder="E.g. Baner"
                      onChange={(e) => setFormData({...formData, area: e.target.value})}
                    />
                  </div>
                </div>
                <button 
                  onClick={() => setStep(2)}
                  className="w-full py-6 bg-white text-black rounded-3xl font-black uppercase tracking-[0.3em] text-xs hover:bg-brandRed hover:text-white transition-all flex items-center justify-center gap-3"
                >
                  Next Step <ArrowRight size={16} />
                </button>
              </div>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <h1 className="text-5xl font-black italic uppercase tracking-tighter mb-4">The <span className="text-brandRed">Visual</span> Proof</h1>
              <p className="text-zinc-500 font-bold uppercase tracking-widest text-xs mb-10">Verification & Media // Step 02</p>

              <div className="space-y-8">
                {/* UPLOAD BOX */}
                <div className="relative group">
                  <input 
                    type="file" 
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" 
                  />
                  <div className="border-2 border-dashed border-white/10 rounded-[40px] p-20 flex flex-col items-center justify-center group-hover:border-brandRed/50 transition-all bg-zinc-950/50">
                    <Upload className="text-brandRed mb-4 group-hover:scale-110 transition-transform" size={40} />
                    <p className="text-[10px] font-black uppercase tracking-[0.2em]">{file ? file.name : 'Upload Brand Logo / Photo'}</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <textarea 
                    className="w-full bg-zinc-900/50 border border-white/10 rounded-3xl p-6 outline-none focus:border-brandRed transition-all font-medium italic min-h-[120px]"
                    placeholder="Tell the Tribe about your expertise..."
                    onChange={(e) => setFormData({...formData, description: e.target.value})}
                  />
                  <input 
                    className="w-full bg-zinc-900/50 border border-white/10 rounded-2xl p-5 outline-none focus:border-brandRed transition-all font-bold italic"
                    placeholder="WhatsApp Number (With Country Code)"
                    onChange={(e) => setFormData({...formData, contact: e.target.value})}
                  />
                </div>

                <button 
                  onClick={handleSubmit}
                  disabled={loading}
                  className="w-full py-6 bg-brandRed text-white rounded-3xl font-black uppercase tracking-[0.3em] text-xs shadow-[0_0_30px_rgba(255,0,0,0.3)] flex items-center justify-center gap-3 disabled:opacity-50"
                >
                  {loading ? <Loader2 className="animate-spin" /> : <>Finish Listing <ShieldCheck size={18} /></>}
                </button>
              </div>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div key="step3" initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-center py-20">
              <CheckCircle size={80} className="text-green-500 mx-auto mb-8 shadow-[0_0_40px_rgba(34,197,94,0.3)] rounded-full" />
              <h1 className="text-5xl font-black italic uppercase tracking-tighter mb-4">Welcome to the <span className="text-brandRed">Mart</span></h1>
              <p className="text-zinc-500 font-bold uppercase tracking-widest text-xs mb-10 max-w-sm mx-auto">Your profession is now visible to thousands of Tribe members.</p>
              <button 
                onClick={() => router.push('/directory')}
                className="px-12 py-5 bg-white text-black rounded-full font-black uppercase tracking-widest text-[10px] hover:bg-brandRed hover:text-white transition-all"
              >
                Go to Mart
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}