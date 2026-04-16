"use client";
import { useState, useEffect } from 'react';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { Clock, MapPin, ExternalLink, Zap, ChevronRight, History } from 'lucide-react';

interface EventCardProps {
  title: string;
  date: string;
  image: string;
  category: string;
  categoryLogo?: string; // 🔥 Added for logo support
  isUpcoming?: boolean;
  showDescription?: boolean; 
  description?: string;
  time?: string;
  location?: string;
  mapUrl?: string;
  ticketUrl?: string;
}

export default function EventCard({ 
  title, 
  date, 
  image, 
  category, 
  categoryLogo, // 🔥 New Prop
  isUpcoming = false, 
  showDescription = true, 
  description, 
  time, 
  location, 
  mapUrl,
  ticketUrl 
}: EventCardProps) {
  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, mins: 0, secs: 0 });
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    if (!date || !isUpcoming) return;

    const calculateTimeLeft = () => {
      try {
        const eventDateTimeStr = `${date} ${time || "12:00 AM"}`;
        const targetDate = new Date(eventDateTimeStr).getTime();
        const now = new Date().getTime();
        const difference = targetDate - now;

        if (difference > 0) {
          setTimeLeft({
            days: Math.floor(difference / (1000 * 60 * 60 * 24)),
            hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
            mins: Math.floor((difference / 1000 / 60) % 60),
            secs: Math.floor((difference / 1000) % 60),
          });
          setIsLive(true);
        } else {
          setIsLive(false);
        }
      } catch (e) {
        console.error("Pulse calculation error:", e);
      }
    };

    const timer = setInterval(calculateTimeLeft, 1000);
    calculateTimeLeft();
    return () => clearInterval(timer);
  }, [date, time, isUpcoming]);

  const safeSrc = image || "/events/placeholder.jpg";
  const dateParts = date?.split(/[\s,]+/) || []; 
  const month = dateParts[0] || "---";
  const day = dateParts[1] || "--";
  const year = dateParts[2] || "----";

  return (
    <motion.div 
      layout 
      initial={{ opacity: 0, y: 20 }} 
      animate={{ opacity: 1, y: 0 }} 
      className="group h-full w-full"
    >
      <div className={`relative h-full flex flex-col overflow-hidden rounded-[45px] bg-zinc-950/40 backdrop-blur-xl border transition-all duration-700 ${
        isUpcoming 
        ? 'border-white/10 hover:border-brandRed/50 hover:shadow-[0_0_50px_rgba(255,0,0,0.15)]' 
        : 'border-white/5 opacity-60 grayscale hover:grayscale-0 hover:opacity-100 shadow-none'
      }`}>
        
        {/* IMAGE SECTION */}
        <div className="relative w-full aspect-[16/11] overflow-hidden">
        <Image 
          src={safeSrc} 
          alt={title} 
          fill 
          className="object-cover transition-all duration-1000 group-hover:scale-105" 
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          priority={isUpcoming} 
        />
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/20 to-transparent z-10" />
          
          {/* 🔥 UPDATED: LOGO BADGE (Increased Size & Full Frame) */}
          <div className="absolute top-5 right-5 z-20">
            {/* Increased to w-14 h-14 */}
            <div className="relative w-14 h-14 flex items-center justify-center">
              {/* Outer Glow Ring */}
              <div className={`absolute inset-0 rounded-full blur-lg transition-opacity duration-700 ${isUpcoming ? 'bg-brandRed opacity-40 group-hover:opacity-80' : 'bg-zinc-600 opacity-20'}`} />
              
              {/* Logo Container - Removed padding to allow full coverage */}
              <div className={`relative w-full h-full rounded-full border-2 overflow-hidden flex items-center justify-center backdrop-blur-md shadow-2xl transition-all ${
                isUpcoming ? 'bg-zinc-950/90 border-white/20' : 'bg-zinc-900/90 border-white/5 opacity-60 grayscale'
              }`}>
                {categoryLogo ? (
                  /* object-cover ensures the circle is entirely covered */
                  <img src={categoryLogo} alt={category} className="w-full h-full object-cover" />
                ) : (
                  /* Fallback icon if no logo provided */
                  isUpcoming ? <Zap size={20} className="text-brandRed" /> : <History size={20} className="text-zinc-500" />
                )}
              </div>
            </div>
          </div>

          {/* COUNTDOWN OVERLAY - MAINTAINED */}
          {isUpcoming && isLive && (
            <div className="absolute inset-0 bg-black/70 flex items-center justify-center backdrop-blur-md opacity-0 group-hover:opacity-100 transition-all duration-700 z-30">
              <div className="text-center">
                <p className="text-[10px] tracking-[.4em] text-brandRed mb-5 uppercase font-black">Syncing Pulse</p>
                
                <div className="flex gap-4 text-white font-black italic text-4xl tracking-tighter">
                   <div className="flex flex-col items-center">
                     <span className="leading-none">{timeLeft.days}</span>
                     <span className="text-[10px] not-italic text-zinc-400 uppercase font-black tracking-widest mt-2">Days</span>
                   </div>
                   <div className="text-brandRed animate-pulse self-start mt-[-4px]">:</div>
                   <div className="flex flex-col items-center">
                     <span className="leading-none">{timeLeft.hours}</span>
                     <span className="text-[10px] not-italic text-zinc-400 uppercase font-black tracking-widest mt-2">Hrs</span>
                   </div>
                   <div className="text-brandRed animate-pulse self-start mt-[-4px]">:</div>
                   <div className="flex flex-col items-center">
                     <span className="leading-none">{timeLeft.mins}</span>
                     <span className="text-[10px] not-italic text-zinc-400 uppercase font-black tracking-widest mt-2">Mins</span>
                   </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* CONTENT SECTION - MAINTAINED */}
        <div className="p-8 md:p-10 flex-1 flex flex-col relative z-20">
          <div className="flex items-start gap-5 mb-6">
            <div className="flex flex-col items-center justify-center w-14 h-16 bg-white rounded-2xl overflow-hidden shadow-2xl group-hover:-rotate-3 transition-transform duration-700 shrink-0">
              <div className="w-full bg-brandRed h-4" />
              <div className="flex flex-col items-center justify-center flex-1 text-black">
                <span className="font-black text-[8px] uppercase tracking-tighter leading-none">{month}</span>
                <span className="font-black text-xl tracking-tighter leading-none">{day}</span>
              </div>
            </div>

            <div className="space-y-1">
              <h3 className="text-2xl md:text-3xl font-black uppercase italic leading-none tracking-tighter text-white group-hover:text-brandRed transition-colors duration-500">
                {title}
              </h3>
              <div className="flex items-center gap-2 text-zinc-500">
                 <Clock size={12} className="text-brandRed" />
                 <span className="text-[9px] font-black uppercase tracking-widest">{time}</span>
              </div>
            </div>
          </div>

          {showDescription && description && (
            <div className="mb-8 relative pl-2">
              <ul className="space-y-3">
                {description.split('-').map((segment, idx) => {
                  const trimmed = segment.trim();
                  if (!trimmed) return null;
                  return (
                    <motion.li 
                      key={idx} 
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.1 }}
                      className="text-zinc-300 text-[11px] sm:text-[12px] font-medium leading-relaxed italic flex items-start gap-3 group/item"
                    >
                      <div className="mt-1.5 shrink-0">
                         <div className="w-1.5 h-1.5 rounded-full bg-brandRed shadow-[0_0_8px_#FF0000] group-hover/item:scale-125 transition-transform" />
                      </div>
                      <span className="group-hover/item:text-white transition-colors">{trimmed}</span>
                    </motion.li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* FOOTER - MAINTAINED */}
          <div className="mt-auto space-y-4">
            {location && (
              <div className="flex items-center justify-between bg-white/5 p-3 px-4 rounded-xl border border-white/5 backdrop-blur-md">
                <div className="flex items-center gap-3">
                  <MapPin size={14} className="text-brandRed" />
                  <div className="flex flex-col">
                    <span className="text-[7px] font-black text-zinc-500 uppercase tracking-widest leading-none mb-1">Venue</span>
                    <p className="text-[10px] font-black uppercase tracking-widest text-zinc-300 leading-tight truncate max-w-[150px]">{location}</p>
                  </div>
                </div>
                {mapUrl && (
                  <a href={mapUrl} target="_blank" rel="noopener noreferrer" className="p-2 bg-zinc-950 hover:bg-brandRed hover:text-white rounded-lg transition-all border border-white/10">
                    <ExternalLink size={12} />
                  </a>
                )}
              </div>
            )}

            {isUpcoming && (
              <a href={ticketUrl || "/events"} className="block group/btn">
                <button className="w-full py-4 bg-brandRed text-white font-black uppercase text-[9px] tracking-[0.3em] hover:bg-white hover:text-black transition-all rounded-2xl shadow-xl active:scale-95 flex items-center justify-center gap-2">
                  Secure Spot <Zap size={12} />
                </button>
              </a>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}