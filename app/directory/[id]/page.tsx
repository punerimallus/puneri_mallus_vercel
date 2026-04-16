"use client";
import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { motion, AnimatePresence, useScroll, useTransform } from 'framer-motion';
import { createBrowserClient } from '@supabase/ssr';
import { 
  MessageCircle, MapPin, Globe, Instagram, 
  ExternalLink, Maximize2, X, ShieldCheck, Share2, 
  Phone, Star, ChevronRight, Zap, ListChecks, Info, Image as ImageIcon, Clock
} from 'lucide-react';
import { Loader2 } from 'lucide-react';

// --- NEW IMPORT ---
import MartVerificationModal from '@/components/MartVerificationModal';

export default function ProfessionalDetailsPage() {
  const { id } = useParams();
  const router = useRouter();
  const [item, setItem] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [zoomImage, setZoomImage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('overview');
  
  // --- VERIFICATION STATES ---
  const [isVerifyOpen, setIsVerifyOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);

  // Rating Mechanism
  const [userRating, setUserRating] = useState(0);
  const [avgRating, setAvgRating] = useState(3); // Default 3

  const { scrollY } = useScroll();
  const y = useTransform(scrollY, [0, 500], [0, 150]);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // Section Refs
  const overviewRef = useRef<HTMLDivElement>(null);
  const photosRef = useRef<HTMLDivElement>(null);
  const servicesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function fetchDetails() {
      try {
        // Sync Auth Session
        const { data: { user } } = await supabase.auth.getUser();
        setCurrentUser(user);

        const res = await fetch('/api/mart');
        const data = await res.json();
        const found = data.find((i: any) => i._id === id);
        if (found) {
          setItem(found);
          if (found.rating) setAvgRating(found.rating);
        }
      } catch (err) { console.error(err); } finally { setLoading(false); }
    }
    fetchDetails();
  }, [id, supabase]);

  if (loading) return <div className="min-h-screen bg-black flex items-center justify-center"><Loader2 className="animate-spin text-brandRed" size={40} /></div>;
  if (!item) return <div className="min-h-screen bg-black flex flex-col items-center justify-center text-white"><h1>Profile Not Found</h1><Link href="/directory" className="px-6 py-3 bg-brandRed rounded-lg font-bold text-sm uppercase">Return</Link></div>;

  const images = item.imagePaths || (item.imagePath ? [item.imagePath] : []);
  const thumbnail = images[0];
  const gallery = images.slice(1, 7);

  const tabs = [
    { id: 'overview', label: 'Overview', icon: Info, ref: overviewRef },
    { id: 'photos', label: 'Photos', icon: ImageIcon, ref: photosRef },
    { id: 'services', label: 'Services', icon: ListChecks, ref: servicesRef },
  ];

  const scrollToSection = (ref: any, id: string) => {
    setActiveTab(id);
    const offset = 180; // Offset for the sticky tab bar
    const elementPosition = ref.current?.getBoundingClientRect().top + window.pageYOffset;
    window.scrollTo({
      top: elementPosition - offset,
      behavior: 'smooth'
    });
  };

  return (
    <div className="min-h-screen bg-[#030303] text-zinc-100 relative overflow-x-hidden selection:bg-brandRed/30">
      
      {/* 1. BACKGROUND PARALLAX */}
      <motion.div style={{ y }} className="fixed inset-0 z-0 pointer-events-none overflow-hidden bg-[#030303]">
        <Image src="/events/mmart.png" alt="BG" fill priority className="object-cover opacity-[0.2] brightness-[0.7] scale-110" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#030303] via-transparent to-[#030303] z-[1]" />
      </motion.div>

      {/* 2. MAIN CONTENT */}
      <main className="max-w-7xl mx-auto px-6 pt-44 pb-32 relative z-10">
        
        {/* HEADER SECTION */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 mb-8 items-start">
          
          <div className="lg:col-span-4 relative aspect-square rounded-[32px] overflow-hidden border border-white/10 bg-zinc-900 shadow-2xl group">
            <Image 
              src={`https://bhfrgcphqmbocplfcvbg.supabase.co/storage/v1/object/public/mallu-mart/${thumbnail}`}
              alt={item.name} fill priority unoptimized className="object-cover"
            />
            <button 
              onClick={() => navigator.share({title: item.name, url: window.location.href})}
              className="absolute top-4 right-4 p-3 bg-black/60 backdrop-blur-md rounded-full text-white hover:bg-brandRed transition-all z-20"
            >
              <Share2 size={18} />
            </button>

            {item.isVerified && (
              <div className="absolute top-4 left-4 bg-brandRed text-white px-3 py-1 rounded-full flex items-center gap-1.5 text-[8px] font-black uppercase tracking-widest">
                <ShieldCheck size={10} /> Verified
              </div>
            )}
          </div>

          <div className="lg:col-span-8 flex flex-col justify-center space-y-6">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-brandRed/10 border border-brandRed/20 rounded-lg">
                <Zap size={12} className="text-brandRed" />
                <span className="text-[9px] font-black uppercase tracking-[0.3em] text-brandRed">{item.category}</span>
              </div>
              
              <h1 className="text-5xl md:text-7xl font-black text-white italic uppercase tracking-tighter leading-none">
                {item.name}
              </h1>
              
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1 bg-zinc-900 px-3 py-1.5 rounded-xl border border-white/5">
                    <span className="text-yellow-500 font-black text-sm">{avgRating.toFixed(1)}</span>
                    <div className="flex items-center">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          onMouseEnter={() => setUserRating(star)}
                          onMouseLeave={() => setUserRating(0)}
                          onClick={() => setAvgRating((avgRating + star) / 2)}
                          className="transition-transform hover:scale-110"
                        >
                          <Star 
                            size={16} 
                            fill={star <= (userRating || avgRating) ? "#EAB308" : "none"} 
                            className={star <= (userRating || avgRating) ? "text-yellow-500" : "text-zinc-600"}
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                  <span className="text-[9px] font-black uppercase text-zinc-500 tracking-widest italic">Rate this professional</span>
                </div>

                {/* UPDATED: INCREASED LOCATION SIZE AND VISIBILITY */}
                <div className="flex items-center gap-4 text-zinc-100 font-black uppercase tracking-[0.3em] text-[12px] sm:text-sm">
                    <MapPin size={18} className="text-brandRed" />
                    {item.area}
                </div>
                {/* ADDED: OPERATING HOURS DISPLAY */}
                {(item.openTime || item.closeTime) && (
                  <div className="flex items-center gap-4 text-zinc-400 font-black uppercase tracking-[0.2em] text-[10px] sm:text-[11px] border-l-0 sm:border-l border-white/10 sm:pl-10">
                      <Clock size={16} className="text-brandRed" />
                      <span>{item.openTime} — {item.closeTime}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 w-full pt-2">
              {/* 1. WHATSAPP BUTTON - Green & Full Width on Mobile */}
              <a 
                href={`https://wa.me/91${item.contact?.toString().replace(/\D/g,'')}`} 
                target="_blank" 
                className="w-full sm:flex-1 flex items-center justify-center gap-3 bg-[#25D366] text-white h-16 sm:h-20 rounded-2xl font-black uppercase text-[12px] sm:text-xs tracking-[0.2em] hover:bg-white hover:text-[#25D366] border border-[#25D366]/20 transition-all shadow-xl active:scale-95"
              >
                <MessageCircle size={22} fill="currentColor" /> 
                <span>Chat on WhatsApp</span>
              </a>

              {/* 2. CALL BUTTON - Semi-transparent & Full Width on Mobile */}
              <a 
                href={`tel:${item.contact}`} 
                className="w-full sm:w-auto sm:px-12 flex items-center justify-center gap-3 bg-zinc-900/50 backdrop-blur-md text-white h-16 sm:h-20 rounded-2xl font-black uppercase text-[12px] sm:text-xs tracking-[0.2em] border border-white/10 hover:border-brandRed transition-all active:scale-95"
              >
                <Phone size={20} /> 
                <span>Call Now</span>
              </a>
            </div>
          </div>
        </div>

        {/* --- OWNER VERIFICATION TRIGGER --- */}
        {currentUser?.email === item.userEmail && !item.isVerified && item.verificationStatus !== 'PENDING' && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-10 p-6 md:p-8 rounded-[40px] bg-brandRed/10 border border-brandRed/20 backdrop-blur-xl flex flex-col md:flex-row items-center justify-between gap-6 overflow-hidden relative"
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-brandRed/10 blur-[80px] pointer-events-none" />
            <div className="flex items-center gap-6 relative z-10">
              <div className="p-4 bg-brandRed rounded-[24px] shadow-[0_0_30px_rgba(255,0,0,0.4)] flex items-center justify-center shrink-0">
                <ShieldCheck className="text-white" size={32} />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-black uppercase tracking-widest text-white italic">
                  Trust Protocol <span className="text-brandRed">Required</span>
                </h4>
                <p className="text-[14px] font-bold text-zinc-400 uppercase tracking-tighter leading-tight max-w-md">
                  Initialize your business audit by uploading your Shop Act and Identity documents to earn the verified badge.
                </p>
              </div>
            </div>
            
            <button 
              onClick={() => setIsVerifyOpen(true)}
              className="w-full md:w-auto px-10 py-4 bg-white text-black text-[11px] font-black uppercase tracking-[0.2em] rounded-2xl hover:bg-brandRed hover:text-white transition-all active:scale-95 shadow-2xl relative z-10"
            >
              Initialize Audit
            </button>
          </motion.div>
        )}

        {/* --- PENDING STATUS INDICATOR --- */}
        {currentUser?.email === item.userEmail && item.verificationStatus === 'PENDING' && (
          <div className="mb-10 p-6 rounded-[32px] bg-zinc-900/50 border border-amber-500/20 flex items-center gap-4">
            <Clock className="text-amber-500 animate-pulse" size={20} />
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
              Audit in Progress // Document verification is currently being processed by the Tribe Moderator.
            </span>
          </div>
        )}

        {/* TAB BAR */}
        <div className="sticky top-[100px] z-[40] mb-12 bg-black/60 backdrop-blur-xl border-y border-white/5 mx-[-1.5rem] px-6">
          <div className="flex items-center gap-8 overflow-x-auto no-scrollbar py-4">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => scrollToSection(tab.ref, tab.id)}
                className={`flex items-center gap-2 whitespace-nowrap text-[10px] font-black uppercase tracking-[0.2em] transition-all relative py-2 ${
                  activeTab === tab.id ? 'text-brandRed' : 'text-zinc-500 hover:text-white'
                }`}
              >
                <tab.icon size={14} />
                {tab.label}
                {activeTab === tab.id && (
                  <motion.div layoutId="activeTabUnderline" className="absolute -bottom-4 left-0 right-0 h-1 bg-brandRed shadow-[0_0_10px_#FF0000]" />
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
          <div className="lg:col-span-8 space-y-16">
            
            {/* Overview Section */}
            <section ref={overviewRef} className="bg-zinc-950/40 backdrop-blur-md border border-white/5 p-10 rounded-[40px] space-y-6 scroll-mt-24">
              <h2 className="text-xs font-black text-white uppercase tracking-[0.3em] flex items-center gap-3">
                <div className="w-10 h-px bg-brandRed/50" />
                Company Profile
              </h2>
              <p className="text-zinc-300 text-lg leading-relaxed italic border-l-2 border-brandRed/30 pl-8 whitespace-pre-wrap break-words">
                {item.description}
              </p>
            </section>

            {/* Services Section */}
            {item.services && item.services.length > 0 && (
              <section ref={servicesRef} className="space-y-8 scroll-mt-24">
                <h2 className="text-xs font-black text-white uppercase tracking-[0.3em] flex items-center gap-3">
                  <div className="w-10 h-px bg-brandRed/50" />
                  Services Offered
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {item.services.map((service: any, idx: number) => (
                    <div key={idx} className="bg-zinc-900/50 p-6 rounded-3xl border border-white/5 group hover:border-brandRed/30 transition-all">
                      <div className="flex items-start gap-4">
                        <div className="w-8 h-8 rounded-full bg-brandRed/10 flex items-center justify-center text-brandRed font-black text-[10px] shrink-0">
                          {idx + 1}
                        </div>
                        <div className="space-y-1">
                          <h4 className="text-sm font-black uppercase text-white tracking-tight">{service.name}</h4>
                          <p className="text-[13px] text-zinc-100 leading-relaxed italic">{service.desc}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Photo Gallery */}
            {gallery.length > 0 && (
              <section ref={photosRef} className="space-y-8 scroll-mt-24">
                <h2 className="text-xs font-black text-white uppercase tracking-[0.3em] flex items-center gap-3">
                  <div className="w-10 h-px bg-brandRed/50" />
                  Portfolio Gallery
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {gallery.map((img: string, idx: number) => (
                    <div 
                      key={idx} 
                      onClick={() => setZoomImage(`https://bhfrgcphqmbocplfcvbg.supabase.co/storage/v1/object/public/mallu-mart/${img}`)}
                      className="relative aspect-square rounded-[30px] border border-white/10 cursor-zoom-in group bg-zinc-900"
                    >
                      <Image src={`https://bhfrgcphqmbocplfcvbg.supabase.co/storage/v1/object/public/mallu-mart/${img}`} alt="Work" fill unoptimized className="object-cover opacity-90 rounded-[30px] group-hover:opacity-100 transition-all duration-700" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 rounded-[30px] group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <Maximize2 size={24} className="text-white" />
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* STICKY SIDEBAR */}
          <aside className="lg:col-span-4 sticky top-44">
            <div className="bg-zinc-950 border border-white/10 p-10 rounded-[45px] space-y-10 shadow-3xl">
              <div className="space-y-8">
                <div className="flex gap-5">
                  <div className="w-12 h-12 bg-zinc-900 rounded-2xl flex items-center justify-center shrink-0 border border-white/5 text-brandRed">
                    <MapPin size={24} />
                  </div>
                  <div>
                    <p className="text-[9px] text-zinc-500 font-black uppercase tracking-widest mb-1">Location</p>
                    <p className="text-sm text-zinc-200 font-bold uppercase">{item.area}</p>
                    {item.mapUrl && <a href={item.mapUrl} target="_blank" className="text-[10px] text-brandRed font-black mt-3 inline-flex items-center gap-1 hover:underline tracking-widest uppercase">Navigation Link <ExternalLink size={12} /></a>}
                  </div>
                </div>

                <div className="flex gap-5">
                  <div className="w-12 h-12 bg-zinc-900 rounded-2xl flex items-center justify-center shrink-0 border border-white/5 text-brandRed">
                    <Globe size={24} />
                  </div>
                  <div className="flex flex-col gap-2 flex-1">
                    <p className="text-[9px] text-zinc-500 font-black uppercase tracking-widest mb-1">Web Protocol</p>
                    {item.website && (
                      <a 
                        href={item.website} 
                        target="_blank" 
                        className="text-xs text-zinc-200 font-bold break-all hover:text-brandRed transition-colors flex items-center gap-2"
                      >
                        {item.website.replace(/^https?:\/\//, '')} 
                        <ExternalLink size={12} />
                      </a>
                    )}
                    <div className="flex flex-wrap gap-4 items-center mt-2">
                      {item.instagram && <a href={`https://instagram.com/${item.instagram}`} target="_blank" className="text-zinc-400 hover:text-brandRed transition-colors scale-125"><Instagram size={24} /></a>}
                    </div>
                  </div>
                </div>

                {item.buttonText && item.buttonUrl && (
                  <a href={item.buttonUrl} target="_blank" className="flex items-center justify-center bg-brandRed text-white w-full py-5 rounded-2xl font-black uppercase text-[10px] tracking-[0.2em] shadow-lg hover:scale-105 transition-all">
                    {item.buttonText}
                  </a>
                )}
              </div>
            </div>
          </aside>
        </div>
      </main>

      {/* LIGHTBOX OVERLAY */}
      <AnimatePresence>
        {zoomImage && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setZoomImage(null)} className="fixed inset-0 z-[1000] bg-black/98 flex items-center justify-center p-8 cursor-zoom-out">
            <div className="relative w-full max-w-6xl h-full flex items-center justify-center"><Image src={zoomImage} alt="Zoomed" fill unoptimized className="object-contain" /></div>
            <button className="absolute top-10 right-10 text-white p-4 bg-zinc-900 rounded-full hover:bg-brandRed transition-all"><X size={32} /></button>
          </motion.div>
        )}
      </AnimatePresence>

      <MartVerificationModal 
        isOpen={isVerifyOpen}
        onClose={() => setIsVerifyOpen(false)}
        businessId={item._id}
        businessName={item.name}
        userEmail={currentUser?.email || ''}
      />
    </div>
  );
}