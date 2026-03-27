"use client";
import { useState, useEffect, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { motion, useScroll, useTransform, AnimatePresence } from 'framer-motion';
import { 
  ArrowUpRight, Users, Zap, Flame, Loader2, Search, 
  MapPin, ShieldCheck, MessageCircle, ChevronDown, Filter
} from 'lucide-react';

const EXTERNAL_CATEGORIES = ["SAMAJAM", "TEMPLE", "CHURCH", "ORGANIZATION"];
const TABS = [
    { id: "ALL", label: "All Circles" },
    { id: "INTERNAL", label: "Tribe Circles" },
    { id: "EXTERNAL", label: "Organizations" }
];

const LaserDivider = () => (
  <div className="relative w-full h-px flex items-center justify-center overflow-visible my-4">
    <div className="absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-brandRed/40 to-transparent" />
    <div className="absolute w-[30%] h-[2px] bg-brandRed shadow-[0_0_20px_#FF0000] z-10" />
  </div>
);

export default function CommunityPage() {
  const [circles, setCircles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("ALL");
  const [filterTab, setFilterTab] = useState<"ALL" | "INTERNAL" | "EXTERNAL">("ALL" as any);
  const [userInteracted, setUserInteracted] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  const { scrollY } = useScroll();
  const y = useTransform(scrollY, [0, 500], [0, 150]);

  // Handle Mobile Detection
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    async function fetchCircles() {
      try {
        const res = await fetch('/api/community');
        const data = await res.json();
        setCircles(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error("Failed to load circles:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchCircles();
  }, []);

  // --- AUTO SLIDE LOGIC (DISABLED ON MOBILE) ---
  useEffect(() => {
    // Only run the interval if NOT mobile and NO user interaction
    if (userInteracted || loading || isMobile) return;
    
    const interval = setInterval(() => {
      setFilterTab((prev) => {
        const currentIndex = TABS.findIndex(t => t.id === prev);
        const nextIndex = (currentIndex + 1) % TABS.length;
        return TABS[nextIndex].id as any;
      });
    }, 3000);
    return () => clearInterval(interval);
  }, [userInteracted, loading, isMobile]);

  const handleTabClick = (tabId: string) => {
    setUserInteracted(true);
    setFilterTab(tabId as any);
    setActiveCategory("ALL");
  };

  const isExternal = (cat: string) => EXTERNAL_CATEGORIES.includes(cat?.toUpperCase());

  const filteredCircles = useMemo(() => {
    const query = searchQuery.toLowerCase();
    return circles.filter(circle => {
      const matchesSearch = 
        circle.title?.toLowerCase().includes(query) || 
        circle.description?.toLowerCase().includes(query) ||
        circle.area?.toLowerCase().includes(query);
      
      const matchesCategoryDropdown = activeCategory === "ALL" || circle.category?.toUpperCase() === activeCategory;
      
      let matchesTab = true;
      if (filterTab === "INTERNAL") matchesTab = !isExternal(circle.category);
      if (filterTab === "EXTERNAL") matchesTab = isExternal(circle.category);

      return matchesSearch && matchesCategoryDropdown && matchesTab;
    });
  }, [searchQuery, activeCategory, filterTab, circles]);

  const dropdownCategories = useMemo(() => {
    const subset = circles.filter(c => {
        if (filterTab === "INTERNAL") return !isExternal(c.category);
        if (filterTab === "EXTERNAL") return isExternal(c.category);
        return true;
    });
    const cats = subset.map(c => c.category?.toUpperCase() || "TRIBE");
    return ["ALL", ...Array.from(new Set(cats)).sort()];
  }, [circles, filterTab]);

  if (loading) return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <Loader2 className="animate-spin text-brandRed" size={30} strokeWidth={1} />
    </div>
  );

  return (
    <div className="min-h-screen bg-[#030303] text-white relative selection:bg-brandRed/30 overflow-x-hidden">
      
      <motion.div style={{ y }} className="fixed inset-0 z-0 pointer-events-none overflow-hidden bg-[#030303]">
        <Image 
          src="/events/comm_2.png" 
          alt="Atmosphere" fill priority
          className="object-cover opacity-[0.50] brightness-[0.8] scale-110 saturate-150" 
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#030303]/60 via-transparent to-[#030303] z-[1]" />
      </motion.div>

      <div className="max-w-7xl mx-auto relative z-10 pt-32 pb-10 px-6">
        
        <div className="text-center mb-10 space-y-4">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-zinc-950/60 backdrop-blur-xl border border-white/10 rounded-full">
            <Zap size={12} className="text-brandRed" />
            <span className="text-[9px] font-black uppercase tracking-[0.3em] text-zinc-400">The Social Grid</span>
          </div>
          <h1 className="text-5xl md:text-7xl font-black italic uppercase tracking-tighter leading-none">
            Our <span className="text-brandRed">Circles .</span>
          </h1>
        </div>

        {/* MAIN HQ CARD */}
        <div className="relative group mb-10 max-w-4xl mx-auto">
          <div className="absolute -inset-1 bg-gradient-to-r from-brandRed via-red-900 to-brandRed rounded-[30px] blur-lg opacity-10 group-hover:opacity-25 transition duration-1000"></div>
          <div className="relative flex flex-col md:flex-row items-center justify-between gap-6 bg-zinc-950/70 backdrop-blur-3xl border border-white/10 rounded-[30px] p-6 md:p-8 overflow-hidden shadow-2xl">
            <div className="flex-1 space-y-2 text-left">
              <h2 className="text-2xl md:text-3xl font-black italic uppercase tracking-tighter">
                Official <span className="text-brandRed">Tribe</span> HQ
              </h2>
              <p className="text-zinc-400 text-[11px] font-bold uppercase tracking-widest leading-relaxed">
                Connect with the core community in one tap.
              </p>
            </div>
            <Link 
              href="https://chat.whatsapp.com/Bzi4uYF4wCo5YNa5qKKBfN" target="_blank"
              className="w-full md:w-auto px-8 py-4 bg-white text-black rounded-xl font-black uppercase text-[10px] tracking-[0.2em] flex items-center justify-center gap-3 hover:bg-brandRed hover:text-white transition-all shadow-xl active:scale-95"
            >
              <MessageCircle size={16} fill="currentColor" />
              Join WhatsApp HQ
            </Link>
          </div>
        </div>

        {/* FILTERS */}
        <div className="flex flex-col md:flex-row gap-4 items-center justify-between mb-10">
            <div className="relative flex items-center bg-zinc-950/50 p-1 rounded-xl border border-white/10 w-full md:w-[450px] backdrop-blur-md">
                {TABS.map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => handleTabClick(tab.id)}
                        className={`relative flex-1 py-2.5 text-[9px] font-black uppercase tracking-widest transition-colors z-10 ${filterTab === tab.id ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                    >
                        {tab.label}
                        {filterTab === tab.id && (
                            <motion.div 
                                layoutId="activeTab"
                                className="absolute inset-0 bg-brandRed rounded-lg -z-10 shadow-[0_0_10px_rgba(255,0,0,0.3)]"
                                transition={{ type: "spring", bounce: 0.1, duration: 0.5 }}
                            />
                        )}
                    </button>
                ))}
            </div>

            <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
                <div className="relative group min-w-[240px]">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600 group-focus-within:text-brandRed" size={14} />
                    <input 
                        type="text"
                        placeholder="SEARCH..."
                        value={searchQuery}
                        onChange={(e) => { setSearchQuery(e.target.value); setUserInteracted(true); }}
                        className="w-full bg-zinc-950/40 border border-white/10 rounded-xl py-3.5 pl-10 pr-4 text-[9px] font-black tracking-widest uppercase focus:border-brandRed outline-none transition-all"
                    />
                </div>

                <div className="relative group">
                    <Filter className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none" size={14} />
                    <select 
                        value={activeCategory}
                        onChange={(e) => { setActiveCategory(e.target.value); setUserInteracted(true); }}
                        className="bg-zinc-950/40 border border-white/10 rounded-xl py-3.5 pl-10 pr-10 text-[9px] font-black tracking-widest uppercase appearance-none focus:border-brandRed outline-none cursor-pointer min-w-[160px]"
                    >
                        {dropdownCategories.map((cat) => (
                            <option key={cat} value={cat} className="bg-zinc-900 text-white">{cat}</option>
                        ))}
                    </select>
                    <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none" size={14} />
                </div>
            </div>
        </div>

        {/* GRID */}
<AnimatePresence mode="popLayout">
    {filteredCircles.length > 0 ? (
    <motion.div layout className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mb-20">
        {filteredCircles.map((circle) => (
        <motion.div 
            layout initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
            key={circle._id} 
            className="group relative bg-zinc-950/30 border border-white/5 rounded-[40px] overflow-hidden transition-all duration-500 hover:border-brandRed/30 shadow-xl backdrop-blur-2xl"
        >
            <Link href={`/community/${circle._id}`} className="block relative w-full h-56 overflow-hidden cursor-pointer">
                <Image 
                    src={circle.image || "/about/placeholder.jpeg"} 
                    alt={circle.title} fill unoptimized 
                    className="object-cover group-hover:scale-110 transition-all duration-1000"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-transparent to-transparent" />
                
                <div className="absolute bottom-4 right-4 bg-zinc-950/90 px-4 py-1.5 rounded-full border border-white/10 flex items-center gap-2 backdrop-blur-md">
                    <MapPin size={12} className="text-brandRed" />
                    <span className="text-[10px] font-black text-zinc-100 uppercase tracking-widest">
                        {circle.area || "Pune Hub"}
                    </span>
                </div>
            </Link>

            {/* CONTENT SECTION - Restored stable layout */}
            <div className="p-8 space-y-6">
                <div className="space-y-3">
                    {/* ABOVE HEADER */}
                    <span className="text-brandRed font-black uppercase text-[10px] sm:text-[11px] tracking-[0.2em] block">
                        {circle.category} {circle.tagline ? `// ${circle.tagline}` : ''}
                    </span>

                    {/* HEADER */}
                    <h2 className="text-2xl sm:text-3xl font-black italic uppercase tracking-tighter flex items-center gap-2 text-white leading-tight">
                        {circle.title} {circle.isVerified && <ShieldCheck size={20} className="text-brandRed" />}
                    </h2>

                    {/* BELOW HEADER */}
                    <p className="text-zinc-300 text-[13px] sm:text-[14px] font-medium leading-relaxed italic line-clamp-2">
                        {circle.description}
                    </p>
                </div>

                {/* BUTTON - Using mt-4 as a buffer */}
                <div className="pt-2">
                    <Link href={`/community/${circle._id}`} className="block w-full">
                        <button className="w-full bg-white text-black py-4 rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-brandRed hover:text-white transition-all flex items-center justify-center gap-2 shadow-lg active:scale-95">
                            {isExternal(circle.category) ? 'Visit Organization' : 'Explore Circle'} <ArrowUpRight size={14} />
                        </button>
                    </Link>
                </div>
            </div>
        </motion.div>
        ))}
    </motion.div>
    ) : (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-72 flex flex-col items-center justify-center border border-white/5 rounded-[30px] bg-zinc-950/20 mb-20 backdrop-blur-md">
                <Search size={30} className="text-zinc-800 mb-3" />
                <p className="text-zinc-500 font-black uppercase tracking-[0.3em] text-[9px]">No nodes detected</p>
                <button onClick={() => { setSearchQuery(""); setFilterTab("ALL"); setActiveCategory("ALL"); }} className="mt-3 text-brandRed font-black uppercase text-[8px] hover:underline tracking-widest">Clear Filters</button>
            </motion.div>
            )}
        </AnimatePresence>

        <div className="text-center mt-10">
          <LaserDivider />
          <div className="flex items-center justify-center gap-8 mt-6 opacity-20 text-[8px] font-black uppercase tracking-[0.4em]">
            <div className="flex items-center gap-2"><Users size={14} /> {filteredCircles.length} Active Nodes</div>
            <div className="flex items-center gap-2"><Flame size={14} /> Live Pulse</div>
          </div>
        </div>
      </div>
    </div>
  );
}