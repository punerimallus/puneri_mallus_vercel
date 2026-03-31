"use client";
import { useEffect, useState,useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';

export default function Preloader() {
  const [loading, setLoading] = useState(true);
  
  const [percent, setPercent] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
  intervalRef.current = setInterval(() => {
    setPercent((prev) => {
      if (prev >= 100) {
        clearInterval(intervalRef.current!)
        setTimeout(() => {
  sessionStorage.setItem('preloader_shown', 'true');
  setLoading(false);
}, 800);
        return 100;
      }
      return Math.min(prev + Math.floor(Math.random() * 10) + 2, 100);
    });
  }, 80);
  return () => clearInterval(intervalRef.current!);
}, []);

  const mantra = ["ONE COMMUNITY", "MANY DREAMS", "ZERO DIVIDE"];
  
  return (
    <AnimatePresence>
      {loading && (
        <motion.div
          exit={{ opacity: 0 }}
transition={{ duration: 0.6, ease: "easeInOut" }}
          className="fixed inset-0 z-[999] bg-[#030303] flex flex-col items-center justify-center overflow-hidden"
        >
          {/* 1. ATMOSPHERIC FX */}
          <div className="absolute inset-0 opacity-[0.03] bg-[url('https://grainy-gradients.vercel.app/noise.svg')] pointer-events-none" />
          
          {/* Moving Ambient Orbs */}
          <div className="absolute top-1/4 -left-20 w-[400px] h-[400px] bg-brandRed/15 blur-[150px] rounded-full pointer-events-none" />
<div className="absolute bottom-1/4 -right-20 w-[400px] h-[400px] bg-brandRed/10 blur-[150px] rounded-full pointer-events-none" />

          <div className="relative flex flex-col items-center w-full px-10 z-10 space-y-8 md:space-y-16">
            
            {/* 2. LOGO: Sharp Animation */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1, ease: "easeOut" }}
            >
              <Image 
  src="/logo.png" 
  alt="Puneri Mallus" 
  width={450} 
  height={150} 
  // Added sizes to fix the performance warning and improve mobile loading
  sizes="(max-width: 768px) 200px, 450px"
  className="h-28 md:h-44 w-auto object-contain drop-shadow-[0_0_20px_rgba(255,0,0,0.15)]"
  priority
/>
            </motion.div>

            {/* 3. MODERN LOADING ENGINE */}
            <div className="w-full max-w-[320px] md:max-w-[550px] space-y-6">
              <div className="h-[2px] w-full bg-white/5 relative overflow-hidden rounded-full">
                {/* Background "Glow" line */}
                <div className="absolute inset-0 bg-brandRed/10" />
                
                {/* Main Progress */}
                <motion.div 
  className="absolute inset-y-0 left-0 bg-brandRed shadow-[0_0_20px_#FF0000] will-change-transform"
  initial={{ width: 0 }}
  animate={{ width: `${percent}%` }}
/>
                
                {/* LASER SCANNER EFFECT */}
                <motion.div 
                  animate={{ left: ["-10%", "110%"] }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                  className="absolute inset-y-0 w-20 bg-gradient-to-r from-transparent via-white/40 to-transparent z-10"
                />
              </div>

              <div className="flex flex-col items-center gap-3">
                <div className="flex justify-between w-full font-mono text-[8px] md:text-[10px] tracking-[0.4em] font-black text-zinc-500">
                  <span className="uppercase italic">System Initialization</span>
                  <span className="text-brandRed">{percent}%</span>
                </div>
                
                {/* REPLACED: TOGETHER FOR GROWTH SLOGAN */}
                <motion.p 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-[9px] md:text-[11px] font-black text-white tracking-[0.3em] md:tracking-[0.5em] uppercase italic text-center pt-2"
                >
                  Together for Growth <span className="text-brandRed mx-1 inline-block">/</span> Good Vibes
                </motion.p>
              </div>
            </div>

            {/* 4. MANTRA: Minimalist Stack - FIXED VISIBILITY */}
            <div className="flex flex-col items-center space-y-4 pt-4">
              {mantra.map((text, i) => {
                const isSynced = percent > (i * 33);
                return (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0 }}
                    animate={{ 
                      opacity: isSynced ? 1 : 0.1, // High contrast for synced items
                      x: isSynced ? 0 : -10 
                    }}
                    transition={{ duration: 0.8 }}
                    className="flex items-center gap-4"
                  >
                    {/* Modern dash indicator */}
                    <div className={`h-[1px] transition-all duration-1000 ${isSynced ? 'w-6 bg-brandRed shadow-[0_0_8px_#FF0000]' : 'w-0 bg-zinc-800'}`} />
                    
                    <p className={`text-[10px] md:text-[12px] font-black uppercase tracking-[0.3em] md:tracking-[0.6em] transition-all duration-700 ${
                      isSynced 
                        ? (text === "ZERO DIVIDE" ? "text-brandRed" : "text-white") 
                        : "text-white/10"
                    }`}>
                      {text}
                    </p>
                  </motion.div>
                );
              })}
            </div>
          </div>

          
        </motion.div>
      )}
    </AnimatePresence>
  );
}