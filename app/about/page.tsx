"use client";
import { useState, useEffect, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import InstagramGlimpse from '@/components/about/InstagramGlimpse';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Target,
  Eye,
  Diamond,
  ArrowRight, 
  Music, 
  ArrowUpRight,
  X,
  Calendar,
  ChevronDown
} from 'lucide-react';
import MembershipCard from '@/components/Membership'; 
import LazyVideo from '@/components/ui/LazyVideo';

interface TeamMember {
  name: string;
  role: string;
  image: string;
}

interface GalleryEvent {
  id: string;
  title: string;
  year: number;
  description: string;
  images: string[];
}

interface DisplayImage {
  src: string;
  title: string;
  description: string;
  year: number;
}

const shimmer = (w: number, h: number) => `
<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#111"/>
</svg>`;

const toBase64 = (str: string) =>
  typeof window === 'undefined'
    ? Buffer.from(str).toString('base64')
    : window.btoa(str);

export const blurPlaceholder = `data:image/svg+xml;base64,${toBase64(shimmer(700, 475))}`;

const LaserDivider = () => (
  <div className="relative w-full h-px flex items-center justify-center overflow-visible my-32">
    <div className="absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-brandRed/40 to-transparent" />
    <div className="absolute w-[45%] h-[2px] bg-brandRed shadow-[0_0_20px_#FF0000] z-10" />
  </div>
);

const shuffleArray = <T,>(array: T[]): T[] => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

