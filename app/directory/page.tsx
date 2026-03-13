"use client";
import { useState, useEffect, useMemo, useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { motion, useScroll, useTransform } from 'framer-motion';
import { 
  ArrowUpRight, Users, 
  Zap, Flame, Loader2, Search, Filter, X,
  MessageCircle, MapPin, ShieldCheck, Plus
} from 'lucide-react';

const LaserDivider = () => (
  <div className="relative w-full h-px flex items-center justify-center overflow-visible my-8">
    <div className="absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-brandRed/40 to-transparent" />
    <div className="absolute w-[30%] h-[2px] bg-brandRed shadow-[0_0_20px_#FF0000] z-10" />
  </div>
);

export default function MalluMartPage() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("ALL");
  const [scrolled, setScrolled] = useState(false);

  // Parallax Setup
  const containerRef = useRef(null);
  const { scrollY } = useScroll();
  const y = useTransform(scrollY, [0, 500], [0, 150]); // Move image 150px as we scroll

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 50);
    };
    window.addEventListener('scroll', handleScroll);

    async function fetchMart() {
      try {
        const res = await fetch('/api/mart');
        const data = await res.json();
        setItems(data);
      } catch (err) {
        console.error("Failed to load Mart:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchMart();
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const categories = useMemo(() => {
    const cats = items.map(c => c.category?.toUpperCase() || "TRADE");
    return ["ALL", ...Array.from(new Set(cats)).sort()];
  }, [items]);

  const filteredItems = useMemo(() => {
    return items.filter(item => {
      const matchesSearch = 
        item.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
        item.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.area?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = activeCategory === "ALL" || item.category?.toUpperCase() === activeCategory;
      return matchesSearch && matchesCategory;
    });
  }, [searchQuery, activeCategory, items]);

  if (loading) return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <Loader2 className="animate-spin text-brandRed" size={30} strokeWidth={1} />
    </div>
  );

  return (
    <div ref={containerRef} className="min-h-screen bg-[#030303] text-white relative selection:bg-brandRed/30 overflow-x-hidden">
      
      {/* 1. PARALLAX BRANDED BACKGROUND */}
      <motion.div 
        style={{ y }} 
        className="fixed inset-0 z-0 pointer-events-none overflow-hidden bg-[#030303]"
      >
        <Image 
          src="/events/mmart.png" 
          alt="Branded Atmosphere"
          fill
          priority
          className="object-cover object-center opacity-[0.35] brightness-[0.9] scale-110" 
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#030303] via-transparent to-[#030303] z-[1]" />
        <div className="absolute inset-0 opacity-[0.03] bg-[url('https://grainy-gradients.vercel.app/noise.svg')] mix-blend-overlay z-[2]" />
      </motion.div>

      {/* NOTE FOR NAV: Use the 'scrolled' state here to toggle your navbar background.
          Example: <Navbar isScrolled={scrolled} /> 
      */}

      <div className="max-w-7xl mx-auto relative z-10 pt-40 pb-20 px-6">
        
        {/* HEADER */}
        <div className="flex flex-col md:flex-row justify-between items-center mb-16 gap-8">
          <div className="text-left space-y-4">
            <div className="inline-flex items-center gap-3 px-5 py-2 bg-zinc-950/60 backdrop-blur-xl border border-white/10 rounded-full">
              <Zap size={14} className="text-brandRed" />
              <span className="text-[10px] font-black uppercase tracking-[0.4em] text-zinc-400">
                Tribe // <span className="text-white">Trade</span>
              </span>
            </div>
            <h1 className="text-6xl md:text-8xl font-black italic uppercase tracking-tighter leading-none text-white">
              Mallu <span className="text-brandRed text-glow">Mart .</span>
            </h1>
            <p className="text-zinc-500 font-bold uppercase tracking-[0.5em] text-xs">
              Pune's Malayali Professional Network
            </p>
          </div>

          <Link href="/directory/list">
            <button className="group flex items-center gap-3 bg-white text-black px-8 py-5 rounded-2xl font-black uppercase text-[11px] tracking-widest hover:bg-brandRed hover:text-white transition-all shadow-[0_0_30px_rgba(255,255,255,0.1)] active:scale-95">
              <Plus size={20} strokeWidth={3} className="group-hover:rotate-90 transition-transform" /> 
              List Your Profession
            </button>
          </Link>
        </div>

        {/* SEARCH & FILTER MODULE */}
        <div className="mb-20 space-y-8">
          <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
            <div className="relative w-full md:max-w-md group">
              <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-600 group-focus-within:text-brandRed transition-colors" size={18} />
              <input 
                type="text"
                placeholder="FIND A PROFESSIONAL..."
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

        {/* MART GRID */}
        {filteredItems.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mb-32">
            {filteredItems.map((item) => (
              <div key={item._id} className={`group relative bg-zinc-950/30 border rounded-[40px] overflow-hidden transition-all duration-700 shadow-2xl backdrop-blur-2xl ${item.isPremium ? 'border-brandRed/40 shadow-[0_0_40px_rgba(255,0,0,0.1)]' : 'border-white/5 hover:border-brandRed/20'}`}>
                
                <div className="relative w-full h-64 overflow-hidden z-10">
                  <Image 
                    src={item.imagePath ? `https://bhfrgcphqmbocplfcvbg.supabase.co/storage/v1/object/public/mallu-mart/${item.imagePath}` : "/about/placeholder.jpeg"} 
                    alt={item.name}
                    fill
                    unoptimized
                    className="object-cover group-hover:scale-110 transition-all duration-1000"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/20 to-transparent" />
                  
                  <div className="absolute top-6 right-6 bg-zinc-950/80 px-4 py-1.5 rounded-full border border-white/10 flex items-center gap-1.5">
                    <MapPin size={10} className="text-brandRed" />
                    <span className="text-[8px] font-black text-zinc-300 uppercase tracking-widest">{item.area || "Pune"}</span>
                  </div>
                </div>

                <div className="p-8 space-y-6 relative z-20 text-left">
                  <div className="space-y-2">
                    <span className="text-brandRed font-black uppercase text-[9px] tracking-[0.3em] block">
                      {item.category?.toUpperCase() || "TRADE"} {item.isVerified && "// VERIFIED"}
                    </span>
                    <h2 className="text-3xl font-black italic uppercase tracking-tighter group-hover:text-white transition-colors duration-500 flex items-center gap-2">
                      {item.name}
                      {item.isVerified && <ShieldCheck size={20} className="text-brandRed" />}
                    </h2>
                    <p className="text-zinc-500 text-[12px] font-medium italic leading-relaxed min-h-[40px] group-hover:text-zinc-300 transition-colors line-clamp-2">
                      {item.description}
                    </p>
                  </div>

                  <div className="flex gap-3">
                    <a 
                      href={`tel:${item.contact}`}
                      className="flex-1 bg-white text-black py-4 rounded-2xl font-black uppercase text-[10px] tracking-widest text-center hover:bg-brandRed hover:text-white transition-all active:scale-95 shadow-xl flex items-center justify-center gap-2"
                    >
                      Contact <ArrowUpRight size={14} />
                    </a>
                    
                    <a 
                      href={`https://wa.me/${item.contact}`}
                      target="_blank"
                      className="px-6 bg-zinc-900/50 border border-white/5 rounded-2xl flex items-center justify-center group-hover:border-green-500/30 transition-all hover:bg-green-600/10"
                    >
                       <MessageCircle className="text-zinc-600 group-hover:text-green-500" size={18} />
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="h-96 flex flex-col items-center justify-center border border-white/5 rounded-[40px] bg-zinc-950/20 mb-32 backdrop-blur-md">
            <Search size={40} className="text-zinc-800 mb-4" />
            <p className="text-zinc-500 font-black uppercase tracking-[0.3em] text-[10px]">No partners found in this circle</p>
            <button onClick={() => { setSearchQuery(""); setActiveCategory("ALL"); }} className="mt-4 text-brandRed font-black uppercase text-[9px] hover:underline tracking-widest">Reset Radar</button>
          </div>
        )}

        {/* FOOTER STATS */}
        <div className="text-center">
          <LaserDivider />
          <div className="flex flex-col md:flex-row items-center justify-center gap-12 mt-12 opacity-50">
            <div className="flex items-center gap-3">
              <Users size={16} className="text-brandRed" />
              <span className="text-[10px] font-black uppercase tracking-[0.5em]">{filteredItems.length} Partners Listed</span>
            </div>
            <div className="flex items-center gap-3">
              <Flame size={16} className="text-brandRed" />
              <span className="text-[10px] font-black uppercase tracking-[0.5em]">Tribe Trade Pulse</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}