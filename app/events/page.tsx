"use client";
import { useState, useEffect, useMemo, useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { motion, AnimatePresence, useScroll, useTransform } from 'framer-motion';
import { 
  Loader2, Search, Zap, History, Calendar, 
  Clock, MapPin, X, Ticket
} from 'lucide-react';

const FILTERS = [
    { id: 'ALL', label: 'All Events' },
    { id: 'UPCOMING', label: 'Upcoming Event' },
    { id: 'PAST', label: 'Past Events' }
];
const shimmer = (w: number, h: number) => `
<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#111"/>
</svg>`;

const toBase64 = (str: string) =>
  typeof window === 'undefined'
    ? Buffer.from(str).toString('base64')
    : window.btoa(str);
export const blurPlaceholder = `data:image/svg+xml;base64,${toBase64(shimmer(700, 475))}`;
export default function EventsPage() {
  const [activeFilter, setActiveFilter] = useState('ALL');
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);
  const [search, setSearch] = useState('');
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { scrollY } = useScroll();
  const [isMobile, setIsMobile] = useState(false);
useEffect(() => {
  const check = () => setIsMobile(window.innerWidth < 768);
  check();
  window.addEventListener('resize', check);
  return () => window.removeEventListener('resize', check);
}, []);
  const y = useTransform(scrollY, [0, 500], isMobile ? [0, 0] : [0, 150]);
  useEffect(() => {
    // Only allow auto-play if screen is larger than 1024px (Desktop)
    if (window.innerWidth > 1024) {
        setIsAutoPlaying(true);
    } else {
        setIsAutoPlaying(false); // Force manual mode on mobile/tablets
    }

    const fetchEvents = async () => {
      try {
        const res = await fetch('/api/events');
        const data = await res.json();
        const sortedData = data.sort((a: any, b: any) => {
          if (a.isUpcoming !== b.isUpcoming) return a.isUpcoming ? -1 : 1;
          return new Date(b.date).getTime() - new Date(a.date).getTime();
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

  // Auto-sliding Filter Logic (Gated by isAutoPlaying)
  useEffect(() => {
    if (!isAutoPlaying || search !== "") return; 
    const interval = setInterval(() => {
      setActiveFilter((prev) => {
        const currentIndex = FILTERS.findIndex(f => f.id === prev);
        return FILTERS[(currentIndex + 1) % FILTERS.length].id;
      });
    }, 3500);
    return () => clearInterval(interval);
  }, [isAutoPlaying, search]);

  const stopSlider = () => {
    if (isAutoPlaying) setIsAutoPlaying(false);
  };

  const filteredEvents = useMemo(() => {
    return events.filter(e => {
      const matchesSearch = e.title.toLowerCase().includes(search.toLowerCase());
      const matchesFilter = activeFilter === 'ALL' || 
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
    <div 
      className="bg-[#030303] min-h-screen relative selection:bg-brandRed/30 overflow-x-hidden"
      onClickCapture={stopSlider}
      onKeyDownCapture={stopSlider}
    >
      <motion.div style={{ y }} className="fixed inset-0 z-0 pointer-events-none overflow-hidden bg-black">
<Image 
    src="/events/eventsback.jpg" 
    alt="BG" 
    fill 
    className="object-cover opacity-[0.45] brightness-[0.8] scale-110 saturate-[1.2]" 
    priority 
    // ADD THIS:
    sizes="100vw"
    blurDataURL={blurPlaceholder}
  />        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#030303] z-[1]" />
      </motion.div>

      <div className="max-w-7xl mx-auto relative z-10 pt-32 pb-32 px-6">
        <div className="text-center mb-12 space-y-4">
          <h1 className="text-5xl md:text-7xl font-black italic uppercase tracking-tighter leading-none text-white text-glow">
            The <span className="text-brandRed">Lineup.</span>
          </h1>
        </div>

        <div className="flex flex-col md:flex-row gap-4 items-center justify-between mb-16">
            <div className="relative group w-full md:max-w-xs">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600 group-focus-within:text-brandRed" size={14} />
                <input 
                    placeholder="SEARCH RECORDS..." 
                    className="w-full bg-zinc-950/40 border border-white/10 rounded-xl py-3.5 pl-11 text-[9px] font-black tracking-widest outline-none focus:border-brandRed transition-all text-white md:backdrop-blur-xl" 
                    onChange={e => {setSearch(e.target.value); stopSlider();}} value={search}
                />
            </div>

            <div className="relative flex items-center bg-zinc-950/50 p-1 rounded-xl border border-white/10 w-full md:w-[450px] md:backdrop-blur-md">
                {FILTERS.map((f) => (
                    <button key={f.id} onClick={() => {setActiveFilter(f.id); stopSlider();}}
                        className={`relative flex-1 py-2.5 text-[9px] font-black uppercase tracking-widest transition-colors z-10 ${activeFilter === f.id ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                    >
                        {f.label}
                        {activeFilter === f.id && (
                            <motion.div layoutId="activeTab" className="absolute inset-0 bg-brandRed rounded-lg -z-10 shadow-[0_0_15px_rgba(255,0,0,0.3)]" transition={{ type: "spring", bounce: 0.1, duration: 0.6 }} />
                        )}
                    </button>
                ))}
            </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          <AnimatePresence mode='popLayout'>
            {filteredEvents.map((item) => {
              const isExpanded = expandedId === item._id;
              const dateObj = new Date(item.date);
              const day = dateObj.getDate() || "??";
              const month = dateObj.toLocaleString('en-US', { month: 'short' }).toUpperCase() || "TBA";

              return (
                <motion.div layout key={item._id}
                  
  initial={{ opacity: 0 }} 
  animate={{ opacity: 1 }} 
  exit={{ opacity: 0 }}
                  className="group relative bg-zinc-950/30 border border-white/5 rounded-[40px] overflow-hidden transition-all duration-500 hover:border-brandRed/30 shadow-xl md:backdrop-blur-2xl h-fit"
                >
                  <div className="relative w-full h-56 overflow-hidden">
                    <Image 
                      src={item.image || "/about/placeholder.jpeg"} 
                      alt={item.title} fill  
                      blurDataURL={blurPlaceholder} placeholder="blur"
                      // ADD THIS:
    // Mobile: 100% width, Tablet: 50% width, Desktop: 33% width
    sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                      className={`object-cover group-hover:scale-105 transition-all duration-700 ${!item.isUpcoming ? 'grayscale opacity-60' : 'grayscale-0'}`} 
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-transparent to-transparent" />
                    
                    <div className="absolute top-6 left-6 flex flex-col items-center bg-white rounded-2xl overflow-hidden shadow-2xl group-hover:scale-110 transition-transform duration-500">
                        <div className={`w-full px-3 py-1 text-center text-[10px] font-black text-white uppercase tracking-tighter ${item.isUpcoming ? 'bg-brandRed' : 'bg-zinc-600'}`}>{month}</div>
                        <div className="px-3 py-1 text-2xl font-black text-black leading-none pb-2">{day}</div>
                    </div>

                    <div className="absolute top-6 right-6 bg-zinc-950/80 px-3 py-1.5 rounded-full border border-white/10 flex items-center gap-2 md:backdrop-blur-md">
                        {item.isUpcoming ? <Zap size={10} className="text-brandRed fill-brandRed animate-pulse" /> : <History size={10} className="text-zinc-500" />}
                        <span className={`text-[7px] font-black uppercase tracking-widest ${item.isUpcoming ? 'text-brandRed' : 'text-zinc-500'}`}>
                            {item.isUpcoming ? 'Upcoming' : 'Past'}
                        </span>
                    </div>
                  </div>

                  <div className="p-8 space-y-6">
                    <h2 className={`text-2xl md:text-3xl font-black italic uppercase tracking-tighter leading-[0.9] ${!item.isUpcoming ? 'text-zinc-500' : 'text-white'}`}>
                      {item.title}
                    </h2>

                    <AnimatePresence>
  {isExpanded && (
    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden space-y-6" >
       <div className="h-px bg-white/10 w-full" />
       
       <div className="grid grid-cols-1 gap-4">
         <div className="flex items-center gap-3 text-zinc-300 text-sm md:text-base font-black uppercase tracking-widest">
           <Clock size={18} className={item.isUpcoming ? 'text-brandRed' : 'text-zinc-600'} /> {item.time || 'TBA'}
         </div>
         <div className="flex items-center gap-3 text-zinc-300 text-sm md:text-base font-black uppercase tracking-widest">
           <MapPin size={18} className={item.isUpcoming ? 'text-brandRed' : 'text-zinc-600'} /> {item.location || 'Pune Hub'}
         </div>
       </div>

       {/* UPDATED DESCRIPTION LOGIC: Convert hyphens to pointers */}
       <div className="space-y-3 pl-1">
         {item.description?.split('-').map((segment: string, idx: number) => {
           const trimmed = segment.trim();
           if (!trimmed) return null;

           return (
             <div key={idx} className="flex items-start gap-3 group/item">
               <div className="mt-2 shrink-0">
                 <div className="w-1.5 h-1.5 rounded-full bg-brandRed shadow-[0_0_8px_#FF0000]" />
               </div>
               <p className="text-zinc-300 text-sm md:text-base leading-relaxed italic font-medium group-hover/item:text-white transition-colors">
                 {trimmed}
               </p>
             </div>
           );
         })}
       </div>
    </motion.div>
  )}
</AnimatePresence>

                    <div className="flex flex-col gap-3">
                        <div className="flex gap-2">
                           {/* BOOKING BUTTON - Visible if upcoming */}
                           {item.isUpcoming && (
                             <Link 
                               href={item.link || '#'} 
                               target="_blank" 
                               className="flex-[2] bg-brandRed text-white py-4 rounded-2xl font-black uppercase text-[11px] tracking-widest hover:bg-white hover:text-black transition-all flex items-center justify-center gap-2 shadow-lg active:scale-95"
                             >
                               <Ticket size={16} /> Book Tickets
                             </Link>
                           )}
                           
                           {/* DETAILS TOGGLE */}
                           <button onClick={() => {setExpandedId(isExpanded ? null : item._id); stopSlider();}}
                              className={`flex-1 py-4 rounded-2xl font-black uppercase text-[11px] tracking-widest transition-all flex items-center justify-center gap-2 shadow-lg active:scale-95 ${item.isUpcoming ? 'bg-white text-black hover:bg-zinc-200' : 'bg-zinc-800 text-zinc-400 hover:text-white'}`}
                           >
                             {isExpanded ? <X size={14} /> : 'Details'}
                           </button>
                        </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        {filteredEvents.length === 0 && (
          <div className="py-32 text-center">
            <Search size={40} className="text-zinc-800 mx-auto mb-4" />
            <p className="text-zinc-500 font-black uppercase tracking-[0.3em] text-[10px]">No transmission found</p>
            <button onClick={() => { setSearch(''); setActiveFilter('ALL'); }} className="mt-4 text-brandRed font-black uppercase text-[10px] hover:underline tracking-widest">Reset Radar</button>
          </div>
        )}
      </div>
    </div>
  );
}