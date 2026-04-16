"use client";
import { useState, useEffect, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { motion, useScroll, useTransform, AnimatePresence } from 'framer-motion';
import { 
  ArrowUpRight, Users, Zap, Flame, Loader2, Search, 
  MapPin, ShieldCheck, ChevronDown, Filter, Plus, Edit3, Clock,Trash2
} from 'lucide-react';
import { WhatsAppTribe } from '@/components/ui/WhatsappTribe';
import { createBrowserClient } from '@supabase/ssr';
import TribeAlert from '@/components/TribeAlert'; 
import TribeConfirm from '@/components/TribeConfirm';
import TribeDisclaimer from '@/components/TribeDisclaimer';
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
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  
  const [circles, setCircles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("ALL");
  const [filterTab, setFilterTab] = useState<"ALL" | "INTERNAL" | "EXTERNAL">("ALL" as any);
  const [isMobile, setIsMobile] = useState(false);
  const [error, setError] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [alertConfig, setAlertConfig] = useState({
  isVisible: false,
  message: '',
  type: 'info' as 'success' | 'error' | 'info'
});
const triggerToast = (message: string, type: 'success' | 'error' | 'info') => {
  setAlertConfig({ isVisible: true, message, type });
};
const handleDelete = async () => {
  if (!deleteId || !currentUser?.email) return;
  setConfirmOpen(false);

  try {
    const res = await fetch('/api/community/delete', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      // Force email to lowercase before sending to API
      body: JSON.stringify({ 
        id: deleteId, 
        userEmail: currentUser.email.toLowerCase() 
      })
    });

    if (res.ok) {
      triggerToast("Community successfully deleted from the Tribe", "success");
      setCircles(prev => prev.filter(c => c._id !== deleteId));
    } else {
      const errorData = await res.json();
      triggerToast(errorData.error || "Deletion failed: Unauthorized", "error");
    }
  } catch (err) {
    triggerToast("System error during deletion", "error");
  } finally {
    setDeleteId(null);
  }
};
  const { scrollY } = useScroll();
  const y = useTransform(scrollY, [0, 500], isMobile ? [0, 0] : [0, 150]);

  // Handle Mobile Responsiveness
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Sync Auth Session
  useEffect(() => {
    const getSession = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setCurrentUser(user);
    };
    getSession();
  }, [supabase]);

  // Fetch Community Data
  useEffect(() => {
    async function fetchCircles() {
      try {
        const res = await fetch('/api/community');
        const data = await res.json();
        setCircles(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error("Failed to load circles:", err);
        setError(true);
      } finally {
        setLoading(false);
      }
    }
    fetchCircles();
  }, []);

  const isExternal = (cat: string) => EXTERNAL_CATEGORIES.includes(cat?.toUpperCase());

  // 🔥 CORE FILTERING LOGIC
  const filteredCircles = useMemo(() => {
    const query = searchQuery.toLowerCase();
    const userEmail = currentUser?.email?.toLowerCase();

    return circles.filter(circle => {
      const ownerEmail = circle.submittedBy?.toLowerCase();
      const isOwner = userEmail && ownerEmail && userEmail === ownerEmail;
      const isApproved = circle.isApproved === true;
      const isDraft = circle.isDraft === true;

      // 🔒 PRIVACY GATE: If Draft or Unapproved, ONLY owner passes
      if ((isDraft || !isApproved) && !isOwner) return false;

      // Search Filter
      const matchesSearch = 
        circle.title?.toLowerCase().includes(query) || 
        circle.area?.toLowerCase().includes(query) ||
        circle.description?.toLowerCase().includes(query);
      
      // Category Dropdown Filter
      const matchesCategoryDropdown = activeCategory === "ALL" || circle.category?.toUpperCase() === activeCategory;
      
      // Tab Filter (Internal vs External)
      let matchesTab = true;
      if (filterTab === "INTERNAL") matchesTab = !isExternal(circle.category);
      if (filterTab === "EXTERNAL") matchesTab = isExternal(circle.category);

      return matchesSearch && matchesCategoryDropdown && matchesTab;
    });
  }, [searchQuery, activeCategory, filterTab, circles, currentUser]);

  // Categories for the filter dropdown
  const dropdownCategories = useMemo(() => {
    const liveCircles = circles.filter(c => c.isApproved && !c.isDraft);
    const cats = liveCircles.map(c => c.category?.toUpperCase() || "TRIBE");
    return ["ALL", ...Array.from(new Set(cats)).sort()];
  }, [circles]); 

  if (loading) return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <Loader2 className="animate-spin text-brandRed" size={30} strokeWidth={1} />
    </div>
  );

  return (
    <div className="min-h-screen bg-[#030303] text-white relative selection:bg-brandRed/30 overflow-x-hidden">
      <WhatsAppTribe />

      {/* Background Atmosphere */}
      <motion.div style={{ y }} className="fixed inset-0 z-0 pointer-events-none overflow-hidden bg-[#030303]">
        <Image 
          src="/events/comm_2.png" 
          alt="Atmosphere" fill priority
          className="object-cover opacity-[0.50] brightness-[0.8] scale-110 saturate-150"
          onError={(e) => { (e.target as HTMLImageElement).src = "/about/placeholder.jpeg"; }} 
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#030303]/60 via-transparent to-[#030303] z-[1]" />
      </motion.div>

      <div className="max-w-7xl mx-auto relative z-10 pt-40 pb-10 px-6">
        {/* Page Title */}
        <div className="text-center mb-10">
          <h1 className="text-4xl md:text-7xl font-black italic uppercase tracking-tighter leading-none">
            Our <span className="text-brandRed">Circles .</span>
          </h1>
        </div>

        {/* Listing Bar */}
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row justify-between items-center mb-8 gap-6 bg-zinc-950/50 backdrop-blur-xl p-6 rounded-[30px] border border-white/10">
          <div className="text-left space-y-1">
            <h3 className="text-lg font-black italic uppercase tracking-tighter text-white">List your <span className="text-brandRed">Organization</span></h3>
            <p className="text-zinc-500 text-[9px] font-bold uppercase tracking-widest">Add Samajams, Temples, or Local Communities to the grid.</p>
          </div>
          <Link href="/community/add" className="w-full md:w-auto">
            <motion.button 
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="w-full md:w-auto flex items-center justify-center gap-3 bg-white text-black px-6 py-3.5 rounded-xl font-black uppercase text-[10px] tracking-widest hover:bg-brandRed hover:text-white transition-all shadow-xl"
            >
              <Plus size={16} strokeWidth={3} /> Add Organization
            </motion.button>
          </Link>
        </div>

        {/* Filter Toolbar */}
        <div className="flex flex-col md:flex-row gap-4 items-center justify-between mb-8">
            <div className="relative flex items-center bg-zinc-950/50 p-1 rounded-xl border border-white/10 w-full md:w-[450px] backdrop-blur-md">
                {TABS.map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setFilterTab(tab.id as any)}
                        className={`relative flex-1 py-2.5 text-[9px] font-black uppercase tracking-widest transition-colors z-10 ${filterTab === tab.id ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                    >
                        {tab.label}
                        <AnimatePresence>
                        {filterTab === tab.id && (
                          <motion.div 
                            layoutId="activeTab"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute inset-0 bg-brandRed rounded-lg -z-10 shadow-[0_0_15px_rgba(255,0,0,0.4)]"
                          />
                        )}
                        </AnimatePresence>
                    </button>
                ))}
            </div>

            <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
                <div className="relative group min-w-[240px]">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600" size={14} />
                    <input 
                        type="text"
                        placeholder="SEARCH..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-zinc-950/40 border border-white/10 rounded-xl py-3.5 pl-10 pr-4 text-[9px] font-black tracking-widest uppercase focus:border-brandRed outline-none transition-all"
                    />
                </div>
                <div className="relative group">
                    <Filter className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none" size={14} />
                    <select 
                        value={activeCategory}
                        onChange={(e) => setActiveCategory(e.target.value)}
                        className="bg-zinc-950/40 border border-white/10 rounded-xl py-3.5 pl-10 pr-10 text-[9px] font-black tracking-widest uppercase appearance-none focus:border-brandRed outline-none cursor-pointer text-white"
                    >
                        {dropdownCategories.map((cat) => (
                            <option key={cat} value={cat} className="bg-zinc-900">{cat}</option>
                        ))}
                    </select>
                </div>
            </div>
        </div>
                        {/* 🔥 STRATEGIC PLACEMENT: Above the Grid */}
<TribeDisclaimer type="COMMUNITY" />
        {/* Community Grid */}
        <AnimatePresence mode="popLayout">
            {filteredCircles.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-20">
                {filteredCircles.map((circle) => (
  <motion.div 
    layout 
    initial={{ opacity: 0, y: 20 }} 
    animate={{ opacity: 1, y: 0 }} 
    exit={{ opacity: 0, scale: 0.95 }}
    key={circle._id} 
    className="group relative bg-zinc-950/30 border border-white/5 rounded-[35px] overflow-hidden transition-all duration-500 hover:border-brandRed/30 shadow-xl backdrop-blur-2xl"
  >
    {/* 🔥 OWNER TOOLS: Edit & Delete */}
{currentUser?.email?.toLowerCase() === circle.submittedBy?.toLowerCase() && (
  <div className="absolute top-6 right-6 z-[50] flex gap-2">
    <Link href={`/community/add?edit=${circle._id}`}>
      <motion.button 
        whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
        className="p-3 bg-zinc-900/90 backdrop-blur-md text-white rounded-2xl border border-white/10 hover:bg-brandRed transition-all shadow-xl"
      >
        <Edit3 size={14} />
      </motion.button>
    </Link>
    <motion.button 
      whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
      onClick={() => {
        setDeleteId(circle._id);
        setConfirmOpen(true);
      }}
      className="p-3 bg-zinc-900/90 backdrop-blur-md text-zinc-400 rounded-2xl border border-white/10 hover:bg-red-600 hover:text-white transition-all shadow-xl"
    >
      <Trash2 size={14} />
    </motion.button>
  </div>
)}

    {/* Status Badges (Shifted left to avoid overlap with owner tools) */}
    <div className="absolute top-6 left-6 z-[40] flex flex-col gap-2">
      {currentUser?.email?.toLowerCase() === circle.submittedBy?.toLowerCase() && circle.isDraft && (
        <div className="bg-zinc-800/90 backdrop-blur-md text-cyan-400 px-4 py-1.5 rounded-full flex items-center gap-2 text-[8px] font-black uppercase tracking-widest border border-white/10 shadow-xl">
          <Edit3 size={12} /> Work in Progress
        </div>
      )}

      {currentUser?.email?.toLowerCase() === circle.submittedBy?.toLowerCase() && !circle.isApproved && !circle.isDraft && (
        <div className="bg-zinc-950/80 backdrop-blur-md text-amber-500 px-4 py-1.5 rounded-full flex items-center gap-2 text-[8px] font-black uppercase tracking-widest animate-pulse border border-amber-500/20 shadow-xl">
          <Clock size={12} className="fill-amber-500" /> Pending Review
        </div>
      )}
    </div>

                    <Link href={`/community/${circle._id}`} className="block relative w-full h-44 overflow-hidden">
                        <Image 
                            src={circle.image || "/about/placeholder.jpeg"} 
                            alt={circle.title} fill  
                            className="object-cover group-hover:scale-110 transition-all duration-1000"
                            onError={(e) => { (e.target as HTMLImageElement).src = "/about/placeholder.jpeg"; }}
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-transparent to-transparent" />
                        <div className="absolute bottom-4 right-4 bg-zinc-950/90 px-3 py-1.5 rounded-full border border-white/10 flex items-center gap-2">
                            <MapPin size={10} className="text-brandRed" />
                            <span className="text-[9px] font-black text-zinc-100 uppercase tracking-widest">{circle.area || "Pune Hub"}</span>
                        </div>
                    </Link>

                    <div className="p-6 space-y-4">
                        <div className="space-y-2">
                            <span className="text-brandRed font-black uppercase text-[9px] tracking-[0.2em] block">
                                {circle.category} {circle.tagline ? `// ${circle.tagline}` : ''}
                            </span>
                            <h2 className="text-xl font-black italic uppercase tracking-tighter flex items-center gap-2 text-white">
                                {circle.title} {circle.isVerified && <ShieldCheck size={18} className="text-brandRed" />}
                            </h2>
                            <p className="text-zinc-400 text-[12px] font-medium leading-relaxed italic line-clamp-2">{circle.description}</p>
                        </div>
                        <div className="pt-1">
                            <Link href={`/community/${circle._id}`} className="block w-full">
                                <button className="w-full bg-white text-black py-3.5 rounded-2xl font-black uppercase text-[9px] tracking-widest hover:bg-brandRed hover:text-white transition-all flex items-center justify-center gap-2 shadow-lg active:scale-95">
                                    {isExternal(circle.category) ? 'Visit Organization' : 'Explore Circle'} <ArrowUpRight size={14} />
                                </button>
                            </Link>
                        </div>
                    </div>
                </motion.div>
                ))}
            </div>
            ) : (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-72 flex flex-col items-center justify-center border border-white/5 rounded-[30px] bg-zinc-950/20 mb-20 backdrop-blur-md">
                    <Search size={30} className="text-zinc-800 mb-3" />
                    <p className="text-zinc-500 font-black uppercase tracking-[0.3em] text-[9px]">No nodes detected</p>
                    <button onClick={() => { setSearchQuery(""); setFilterTab("ALL"); setActiveCategory("ALL"); }} className="mt-3 text-brandRed font-black uppercase text-[8px] hover:underline tracking-widest">Clear Filters</button>
                </motion.div>
            )}
        </AnimatePresence>

        {/* Footer Metrics - Updated to Glowing Red */}
        <div className="text-center mt-20 relative">
          <LaserDivider />
          <div className="flex items-center justify-center gap-8 mt-10">
            {[
              { icon: Users, label: `${filteredCircles.length} ACTIVE COMMUNITY` },
              { icon: Flame, label: "LIVE PULSE" }
            ].map((metric, i) => (
              <div key={i} className="flex items-center gap-3 group">
                <metric.icon size={16} className="text-brandRed animate-pulse shadow-[0_0_15px_rgba(255,0,0,0.5)]" />
                <span className="text-[10px] font-black uppercase tracking-[0.5em] text-brandRed drop-shadow-[0_0_8px_rgba(255,0,0,0.8)]">
                  {metric.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* --- CUSTOM OVERLAYS --- */}
      <TribeConfirm 
        isOpen={confirmOpen}
        title="Purge Node?"
        message="This action will permanently delete this circle from the community grid. This cannot be undone."
        onConfirm={handleDelete}
        onCancel={() => {
          setConfirmOpen(false);
          setDeleteId(null);
        }}
      />

      <TribeAlert 
        isVisible={alertConfig.isVisible}
        message={alertConfig.message}
        type={alertConfig.type}
        onClose={() => setAlertConfig(prev => ({ ...prev, isVisible: false }))}
      />
    </div>
  );
}