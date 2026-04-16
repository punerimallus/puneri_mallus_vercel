"use client";
import { ShieldAlert } from 'lucide-react';
import { motion } from 'framer-motion';

export default function TribeDisclaimer({ type }: { type: 'MART' | 'COMMUNITY' }) {
  return (
    <motion.div 
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-7xl mx-auto px-6 mb-8"
    >
      <div className="relative bg-zinc-950/40 backdrop-blur-xl border border-brandRed/20 p-4 md:p-5 rounded-[24px] flex items-start gap-4 shadow-[0_0_30px_rgba(255,0,0,0.05)] overflow-hidden">
        {/* Ambient System Glow */}
        <div className="absolute top-0 right-0 w-24 h-24 bg-brandRed/5 blur-3xl pointer-events-none" />
        
        <div className="mt-1 bg-brandRed/10 p-2 rounded-lg shrink-0">
          <ShieldAlert className="text-brandRed" size={18} />
        </div>

        <div className="flex-1 space-y-1">
          <h4 className="text-[10px] font-black uppercase tracking-[0.3em] text-white flex items-center gap-2">
            Protocol <span className="text-brandRed">Disclaimer</span>
          </h4>
          <p className="text-[9px] md:text-[10px] font-bold uppercase tracking-widest text-zinc-500 leading-relaxed max-w-4xl">
            {type === 'MART' 
              ? "Verification indicates identity proofing only. Puneri Mallus does not guarantee service quality or handle transaction disputes. Perform your own due diligence."
              : "Member views are personal and do not reflect the Tribe's official stance. Puneri Mallus is not liable for shared advice or external links within this forum."
            }
          </p>
        </div>
      </div>
    </motion.div>
  );
}