export default function AboutPage() {
  const [cycle, setCycle] = useState(false);
  // The stills cross-fade into the videos only once a video is really playing (it never is on phones / Data Saver),
  // otherwise the card would fade to an empty black box.
  const [jamPlaying, setJamPlaying] = useState(false);
  const [beautyPlaying, setBeautyPlaying] = useState(false);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [zoomImage, setZoomImage] = useState<string | null>(null);
  
  // Gallery States
  const currentYear = new Date().getFullYear();
  const [galleryEvents, setGalleryEvents] = useState<GalleryEvent[]>([]);
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [displayedImages, setDisplayedImages] = useState<DisplayImage[]>([]);
  
  // Global Admin Settings States
  const [globalDisplayMode, setGlobalDisplayMode] = useState<'MIX' | 'SPECIFIC'>('MIX');
  const [globalFeaturedEventId, setGlobalFeaturedEventId] = useState<string | null>(null);

  useEffect(() => {
    async function initializeTribeData() {
      try {
        const [galleryRes, teamRes] = await Promise.all([
          fetch('/api/settings/gallery'),
          fetch('/api/team')
        ]);

        const galleryData = await galleryRes.json();
        
        if (galleryData) {
          if (Array.isArray(galleryData.events) && galleryData.events.length > 0) {
            setGalleryEvents(galleryData.events);
          }
          if (galleryData.displayMode) setGlobalDisplayMode(galleryData.displayMode);
          if (galleryData.featuredEventId) setGlobalFeaturedEventId(galleryData.featuredEventId);
        }

        const teamData = await teamRes.json();
        if (Array.isArray(teamData) && teamData.length > 0) {
          setTeamMembers(teamData);
        }

      } catch (err) {
        console.error("Initialization error:", err);
      }
    }

    initializeTribeData();
  }, []);

  const availableYears = useMemo(() => {
    const years = galleryEvents.map(e => e.year);
    return Array.from(new Set([currentYear, ...years])).sort((a, b) => b - a);
  }, [galleryEvents, currentYear]);

  const currentImagePool = useMemo(() => {
    let pool: DisplayImage[] = [];
    const isViewingCurrentYear = selectedYear === currentYear;

    if (isViewingCurrentYear && globalDisplayMode === 'SPECIFIC' && globalFeaturedEventId) {
      const specificEvent = galleryEvents.find(e => String(e.id) === String(globalFeaturedEventId));
      if (specificEvent) {
        specificEvent.images.forEach(img => {
          pool.push({
            src: img,
            title: specificEvent.title,
            description: specificEvent.description,
            year: specificEvent.year
          });
        });
        return pool; 
      }
    }

    const eventsToProcess = galleryEvents.filter(e => e.year === selectedYear);

    eventsToProcess.forEach(event => {
      event.images.forEach(img => {
        pool.push({
          src: img,
          title: event.title,
          description: event.description,
          year: event.year
        });
      });
    });

    return pool;
  }, [galleryEvents, selectedYear, globalDisplayMode, globalFeaturedEventId, currentYear]);

  useEffect(() => {
    if (currentImagePool.length > 0) {
      setDisplayedImages(shuffleArray(currentImagePool).slice(0, 6));
    } else {
      setDisplayedImages([]);
    }
  }, [currentImagePool]);

  useEffect(() => {
    if (!zoomImage) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZoomImage(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [zoomImage]);

  useEffect(() => {
    const interval = setInterval(() => setCycle(p => !p), 4000);
    return () => clearInterval(interval);
  }, []);

  return (
    <main className="min-h-screen bg-[#030303] text-white pt-40 pb-20 px-6 relative selection:bg-brandRed/30">
      
      {/* FIXED BRANDED BACKGROUND */}
      <div
        className="fixed inset-0 z-0 pointer-events-none overflow-hidden"
        style={{
          backgroundImage: 'url(/events/about5.png)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          opacity: 0.4,
          transform: 'translateZ(0)',
          willChange: 'transform',
        }}
      />
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#030303]" />
        <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[60%] bg-brandRed/10 blur-[150px] rounded-full opacity-30" />
        <div className="absolute inset-0 opacity-[0.03] bg-[url('https://grainy-gradients.vercel.app/noise.svg')] mix-blend-overlay" />
      </div>

      <div className="relative z-10">
        
       {/* HERO: THE ORIGIN STORY */}
        <section className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 md:gap-20 items-center mb-40 px-6"> 
          <div className="relative aspect-square rounded-[40px] overflow-hidden border border-white/10 group shadow-2xl bg-zinc-950">
            <Image 
              src="/about/community.jpeg" 
              alt="Community" 
              fill 
              priority
              blurDataURL={blurPlaceholder} 
              placeholder="blur"
              sizes="(max-width: 768px) 100vw, 50vw" 
              className="object-cover grayscale-[20%] group-hover:grayscale-0 transition-all duration-1000 group-hover:scale-105" 
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-80" />
          </div>
          
          <div className="space-y-8">
            <h1 className="text-6xl md:text-8xl font-black uppercase tracking-tighter italic leading-[0.85] mb-4">
              About <br />
              <span className="text-brandRed">Puneri <br />Mallus.</span>
            </h1>
            <p className="text-xl md:text-2xl text-zinc-400 font-medium leading-relaxed italic max-w-xl">
              The heartbeat of the Kerala diaspora in Pune. A cultural bridge, a support system, and a family away from home.
            </p>
          </div>
        </section>

        {/* CORE DIRECTIVES */}
        <section className="max-w-7xl mx-auto mb-40 px-6">
          <div className="flex flex-col items-center mb-20 text-center">
            <h2 className="text-5xl md:text-7xl font-black uppercase italic tracking-tighter">
              Core <span className="text-brandRed">Directives</span>
            </h2>
            <div className="w-24 h-1 bg-brandRed mt-4 shadow-[0_0_20px_#FF0000]" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-10">
            <div className="bg-zinc-950 border border-white/5 p-10 md:p-12 rounded-[40px] hover:border-brandRed/40 transition-all duration-500 shadow-2xl relative group overflow-hidden flex flex-col items-start text-left">
              <div className="absolute top-0 right-0 w-40 h-40 bg-brandRed/5 blur-[50px] opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
              <div className="p-5 bg-black border border-white/5 rounded-2xl mb-8 group-hover:scale-110 group-hover:border-brandRed/30 transition-all duration-500 shadow-xl">
                <Target className="text-brandRed" size={32} />
              </div>
              <h3 className="text-3xl font-black uppercase italic mb-4 text-white group-hover:text-brandRed transition-colors">Mission</h3>
              <p className="text-zinc-400 font-medium leading-relaxed italic">
                To unite the Kerala diaspora in Pune through cultural celebrations, creating an unbreakable home away from home where our traditions thrive.
              </p>
            </div>

            <div className="bg-zinc-950 border border-white/5 p-10 md:p-12 rounded-[40px] hover:border-brandRed/40 transition-all duration-500 shadow-2xl relative group overflow-hidden flex flex-col items-start text-left">
              <div className="absolute top-0 right-0 w-40 h-40 bg-brandRed/5 blur-[50px] opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
              <div className="p-5 bg-black border border-white/5 rounded-2xl mb-8 group-hover:scale-110 group-hover:border-brandRed/30 transition-all duration-500 shadow-xl">
                <Eye className="text-brandRed" size={32} />
              </div>
              <h3 className="text-3xl font-black uppercase italic mb-4 text-white group-hover:text-brandRed transition-colors">Vision</h3>
              <p className="text-zinc-400 font-medium leading-relaxed italic">
                To build the most dynamic, supportive, and culturally vibrant Malayali community network across Maharashtra, setting the benchmark for diaspora collectives.
              </p>
            </div>

            <div className="bg-zinc-950 border border-white/5 p-10 md:p-12 rounded-[40px] hover:border-brandRed/40 transition-all duration-500 shadow-2xl relative group overflow-hidden flex flex-col items-start text-left">
              <div className="absolute top-0 right-0 w-40 h-40 bg-brandRed/5 blur-[50px] opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
              <div className="p-5 bg-black border border-white/5 rounded-2xl mb-8 group-hover:scale-110 group-hover:border-brandRed/30 transition-all duration-500 shadow-xl">
                <Diamond className="text-brandRed" size={32} />
              </div>
              <h3 className="text-3xl font-black uppercase italic mb-4 text-white group-hover:text-brandRed transition-colors">Values</h3>
              <p className="text-zinc-400 font-medium leading-relaxed italic">
                Uncompromising authenticity, mutual growth, creative expression, and a fierce dedication to preserving our roots while evolving our future.
              </p>
            </div>
          </div>
        </section>

        <LaserDivider />

        {/* AGAM: FLAGSHIP PROGRAM */}
        <section className="max-w-7xl mx-auto mb-40">
          <div 
            className="relative p-12 lg:p-24 rounded-[80px] bg-zinc-950/80 md:bg-white/[0.03] border border-brandRed/20 md:backdrop-blur-3xl overflow-hidden group"
            style={{ transform: 'translateZ(0)' }}
          > 
            <div className="flex flex-col lg:flex-row gap-20 items-center">
              <div className="w-full lg:w-2/5 space-y-8 order-2 lg:order-1">
                <div className="flex items-center gap-3">
                   <Target size={18} className="text-brandRed fill-brandRed" />
                   <span className="text-brandRed font-black uppercase text-[11px] tracking-widest">Flagship Event</span>
                </div>
                <h2 className="text-6xl md:text-8xl font-black uppercase italic tracking-tighter leading-[0.85]">
                  Agam: The <br /><span className="text-white">Pioneer <br />Program</span>
                </h2>
                <p className="text-zinc-500 text-xl italic border-l border-brandRed/30 pl-6">Bringing the best of Kerala's art and music blockbusters to Pune.</p>
              </div>
              <div className="w-full lg:w-3/5 order-1 lg:order-2">
                <div className="relative h-[500px] lg:h-[700px] w-full rounded-[50px] overflow-hidden border border-white/5 shadow-2xl">
                  <Image 
                    src="/about/agams.jpg" 
                    alt="Agam" 
                    fill 
                    blurDataURL={blurPlaceholder} placeholder="blur"
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                    className="object-cover group-hover:scale-110 transition-transform duration-1000" 
                  /> 
                </div>
              </div>
            </div>
          </div>
        </section>

        <LaserDivider />

        {/* JAMMING SESSIONS */}
        <section id="jamming-section" className="max-w-7xl mx-auto mb-40 relative">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
            <div className="lg:col-span-7 relative h-[600px] rounded-[60px] overflow-hidden border border-white/10 shadow-2xl bg-zinc-950">
              <Image 
                src="/about/image_1.jpeg" 
                alt="Jamming" 
                fill 
                blurDataURL={blurPlaceholder} placeholder="blur"
                sizes="(max-width: 768px) 100vw, 50vw" 
                className={`object-cover transition-opacity duration-500 ease-in-out ${cycle && jamPlaying ? 'opacity-0' : 'opacity-80'}`} 
                priority
              />
              <LazyVideo
                src="/videos/jam.mp4"
                skipOnPhones
                onPlaying={() => setJamPlaying(true)}
                className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ease-in-out ${cycle && jamPlaying ? 'opacity-80' : 'opacity-0'}`}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-90" />
            </div>

            <div className="lg:col-span-5 flex flex-col justify-center relative min-h-[400px]">
              <h2 className="text-8xl md:text-[140px] font-black uppercase italic tracking-tighter leading-[0.7] text-white/[0.03] select-none absolute -translate-x-10 lg:-translate-x-20 top-1/2 -translate-y-1/2 -z-10">
                RHYTHM
              </h2>
              <div className="space-y-8 relative z-10">
                <div className="flex items-center gap-4 text-brandRed">
                  <Music size={24} className="animate-pulse" />
                  <span className="font-mono uppercase tracking-[0.4em] text-[10px] font-black opacity-60">
                    Live Music
                  </span>
                </div>
                <h3 className="text-6xl md:text-8xl font-black uppercase italic tracking-tighter leading-[0.85]">
                  <span className="text-white">THE </span>
                  <span className="text-brandRed drop-shadow-[0_0_15px_rgba(255,0,0,0.5)]">JAMMING</span><br />
                  <span className="text-white">SESSIONS</span>
                </h3>
                <p className="text-xl text-zinc-500 italic leading-relaxed border-l-2 border-brandRed/20 pl-6 max-w-sm">
                  Mallu Beats recreating the magic of Kerala unplugged.
                </p>
              </div>
            </div>
          </div>
        </section>

        <LaserDivider />

        {/* BEAUTY PAGEANT */}
        <section className="max-w-7xl mx-auto mb-40 px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 md:gap-24 items-center">
            
            <div className="space-y-8">
              <div className="flex items-center gap-3">
                <span className="w-12 h-px bg-brandRed" />
                <span className="text-brandRed font-black uppercase text-[11px] tracking-widest">Annual Event</span>
              </div>
              
              <h2 className="text-6xl md:text-8xl font-black uppercase italic tracking-tighter leading-none">
                The <span className="text-brandRed">Beauty</span> <br />Pageant Pune.
              </h2>
              
              <p className="text-xl text-zinc-400 italic font-medium">
                Elegance, culture, and identity on a single stage.
              </p>

              <div className="pt-4">
                <a 
                  href="https://misskeralapune.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 bg-white text-black px-8 py-4 rounded-full font-black uppercase tracking-widest text-[11px] hover:scale-105 hover:bg-brandRed hover:text-white transition-all duration-300 shadow-xl active:scale-95"
                >
                  View More 
                </a>
              </div>
            </div>
            
            <div className="relative h-[450px] md:h-[650px] w-full rounded-[32px] md:rounded-[40px] overflow-hidden shadow-2xl bg-zinc-950">
              <Image 
                src="/about/beauty.jpeg" 
                alt="Pageant" 
                fill 
                blurDataURL={blurPlaceholder} placeholder="blur"
                sizes="(max-width: 768px) 100vw, 50vw" 
                className={`object-cover transition-opacity duration-1000 ${cycle && beautyPlaying ? 'opacity-0' : 'opacity-100'}`} 
              />
              <LazyVideo
                src="/videos/beauty.mp4"
                skipOnPhones
                onPlaying={() => setBeautyPlaying(true)}
                className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-1000 ${cycle && beautyPlaying ? 'opacity-100' : 'opacity-0'}`}
              />
            </div>
            
          </div>
        </section>
        
        <LaserDivider />

        {/* 🚀 SMART ARCHIVE SYSTEM */}
        <section className="max-w-[90%] md:max-w-7xl mx-auto mb-40 relative px-6 md:px-0">
          <div className="flex flex-col md:flex-row justify-between items-baseline gap-6 mb-12">
            <div className="flex flex-col md:flex-row items-baseline gap-4">
              <h2 className="text-4xl md:text-6xl font-black uppercase italic tracking-tighter text-white">
                The <span className="text-brandRed">Archive</span>
              </h2>
              <p className="text-zinc-500 font-bold uppercase tracking-widest text-[10px]">
                Visual Legacy // {currentYear}
              </p>
            </div>

            {/* 🔥 INTERACTIVE DROPDOWN */}
            <div className="relative w-40 shrink-0 mt-2 md:mt-0">
              <div className="absolute inset-0 bg-zinc-900/80 rounded-lg border border-white/5 transition-colors hover:border-white/20" />
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-brandRed pointer-events-none z-10" size={14} />
              <select 
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="relative w-full bg-transparent py-3 pl-9 pr-8 text-[11px] outline-none focus:border-brandRed text-white/90 appearance-none cursor-pointer font-black uppercase tracking-widest z-10"
              >
                {availableYears.map(year => (
                  <option key={year} value={year} className="bg-zinc-900 text-white">{year}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none z-10" size={14} />
            </div>
          </div>

          {galleryEvents.length > 0 ? (
            <div className="space-y-10">
              
              {/* ARCHIVE META CARD */}
              <AnimatePresence mode="wait">
                <motion.div 
                  key={selectedYear === currentYear && globalDisplayMode === 'SPECIFIC' ? globalFeaturedEventId : selectedYear}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="flex flex-col gap-2 bg-zinc-900/30 p-6 rounded-3xl border border-white/5"
                >
                  <div className="flex items-center gap-2 text-brandRed font-black uppercase text-[10px] tracking-widest">
                    <Calendar size={12} /> 
                    {selectedYear === currentYear && globalDisplayMode === 'SPECIFIC' 
                      ? 'Featured Event Highlight' 
                      : `${selectedYear} Collection`
                    }
                  </div>
                  <p className="text-zinc-400 text-sm font-medium leading-relaxed italic">
                    {selectedYear === currentYear && globalDisplayMode === 'SPECIFIC'
                      ? galleryEvents.find(e => String(e.id) === String(globalFeaturedEventId))?.description || "Highlighting our featured event moments."
                      : `A curated mix of our milestones, celebrations, and gatherings from ${selectedYear}.`
                    }
                  </p>
                </motion.div>
              </AnimatePresence>

              {/* 🔥 UPDATED: LARGER DYNAMIC IMAGE GRID WITH PREMIUM METADATA */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10 lg:gap-14">
                {displayedImages.length > 0 ? (
                  displayedImages.map((img, idx) => (
                    <motion.div 
                      key={`${selectedYear}-${img.src}-${idx}`}
                      initial={{ opacity: 0, scale: 0.95, y: 10 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      transition={{ delay: idx * 0.05, duration: 0.4 }}
                      className="group cursor-pointer flex flex-col"
                      onClick={() => setZoomImage(img.src)}
                    >
                      {/* Premium Image Container */}
                      <div 
                        className="relative aspect-square md:aspect-[4/3] rounded-[32px] overflow-hidden border border-white/5 bg-zinc-900 shadow-2xl mb-5"
                        style={{ transform: 'translateZ(0)' }}
                      >
                        <Image 
                          src={img.src} 
                          alt={`Archive Asset ${img.title}`} 
                          fill 
                          blurDataURL={blurPlaceholder} placeholder="blur"
                          sizes="(max-width: 768px) 100vw, 33vw"
                          className="object-cover transition-transform duration-700 will-change-[transform] md:group-hover:scale-105" 
                          loading="lazy"  
                        />
                        <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
                           <Eye size={32} className="text-white opacity-70 drop-shadow-xl" />
                        </div>
                      </div>
                      
                      {/* Premium Metadata */}
                      <div className="px-1 flex flex-col gap-1.5">
                        <div className="flex items-center gap-3">
                          <span className="bg-[#111] text-brandRed border border-white/5 px-3 py-1 rounded-full font-black text-[11px] tracking-widest shadow-md">
                            {img.year}
                          </span>
                          <h4 className="text-white font-black uppercase text-xl tracking-tighter truncate mt-0.5">
                            {img.title}
                          </h4>
                        </div>
                        {img.description && (
                          <p className="text-zinc-500 text-sm italic font-bold uppercase tracking-wider pl-1 line-clamp-1">
                            {img.description}
                          </p>
                        )}
                      </div>
                    </motion.div>
                  ))
                ) : (
                  <div className="col-span-full py-20 border border-dashed border-white/5 rounded-3xl w-full text-center bg-zinc-950/50">
                    <p className="text-zinc-500 font-bold uppercase tracking-widest text-xs">
                      No images found for this selection.
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="py-20 border border-dashed border-white/5 rounded-3xl w-full text-center bg-zinc-950/50">
              <p className="text-zinc-500 font-bold uppercase tracking-widest text-xs">
                Archive compiling...
              </p>
            </div>
          )}
        </section>
        
        <LaserDivider />

        {/* LIGHTBOX OVERLAY */}
        <AnimatePresence>
          {zoomImage && (
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }} 
              onClick={() => setZoomImage(null)} 
              className="fixed inset-0 z-[1000] bg-black/98 flex items-center justify-center p-4 sm:p-12 cursor-zoom-out backdrop-blur-md"
              style={{ transform: 'translateZ(0)' }} 
            >
              <motion.div 
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 25 }} 
                className="relative w-full max-w-6xl h-full flex items-center justify-center"
              >
                <Image 
                  src={zoomImage} 
                  alt="Zoomed Legacy Asset" 
                  fill 
                  unoptimized 
                  priority
                  className="object-contain" 
                />
              </motion.div>
              <button className="absolute top-6 right-6 md:top-10 md:right-10 text-white p-3 md:p-4 bg-zinc-900 rounded-full hover:bg-brandRed transition-all shadow-2xl border border-white/10 active:scale-90">
                <X size={24} className="md:w-8 md:h-8" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
        <InstagramGlimpse />
        
        <LaserDivider />
      
      </div>
    </main>
  );
}