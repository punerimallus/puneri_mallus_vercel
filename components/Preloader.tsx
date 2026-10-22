"use client";
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';
import { usePathname } from 'next/navigation';

// Seen once per browser session: the branded intro is a welcome, not a toll on every page load.
const SEEN_KEY = 'pm_intro_seen';
const INTRO_MS = 1100;

export default function Preloader() {
  // Admins are here to work, so the intro never holds up the admin area.
  const isAdminArea = (usePathname() || '').startsWith('/admin');
  const [loading, setLoading] = useState(!isAdminArea);
  const [percent, setPercent] = useState(0);

  useEffect(() => {
    let seen = false;
    try { seen = sessionStorage.getItem(SEEN_KEY) === '1'; } catch { /* storage blocked: just show it */ }
    const reduceMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (isAdminArea || seen || reduceMotion) { setLoading(false); return; }
    try { sessionStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ }

    // Time-based, not tied to window "load": waiting on every image and script made slow phones sit here for seconds.
    const startedAt = performance.now();
    let done: ReturnType<typeof setTimeout> | undefined;
    const tick = setInterval(() => {
      const p = Math.min(100, Math.round(((performance.now() - startedAt) / INTRO_MS) * 100));
      setPercent(p);
      if (p >= 100) {
        clearInterval(tick);
        done = setTimeout(() => setLoading(false), 150);
      }
    }, 50);

    return () => { clearInterval(tick); if (done) clearTimeout(done); };
  }, [isAdminArea]);

  const mantra = ["ONE COMMUNITY", "MANY DREAMS", "ZERO DIVIDE"];

  return (
    <AnimatePresence>
      {loading && (
        <motion.div
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4, ease: "easeInOut" }}
          className="intro-overlay fixed inset-0 z-[999] bg-[#030303] flex flex-col items-center justify-center overflow-hidden"
        >
          {/* 1. ATMOSPHERIC FX: plain gradients, no blur filters or remote textures (they stall phones) */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ background: 'radial-gradient(circle at 20% 28%, rgba(255,0,0,0.10), transparent 45%), radial-gradient(circle at 85% 72%, rgba(255,0,0,0.07), transparent 45%)' }}
          />

          <div className="relative flex flex-col items-center w-full px-10 z-10 space-y-8 md:space-y-16">
            
            {/* 2. LOGO */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1, ease: "easeOut" }}
            >
              <Image 
                src="/logo_main.png" 
                alt="Puneri Mallus" 
                width={450} 
                height={150} 
                sizes="(max-width: 768px) 200px, 450px"
                className="h-28 md:h-44 w-auto object-contain drop-shadow-[0_0_20px_rgba(255,0,0,0.15)]"
                priority
              />
            </motion.div>

            {/* 3. LOADING ENGINE */}
            <div className="w-full max-w-[320px] md:max-w-[550px] space-y-6">
              <div className="h-[2px] w-full bg-white/5 relative overflow-hidden rounded-full transform-gpu">
                <div className="absolute inset-0 bg-brandRed/10" />
                
                <motion.div 
                  className="absolute inset-y-0 left-0 w-full bg-brandRed shadow-[0_0_20px_#FF0000] origin-left"
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: percent / 100 }}
                  transition={{ ease: "easeOut", duration: 0.1 }}
                />
                
                <motion.div 
                  animate={{ x: ["-100%", "500%"] }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                  className="absolute inset-y-0 w-[20%] bg-gradient-to-r from-transparent via-white/40 to-transparent z-10"
                />
              </div>

              <div className="flex flex-col items-center gap-3">
                <div className="flex justify-between w-full font-mono text-[8px] md:text-[10px] tracking-[0.4em] font-black text-zinc-500">
                  <span className="uppercase italic">System Initialization</span>
                  <span className="text-brandRed">{percent}%</span>
                </div>
                
                <motion.p 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-[9px] md:text-[11px] font-black text-white tracking-[0.3em] md:tracking-[0.5em] uppercase italic text-center pt-2"
                >
                  Together for Growth <span className="text-brandRed mx-1 inline-block">/</span> Good Vibes
                </motion.p>
              </div>
            </div>

            {/* 4. MANTRA */}
            <div className="flex flex-col items-center space-y-4 pt-4">
              {mantra.map((text, i) => {
                const isSynced = percent > (i * 33);
                return (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0 }}
                    animate={{ 
                      opacity: isSynced ? 1 : 0.1, 
                      x: isSynced ? 0 : -10 
                    }}
                    transition={{ duration: 0.8 }}
                    className="flex items-center gap-4"
                  >
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