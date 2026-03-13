"use client";
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';

export default function Preloader() {
  const [loading, setLoading] = useState(true);
  const [percent, setPercent] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setPercent((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setTimeout(() => setLoading(false), 800); 
          return 100;
        }
        return prev + Math.floor(Math.random() * 15) + 5; 
      });
    }, 120);

    return () => {
      clearInterval(interval);
    };
  }, []);

  const mantra = ["ONE COMMUNITY", "MANY DREAMS", "ZERO DIVIDE"];

  return (
    <AnimatePresence>
      {loading && (
        <motion.div
          exit={{ opacity: 0, scale: 1.05, filter: "blur(10px)" }}
          transition={{ duration: 1, ease: [0.76, 0, 0.24, 1] }}
          className="fixed inset-0 z-[999] bg-black flex flex-col items-center justify-center overflow-hidden"
        >
          {/* AMBIENT BACKGROUND */}
          <div className="absolute inset-0 opacity-[0.05] bg-[url('https://grainy-gradients.vercel.app/noise.svg')] pointer-events-none" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-brandRed/10 blur-[150px] rounded-full animate-pulse pointer-events-none" />

          <div className="relative flex flex-col items-center space-y-16 z-10">
            
            {/* 2. UPSCALED LOGO */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 1, ease: "easeOut" }}
            >
              <Image 
                src="/logo.png" 
                alt="Puneri Mallus" 
                width={600} 
                height={200} 
                className="h-32 md:h-48 w-auto object-contain drop-shadow-[0_0_50px_rgba(255,0,0,0.5)]"
                priority
              />
            </motion.div>

            {/* 3. THE LOADING BAR */}
            <div className="w-[300px] md:w-[500px] space-y-5">
              <div className="h-[2px] w-full bg-white/5 relative overflow-hidden">
                <motion.div 
                  className="absolute inset-y-0 left-0 bg-brandRed shadow-[0_0_20px_#FF0000]"
                  initial={{ width: 0 }}
                  animate={{ width: `${percent}%` }}
                />
              </div>
              <div className="flex justify-between items-center font-mono text-[11px] tracking-[0.4em] text-zinc-400 font-black">
                <span className="animate-pulse">CONNECTING THE TRIBE</span>
                <span className="text-brandRed">{percent}%</span>
              </div>
            </div>

            {/* 4. THE MANTRA */}
            <div className="text-center space-y-3 pt-6">
              {mantra.map((text, i) => (
                <motion.p
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ 
                    opacity: percent > (i * 30) ? 1 : 0,
                    y: percent > (i * 30) ? 0 : 10 
                  }}
                  className={`text-[12px] md:text-sm font-black uppercase tracking-[0.8em] transition-all duration-700 ${
                    text === "ZERO DIVIDE" ? "text-brandRed drop-shadow-[0_0_10px_rgba(255,0,0,0.5)]" : "text-white/30"
                  }`}
                >
                  {text}
                </motion.p>
              ))}
            </div>
          </div>

          {/* 5. BOTTOM FIXED MANTRA */}
          <div className="absolute bottom-16 z-10">
             <motion.p 
               initial={{ opacity: 0 }}
               animate={{ 
                 opacity: [0.4, 1, 0.4], 
               }} 
               transition={{ 
                 duration: 3, 
                 repeat: Infinity, 
                 ease: "easeInOut" 
               }}
               className="text-[10px] font-black text-white tracking-[0.6em] uppercase italic"
             >
               Together for Growth & Good Vibes
             </motion.p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}