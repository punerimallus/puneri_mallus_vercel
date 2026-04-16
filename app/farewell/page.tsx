"use client";
import Link from 'next/link';
import { motion } from 'framer-motion'; // If you have framer-motion installed
import { HeartOff, ArrowLeft } from 'lucide-react';

export default function FarewellPage() {
  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center">
        <div className="w-20 h-20 bg-zinc-900 rounded-full flex items-center justify-center mx-auto mb-8 border border-white/5">
          <HeartOff className="text-brandRed animate-pulse" size={32} />
        </div>
        
        <h1 className="text-5xl font-black italic uppercase tracking-tighter mb-4 text-white">
          Identity <span className="text-zinc-700">Wiped.</span>
        </h1>
        
        <p className="text-zinc-500 font-medium leading-relaxed mb-10">
          You’ve officially left the tribe. Your data has been removed from our records, and your seat at the table is now empty. 
          <br /><br />
          <span className="italic text-zinc-400">Puna reminds you: The door is always open if you decide to return.</span>
        </p>

        <Link href="/auth/signup">
          <button className="group flex items-center justify-center gap-3 w-full py-5 bg-white text-black rounded-2xl font-black uppercase text-[11px] tracking-[0.2em] hover:bg-brandRed hover:text-white transition-all shadow-xl">
            <ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform" />
            Start a New Journey
          </button>
        </Link>
        
        <p className="mt-8 text-[9px] font-black uppercase tracking-[0.4em] text-zinc-800">
          Puneri Mallus — Over & Out
        </p>
      </div>
    </div>
  );
}