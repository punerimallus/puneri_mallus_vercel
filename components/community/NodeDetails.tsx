"use client";
import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { motion, AnimatePresence, useScroll, useTransform } from 'framer-motion';
import { 
  MessageCircle, MapPin, Globe, Instagram, 
  ExternalLink, Maximize2, X, ShieldCheck, Share2, 
  Zap, ListChecks, Info, Image as ImageIcon, Loader2, Clock, ChevronRight, Users, Link as LinkIcon, Phone
} from 'lucide-react';

interface NodeDetailsProps {
  isAdminView?: boolean;
}

export default function NodeDetails({ isAdminView = false }: NodeDetailsProps) {
  const { id } = useParams();
  const [item, setItem] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [zoomImage, setZoomImage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [isMobile, setIsMobile] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false); // For Read More logic
  
  const { scrollY } = useScroll();
  const y = useTransform(scrollY, [0, 500], isMobile ? [0, 0] : [0, 150]);

  const overviewRef = useRef<HTMLDivElement>(null);
  const photosRef = useRef<HTMLDivElement>(null);
  const servicesRef = useRef<HTMLDivElement>(null);
  const membersRef = useRef<HTMLDivElement>(null); 
  const [error, setError] = useState(false);

  useEffect(() => {
    async function fetchDetails() {
      try {
        const res = await fetch(`/api/community?id=${id}`);
        const data = await res.json();
        if (data && !data.error) setItem(data);
      } catch (err) { 
        console.error(err);
        setError(true); 
      } finally { 
        setLoading(false); 
      }
    }
    if (id) fetchDetails();
  }, [id]);
  
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  if (loading) return <div className="min-h-screen bg-black flex items-center justify-center"><Loader2 className="animate-spin text-brandRed" size={30} /></div>;
  
  if (error || !item) return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center text-white">
      <p className="text-brandRed font-black uppercase tracking-widest text-sm">Node Not Found</p>
      <Link href="/community" className="mt-4 px-6 py-2 bg-brandRed rounded-full text-xs font-black uppercase">Back to Community</Link>
    </div>
  );

  const allImages = item.imagePaths && item.imagePaths.length > 0 ? item.imagePaths : [item.image];
  const thumbnail = allImages[0];
  const gallery = allImages.slice(1);

  const tabs = [
    { id: 'overview', label: 'Identity', icon: Info, ref: overviewRef },
    { id: 'services', label: 'Services', icon: ListChecks, ref: servicesRef },
    ...(Array.isArray(item.members) && item.members.length > 0 ? [{ id: 'members', label: 'Members', icon: Users, ref: membersRef }] : []),
    { id: 'photos', label: 'Gallery', icon: ImageIcon, ref: photosRef },
  ];

  const scrollToSection = (ref: any, id: string) => {
    setActiveTab(id);
    const offset = 180;
    const elementPosition = ref.current?.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: elementPosition - offset, behavior: 'smooth' });
  };

  const getWhatsAppLink = () => {
    const waNumber = item.whatsapp || item.contact;
    if (waNumber && waNumber.length === 10) return `https://wa.me/91${waNumber}`;
    return item.link || "#"; 
  };

  const formatTime = (time: string) => {
    if (!time) return null;
    if (time.toUpperCase().includes('AM') || time.toUpperCase().includes('PM')) return time;
    try {
      const [hours, minutes] = time.split(':');
      const h = parseInt(hours);
      const ampm = h >= 12 ? 'PM' : 'AM';
      const hours12 = h % 12 || 12;
      return `${hours12}:${minutes} ${ampm}`;
    } catch { return time; }
  };
 
  return (
    <div className="min-h-screen bg-[#030303] text-zinc-100 relative overflow-x-hidden selection:bg-brandRed/30">
      
      {isAdminView && (
        <div className="fixed top-0 left-0 right-0 z-[100] bg-cyan-500 text-black p-2 text-center font-black uppercase tracking-widest text-[10px]">
          Admin Moderation Mode: Preview
        </div>
      )}

      {/* 1. BACKGROUND PARALLAX */}
      <motion.div style={{ y }} className="fixed inset-0 z-0 pointer-events-none overflow-hidden bg-black">
        <Image 
          src="/events/comm_2.png" 
          alt="Atmosphere" 
          fill 
          priority 
          quality={60} // 🔥 Lowered quality for massive speed boost
          sizes="100vw" 
          className="object-cover opacity-[0.25] brightness-[0.7] scale-110 saturate-[1.2]" 
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#030303]/60 via-transparent to-[#030303] z-[1]" />
      </motion.div>

      <main className="max-w-7xl mx-auto px-6 pt-44 pb-32 relative z-10">
        
        {/* COMPACT HEADER BLOCK */}
        <div className="bg-zinc-950/40 backdrop-blur-2xl border border-white/5 p-8 rounded-[40px] mb-10 shadow-3xl">
          <div className="flex flex-col md:flex-row gap-10 justify-center items-center md:items-start">
            
            <div className="w-32 h-32 md:w-44 md:h-44 relative rounded-[32px] overflow-hidden border border-white/10 bg-zinc-900 shadow-2xl shrink-0 transition-all duration-500 hover:scale-105">
              <Image 
                src={thumbnail || "/about/placeholder.jpeg"} 
                alt={item.title} 
                fill 
                priority 
                sizes="(max-width: 768px) 128px, 176px" // 🔥 Explicit sizes
                quality={80}
                className="object-cover" 
              />
            </div>

            <div className="flex-1 space-y-6 w-full flex flex-col items-center text-center md:items-start md:text-left">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 w-full">
                <div className="space-y-2 flex flex-col items-center md:items-start w-full md:w-auto">
                  <div className="inline-flex items-center gap-2 px-3 py-1 bg-brandRed/10 border border-brandRed/20 rounded-lg">
                    <Zap size={12} className="text-brandRed" />
                    <span className="text-[9px] font-black uppercase tracking-[0.3em] text-brandRed">{item.category}</span>
                  </div>
                  <h1 className="text-3xl md:text-5xl font-black text-white italic uppercase tracking-tighter leading-none flex items-center gap-2">
                    {item.title} {item.isVerified && <ShieldCheck size={24} className="text-brandRed inline-block ml-2" />}
                  </h1>
                  <p className="text-zinc-500 font-bold uppercase tracking-[0.4em] text-[10px] italic">{item.tagline || "Community Pillar"}</p>
                </div>

                {/* ACTION BUTTONS */}
                <div className="flex items-center gap-3">
                  <a href={getWhatsAppLink()} target="_blank" className="p-4 bg-[#25D366]/10 text-[#25D366] rounded-2xl border border-[#25D366]/20 hover:bg-[#25D366] hover:text-white transition-all shadow-xl" title="Contact on WhatsApp">
                    <MessageCircle size={20} />
                  </a>
                  
                  {item.contact && (
                    <a href={`tel:${item.contact}`} className="p-4 bg-zinc-900 text-white rounded-2xl border border-white/10 hover:border-brandRed transition-all shadow-xl" title="Call Directly">
                      <Phone size={20} />
                    </a>
                  )}

                  <button onClick={() => navigator.share({title: item.title, url: window.location.href})} className="p-4 bg-zinc-900 text-white rounded-2xl border border-white/10 hover:border-brandRed transition-all shadow-xl" title="Share">
                    <Share2 size={20} />
                  </button>
                </div>
              </div>

              {/* LOCATION & DESCRIPTION */}
              <div className="space-y-4 flex flex-col items-center md:items-start w-full md:w-auto">
                <div className="flex flex-wrap items-center justify-center md:justify-start gap-6 w-full md:w-auto">
                  <div className="flex items-center gap-2 text-zinc-100 font-black uppercase tracking-[0.2em] text-[11px]">
                    <MapPin size={16} className="text-brandRed" />
                    {item.area || "Pune Metropolitan"}
                  </div>
                  {(item.openTime || item.closeTime) && (
                    <div className="flex items-center gap-2 text-zinc-500 font-black uppercase tracking-[0.2em] text-[10px]">
                      <Clock size={16} className="text-brandRed" />
                      <span>{formatTime(item.openTime)} — {formatTime(item.closeTime)}</span>
                    </div>
                  )}
                </div>

                <div className="relative max-w-3xl w-full">
                  <p className={`text-zinc-400 text-base leading-relaxed italic md:border-l-2 border-brandRed/30 md:pl-6 whitespace-pre-wrap break-words ${!isExpanded ? 'line-clamp-2' : ''}`}>
                    {item.description}
                  </p>
                  {!isExpanded && item.description?.length > 120 && (
                    <button onClick={() => setIsExpanded(true)} className="mt-3 text-brandRed font-black uppercase text-[10px] tracking-widest flex items-center justify-center md:justify-start gap-2 hover:gap-3 transition-all w-full md:w-auto">
                      Read Vision <ChevronRight size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* TAB BAR */}
        <div className="sticky top-[100px] z-[40] mb-12 bg-black/60 backdrop-blur-xl border-y border-white/5 mx-[-1.5rem] px-6">
          <div className="flex items-center gap-8 overflow-x-auto no-scrollbar py-4">
            {tabs.map((tab) => (
              <button key={tab.id} onClick={() => scrollToSection(tab.ref, tab.id)} className={`flex items-center gap-2 whitespace-nowrap text-[10px] font-black uppercase tracking-[0.2em] transition-all relative py-2 ${activeTab === tab.id ? 'text-brandRed' : 'text-zinc-500 hover:text-white'}`}>
                <tab.icon size={14} /> {tab.label}
                {activeTab === tab.id && <motion.div layoutId="activeTabUnderline" className="absolute -bottom-4 left-0 right-0 h-1 bg-brandRed shadow-[0_0_10px_#FF0000]" />}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-16 items-start">
          <div className="lg:col-span-8 space-y-20">
            
            {/* VISION NARRATIVE */}
            <section ref={overviewRef} className="bg-zinc-950/40 border border-white/5 p-10 md:p-14 rounded-[50px] space-y-8 scroll-mt-44 shadow-2xl">
              <h2 className="text-xs font-black text-white uppercase tracking-[0.4em] flex items-center gap-4">
                <div className="w-12 h-px bg-brandRed" /> Detailed Narrative
              </h2>
              <p className="text-zinc-200 text-lg md:text-xl leading-relaxed italic font-medium border-l-4 border-brandRed/30 pl-10 whitespace-pre-wrap break-words">
                {item.description}
              </p>
            </section>

            {/* SERVICES SECTION */}
            <section ref={servicesRef} className="space-y-10 scroll-mt-44">
              <h2 className="text-xs font-black text-white uppercase tracking-[0.4em] flex items-center gap-4 pl-2">
                <div className="w-12 h-px bg-brandRed" /> Community Offerings
              </h2>
              {item.services && item.services.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {item.services.map((s: any, idx: number) => (
                    <div key={idx} className="bg-zinc-900/40 p-8 rounded-[32px] border border-white/5 hover:border-brandRed/30 transition-all group shadow-xl">
                      <div className="flex items-start gap-5">
                        <div className="w-10 h-10 rounded-full bg-brandRed/10 flex items-center justify-center text-brandRed font-black text-xs shrink-0 border border-brandRed/20">{idx + 1}</div>
                        <div className="space-y-2">
                          <h4 className="text-lg font-black uppercase text-white tracking-tight">{s.name}</h4>
                          <p className="text-sm text-zinc-500 leading-relaxed italic">{s.desc}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bg-zinc-900/20 border border-dashed border-white/5 rounded-[40px] p-12 text-center text-zinc-600 uppercase font-black text-[10px] tracking-widest">
                   No listed services for this community.
                </div>
              )}
            </section>

            {/* MEMBERS SECTION */}
            {Array.isArray(item.members) && item.members.length > 0 && (
              <section ref={membersRef} className="space-y-10 scroll-mt-44">
                <h2 className="text-xs font-black text-white uppercase tracking-[0.4em] flex items-center gap-4 pl-2">
                  <div className="w-12 h-px bg-brandRed" /> Leadership & Members
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
                  {item.members.map((m: any, idx: number) => (
                    <div key={idx} className="bg-zinc-900/40 p-8 rounded-[32px] border border-white/5 hover:border-brandRed/30 transition-all group shadow-xl flex flex-col items-center text-center space-y-5">
                      
                      {/* 🔥 INCREASED SIZE & ADDED 'unoptimized' TO STOP VANISHING */}
                      <div className="w-36 h-36 md:w-40 md:h-40 relative rounded-full overflow-hidden border-2 border-white/10 group-hover:border-brandRed transition-colors shadow-lg">
                        <Image 
                          src={m.image || "/about/placeholder.jpeg"} 
                          alt={m.name} 
                          fill 
                          sizes="(max-width: 768px) 144px, 160px" // 🔥 Explicit sizes
                          quality={75}
                          loading="lazy"
                          className="object-cover" 
                        />
                      </div>

                      {/* 🔥 Slightly bumped up text size to match the bigger image */}
                      <div className="space-y-1 w-full mt-2">
                        <h4 className="text-base font-black uppercase text-white tracking-widest line-clamp-1">{m.name}</h4>
                        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-brandRed line-clamp-1">{m.designation}</p>
                      </div>
                      
                      {m.contact && (
                        <a 
                          href={`tel:${m.contact}`} 
                          className="mt-2 w-full py-3.5 bg-zinc-900/80 text-zinc-300 rounded-2xl border border-white/10 hover:bg-brandRed hover:text-white hover:border-brandRed transition-all flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-widest active:scale-95"
                        >
                          <Phone size={14} /> Call Member
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* GALLERY SECTION */}
            <section ref={photosRef} className="space-y-10 scroll-mt-44">
              <h2 className="text-xs font-black text-white uppercase tracking-[0.4em] flex items-center gap-4 pl-2">
                <div className="w-12 h-px bg-brandRed" /> Portfolio & Archive
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                {allImages.filter((img: string) => img).map((img: string, idx: number) => (
                  <div key={idx} onClick={() => setZoomImage(img)} className="relative aspect-square rounded-[32px] overflow-hidden border border-white/10 bg-zinc-900 cursor-zoom-in group shadow-2xl">
                    <Image 
                      src={img} 
                      alt="Archive" 
                      fill 
                      // 🔥 Removed unoptimized, added sizes and lazy loading
                      sizes="(max-width: 768px) 50vw, 33vw"
                      quality={75}
                      loading="lazy"
                      className="object-cover transition-transform duration-700 group-hover:scale-110 opacity-90 group-hover:opacity-100" 
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <Maximize2 size={24} className="text-white" />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* SIDEBAR */}
          <aside className="lg:col-span-4 sticky top-44 space-y-8">
            <div className="bg-zinc-950 border border-white/10 p-10 rounded-[45px] space-y-10 shadow-3xl">
              <div className="space-y-8">
                <div className="flex gap-6">
                  <div className="w-14 h-14 bg-zinc-900 rounded-2xl flex items-center justify-center shrink-0 border border-white/5 text-brandRed">
                    <MapPin size={28} />
                  </div>
                  <div>
                    <p className="text-[10px] text-zinc-500 font-black uppercase tracking-widest mb-1">Base Location</p>
                    <p className="text-sm text-zinc-200 font-bold uppercase">{item.area || "Pune Metropolitan"}</p>
                    {item.mapUrl && <a href={item.mapUrl} target="_blank" className="text-[10px] text-brandRed font-black mt-3 inline-flex items-center gap-2 hover:underline tracking-widest uppercase">Maps Link <ExternalLink size={14} /></a>}
                  </div>
                </div>

                <div className="flex gap-6">
                  <div className="w-14 h-14 bg-zinc-900 rounded-2xl flex items-center justify-center shrink-0 border border-white/5 text-brandRed">
                    <Globe size={28} />
                  </div>
                  <div className="flex-1">
                    <p className="text-[10px] text-zinc-500 font-black uppercase tracking-widest mb-1">Web Protocol</p>
                    <div className="flex flex-wrap gap-5 mt-4">
                      {item.instagram && (
                        <a href={`https://instagram.com/${item.instagram.replace('@','')}`} target="_blank" className="text-zinc-500 hover:text-brandRed transition-all hover:scale-125" title="Instagram">
                          <Instagram size={28} />
                        </a>
                      )}
                      {item.website && (
                        <a href={item.website} target="_blank" className="text-zinc-500 hover:text-brandRed transition-all hover:scale-125" title="Website">
                          <Globe size={28} />
                        </a>
                      )}
                      {item.link && (
                        <a href={item.link} target="_blank" className="text-zinc-500 hover:text-brandRed transition-all hover:scale-125" title="Join Group">
                          <LinkIcon size={28} />
                        </a>
                      )}
                      {(item.whatsapp || item.contact) && (
                        <a href={`https://wa.me/91${item.whatsapp || item.contact}`} target="_blank" className="text-zinc-500 hover:text-brandRed transition-all hover:scale-125" title="WhatsApp Contact">
                          <MessageCircle size={28} />
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </main>

      {/* LIGHTBOX OVERLAY */}
      <AnimatePresence>
        {zoomImage && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setZoomImage(null)} className="fixed inset-0 z-[1000] bg-black/98 flex items-center justify-center p-8 cursor-zoom-out">
            <div className="relative w-full max-w-6xl h-full flex items-center justify-center">
              <Image src={zoomImage} alt="Zoomed" fill unoptimized className="object-contain" />
            </div>
            <button className="absolute top-10 right-10 text-white p-4 bg-zinc-900 rounded-full hover:bg-brandRed transition-all">
              <X size={32} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}