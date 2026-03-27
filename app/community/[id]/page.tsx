"use client";
import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { motion, AnimatePresence, useScroll, useTransform } from 'framer-motion';
import { 
  MessageCircle, MapPin, Globe, Instagram, 
  ExternalLink, Maximize2, X, ShieldCheck, Share2, 
  Zap, ListChecks, Info, Image as ImageIcon, Loader2
} from 'lucide-react';

export default function OrganizationDetailsPage() {
  const { id } = useParams();
  const [item, setItem] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [zoomImage, setZoomImage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('overview');
  
  const { scrollY } = useScroll();
  const y = useTransform(scrollY, [0, 500], [0, 150]);

  const overviewRef = useRef<HTMLDivElement>(null);
  const photosRef = useRef<HTMLDivElement>(null);
  const servicesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function fetchDetails() {
      try {
        const res = await fetch(`/api/community?id=${id}`);
        const data = await res.json();
        if (data && !data.error) setItem(data);
      } catch (err) { console.error(err); } finally { setLoading(false); }
    }
    fetchDetails();
  }, [id]);

  if (loading) return <div className="min-h-screen bg-black flex items-center justify-center"><Loader2 className="animate-spin text-brandRed" size={30} /></div>;
  if (!item) return <div className="min-h-screen bg-black flex flex-col items-center justify-center text-white"><h1>Node Not Found</h1><Link href="/community" className="mt-4 px-6 py-2 bg-brandRed rounded-full text-xs font-black uppercase">Back to Community</Link></div>;

  const allImages = item.imagePaths && item.imagePaths.length > 0 ? item.imagePaths : [item.image];
  const thumbnail = allImages[0];

  const tabs = [
    { id: 'overview', label: 'Identity', icon: Info, ref: overviewRef },
    { id: 'services', label: 'Services', icon: ListChecks, ref: servicesRef },
    { id: 'photos', label: 'Gallery', icon: ImageIcon, ref: photosRef },
  ];

  const scrollToSection = (ref: any, id: string) => {
    setActiveTab(id);
    const offset = 180;
    const elementPosition = ref.current?.getBoundingClientRect().top + window.pageYOffset;
    window.scrollTo({ top: elementPosition - offset, behavior: 'smooth' });
  };

  const getWhatsAppLink = () => {
    if (item.contact && item.contact.length === 10) return `https://wa.me/91${item.contact}`;
    return item.link || "#";
  };

  return (
    <div className="min-h-screen bg-[#030303] text-zinc-100 relative overflow-x-hidden selection:bg-brandRed/30">
      
      {/* 1. FIXED BRANDED BACKGROUND */}
      <motion.div style={{ y }} className="fixed inset-0 z-0 pointer-events-none overflow-hidden bg-black">
        <Image 
          src="/events/comm_2.png" 
          alt="Atmosphere" 
          fill 
          priority 
          className="object-cover opacity-[0.40] brightness-[0.7] scale-110 saturate-[1.2]" 
        />
        {/* Deep gradient for text readability */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#030303]/60 via-transparent to-[#030303] z-[1]" />
        {/* Grainy Noise Overlay for consistency */}
        <div className="absolute inset-0 opacity-[0.03] bg-[url('https://grainy-gradients.vercel.app/noise.svg')] mix-blend-overlay z-[2]" />
      </motion.div>

      <main className="max-w-7xl mx-auto px-6 pt-40 pb-32 relative z-10">
        
        {/* HEADER SECTION */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 mb-16 items-start">
          
          <div className="lg:col-span-4 relative aspect-square rounded-[40px] overflow-hidden border border-white/10 bg-zinc-900 shadow-2xl group">
            <Image src={thumbnail || "/about/placeholder.jpeg"} alt={item.title} fill priority unoptimized className="object-cover" />
            <button onClick={() => navigator.share({title: item.title, url: window.location.href})} className="absolute top-4 right-4 p-3 bg-black/60 backdrop-blur-md rounded-full text-white hover:bg-brandRed transition-all z-20">
              <Share2 size={16} />
            </button>
            {item.isVerified && (
              <div className="absolute top-4 left-4 bg-brandRed text-white px-3 py-1 rounded-full flex items-center gap-1.5 text-[8px] font-black uppercase tracking-widest shadow-lg">
                <ShieldCheck size={10} /> Verified Member
              </div>
            )}
          </div>

          <div className="lg:col-span-8 flex flex-col justify-center space-y-8 pt-4">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-brandRed/15 border border-brandRed/30 rounded-full backdrop-blur-md">
                <Zap size={14} className="text-brandRed" />
                <span className="text-[10px] font-black uppercase tracking-[0.25em] text-brandRed">{item.category}</span>
              </div>
              <h1 className="text-5xl md:text-7xl font-black text-white italic uppercase tracking-tighter leading-[0.95]">{item.title}</h1>
              <p className="text-zinc-400 font-bold uppercase tracking-[0.6em] text-[11px] pl-1 border-l-2 border-brandRed">{item.tagline || "Community Pillar"}</p>
              
              <div className="flex items-center gap-3 text-zinc-500 font-black uppercase tracking-[0.2em] text-[10px] pt-2">
                <MapPin size={16} className="text-brandRed" /> {item.area || "Pune Metropolitan"}
              </div>
            </div>

            {/* TWO PRIMARY BUTTONS */}
            <div className="flex flex-col sm:flex-row gap-4 max-w-2xl w-full pt-4">
              {/* 1. WHATSAPP / DIRECT CONNECT BUTTON - Optimized for visibility */}
              <a 
                href={getWhatsAppLink()} 
                target="_blank" 
                className="w-full sm:flex-1 flex items-center justify-center gap-3 bg-[#25D366] text-white h-16 sm:h-20 rounded-2xl font-black uppercase text-[12px] sm:text-sm tracking-[0.2em] hover:bg-white hover:text-[#25D366] border border-[#25D366]/20 transition-all shadow-xl active:scale-95"
              >
                <MessageCircle size={24} fill="currentColor" /> 
                {item.contact ? 'Direct Connect' : 'Join Whatsapp'}
              </a>

              {/* 2. OFFICIAL LINK BUTTON */}
              {item.website && (
                <a 
                  href={item.website} 
                  target="_blank" 
                  className="w-full sm:w-auto sm:px-12 flex items-center justify-center gap-3 bg-zinc-900 border border-white/10 text-white h-16 sm:h-20 rounded-2xl font-black uppercase text-[12px] sm:text-sm tracking-[0.2em] hover:border-brandRed transition-all"
                >
                  <Globe size={24} /> Official Link
                </a>
              )}
            </div>
          </div>
        </div>

        {/* TAB BAR */}
        <div className="sticky top-[90px] z-[40] mb-16 bg-black/50 backdrop-blur-2xl border-y border-white/5 mx-[-1.5rem] px-6">
          <div className="flex items-center gap-10 overflow-x-auto no-scrollbar py-5">
            {tabs.map((tab) => (
              <button key={tab.id} onClick={() => scrollToSection(tab.ref, tab.id)} className={`flex items-center gap-2 whitespace-nowrap text-[10px] font-black uppercase tracking-[0.25em] transition-all relative py-1 ${activeTab === tab.id ? 'text-brandRed' : 'text-zinc-500 hover:text-white'}`}>
                <tab.icon size={16} /> {tab.label}
                {activeTab === tab.id && <motion.div layoutId="activeTabUnderline" className="absolute -bottom-5 left-0 right-0 h-0.5 bg-brandRed shadow-[0_0_15px_#FF0000]" />}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
          <div className="lg:col-span-8 space-y-20">
            
            {/* 1. IDENTITY NARRATIVE */}
            <section ref={overviewRef} className="bg-zinc-950/40 border border-white/5 p-10 md:p-14 rounded-[50px] space-y-8 scroll-mt-24">
              <h2 className="text-[10px] font-black text-white uppercase tracking-[0.4em] flex items-center gap-4">
                <div className="w-12 h-px bg-brandRed" /> The Vision
              </h2>
              <p className="text-zinc-200 text-lg md:text-xl leading-relaxed italic font-medium border-l-4 border-brandRed/30 pl-10 whitespace-pre-wrap break-words">
                {item.description}
              </p>
            </section>

            {/* 2. OFFERINGS */}
            {item.services && item.services.length > 0 && (
              <section ref={servicesRef} className="space-y-12 scroll-mt-24">
                <h2 className="text-[10px] font-black text-white uppercase tracking-[0.4em] flex items-center gap-4 pl-2">
                  <div className="w-12 h-px bg-brandRed" /> Offerings & Impact
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {item.services.map((s: any, idx: number) => (
                    <div key={idx} className="bg-zinc-900/40 p-8 rounded-[40px] border border-white/5 hover:border-brandRed/40 transition-all group">
                      <div className="flex items-start gap-6">
                        <div className="w-12 h-12 rounded-2xl bg-brandRed/10 flex items-center justify-center text-brandRed font-black text-sm shrink-0 group-hover:bg-brandRed group-hover:text-white transition-all">
                          {idx + 1}
                        </div>
                        <div className="space-y-3">
                            <h4 className="text-sm md:text-base font-black uppercase text-white tracking-widest leading-tight">{s.name}</h4>
                            {s.desc && (
                                <p className="text-xs md:text-sm text-zinc-400 leading-relaxed italic">
                                    {s.desc}
                                </p>
                            )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* 3. GALLERY */}
            <section ref={photosRef} className="space-y-10 scroll-mt-24">
              <h2 className="text-[10px] font-black text-white uppercase tracking-[0.4em] flex items-center gap-4 pl-2">
                <div className="w-12 h-px bg-brandRed" /> Archive & Visuals
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                {allImages.map((img: string, idx: number) => (
                  <div key={idx} onClick={() => setZoomImage(img)} className="relative aspect-square rounded-[40px] border border-white/5 cursor-zoom-in group bg-zinc-900 overflow-hidden shadow-2xl">
                    <Image src={img} alt="Gallery" fill unoptimized className="object-cover opacity-80 group-hover:opacity-100 group-hover:scale-110 transition-all duration-700" />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <Maximize2 size={24} className="text-white" />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* SIDEBAR - STATS REMOVED */}
          <aside className="lg:col-span-4 sticky top-44">
            <div className="bg-zinc-950 border border-white/10 p-10 rounded-[50px] space-y-12 shadow-3xl">
              <div className="space-y-10">
                <div className="flex gap-5">
                  <div className="w-12 h-12 bg-zinc-900 rounded-2xl flex items-center justify-center shrink-0 border border-white/5 text-brandRed">
                    <MapPin size={24} />
                  </div>
                  <div>
                    <p className="text-[9px] text-zinc-500 font-black uppercase tracking-widest mb-1">Base</p>
                    <p className="text-sm text-zinc-100 font-bold uppercase">{item.area || "Pune Central"}</p>
                    {item.mapUrl && <a href={item.mapUrl} target="_blank" className="text-[10px] text-brandRed font-black mt-3 inline-flex items-center gap-1.5 hover:underline tracking-widest uppercase">View Location <ExternalLink size={12} /></a>}
                  </div>
                </div>

                <div className="flex gap-5">
                  <div className="w-12 h-12 bg-zinc-900 rounded-2xl flex items-center justify-center shrink-0 border border-white/5 text-brandRed">
                    <Globe size={24} />
                  </div>
                  <div className="flex flex-wrap gap-5 items-center pt-1">
                    {item.instagram && (
                      <a href={`https://instagram.com/${item.instagram.replace('@','')}`} target="_blank" className="text-zinc-400 hover:text-brandRed transition-all hover:scale-125">
                        <Instagram size={28} />
                      </a>
                    )}
                    {item.website && (
                      <a href={item.website} target="_blank" className="text-zinc-400 hover:text-brandRed transition-all hover:scale-125">
                        <Globe size={28} />
                      </a>
                    )}
                    {(item.link || item.contact) && (
                      <a href={getWhatsAppLink()} target="_blank" className="text-zinc-400 hover:text-brandRed transition-all hover:scale-125">
                        <MessageCircle size={28} />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </main>

      <AnimatePresence>
        {zoomImage && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setZoomImage(null)} className="fixed inset-0 z-[1000] bg-black/98 flex items-center justify-center p-8 cursor-zoom-out">
            <div className="relative w-full max-w-5xl h-full flex items-center justify-center">
              <Image src={zoomImage} alt="Zoomed" fill unoptimized className="object-contain" />
            </div>
            <button className="absolute top-8 right-8 text-white p-4 bg-zinc-900/80 rounded-full hover:bg-brandRed transition-all"><X size={28} /></button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}