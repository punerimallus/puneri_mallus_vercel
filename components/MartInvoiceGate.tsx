"use client";
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, Receipt, ArrowRight, Loader2, X } from 'lucide-react';
import { createBrowserClient } from '@supabase/ssr';
import { onEnter } from '@/lib/ui/enter';

interface MartInvoiceGateProps {
  userId: string;
  userPhone: string;
  onSuccess: (email: string) => void;
  onCancel: () => void;
}

export default function MartInvoiceGate({ userId, userPhone, onSuccess, onCancel }: MartInvoiceGateProps) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const handleSave = async () => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return setError("Please enter a valid email address.");
    }

    setLoading(true);
    setError('');

    try {
      // Save to our dedicated invoice table
      const { error: dbError } = await supabase.from('mallu_invoice').upsert({
        user_id: userId,
        phone_number: userPhone,
        invoice_email: email.toLowerCase().trim()
      }, { onConflict: 'user_id' });

      if (dbError) throw dbError;

      // Pass the email back to the parent component to trigger Razorpay
      onSuccess(email.toLowerCase().trim());
    } catch (err: any) {
      setError(err.message || "Failed to save invoice email.");
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/80 backdrop-blur-sm"
          onClick={onCancel}
        />
        
        <motion.div 
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="relative w-full max-w-md bg-zinc-950 border border-white/10 rounded-[32px] p-8 shadow-2xl overflow-hidden"
        >
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-brandRed to-transparent" />
          
          <button onClick={onCancel} className="absolute top-6 right-6 text-zinc-500 hover:text-white transition-colors">
            <X size={20} />
          </button>

          <div className="flex flex-col items-center text-center space-y-4 mb-8 mt-4">
            <div className="w-16 h-16 bg-brandRed/10 rounded-full flex items-center justify-center border border-brandRed/20">
              <Receipt size={28} className="text-brandRed" />
            </div>
            <div>
              <h3 className="text-2xl font-black uppercase italic tracking-tighter text-white">Where should we send your receipt?</h3>
              <p className="text-zinc-400 text-xs font-medium mt-2 leading-relaxed">
                You logged in with a phone number. We need an email address to send your Razorpay invoice and Tribe unlock confirmation.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="relative group">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-brandRed transition-colors" size={18} />
              <input 
                type="email" 
                placeholder="Enter your best email..." 
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(''); }}
                onKeyDown={onEnter(handleSave, !loading && !!email)}
                className="w-full bg-black/50 border border-white/10 p-4 pl-12 rounded-2xl font-medium text-base focus:border-brandRed outline-none text-white transition-all"
              />
            </div>
            
            {error && <p className="text-red-500 text-[10px] font-bold uppercase tracking-widest text-center">{error}</p>}

            <button 
              onClick={handleSave}
              disabled={loading || !email}
              className="w-full py-4 bg-white text-black font-black uppercase tracking-widest rounded-2xl hover:bg-brandRed hover:text-white transition-all shadow-xl active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50 mt-4"
            >
              {loading ? <Loader2 className="animate-spin" size={18} /> : <>Continue to Payment <ArrowRight size={16} /></>}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}