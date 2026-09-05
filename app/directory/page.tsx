"use client";
import { useState, useEffect, useMemo, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { createBrowserClient } from '@supabase/ssr';
import { 
  ArrowUpRight, Users, Zap, Flame, Loader2, Search, 
  MapPin, ShieldCheck, Trash2, MessageCircle, Edit3, ChevronDown, Filter, Briefcase, Crown
} from 'lucide-react';
import TribeConfirm from '@/components/TribeConfirm';
import TribeDisclaimer from '@/components/TribeDisclaimer';

const FIXED_CATEGORIES = [
  "ALL", "FOOD & BEVERAGE", "REAL ESTATE", "HEALTH & WELLNESS", "EDUCATION", 
  "IT SERVICES", "AUTOMOBILE", "BEAUTY & SALON", "HOME DECOR", 
  "LEGAL & FINANCE", "TRAVEL & TOURISM", "EVENT MANAGEMENT", "OTHER"
];

const LaserDivider = () => (
  <div className="relative w-full h-px flex items-center justify-center overflow-visible my-8">
    <div className="absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-brandRed/40 to-transparent" />
    <div className="absolute w-[30%] h-[2px] bg-brandRed shadow-[0_0_20px_#FF0000] z-10" />
  </div>
);

const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

const shimmer = (w: number, h: number) => `
<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#111"/>
</svg>`;

const toBase64 = (str: string) =>
  typeof window === 'undefined'
    ? Buffer.from(str).toString('base64')
    : window.btoa(str);

const blurPlaceholder = `data:image/svg+xml;base64,${toBase64(shimmer(700, 475))}`;

export default function MalluMartPage() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("ALL");
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [error, setError] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<any>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []); 

  // 🔥 1. FETCH SESSION WITH MASTER KEY DATA
  useEffect(() => {
    const getSession = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: ownerRecords } = await supabase
          .from('directory_owners')
          .select('verified_email, email, phone_number')
          .eq('user_id', user.id)
          .eq('is_verified', true) // 🔥 THE FIX: Ignore unverified rows
          .limit(1);

        const realEmail = ownerRecords?.[0]?.verified_email || ownerRecords?.[0]?.email || user.email;
        const dbPhone = ownerRecords?.[0]?.phone_number || user.phone;
        
        setCurrentUser({ 
          ...user, 
          realEmail,
          dbPhone 
        }); 
      } else {
        setCurrentUser(null);
      }
    };
    getSession();
  }, []);

  // 2. FETCH DIRECTORY ITEMS
  useEffect(() => {
    async function fetchItems() {
      try {
        const res = await fetch('/api/mart');
        const data = await res.json();
        setItems(Array.isArray(data) ? data : []);
      } catch (err) { 
        setError(true); 
      } finally { 
        setLoading(false); 
      }
    }
    fetchItems();
  }, []);

  // 🔥 3. MASTER KEY OWNERSHIP CHECKER
  const checkOwnership = useCallback((item: any) => {
    if (!currentUser) return false;
    
    // 1. Match by unique user ID (For new cards)
    if (item.userId && item.userId === currentUser.id) return true;

    // 2. Match by Phone Number (For OTP users' old cards)
    const userPhone = currentUser.phone?.replace(/\D/g, '') || currentUser.dbPhone?.replace(/\D/g, '');
    if (userPhone && item.contact && userPhone.includes(item.contact)) return true;

    // 3. Match by Email (For Google/Apple users' old cards)
    const realEmail = currentUser.realEmail?.toLowerCase()?.trim(); 
    const authEmail = currentUser.email?.toLowerCase()?.trim();
    const ownerEmail = item.userEmail?.toLowerCase()?.trim();
    
    if (ownerEmail && realEmail && ownerEmail === realEmail) return true;
    if (ownerEmail && authEmail && ownerEmail === authEmail) return true;

    return false;
  }, [currentUser]);

  // 4. FILTERING LOGIC
  const filteredItems = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    
    return items.filter(item => {
      const isOwner = checkOwnership(item);
      
      // Only the owner can see pending or draft items!
      if (!item.isApproved && !isOwner) return false;
      if (item.isDraft && !isOwner) return false;
      
      const safeName = item.name ? String(item.name).toLowerCase() : "";
      const safeArea = item.area ? String(item.area).toLowerCase() : "";
      const safeCategory = item.category ? String(item.category).toLowerCase() : "";

      const matchesSearch = 
        safeName.includes(query) || 
        safeArea.includes(query) ||
        safeCategory.includes(query);
        
      const matchesCategoryDropdown = activeCategory === "ALL" || safeCategory.toUpperCase() === activeCategory;
      return matchesSearch && matchesCategoryDropdown;
    });
  }, [searchQuery, activeCategory, items, checkOwnership]);

  const handleDeleteExecute = async () => {
    // 🔥 Ensure we have the item and a logged-in user
    if (!itemToDelete || !currentUser) return;

    try {
      // 1. Build the query parameters to match what the backend expects
      const params = new URLSearchParams({
        id: itemToDelete._id,
        userEmail: itemToDelete.userEmail || '',
        userId: currentUser.id || ''
      });

      // 2. Send the DELETE request with the parameters in the URL, not the body
      const res = await fetch(`/api/mart?${params.toString()}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        setItems(prev => prev.filter(i => i._id !== itemToDelete._id));
        setConfirmOpen(false);
        setItemToDelete(null);
      } else {
        const errorData = await res.json();
        console.error("Deletion failed:", errorData.error);
        alert(errorData.error || "Unauthorized to delete this listing.");
      }
    } catch (err) { 
        console.error("System error during deletion:", err);
    }
  };

  if (loading) return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-4">
      <Loader2 className="animate-spin text-brandRed" size={30} strokeWidth={1} />
      <p className="text-zinc-500 text-[11px] font-bold uppercase tracking-widest">Loading Directory...</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#030303] text-white relative selection:bg-brandRed/30 overflow-x-hidden">
      
      <TribeConfirm 
        isOpen={confirmOpen}
        title="Delete Business?"
        message={`Are you sure you want to permanently delete "${itemToDelete?.name}" from the directory?`}
        onConfirm={handleDeleteExecute}
        onCancel={() => {setConfirmOpen(false); setItemToDelete(null);}}
      />

      <div
        className="fixed inset-0 z-0 pointer-events-none overflow-hidden"
        style={{
          backgroundImage: 'url(/events/mmart.webp)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          opacity: 0.3,
          filter: 'brightness(0.8)',
          transform: 'translateZ(0)',
          willChange: 'transform',
        }}
      />
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-b from-[#030303] via-transparent to-[#030303] z-[1]" />
      </div>

      <div className="max-w-7xl mx-auto relative z-10 pt-32 md:pt-44 pb-20 px-6">
        
        {/* Header Section */}
        <div className="flex flex-col md:flex-row justify-between items-start mb-10 gap-8">
          <div className="space-y-4 max-w-2xl">
            <div className="inline-flex items-center gap-3 px-5 py-2 bg-zinc-950/60 backdrop-blur-sm md:backdrop-blur-xl border border-white/10 rounded-full">
              <Zap size={14} className="text-brandRed" />
              <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">Business Directory</span>
            </div>
            <div className="space-y-1">
                <h1 className="text-5xl md:text-7xl font-black italic uppercase tracking-tighter leading-none">
                Mallu <span className="text-brandRed">Connect .</span>
                </h1>
                <p className="text-zinc-400 text-xs md:text-sm font-medium leading-relaxed max-w-xl italic">
                    The professional hub for Puneri Mallus. Connect with verified businesses and skilled service providers.
                </p>
            </div>
          </div>

          <Link href="/directory/list" className="w-full md:w-auto">
            <button className="group w-full flex items-center justify-center gap-3 bg-white text-black px-6 py-4 rounded-2xl font-black uppercase text-[11px] tracking-widest hover:bg-brandRed hover:text-white transition-all shadow-2xl active:scale-95">
              <Briefcase size={18} strokeWidth={2.5} /> 
              List Your Business
            </button>
          </Link>
        </div>

        {/* Search & Filter Section */}
        <div className="mb-12 grid grid-cols-1 md:grid-cols-2 gap-4 bg-zinc-950/40 p-4 rounded-[28px] border border-white/10 backdrop-blur-md" style={{ transform: 'translateZ(0)' }}>
          <div className="relative group">
            <label htmlFor="search" className="sr-only">Search Directory</label>
            <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-600 group-focus-within:text-brandRed transition-colors" size={16} />
            <input 
              id="search"
              type="text"
              placeholder="Search by name, area..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-black/50 border border-white/10 rounded-xl py-4 pl-12 pr-6 text-[13px] font-medium transition-all focus:border-brandRed outline-none text-white placeholder:text-zinc-500"
            />
          </div>
          
          <div className="relative group">
            <label htmlFor="categoryFilter" className="sr-only">Filter by Category</label>
            <Filter className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-600 group-focus-within:text-brandRed transition-colors pointer-events-none" size={16} />
            <select 
              id="categoryFilter"
              value={activeCategory}
              onChange={(e) => setActiveCategory(e.target.value)}
              className="w-full bg-black/50 border border-white/10 rounded-xl py-4 pl-12 pr-10 text-[13px] font-bold uppercase tracking-widest appearance-none focus:border-brandRed outline-none transition-all cursor-pointer text-white"
            >
              {FIXED_CATEGORIES.map((cat) => (
                <option key={cat} value={cat} className="bg-zinc-900 text-white font-bold">
                  {cat === "ALL" ? "ALL CATEGORIES" : cat}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-5 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none" size={16} />
          </div>
        </div>
              
        <AnimatePresence mode="wait">
        {filteredItems.length > 0 ? (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mb-32"
          >
            {filteredItems.map((item) => (
              <div 
                key={item._id} 
                className={`group relative border rounded-[40px] overflow-hidden transition-all duration-500 shadow-2xl backdrop-blur-sm md:backdrop-blur-2xl ${item.isPremium ? 'bg-zinc-950/80 border-brandRed/60 shadow-[0_0_40px_rgba(255,0,0,0.15)]' : 'bg-white/[0.03] border-white/5 hover:border-brandRed/30'}`}
                style={{ transform: 'translateZ(0)' }}
              >
                
                {/* --- BADGE SECTION: TOP LEFT --- */}
                <div className="absolute top-6 left-6 z-[45] flex flex-col gap-2 pointer-events-none">
                  {item.isVerified && (
                    <motion.div 
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="bg-brandRed text-white px-4 py-2 rounded-2xl flex items-center gap-2 shadow-[0_0_20px_rgba(255,0,0,0.4)] border border-white/10"
                    >
                      <ShieldCheck size={14} strokeWidth={3} />
                      <span className="text-[10px] font-bold uppercase tracking-widest">Verified</span>
                    </motion.div>
                  )}

                  {checkOwnership(item) && item.isDraft && (
                    <div className="bg-zinc-800/90 backdrop-blur-md text-cyan-400 px-4 py-2 rounded-2xl flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest border border-white/10">
                      <Edit3 size={12} /> Work in Progress
                    </div>
                  )}
                  
                  {checkOwnership(item) && !item.isApproved && !item.isDraft && (
                    <div className="bg-zinc-950/80 backdrop-blur-md text-amber-500 px-4 py-2 rounded-2xl flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest animate-pulse border border-amber-500/20">
                      <Zap size={12} className="text-amber-500 fill-amber-500" /> Review Pending
                    </div>
                  )}
                </div>

                {/* --- OWNER TOOLS: TOP RIGHT --- */}
                {checkOwnership(item) && (
                  <div className="absolute top-6 right-6 z-[45] flex gap-2">
                    <Link href={`/directory/list?edit=${item._id}`} aria-label="Edit listing" className="p-3 bg-black/60 backdrop-blur-md text-white hover:text-brandRed rounded-xl border border-white/10 transition-all shadow-xl">
                      <Edit3 size={16} />
                    </Link>
                    <button onClick={() => { setItemToDelete(item); setConfirmOpen(true); }} aria-label="Delete listing" className="p-3 bg-black/60 backdrop-blur-md text-zinc-400 hover:text-brandRed rounded-xl border border-white/10 transition-all shadow-xl">
                      <Trash2 size={16} />
                    </button>
                  </div>
                )}

                {/* PREMIUM TAG */}
                {item.isPremium && (
                  <div className="absolute top-20 right-6 z-[40] bg-zinc-900/80 backdrop-blur-md text-white px-4 py-2 rounded-2xl flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest border border-brandRed/30">
                    <Crown size={12} className="text-brandRed" /> Premium
                  </div>
                )}

                <Link href={`/directory/${item._id}`} className="block relative w-full h-64 overflow-hidden cursor-pointer">
                  <Image 
                    src={(item.imagePaths && item.imagePaths[0]) ? `https://bhfrgcphqmbocplfcvbg.supabase.co/storage/v1/object/public/mallu-mart/${item.imagePaths[0]}` : (item.imagePath ? `https://bhfrgcphqmbocplfcvbg.supabase.co/storage/v1/object/public/mallu-mart/${item.imagePath}` : "/about/placeholder.jpeg")} 
                    alt={item.name || "Business Image"} fill placeholder="blur"
                    blurDataURL={blurPlaceholder} sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw" className="object-cover md:group-hover:scale-110 transition-transform duration-1000 will-change-transform"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-transparent to-transparent" />
                  <div className="absolute bottom-6 right-6 bg-zinc-950/80 px-4 py-1.5 rounded-full border border-white/10 flex items-center gap-1.5">
                    <MapPin size={10} className="text-brandRed" />
                    <span className="text-[10px] font-bold text-zinc-300 uppercase tracking-widest">{item.area || "Pune"}</span>
                  </div>
                </Link>

                <div className="p-8 space-y-6">
                  <div className="space-y-2">
                    <span className="text-brandRed font-black uppercase text-[10px] tracking-widest block">{item.category || "General"}</span>
                    <h2 className="text-3xl font-black italic uppercase tracking-tighter text-white truncate">
                      {item.name || "Unnamed Business"}
                    </h2>
                  </div>

                  <div className="flex flex-col gap-3">
                    <Link href={`/directory/${item._id}`} className="w-full">
                      <button className="w-full bg-white text-black py-4 rounded-2xl font-black uppercase text-[11px] tracking-widest hover:bg-brandRed hover:text-white transition-all flex items-center justify-center gap-2 shadow-lg active:scale-95">
                        View Profile <ArrowUpRight size={16} />
                      </button>
                    </Link>
                   <a href={`https://wa.me/91${item.whatsapp || item.contact}`} target="_blank" rel="noopener noreferrer" className="w-full bg-zinc-900 border border-white/5 py-4 rounded-2xl font-bold uppercase text-[11px] tracking-widest text-center text-zinc-400 hover:text-white transition-all flex items-center justify-center gap-2">
                      <MessageCircle size={14} /> Contact on WhatsApp
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </motion.div>
        ) : (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-96 flex flex-col items-center justify-center border border-white/5 rounded-[40px] bg-white/[0.03] mb-32 backdrop-blur-md" style={{ transform: 'translateZ(0)' }}>
            <Search size={40} className="text-zinc-600 mb-4" />
            <p className="text-zinc-400 font-bold uppercase tracking-widest text-[11px]">No businesses found.</p>
          </motion.div>
        )}
        </AnimatePresence>

        <div className="text-center mt-20">
          <TribeDisclaimer type="MART" />
          <LaserDivider />
          <div className="flex items-center justify-center gap-12 mt-12 opacity-40 text-[11px] font-bold uppercase tracking-widest">
            <div className="flex items-center gap-3"><Users size={16} /> {filteredItems.length} Registered</div>
            <div className="flex items-center gap-3"><Flame size={16} /> Live Network</div>
          </div>
        </div>
      </div>
    </div>
  );
}