"use client";
import { useState, useEffect, useMemo } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Search, Sparkles, History, Zap } from 'lucide-react';
import EventCard from '@/components/EventCard';

const FILTERS = ['ALL', 'UPCOMING', 'PAST'];

export default function EventsPage() {
  const [activeFilter, setActiveFilter] = useState('ALL');
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);
  const [search, setSearch] = useState('');
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Only auto-play on Desktop
    if (window.innerWidth > 1024) {
      setIsAutoPlaying(true);
    }

    const fetchEvents = async () => {
      try {
        const res = await fetch('/api/events');
        const data = await res.json();
        const sortedData = data.sort((a: any, b: any) => {
          if (a.isUpcoming === b.isUpcoming) return 0;
          return a.isUpcoming ? -1 : 1;
        });
        setEvents(sortedData);
      } catch (error) {
        console.error("Pulse Sync Failed:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchEvents();
  }, []);

  useEffect(() => {
    if (!isAutoPlaying || search !== "") return; 

    const interval = setInterval(() => {
      setActiveFilter((prev) => {
        const currentIndex = FILTERS.indexOf(prev);
        return FILTERS[(currentIndex + 1) % FILTERS.length];
      });
    }, 2800);

    return () => clearInterval(interval);
  }, [isAutoPlaying, search]);

  const handleFilterClick = (filter: string) => {
    setIsAutoPlaying(false); 
    setActiveFilter(filter);
  };

  const filteredEvents = useMemo(() => {
    return events.filter(e => {
      const matchesSearch = e.title.toLowerCase().includes(search.toLowerCase());
      const matchesFilter = 
        activeFilter === 'ALL' || 
        (activeFilter === 'UPCOMING' && e.isUpcoming) || 
        (activeFilter === 'PAST' && !e.isUpcoming);
      return matchesSearch && matchesFilter;
    });
  }, [events, activeFilter, search]);

  if (loading) return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <Loader2 className="text-brandRed animate-spin" size={30} strokeWidth={1} />
    </div>
  );

  return (
    <div className="bg-[#030303] min-h-screen relative selection:bg-brandRed/30">
      
      {/* BACKGROUND - HIGH VISIBILITY */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden bg-black">
        <Image 
          src="/events/eventsback.jpg" 
          alt="Event Background"
          fill
          className="object-cover object-center opacity-[0.45] brightness-[0.8] saturate-[1.1]" 
          priority
        />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#030303] z-[1]" />
        <div className="absolute inset-0 opacity-[0.04] bg-[url('https://grainy-gradients.vercel.app/noise.svg')] mix-blend-overlay z-[2]" />
      </div>

      <div className="max-w-7xl mx-auto relative z-10 pt-40 pb-48 px-6 lg:px-12">
        
        {/* HEADER & FILTERS */}
        <div className="flex flex-col lg:flex-row justify-between items-center mb-16 gap-8">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <h1 className="text-5xl md:text-8xl font-black italic uppercase tracking-tighter leading-none text-white text-center lg:text-left">
              The <span className="text-brandRed">Lineup.</span>
            </h1>
          </motion.div>
          
          <div className="flex items-center gap-1.5 p-1 bg-zinc-950/60 backdrop-blur-2xl rounded-2xl border border-white/10 shadow-2xl overflow-x-auto no-scrollbar max-w-full">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => handleFilterClick(f)}
                className={`px-6 lg:px-8 py-3.5 rounded-xl text-[9px] lg:text-[10px] font-black uppercase tracking-widest transition-all duration-700 whitespace-nowrap ${
                  activeFilter === f 
                  ? 'bg-brandRed text-white shadow-[0_0_20px_rgba(255,0,0,0.3)]' 
                  : 'text-zinc-500 hover:text-white'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* SEARCH BAR */}
        <div className="max-w-md mx-auto lg:mx-0 mb-16 relative group">
          <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-600 group-focus-within:text-brandRed transition-colors" size={16} />
          <input 
            placeholder="SEARCH THE RECORDS..." 
            className="w-full bg-zinc-950/40 border border-white/10 rounded-2xl py-5 pl-14 pr-6 text-[10px] font-black tracking-widest uppercase focus:outline-none focus:border-brandRed/40 transition-all text-white backdrop-blur-xl" 
            onChange={e => {
                setSearch(e.target.value);
                if(isAutoPlaying) setIsAutoPlaying(false);
            }} 
            value={search}
          />
        </div>

        {/* UNIFORM GRID */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 lg:gap-10">
          <AnimatePresence mode='popLayout'>
            {filteredEvents.map((item, index) => (
              <motion.div
                key={item._id || item.id}
                layout
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                
                whileHover={window.innerWidth > 1024 ? { 
                  scale: 1.02,
                  rotateX: 2,
                  rotateY: -2,
                  transition: { duration: 0.2 }
                } : {}}
                style={{ transformStyle: "preserve-3d" }}
                transition={{ 
                  type: "spring",
                  stiffness: 260,
                  damping: 24
                }}
                className="w-full perspective-1000"
              >
                {/* Status Indicator */}
                <div className="flex items-center gap-2 mb-5 px-2">
                  {item.isUpcoming ? (
                    <>
                      <Zap size={14} className="text-brandRed fill-brandRed animate-pulse" />
                      <span className="text-brandRed font-black uppercase text-[11px] lg:text-[12px] tracking-[0.3em] italic">Upcoming Pulse</span>
                    </>
                  ) : (
                    <>
                      <History size={12} className="text-zinc-600" />
                      <span className="text-zinc-600 font-black uppercase text-[9px] lg:text-[10px] tracking-[0.3em]">Archive</span>
                    </>
                  )}
                </div>

                <div className="relative bg-zinc-950/40 backdrop-blur-3xl border border-white/5 rounded-[32px] lg:rounded-[40px] overflow-hidden group hover:border-brandRed/30 transition-all shadow-2xl">
                  <EventCard {...item} isUpcoming={item.isUpcoming} />
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* EMPTY STATE */}
        {filteredEvents.length === 0 && (
          <div className="py-40 text-center flex flex-col items-center justify-center">
            <h2 className="text-zinc-800 font-black italic text-4xl uppercase tracking-tighter">No Events Found</h2>
          </div>
        )}
      </div>
    </div>
  );
}