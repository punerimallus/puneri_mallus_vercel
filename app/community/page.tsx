"use client";
import { useState, useEffect, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { 
  Music, Sparkles, ArrowUpRight, Users, 
  Zap, Flame, Loader2, Search, Filter, X,
  Dumbbell, Utensils, Laptop, Camera, MessageCircle
} from 'lucide-react';

const LaserDivider = () => (
  <div className="relative w-full h-px flex items-center justify-center overflow-visible my-8">
    <div className="absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-brandRed/40 to-transparent" />
    <div className="absolute w-[30%] h-[2px] bg-brandRed shadow-[0_0_20px_#FF0000] z-10" />
  </div>
);

const CategoryIcon = ({ category }: { category: string }) => {
  const cat = category?.toUpperCase();
  if (cat?.includes('MUSIC') || cat?.includes('JAM')) return <Music size={20} />;
  if (cat?.includes('SPORT') || cat?.includes('FIT')) return <Dumbbell size={20} />;
  if (cat?.includes('FOOD') || cat?.includes('EAT')) return <Utensils size={20} />;
  if (cat?.includes('TECH') || cat?.includes('DEV')) return <Laptop size={20} />;
  if (cat?.includes('PHOTO') || cat?.includes('ART')) return <Camera size={20} />;
  return <Sparkles size={20} />;
};

export default function CommunityPage() {
  const [circles, setCircles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("ALL");

  useEffect(() => {
    async function fetchCircles() {
      try {
        const res = await fetch('/api/community');
        const data = await res.json();
        setCircles(data);
      } catch (err) {
        console.error("Failed to load circles:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchCircles();
  }, []);

  const categories = useMemo(() => {
    const cats = circles.map(c => c.category?.toUpperCase() || "TRIBE");
    return ["ALL", ...Array.from(new Set(cats))];
  }, [circles]);

  const filteredCircles = useMemo(() => {
    return circles.filter(circle => {
      const matchesSearch = 
        circle.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
        circle.description.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = activeCategory === "ALL" || circle.category?.toUpperCase() === activeCategory;
      return matchesSearch && matchesCategory;
    });
  }, [searchQuery, activeCategory, circles]);

  if (loading) return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <Loader2 className="animate-spin text-brandRed" size={30} strokeWidth={1} />
    </div>
  );

  return (
    <div className="min-h-screen bg-[#030303] text-white relative selection:bg-brandRed/30 overflow-x-hidden">
      
      {/* 1. FIXED BRANDED BACKGROUND - TUNED OPACITY (0.38) */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden bg-black">
        <Image 
          src="/events/community.jpg" 
          alt="Branded Atmosphere"
          fill
          priority
          className="object-cover object-center opacity-[0.38] brightness-[1.0] saturate-[1.15] contrast-[1.05]" 
        />
        <div className="absolute inset-0 bg-gradient-radial from-transparent via-zinc-950/20 to-[#030303] z-[1]" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#030303] z-[1]" />
        <div className="absolute inset-0 opacity-[0.04] bg-[url('https://grainy-gradients.vercel.app/noise.svg')] mix-blend-overlay z-[2]" />
      </div>

      <div className="max-w-7xl mx-auto relative z-10 pt-40 pb-20 px-6">
        
        {/* HEADER */}
        <div className="text-center mb-16 space-y-6">
          <div className="inline-flex items-center gap-3 px-5 py-2 bg-zinc-950/60 backdrop-blur-xl border border-white/10 rounded-full">
            <Zap size={14} className="text-brandRed" />
            <span className="text-[10px] font-black uppercase tracking-[0.4em] text-zinc-400">
              Community // <span className="text-white">Circle</span>
            </span>
          </div>
          <h1 className="text-6xl md:text-9xl font-black italic uppercase tracking-tighter leading-none text-white text-glow">
            Our <span className="text-brandRed">Circles .</span>
          </h1>
          <p className="text-zinc-500 font-bold uppercase tracking-[0.5em] text-sm md:text-xl">
            Diverse Interests . One Soul
          </p>
        </div>

        {/* SEARCH & FILTER MODULE */}
        <div className="mb-20 space-y-8">
          <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
            <div className="relative w-full md:max-w-md group">
              <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-600 group-focus-within:text-brandRed transition-colors" size={18} />
              <input 
                type="text"
                placeholder="FIND YOUR INTEREST..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-zinc-950/40 border border-white/10 rounded-2xl py-5 pl-14 pr-6 text-[10px] font-black tracking-widest uppercase focus:outline-none focus:border-brandRed/50 transition-all placeholder:text-zinc-700 backdrop-blur-xl"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery("")} className="absolute right-5 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-white">
                  <X size={16} />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-2 w-full md:w-auto">
              <Filter size={14} className="text-brandRed shrink-0 mr-2" />
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`px-6 py-3 rounded-xl text-[9px] font-black uppercase tracking-widest whitespace-nowrap transition-all border ${
                    activeCategory === cat 
                    ? 'bg-brandRed border-brandRed text-white shadow-[0_0_20px_rgba(255,0,0,0.3)]' 
                    : 'bg-zinc-950/40 border-white/10 text-zinc-500 hover:text-white backdrop-blur-md'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* MAIN WHATSAPP CARD */}
        <div className="relative group mb-12">
          <div className="absolute -inset-1 bg-gradient-to-r from-brandRed via-red-900 to-brandRed rounded-[40px] blur-xl opacity-20 group-hover:opacity-40 transition duration-1000 group-hover:duration-200"></div>
          <div className="relative flex flex-col md:flex-row items-center justify-between gap-8 bg-zinc-950/50 backdrop-blur-3xl border border-white/10 rounded-[40px] p-8 md:p-12 overflow-hidden shadow-2xl">
            <div className="absolute top-0 right-0 w-64 h-64 bg-brandRed/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 group-hover:bg-brandRed/10 transition-colors" />
            <div className="flex-1 space-y-6 relative z-10 text-left">
              <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-brandRed/10 border border-brandRed/20 rounded-full">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brandRed opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-brandRed"></span>
                </span>
                <span className="text-[9px] font-black uppercase tracking-[0.3em] text-brandRed">Join The Pulse</span>
              </div>
              <h2 className="text-4xl md:text-5xl font-black italic uppercase tracking-tighter leading-none">
                The Official <span className="text-brandRed">Tribe</span> HQ
              </h2>
              <p className="text-zinc-400 text-xs md:text-sm font-bold uppercase tracking-widest leading-relaxed max-w-xl">
                Enter the main heart of Puneri Mallus. Get instant updates, exclusive invites, and connect with the entire Tribe in one tap.
              </p>
            </div>
            <div className="shrink-0 relative z-10 w-full md:w-auto">
              <Link 
                href="https://chat.whatsapp.com/Bzi4uYF4wCo5YNa5qKKBfN" 
                target="_blank"
                className="w-full md:w-auto px-10 py-6 bg-white text-black rounded-3xl font-black uppercase text-[12px] tracking-[0.2em] flex items-center justify-center gap-4 hover:bg-brandRed hover:text-white transition-all duration-500 shadow-[0_0_30px_rgba(255,255,255,0.1)] active:scale-95"
              >
                <MessageCircle size={20} fill="currentColor" />
                Join WhatsApp Community
              </Link>
            </div>
          </div>
        </div>

        {/* CIRCLES GRID */}
        {filteredCircles.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10 mb-32">
            {filteredCircles.map((circle) => (
              <div key={circle._id} className="group relative bg-zinc-950/30 border border-white/5 rounded-[40px] overflow-hidden transition-all duration-700 hover:border-brandRed/40 shadow-2xl backdrop-blur-2xl">
                <div className="absolute -inset-px bg-gradient-radial from-brandRed/15 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none z-0" />
                <div className="relative w-full h-80 overflow-hidden z-10">
                  <Image 
                    src={circle.image || "/about/placeholder.jpeg"} 
                    alt={circle.title}
                    fill
                    className="object-cover grayscale group-hover:grayscale-0 group-hover:scale-110 transition-all duration-1000"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/20 to-transparent" />
                  <div className="absolute top-8 left-8 bg-brandRed p-4 rounded-2xl shadow-2xl z-20 group-hover:scale-110 group-hover:rotate-6 transition-all duration-500 border border-white/10">
                    <CategoryIcon category={circle.category} />
                  </div>
                </div>
                <div className="p-10 space-y-8 relative z-20 text-left">
                  <div className="space-y-3">
                    <span className="text-brandRed font-black uppercase text-[10px] tracking-[0.3em] block">
                      {circle.category?.toUpperCase() || "TRIBE"} // {circle.tagline}
                    </span>
                    <h2 className="text-4xl font-black italic uppercase tracking-tighter group-hover:text-white transition-colors duration-500">
                      {circle.title}
                    </h2>
                    <p className="text-zinc-500 text-[13px] font-medium italic leading-relaxed min-h-[48px] group-hover:text-zinc-300 transition-colors">
                      {circle.description}
                    </p>
                  </div>
                  <div className="flex gap-4">
                    {circle.link && circle.link.trim() !== "" ? (
                      <Link 
                        href={circle.link} 
                        target="_blank" 
                        className="flex-1 bg-white text-black py-5 rounded-2xl font-black uppercase text-[11px] tracking-widest text-center hover:bg-brandRed hover:text-white transition-all active:scale-95 shadow-xl flex items-center justify-center gap-2"
                      >
                        Join Circle <ArrowUpRight size={14} />
                      </Link>
                    ) : (
                      <div className="flex-1 py-5 rounded-2xl border border-white/5 bg-white/10 text-zinc-600 font-black uppercase text-[11px] tracking-widest text-center italic cursor-default">
                        Invitations Paused
                      </div>
                    )}
                    <div className="px-6 bg-zinc-900/50 border border-white/5 rounded-2xl flex items-center justify-center group-hover:border-brandRed/20 transition-all group-hover:bg-brandRed/10">
                       <Users className="text-zinc-600 group-hover:text-brandRed" size={18} />
                    </div>
                  </div>
                </div>
                <div className="absolute top-6 right-6 opacity-0 group-hover:opacity-100 transition-all duration-500 translate-y-2 group-hover:translate-y-0 pointer-events-none">
                  <ArrowUpRight className="text-brandRed" size={20} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="h-96 flex flex-col items-center justify-center border border-white/5 rounded-[40px] bg-zinc-950/20 mb-32 backdrop-blur-md">
            <Search size={40} className="text-zinc-800 mb-4" />
            <p className="text-zinc-500 font-black uppercase tracking-[0.3em] text-[10px]">No Circles found</p>
            <button onClick={() => { setSearchQuery(""); setActiveCategory("ALL"); }} className="mt-4 text-brandRed font-black uppercase text-[9px] hover:underline tracking-widest">Reset Radar</button>
          </div>
        )}

        {/* FOOTER STATS */}
        <div className="text-center">
          <LaserDivider />
          <div className="flex flex-col md:flex-row items-center justify-center gap-12 mt-12 opacity-50">
            <div className="flex items-center gap-3">
              <Users size={16} className="text-brandRed" />
              <span className="text-[10px] font-black uppercase tracking-[0.5em]">{filteredCircles.length} Circles Active</span>
            </div>
            <div className="flex items-center gap-3">
              <Flame size={16} className="text-brandRed" />
              <span className="text-[10px] font-black uppercase tracking-[0.5em]">Tribe Pulse Active</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}