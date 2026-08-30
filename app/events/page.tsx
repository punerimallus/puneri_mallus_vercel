"use client";
import { useState, useEffect, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { motion, AnimatePresence, useScroll, useTransform } from 'framer-motion';
import { 
  Loader2, Search, Zap, History, Clock, MapPin, X, Ticket
} from 'lucide-react';

const FILTERS = [
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
    if (window.innerWidth > 1024) {
        setIsAutoPlaying(true);
    } else {
        setIsAutoPlaying(false); 
    }

    const fetchEvents = async () => {
      try {
        const res = await fetch('/api/events');
        const data = await res.json();
        
        if (Array.isArray(data)) {
            const now = new Date().getTime();

            // 🔥 1. Add precise timestamps and calculate `isUpcoming` securely
            const processedData = data.map(e => {
                const eventTime = new Date(`${e.date} ${e.time || "12:00 AM"}`).getTime();
                return {
                    ...e,
                    timestamp: eventTime || 0,
                    isUpcoming: eventTime >= now
                };
            });

            // 🔥 2. Sort Upcoming & Past accurately
            const sortedData = processedData.sort((a, b) => {
                // Group UPCOMING first, PAST second
                if (a.isUpcoming && !b.isUpcoming) return -1;
                if (!a.isUpcoming && b.isUpcoming) return 1;

                if (a.isUpcoming) {
                    // For Upcoming: Closest date first (Ascending)
                    return a.timestamp - b.timestamp;
                } else {
                    // For Past: Most recent date first (Descending)
                    return b.timestamp - a.timestamp;
                }
            });

            setEvents(sortedData);
        } else {
            setEvents([]);
        }
      } catch (error) {
        // 🔥 Silent failure for QA
      } finally {
        setLoading(false);
      }
    };
    fetchEvents();
  }, []);

  const filteredEvents = useMemo(() => {
    const safeSearch = search.toLowerCase().trim();
    return events.filter(e => {
      const safeTitle = e.title ? String(e.title).toLowerCase() : "";
      const matchesSearch = safeTitle.includes(safeSearch);
      
      const matchesFilter = activeFilter === 'ALL' || 
        (activeFilter === 'UPCOMING' && e.isUpcoming) || 
        (activeFilter === 'PAST' && !e.isUpcoming);
        
      return matchesSearch && matchesFilter;
    });
  }, [events, activeFilter, search]);

  if (loading) return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-4">
      <Loader2 className="text-brandRed animate-spin" size={30} strokeWidth={1} />
      <p className="text-zinc-500 text-[11px] font-bold uppercase tracking-widest">Loading Events...</p>
    </div>
  );

  return (
    <div className="bg-[#030303] min-h-screen relative selection:bg-brandRed/30 overflow-x-hidden">
     {/* Background Image */}
      <div
        className="fixed inset-0 z-0 pointer-events-none overflow-hidden"
        style={{
          backgroundImage: 'url(/events/main2.jpeg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          opacity: 0.45,
          transform: 'translateZ(0)',
          willChange: 'transform',
        }}
      />
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute inset-0 brightness-[0.8] saturate-[1.2]" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#030303]/40 via-transparent to-[#030303] z-[1]" />
      </div>

      <div className="max-w-7xl mx-auto relative z-10 pt-32 pb-32 px-6">
        <div className="text-center mb-12 space-y-4">
          <h1 className="text-5xl md:text-7xl font-black italic uppercase tracking-tighter leading-none text-white text-glow">
            The <span className="text-brandRed">Lineup.</span>
          </h1>
        </div>

        <div className="flex flex-col md:flex-row gap-4 items-center justify-between mb-16">
            <div className="relative group w-full md:max-w-xs">
                <label htmlFor="searchEvents" className="sr-only">Search Events</label>
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600 group-focus-within:text-brandRed" size={14} />
                <input 
                    id="searchEvents"
                    placeholder="Search events..." 
                    className="w-full bg-zinc-900 md:bg-zinc-950/40 border border-white/10 rounded-xl py-3.5 pl-11 text-[13px] font-medium outline-none focus:border-brandRed transition-all text-white md:backdrop-blur-xl placeholder:text-zinc-500" 
                    onChange={e => {setSearch(e.target.value); }} value={search}
                />
            </div>

            <div className="relative flex items-center bg-zinc-900 md:bg-zinc-950/50 p-1 rounded-xl border border-white/10 w-full md:w-[450px] md:backdrop-blur-md">
                {FILTERS.map((f) => (
                    <button key={f.id} onClick={() => {setActiveFilter(f.id); }}
                        className={`relative flex-1 py-2.5 text-[10px] font-bold uppercase tracking-widest transition-colors z-10 ${activeFilter === f.id ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                    >
                        {f.label}
                        <AnimatePresence>
                          {activeFilter === f.id && (
                            <motion.div
                              initial={{ opacity: 0, scale: 0.95 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0, scale: 0.95 }}
                              transition={{ duration: 0.2 }}
                              className="absolute inset-0 bg-brandRed rounded-lg -z-10 shadow-[0_0_15px_rgba(255,0,0,0.3)]"
                            />
                          )}
                        </AnimatePresence>
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
                  className="group relative border border-white/10 md:border-white/5 rounded-[40px] overflow-hidden transition-all duration-500 hover:border-brandRed/30 shadow-xl md:backdrop-blur-2xl h-fit bg-zinc-900 md:bg-white/[0.03]"
                  style={{ transform: 'translateZ(0)' }}
                >
                  <div className="relative w-full h-56 overflow-hidden">
                    <Image 
                      src={item.image || "/about/placeholder.jpeg"} 
                      alt={item.title || "Event Image"} fill  
                      blurDataURL={blurPlaceholder} placeholder="blur"
                      sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                      className={`object-cover group-hover:scale-105 transition-all duration-700 will-change-transform ${!item.isUpcoming ? 'grayscale opacity-60' : 'grayscale-0'}`} 
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 md:from-zinc-950 via-transparent to-transparent" />
                    
                    <div className="absolute top-6 left-6 flex flex-col items-center bg-white rounded-2xl overflow-hidden shadow-2xl group-hover:scale-110 transition-transform duration-500">
                        <div className={`w-full px-3 py-1 text-center text-[10px] font-black text-white uppercase tracking-tighter ${item.isUpcoming ? 'bg-brandRed' : 'bg-zinc-600'}`}>{month}</div>
                        <div className="px-3 py-1 text-2xl font-black text-black leading-none pb-2">{day}</div>
                    </div>

                    <div className="absolute top-6 right-6 z-20">
                      <div className="relative w-14 h-14 flex items-center justify-center">
                        <motion.div 
                          animate={item.isUpcoming ? { opacity: [0.4, 0.7, 0.4], scale: [1, 1.1, 1] } : { opacity: 0.2 }}
                          transition={{ repeat: Infinity, duration: 3 }}
                          className={`absolute inset-0 rounded-full blur-lg ${item.isUpcoming ? 'bg-brandRed' : 'bg-zinc-600'}`} 
                        />
                        
                        <div className={`relative w-full h-full rounded-full border-2 overflow-hidden flex items-center justify-center transition-all duration-500 md:backdrop-blur-md ${
                          item.isUpcoming 
                          ? 'bg-zinc-950 md:bg-zinc-950/90 border-white/20 shadow-2xl' 
                          : 'bg-zinc-900 md:bg-zinc-900/90 border-white/5 grayscale opacity-60'
                        }`}>
                          {item.categoryLogo ? (
                            <img 
                              src={item.categoryLogo} 
                              alt="Category" 
                              className="w-full h-full object-cover" 
                            />
                          ) : (
                            item.isUpcoming ? (
                              <Zap size={20} className="text-brandRed fill-brandRed/20" />
                            ) : (
                              <History size={20} className="text-zinc-500" />
                            )
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="p-8 space-y-6">
                    <h2 className={`text-2xl md:text-3xl font-black italic uppercase tracking-tighter leading-[0.9] truncate ${!item.isUpcoming ? 'text-zinc-500' : 'text-white'}`}>
                      {item.title || "Untitled Event"}
                    </h2>

                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden space-y-6" >
                          <div className="h-px bg-white/10 w-full" />
                          
                          <div className="grid grid-cols-1 gap-4">
                            <div className="flex items-center gap-3 text-zinc-300 text-sm md:text-base font-bold tracking-widest">
                              <Clock size={18} className={item.isUpcoming ? 'text-brandRed' : 'text-zinc-600'} /> {item.time || 'TBA'}
                            </div>
                            <div className="flex items-center gap-3 text-zinc-300 text-sm md:text-base font-bold tracking-widest">
                              <MapPin size={18} className={item.isUpcoming ? 'text-brandRed' : 'text-zinc-600'} /> {item.location || 'Pune Hub'}
                            </div>
                          </div>

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
                           {item.isUpcoming && (
  <Link 
    href={item.ticketUrl === 'INTERNAL' ? `/events/${item._id}/book` : (item.ticketUrl || '#')}
    target={item.ticketUrl === 'INTERNAL' ? "_self" : "_blank"} 
    className="flex-[2] bg-brandRed text-white py-4 rounded-2xl font-black uppercase text-[11px] tracking-widest hover:bg-white hover:text-black transition-all flex items-center justify-center gap-2 shadow-lg active:scale-95"
  >
    <Ticket size={16} /> Register Now 
  </Link>
)}
                           
                           <button onClick={() => {setExpandedId(isExpanded ? null : item._id); }}
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
            <Search size={40} className="text-zinc-600 mx-auto mb-4" />
            <p className="text-zinc-400 font-bold uppercase tracking-widest text-[11px]">No events found</p>
            <button onClick={() => { setSearch(''); setActiveFilter('ALL'); }} className="mt-4 text-brandRed font-bold uppercase text-[11px] hover:underline tracking-widest">Clear Search</button>
          </div>
        )}
      </div>
    </div>
  );
}