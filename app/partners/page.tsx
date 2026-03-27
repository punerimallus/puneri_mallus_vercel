"use client";
import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { 
  Loader2, Search, Filter, Briefcase, ChevronRight, Zap, ChevronDown
} from 'lucide-react';

const HIERARCHY = [
  "Advisory Board",
  "Board of Trustees",
  "Executive Council",
  "Trailblazers Panel"
];

export default function PartnersPage() {
  const [partners, setPartners] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const sectionRefs = useRef<{ [key: string]: HTMLElement | null }>({});

  useEffect(() => {
    fetch('/api/partners').then(res => res.json()).then(data => {
      setPartners(data);
      setLoading(false);
    });
  }, []);

  const scrollToSection = (cat: string) => {
    const element = sectionRefs.current[cat];
    if (element) {
      const offset = 150;
      const bodyRect = document.body.getBoundingClientRect().top;
      const elementRect = element.getBoundingClientRect().top;
      window.scrollTo({ top: (elementRect - bodyRect) - offset, behavior: 'smooth' });
    }
  };

  if (loading) return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <Loader2 className="animate-spin text-brandRed" size={40} />
    </div>
  );

  return (
    <div className="min-h-screen bg-[#030303] text-white relative overflow-x-hidden selection:bg-brandRed/30">
      
      {/* BACKGROUND */}
      <div className="fixed inset-0 z-0 bg-black">
        <Image 
          src="/events/partner_3.png" 
          alt="BG" 
          fill 
          className="object-cover opacity-[0.5] brightness-[0.8]" 
          priority 
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-[#030303] z-[1]" />
      </div>

      <main className="max-w-7xl mx-auto relative z-10 pt-44 pb-32 px-6">
        
        {/* HEADER */}
        <div className="text-center mb-20 space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-brandRed/20 border border-brandRed/30 rounded-full mb-2 backdrop-blur-md">
             <Zap size={12} className="text-brandRed" fill="currentColor" />
             <span className="text-[9px] font-black uppercase tracking-[0.3em] text-white">Community Leadership</span>
          </div>
          <h1 className="text-6xl md:text-8xl font-black italic uppercase tracking-tighter leading-none drop-shadow-2xl">
            The <span className="text-brandRed">Architects.</span>
          </h1>
          <p className="text-zinc-300 font-bold uppercase tracking-[0.5em] text-[10px] md:text-xs">
            The Visionaries behind Puneri Mallus
          </p>
        </div>

        {/* SEARCH & DYNAMIC FILTERS */}
        <div className="sticky top-24 z-50 flex flex-col lg:flex-row items-center gap-4 lg:gap-6 mb-32 bg-black/60 backdrop-blur-3xl p-4 lg:p-6 rounded-[32px] border border-white/10 shadow-2xl">
           <div className="relative flex-1 w-full">
              <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
              <input 
                placeholder="SEARCH MEMBERS..." 
                className="w-full bg-white/[0.05] border border-white/10 rounded-2xl py-4 lg:py-5 pl-14 text-xs font-black uppercase tracking-widest outline-none focus:border-brandRed/50 transition-all placeholder:text-zinc-600"
                value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              />
           </div>

           {/* MOBILE DROPDOWN FILTER (Visible on phones) */}
           <div className="relative w-full lg:hidden group">
              <Filter className="absolute left-5 top-1/2 -translate-y-1/2 text-brandRed pointer-events-none" size={16} />
              <select 
  defaultValue="" // This replaces 'selected' on the option
  onChange={(e) => {
    if (e.target.value) scrollToSection(e.target.value);
  }}
  className="w-full bg-white/[0.05] border border-white/10 rounded-2xl py-4 pl-14 pr-10 text-[10px] font-black uppercase tracking-[0.2em] outline-none appearance-none focus:border-brandRed/50 transition-all cursor-pointer"
>
  {/* Remove 'selected' from here */}
  <option value="" disabled>JUMP TO SECTION</option> 
  
  {HIERARCHY.map((cat) => (
    <option key={cat} value={cat} className="bg-[#030303] text-white">
      {cat.toUpperCase()}
    </option>
  ))}
</select>
              <ChevronDown className="absolute right-5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none group-focus-within:rotate-180 transition-transform" size={16} />
           </div>

           {/* DESKTOP TAB FILTER (Visible on LG screens) */}
           <div className="hidden lg:flex gap-3 px-2">
              {HIERARCHY.map((cat) => (
                <button 
                  key={cat} 
                  onClick={() => scrollToSection(cat)} 
                  className="px-8 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest whitespace-nowrap bg-zinc-800 border border-white/5 hover:border-brandRed hover:text-brandRed transition-all shadow-xl active:scale-95"
                >
                  {cat}
                </button>
              ))}
           </div>
        </div>

        {/* SECTIONAL DIVISIONS */}
        <div className="space-y-48">
          {HIERARCHY.map((cat) => {
            const sectionMembers = partners.filter(p => p.category === cat && 
              (p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
               p.perk?.toLowerCase().includes(searchQuery.toLowerCase()))
            );

            if (sectionMembers.length === 0) return null;

            return (
              <section key={cat} ref={(el) => { sectionRefs.current[cat] = el; }} className="scroll-mt-48">
                
                <div className="flex flex-col gap-3 mb-20">
                   <div className="flex items-center gap-6">
                      <h2 className="text-4xl md:text-6xl font-black italic uppercase tracking-tighter text-white whitespace-nowrap leading-none drop-shadow-xl">
                        {cat}
                      </h2>
                      <div className="h-px w-full bg-gradient-to-r from-brandRed to-transparent" />
                   </div>
                   <div className="flex items-center gap-3 text-brandRed font-black uppercase text-[10px] tracking-[0.4em]">
                      <span className="w-8 h-[1px] bg-brandRed" /> Leading Representative
                   </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 md:gap-10">
                  {sectionMembers.map((member) => (
                    <Link key={member._id} href={`/partners/${member._id}`}>
                      <motion.div 
                        whileHover={{ y: -15 }}
                        className="group relative bg-black/40 border border-white/10 rounded-[60px] p-10 backdrop-blur-xl hover:border-brandRed/40 transition-all flex flex-col items-center text-center shadow-[0_30px_60px_rgba(0,0,0,0.8)]"
                      >
                        <div className="relative w-44 h-44 md:w-48 md:h-48 rounded-full mb-8 p-1.5 border-2 border-white/10 group-hover:border-brandRed transition-all duration-500 shadow-2xl">
                          <div className="w-full h-full rounded-full overflow-hidden relative shadow-inner">
                            <Image 
                                src={member.image} 
                                alt={member.name} 
                                fill 
                                className="object-cover transition-transform duration-700 group-hover:scale-110 saturate-[1.1]" 
                                unoptimized
                            />
                          </div>
                        </div>

                        <div className="space-y-3 flex-1">
                           <h3 className="text-2xl font-black uppercase italic tracking-tighter group-hover:text-brandRed transition-colors leading-tight">
                             {member.name}
                           </h3>
                           <div className="inline-flex items-center gap-2 text-[10px] font-bold text-zinc-400 uppercase tracking-widest border-t border-white/10 pt-4 w-full justify-center">
                              <Briefcase size={12} className="text-brandRed" /> {member.perk}
                           </div>
                        </div>

                        <div className="mt-8 flex items-center gap-2 text-[8px] font-black uppercase tracking-[0.3em] text-zinc-500 group-hover:text-white transition-all">
                           View Profile <ChevronRight size={10} className="group-hover:translate-x-1 transition-transform" />
                        </div>
                      </motion.div>
                    </Link>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </main>
    </div>
  );
}