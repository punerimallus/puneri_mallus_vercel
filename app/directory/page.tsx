"use client";
import { useState, useEffect, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { motion, useScroll, useTransform } from 'framer-motion';
import { createBrowserClient } from '@supabase/ssr';
import { 
  ArrowUpRight, Users, Zap, Flame, Loader2, Search, 
  MapPin, ShieldCheck, Plus, Trash2, MessageCircle, Edit3, ChevronDown, Filter, Briefcase, Crown
} from 'lucide-react';
import TribeConfirm from '@/components/TribeConfirm';

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
  const [user, setUser] = useState<any>(null);
  const [error, setError] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<any>(null);
  const [isMobile, setIsMobile] = useState(false);
  

  const { scrollY } = useScroll();
  const y = useTransform(scrollY, [0, 500], isMobile ? [0, 0] : [0, 150]);

  useEffect(() => {
  const check = () => setIsMobile(window.innerWidth < 768);
  check();
  window.addEventListener('resize', check);
  return () => window.removeEventListener('resize', check);
}, []); 
  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
      try {
        const res = await fetch('/api/mart');
        const data = await res.json();
        setItems(Array.isArray(data) ? data : []);
      } catch (err) { console.error(err);setError(true); } finally { setLoading(false); }
    }
    init();
  }, []);

  const filteredItems = useMemo(() => {
  const query = searchQuery.toLowerCase();
  return items.filter(item => {
    // 🔥 NEW: Only show if Approved OR if the current user is the owner
    const isOwner = user?.email === item.userEmail;
    if (!item.isApproved && !isOwner) return false;
    if (item.isDraft && !isOwner) return false;
    if (item.isApproved === false && !isOwner) return false;
    const matchesSearch = 
      item.name?.toLowerCase().includes(query) || 
      item.description?.toLowerCase().includes(query) ||
      item.area?.toLowerCase().includes(query) ||
      item.category?.toLowerCase().includes(query);
      
    const matchesCategoryDropdown = activeCategory === "ALL" || item.category?.toUpperCase() === activeCategory;
    
    return matchesSearch && matchesCategoryDropdown;
  });
}, [searchQuery, activeCategory, items, user]);

  const handleDeleteExecute = async () => {
    if (!itemToDelete) return;
    try {
      const res = await fetch('/api/mart', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          id: itemToDelete._id, 
          imagePaths: itemToDelete.imagePaths || [itemToDelete.imagePath], 
          userEmail: user.email 
        })
      });
      if (res.ok) {
        setItems(items.filter(i => i._id !== itemToDelete._id));
        setConfirmOpen(false);
        setItemToDelete(null);
      }
    } catch (err) { console.error(err); }
  };

  if (loading) return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <Loader2 className="animate-spin text-brandRed" size={30} strokeWidth={1} />
    </div>
  );
  if (error) return (
  <div className="min-h-screen bg-black flex items-center justify-center">
    <p className="text-brandRed font-black uppercase tracking-widest text-sm">
      Failed to load. Please refresh.
    </p>
  </div>
);
  return (
    <div className="min-h-screen bg-[#030303] text-white relative selection:bg-brandRed/30 overflow-x-hidden">
      
      <TribeConfirm 
        isOpen={confirmOpen}
        title="Purge Protocol"
        message={`Warning: You are about to permanently remove "${itemToDelete?.name}" from the network.`}
        onConfirm={handleDeleteExecute}
        onCancel={() => {setConfirmOpen(false); setItemToDelete(null);}}
      />

      <div
  className="fixed inset-0 z-0 pointer-events-none overflow-hidden"
  style={{
    backgroundImage: 'url(/events/mmart.png)',
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

      <div className="max-w-7xl mx-auto relative z-10 pt-32 md:pt-64 pb-20 px-6">
        
        <div className="flex flex-col md:flex-row justify-between items-start mb-16 gap-8">
          <div className="space-y-6 max-w-2xl">
            <div className="inline-flex items-center gap-3 px-5 py-2 bg-zinc-950/60 backdrop-blur-sm md:backdrop-blur-xl border border-white/10 rounded-full">
              <Zap size={14} className="text-brandRed" />
              <span className="text-[10px] font-black uppercase tracking-[0.4em] text-zinc-400">Business Network</span>
            </div>
            <div className="space-y-2">
                <h1 className="text-6xl md:text-8xl font-black italic uppercase tracking-tighter leading-none">
                Mallu <span className="text-brandRed">Mart .</span>
                </h1>
                <p className="text-zinc-400 text-sm md:text-lg font-medium leading-relaxed max-w-xl italic">
                    The exclusive professional hub for Puneri Mallus. Connect with verified local businesses, skilled professionals, and service providers within our community.
                </p>
            </div>
          </div>

          <Link href="/directory/list" className="w-full md:w-auto">
            <button className="group w-full flex items-center justify-center gap-3 bg-white text-black px-8 py-5 rounded-2xl font-black uppercase text-[11px] tracking-widest hover:bg-brandRed hover:text-white transition-all shadow-2xl active:scale-95">
              <Briefcase size={20} strokeWidth={2.5} className="md:group-hover:scale-110 transition-transform" /> 
              List Business / Profession
            </button>
          </Link>
        </div>

        <div className="mb-20 grid grid-cols-1 md:grid-cols-2 gap-6 bg-zinc-950/40 p-6 rounded-[32px] border border-white/10 backdrop-blur-sm md:backdrop-blur-xl">
          <div className="relative group">
            <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-600 group-focus-within:text-brandRed transition-colors" size={18} />
            <input 
              type="text"
              placeholder="SEARCH BY NAME, CATEGORY, OR AREA..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-black/50 border border-white/10 rounded-2xl py-5 pl-14 pr-6 text-[10px] font-black tracking-widest uppercase focus:border-brandRed outline-none transition-all"
            />
          </div>

          <div className="relative group">
            <Filter className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-600 group-focus-within:text-brandRed transition-colors pointer-events-none" size={18} />
            <select 
              value={activeCategory}
              onChange={(e) => setActiveCategory(e.target.value)}
              className="w-full bg-black/50 border border-white/10 rounded-2xl py-5 pl-14 pr-10 text-[10px] font-black tracking-widest uppercase appearance-none focus:border-brandRed outline-none transition-all cursor-pointer"
            >
              {FIXED_CATEGORIES.map((cat) => (
                <option key={cat} value={cat} className="bg-zinc-900 text-white font-bold">
                  {cat === "ALL" ? "SHOW ALL CATEGORIES" : cat}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-5 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none group-focus-within:text-brandRed" size={18} />
          </div>
        </div>

        {filteredItems.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mb-32">
            {filteredItems.map((item) => (
              <div key={item._id} className={`group relative bg-zinc-950/30 border rounded-[40px] overflow-hidden transition-all duration-500 shadow-2xl backdrop-blur-sm md:backdrop-blur-2xl ${item.isPremium ? 'border-brandRed/60 shadow-[0_0_40px_rgba(255,0,0,0.15)]' : 'border-white/5 hover:border-brandRed/30'}`}>
                
                
                  {/* 🔥 2. DRAFT BADGE (Add this here) */}
  {user?.email === item.userEmail && item.isDraft && (
    <div className="absolute top-20 left-6 z-[40] bg-zinc-800/90 backdrop-blur-md text-amber-400 px-4 py-1.5 rounded-full flex items-center gap-2 text-[8px] font-black uppercase tracking-widest shadow-xl border border-white/5">
      <Edit3 size={12} className="text-amber-400" /> Work in Progress (Draft)
    </div>
  )}
               {/* 🔥 3. PENDING BADGE (Keep your existing pending logic but ensure it doesn't show if it's a draft) */}
  {user?.email === item.userEmail && !item.isApproved && !item.isDraft && (
    <div className="absolute top-20 left-6 z-[40] bg-zinc-950/80 backdrop-blur-md text-white px-4 py-1.5 rounded-full flex items-center gap-2 text-[8px] font-black uppercase tracking-widest shadow-xl animate-pulse">
      <Zap size={12} className="text-brandRed fill-brandRed" /> Pending Approval
    </div>
  )}
                {user?.email === item.userEmail && (
                  <div className="absolute top-6 left-6 z-[40] flex gap-2">
                    <Link href={`/directory/list?edit=${item._id}`} className="p-3 bg-black/60 backdrop-blur-sm md:backdrop-blur-md text-white hover:text-brandRed rounded-xl border border-white/10 transition-all shadow-xl">
                      <Edit3 size={16} />
                    </Link>
                    <button onClick={() => { setItemToDelete(item); setConfirmOpen(true); }} className="p-3 bg-black/60 backdrop-blur-sm md:backdrop-blur-md text-zinc-400 hover:text-brandRed rounded-xl border border-white/10 transition-all shadow-xl">
                      <Trash2 size={16} />
                    </button>
                  </div>
                )}

                {/* PREMIUM TAG */}
                {item.isPremium && (
                  <div className="absolute top-6 right-6 z-[40] bg-brandRed text-white px-4 py-1.5 rounded-full flex items-center gap-2 text-[8px] font-black uppercase tracking-widest shadow-lg">
                    <Crown size={12} /> Premium Partner
                  </div>
                )}

                <Link href={`/directory/${item._id}`} className="block relative w-full h-64 overflow-hidden cursor-pointer">
                  <Image 
                    src={(item.imagePaths && item.imagePaths[0]) ? `https://bhfrgcphqmbocplfcvbg.supabase.co/storage/v1/object/public/mallu-mart/${item.imagePaths[0]}` : (item.imagePath ? `https://bhfrgcphqmbocplfcvbg.supabase.co/storage/v1/object/public/mallu-mart/${item.imagePath}` : "/about/placeholder.jpeg")} 
                    alt={item.name} fill placeholder="blur"
                    blurDataURL={blurPlaceholder}  sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw" className="object-cover md:group-hover:scale-110 transition-all duration-1000"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-transparent to-transparent" />
                  <div className="absolute bottom-6 right-6 bg-zinc-950/80 px-4 py-1.5 rounded-full border border-white/10 flex items-center gap-1.5">
                    <MapPin size={10} className="text-brandRed" />
                    <span className="text-[8px] font-black text-zinc-300 uppercase tracking-widest">{item.area}</span>
                  </div>
                </Link>

                <div className="p-8 space-y-6">
                  <div className="space-y-2">
                    <span className="text-brandRed font-black uppercase text-[9px] tracking-[0.3em] block">{item.category}</span>
                    <h2 className="text-3xl font-black italic uppercase tracking-tighter flex items-center gap-2">
                      {item.name} {item.isVerified && <ShieldCheck size={20} className="text-brandRed" />}
                    </h2>
                  </div>

                  <div className="flex flex-col gap-3">
                    <Link href={`/directory/${item._id}`} className="w-full">
                      <button className="w-full bg-white text-black py-4 rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-brandRed hover:text-white transition-all flex items-center justify-center gap-2">
                        View Profile <ArrowUpRight size={14} />
                      </button>
                    </Link>
                    <a href={`https://wa.me/${item.contact}`} target="_blank" className="w-full bg-zinc-900 border border-white/5 py-4 rounded-2xl font-black uppercase text-[10px] tracking-widest text-center text-zinc-400 hover:text-white transition-all flex items-center justify-center gap-2">
                      <MessageCircle size={14} /> WhatsApp
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="h-96 flex flex-col items-center justify-center border border-white/5 rounded-[40px] bg-zinc-950/20 mb-32 backdrop-blur-sm md:backdrop-blur-md">
            <Search size={40} className="text-zinc-800 mb-4" />
            <p className="text-zinc-500 font-black uppercase tracking-[0.3em] text-[10px]">No partners found</p>
          </div>
        )}

        <div className="text-center mt-20">
          <LaserDivider />
          <div className="flex items-center justify-center gap-12 mt-12 opacity-30 text-[10px] font-black uppercase tracking-[0.5em]">
            <div className="flex items-center gap-3"><Users size={16} /> {filteredItems.length} Partners</div>
            <div className="flex items-center gap-3"><Flame size={16} /> Tribe Pulse</div>
          </div>
        </div>
      </div>
    </div>
  );
}