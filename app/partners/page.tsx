"use client";
import { useState, useEffect, useRef, useMemo } from 'react';
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

//  FOUNDER DETAILS
const FOUNDERS = [
  {
    _id: "founder-1",
    name: "SUCHEENDRAN KC",
    image: "/founders/suchi.jpg", // Replace with real image path
    role: "Founder"
  },
  {
    _id: "founder-2",
    name: "SHEHANAS.SHEIK",
    image: "/founders/shehanas_2.jpeg", // Replace with real image path
    role: "Co-Founder"
  }
];

interface Partner {
  _id: string;
  name: string;
  image: string;
  category: string;
  perk?: string;
  order?: number;
}

export default function PartnersPage() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const sectionRefs = useRef<{ [key: string]: HTMLElement | null }>({});

  useEffect(() => {
    fetch('/api/partners')
      .then(res => res.json())
      .then(data => setPartners(data))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
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

  const groupedPartners = useMemo(() => {
    return HIERARCHY.map(cat => ({
      cat,
      members: partners.filter(p => p.category === cat &&
        (p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
         p.perk?.toLowerCase().includes(searchQuery.toLowerCase()))
      )
      // 🔥 ADD THIS SORT FUNCTION
        .sort((a, b) => (a.order || 0) - (b.order || 0))
    })).filter(group => group.members.length > 0);
  }, [partners, searchQuery]);

  const hasNoResults = !loading && partners.length > 0 && groupedPartners.length === 0;

  if (loading) return (
    <div className="min-h-[100dvh] bg-black flex items-center justify-center">
      <Loader2 className="animate-spin text-brandRed" size={40} />
    </div>
  );

  if (error) return (
    <div className="min-h-[100dvh] bg-black flex items-center justify-center">
      <p className="text-brandRed font-black uppercase tracking-widest text-sm">
        Failed to load. Please refresh.
      </p>
    </div>
  );

  return (
    <div className="min-h-[100dvh] w-full bg-[#030303] text-white relative overflow-x-hidden selection:bg-brandRed/30">
      
      <div className="fixed inset-0 z-0 pointer-events-none">
        <Image 
          src="/events/partner_3.png" 
          alt="Background" 
          fill 
          priority 
          quality={85}
          className="object-cover opacity-80 brightness-70"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-[#030303]/80 to-[#030303] z-[1]" />
      </div>

      <main className="max-w-7xl mx-auto relative z-10 pt-44 pb-32 px-6">
        
        {/* HEADER */}
        <div className="text-center mb-20 space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-brandRed/10 border border-brandRed/20 rounded-full mb-2 backdrop-blur-md">
            <Zap size={12} className="text-brandRed" fill="currentColor" />
            <span className="text-[9px] font-black uppercase tracking-[0.3em] text-white">Community Leadership</span>
          </div>
          <h1 className="text-6xl md:text-8xl font-black italic uppercase tracking-tighter leading-none drop-shadow-2xl">
            The <span className="text-brandRed">Architects.</span>
          </h1>
          <p className="text-zinc-400 font-bold uppercase tracking-[0.5em] text-[10px] md:text-xs">
            The Visionaries behind the Tribe
          </p>
        </div>

        {/* SEARCH & FILTERS */}
        <div className="sticky top-24 z-50 flex flex-col lg:flex-row items-center gap-4 lg:gap-6 mb-24 bg-black/60 backdrop-blur-2xl p-4 lg:p-6 rounded-[32px] border border-white/10 shadow-2xl">
          <div className="relative flex-1 w-full group">
            <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-brandRed transition-colors" size={18} />
            <input 
              placeholder="SEARCH MEMBERS..." 
              className="w-full bg-white/[0.03] border border-white/10 rounded-2xl py-4 lg:py-5 pl-14 text-xs font-black uppercase tracking-widest outline-none focus:border-brandRed/50 focus:bg-white/[0.05] transition-all placeholder:text-zinc-600"
              value={searchQuery} 
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>

          {/* MOBILE DROPDOWN */}
          <div className="relative w-full lg:hidden group">
            <Filter className="absolute left-5 top-1/2 -translate-y-1/2 text-brandRed pointer-events-none" size={16} />
            <select 
              defaultValue=""
              onChange={(e) => { if (e.target.value) scrollToSection(e.target.value); }}
              className="w-full bg-white/[0.03] border border-white/10 rounded-2xl py-4 pl-14 pr-10 text-[10px] font-black uppercase tracking-[0.2em] outline-none appearance-none focus:border-brandRed/50 transition-all cursor-pointer"
            >
              <option value="" disabled>JUMP TO SECTION</option> 
              <option value="Founders" className="bg-black text-white">FOUNDERS</option>
              {HIERARCHY.map((cat) => (
                <option key={cat} value={cat} className="bg-black text-white">
                  {cat.toUpperCase()}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none group-focus-within:rotate-180 transition-transform" size={16} />
          </div>

          {/* DESKTOP TABS */}
          <div className="hidden lg:flex gap-2 px-2">
            <button 
              onClick={() => scrollToSection('Founders')} 
              className="px-6 py-4 rounded-xl text-[9px] font-black uppercase tracking-widest whitespace-nowrap bg-brandRed/10 border border-brandRed/50 hover:bg-brandRed hover:text-white transition-all duration-300 shadow-xl active:scale-95 text-brandRed"
            >
              FOUNDERS
            </button>
            {HIERARCHY.map((cat) => (
              <button 
                key={cat} 
                onClick={() => scrollToSection(cat)} 
                className="px-6 py-4 rounded-xl text-[9px] font-black uppercase tracking-widest whitespace-nowrap bg-white/[0.03] border border-white/5 hover:border-brandRed hover:bg-brandRed/10 hover:text-white transition-all duration-300 shadow-xl active:scale-95"
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* EMPTY STATE */}
        {hasNoResults && searchQuery !== '' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-32 text-center">
            <p className="text-zinc-500 font-black uppercase tracking-[0.3em] text-[10px]">
              No members found
            </p>
            <button 
              onClick={() => setSearchQuery('')}
              className="mt-4 text-brandRed font-black uppercase text-[10px] tracking-widest hover:text-white transition-colors"
            >
              Clear Search
            </button>
          </motion.div>
        )}

        <div className="space-y-24 md:space-y-40">
          
    {/* 🔥 NEW: FOUNDERS SECTION */}
          {searchQuery === "" && (
            <section ref={(el) => { sectionRefs.current['Founders'] = el; }} className="scroll-mt-40">
              <div className="flex flex-col gap-3 mb-16">
                <div className="flex items-center gap-6">
                  <h2 className="text-4xl md:text-5xl font-black italic uppercase tracking-tighter text-white whitespace-nowrap leading-none drop-shadow-xl">
                    Founders
                  </h2>
                  <div className="h-[1px] w-full bg-gradient-to-r from-brandRed/50 to-transparent" />
                </div>
                <div className="flex items-center gap-3 text-brandRed font-black uppercase text-[10px] tracking-[0.4em]">
                  <span className="w-8 h-[1px] bg-brandRed" /> The Architects
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 md:gap-12 max-w-4xl mx-auto">
                {FOUNDERS.map((founder) => (
                  <div key={founder._id} className="block h-full">
                    <div className="group h-full relative bg-brandRed/5 border border-brandRed/20 rounded-[40px] p-10 backdrop-blur-md hover:bg-brandRed/10 hover:border-brandRed transition-all duration-500 hover:-translate-y-2 hover:shadow-[0_20px_50px_rgba(255,0,0,0.15)] flex flex-col items-center text-center will-change-transform cursor-default">
                      
                      <div className="relative w-48 h-48 md:w-56 md:h-56 rounded-full mb-8 p-1.5 border-2 border-brandRed/30 group-hover:border-brandRed transition-all duration-500 shadow-2xl">
                        <div className="w-full h-full rounded-full overflow-hidden relative bg-zinc-900">
                          <Image 
                            src={founder.image}
                            alt={founder.name} 
                            fill
                            sizes="(max-width: 640px) 100vw, 50vw"
                            className="object-cover transition-transform duration-700 md:group-hover:scale-105" 
                          />
                        </div>
                      </div>

                      <div className="space-y-4 flex-1 w-full">
                        <h3 className="text-2xl md:text-3xl font-black uppercase italic tracking-tighter text-white group-hover:text-brandRed transition-colors leading-tight px-2">
                          {founder.name}
                        </h3>
                        <div className="inline-flex items-center justify-center gap-2 text-[10px] font-bold text-zinc-300 uppercase tracking-widest border-t border-white/10 pt-5 w-full px-2">
                          <Zap size={14} className="text-brandRed shrink-0" fill="currentColor" /> 
                          <span>{founder.role}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
          
          {/* STANDARD SECTIONS */}
          {groupedPartners.map(({ cat, members }) => (
            <section key={cat} ref={(el) => { sectionRefs.current[cat] = el; }} className="scroll-mt-40">
              
              <div className="flex flex-col gap-3 mb-16">
                <div className="flex items-center gap-6">
                  <h2 className="text-4xl md:text-5xl font-black italic uppercase tracking-tighter text-white whitespace-nowrap leading-none drop-shadow-xl">
                    {cat}
                  </h2>
                  <div className="h-[1px] w-full bg-gradient-to-r from-brandRed/50 to-transparent" />
                </div>
                <div className="flex items-center gap-3 text-brandRed font-black uppercase text-[10px] tracking-[0.4em]">
                  <span className="w-8 h-[1px] bg-brandRed" /> Leadership Tier
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 md:gap-8">
                {members.map((member) => (
                  <Link key={member._id} href={`/partners/${member._id}`} className="block h-full">
                    <div className="group h-full relative bg-black/40 border border-white/10 rounded-[32px] p-8 backdrop-blur-md hover:bg-white/[0.02] hover:border-brandRed/40 transition-all duration-500 hover:-translate-y-2 hover:shadow-[0_20px_40px_rgba(255,0,0,0.1)] flex flex-col items-center text-center will-change-transform">
                      
                      <div className="relative w-40 h-40 md:w-44 md:h-44 rounded-full mb-8 p-1 border border-white/10 group-hover:border-brandRed/50 transition-all duration-500 shadow-2xl">
                        <div className="w-full h-full rounded-full overflow-hidden relative bg-zinc-900">
                          <Image 
                            src={member.image || '/about/placeholder.jpeg'}
                            alt={member.name} 
                            fill
                            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                            className="object-cover transition-transform duration-700 md:group-hover:scale-105 saturate-[1.1] grayscale-[10%] group-hover:grayscale-0" 
                          />
                        </div>
                      </div>

                      <div className="space-y-3 flex-1 w-full">
                        <h3 className="text-xl md:text-2xl font-black uppercase italic tracking-tighter group-hover:text-brandRed transition-colors leading-tight truncate px-2">
                          {member.name}
                        </h3>
                        <div className="inline-flex items-center justify-center gap-2 text-[9px] font-bold text-zinc-400 uppercase tracking-widest border-t border-white/5 pt-4 w-full px-2 truncate">
                          <Briefcase size={12} className="text-brandRed shrink-0" /> 
                          <span className="truncate">{member.perk || 'Core Member'}</span>
                        </div>
                      </div>

                      <div className="mt-8 flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.3em] text-zinc-600 group-hover:text-white transition-all">
                        View Profile <ChevronRight size={12} className="group-hover:translate-x-1 group-hover:text-brandRed transition-all" />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}