"use client";
import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { 
  ArrowUpRight, 
  Zap, Loader2 
} from 'lucide-react';
import EventCard from '@/components/EventCard';
import DynamicTribeAd from '@/components/Popup';
import LazyVideo from '@/components/ui/LazyVideo';
import { ArrowRight } from 'lucide-react';

// COMPACT LASER DIVIDER
const LaserDivider = () => (
  <div className="relative w-full h-px flex items-center justify-center overflow-hidden my-2">
    <div className="absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-brandRed/40 to-transparent" />
    <div className="absolute w-[45%] h-[2px] bg-brandRed shadow-[0_0_25px_#FF0000] z-10" />
    <div className="absolute w-24 h-px bg-white blur-[1.5px] opacity-40 z-20" />
  </div>
);

// Slider videos: only the slide on screen downloads and plays. The others used to stream in the background, invisibly.
function SlideVideo({ src, active, className, style }: { src: string; active: boolean; className?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [wanted, setWanted] = useState(active);
  useEffect(() => { if (active) setWanted(true); }, [active]);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (active) v.play().catch(() => { /* autoplay refused: the first frame stays */ });
    else v.pause();
  }, [active, wanted]);
  if (!wanted) return null;
  return <video ref={ref} src={src} className={className} style={style} autoPlay={active} loop muted playsInline preload={active ? 'auto' : 'none'} />;
}

export default function Home() {
  const [slides, setSlides] = useState<any[]>([]);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [upcoming, setUpcoming] = useState<any[]>([]);
  const [past, setPast] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchHomePulse = async () => {
      try {
        const [sliderRes, eventRes] = await Promise.all([
          fetch('/api/settings/slider'),
          fetch('/api/events')
        ]);
        
        const sliderData = await sliderRes.json();
        const allEvents = await eventRes.json();

        if (sliderData?.slides?.length > 0) {
          setSlides(sliderData.slides);
        }

        // UPCOMING: Still requires 'featured' toggle
        const upcomingNodes = allEvents
          .filter((e: any) => e.isUpcoming === true && e.featured === true)
          .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

        // 🔥 THE FIX: Removed 'e.featured === true'. Now it grabs ALL past events and sorts newest-first.
        const pastNodes = allEvents
          .filter((e: any) => e.isUpcoming === false)
          .sort((a: any, b: any) => {
            const timeA = new Date(`${a.date} ${a.time || "12:00 AM"}`).getTime();
            const timeB = new Date(`${b.date} ${b.time || "12:00 AM"}`).getTime();
            return (timeB || 0) - (timeA || 0); 
          });

        const format = (list: any[]) => list.map(e => ({ 
          ...e, 
          id: e._id || e.id,
          image: e.image || "/about/placeholder.jpeg", 
          thumbnail: e.thumbnail || e.image || "/about/placeholder.jpeg",
        }));

        setUpcoming(format(upcomingNodes).slice(0, 2));
        setPast(format(pastNodes).slice(0, 3)); // Automatically grabs the latest 3

      } catch (err) {
        // Silent Failure
      } finally {
        setLoading(false);
      }
    };

    fetchHomePulse();
  }, []);

  useEffect(() => {
    if (slides.length <= 1) return;
    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % slides.length);
    }, 6000);
    return () => clearInterval(timer);
  }, [slides]);

  const isVideo = (url: string) => url?.match(/\.(mp4|webm|ogg|mov)/i) || url?.includes("video");

  if (loading) return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center">
      <Loader2 className="text-brandRed animate-spin mb-4" size={40} />
      <p className="text-zinc-500 text-[11px] font-bold uppercase tracking-widest">Loading...</p>
    </div>
  );

  return (
    <div className="flex flex-col min-h-screen bg-[#030303] text-white selection:bg-brandRed/30 relative overflow-x-hidden w-full">
      
      {/* Background Layer with Hardware Acceleration */}
      <div
        className="fixed inset-0 z-0 pointer-events-none overflow-hidden"
        style={{
          backgroundImage: 'url(/events/eventsback.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          opacity: 0.45,
          willChange: 'transform',
          transform: 'translateZ(0)',
        }}
      />
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#030303]/80 z-[1]" />
        <div className="absolute inset-0 opacity-[0.04] bg-[url('https://grainy-gradients.vercel.app/noise.svg')] mix-blend-overlay z-[2]" />
      </div>

      <div className="relative z-10">
        
      {/* HERO SECTION */}
        <section className="relative h-screen w-full overflow-hidden bg-[#030303] z-20 flex flex-col items-center justify-center">
          {slides.length > 0 && slides.map((slide, index) => {
            const isActive = index === currentSlide;
            
            return (
              <div
                key={index}
                style={{ willChange: 'transform, opacity' }} 
                className={`absolute inset-0 transition-all duration-1000 ease-in-out ${
                  isActive
                    ? 'opacity-100 scale-100 z-20 pointer-events-auto'
                    : 'opacity-0 scale-105 z-0 pointer-events-none'
                }`}
              >
                <div className="absolute inset-0 z-0">
                  {isVideo(slide.mediaUrl) ? (
                    <SlideVideo
                      src={slide.mediaUrl}
                      active={isActive}
                      className="w-full h-full object-cover transition-opacity duration-700"
                      style={{ opacity: Math.min(((slide.visibility || 60) + 20) / 100, 1), objectPosition: `50% ${slide.vOffset || 50}%` }}
                    />
                  ) : (
                    <Image src={slide.mediaUrl} alt="Slide" fill
                      sizes="100vw"
                      quality={80}
                      className="object-cover transition-opacity duration-700"
                      style={{ opacity: Math.min(((slide.visibility || 60) + 20) / 100, 1), objectPosition: `50% ${slide.vOffset || 50}%` }}
                      priority={index === 0}
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/80 z-10" />
                </div>

                <div className="relative w-full h-full flex flex-col items-center justify-center">
                  <div className="relative z-20 text-center px-4 sm:px-6 w-full max-w-6xl">
                    <div className="flex flex-col items-center space-y-1 sm:space-y-2">
                      <h1 className="text-4xl sm:text-5xl md:text-7xl font-black uppercase tracking-tighter leading-none text-white drop-shadow-xl">{slide.title}</h1>
                      <h2 className="text-6xl sm:text-7xl md:text-[110px] font-black uppercase tracking-tighter leading-none italic pb-2">
                        <span className="text-brandRed drop-shadow-[0_0_25px_rgba(255,0,0,0.6)]">{slide.subtitle}</span>
                      </h2>
                      <p className="text-base sm:text-xl md:text-3xl text-zinc-200 font-bold uppercase tracking-widest pt-4 sm:pt-6 drop-shadow-lg">{slide.description}</p>
                    </div>

                    {slide.buttonText && (
                      <div className="absolute top-full left-0 right-0 flex justify-center pt-6 sm:pt-10">
                        <Link href={slide.buttonLink || "/about"} className="relative z-50 inline-block">
                          <button className="cursor-pointer group relative bg-brandRed text-white px-10 sm:px-16 py-4 sm:py-6 rounded-full font-black uppercase tracking-widest text-xs sm:text-sm overflow-hidden transition-all hover:scale-110 shadow-[0_0_60px_rgba(255,0,0,0.4)] active:scale-95">
                            <span className="relative z-10 flex items-center gap-3">{slide.buttonText} <ArrowUpRight size={18} className="group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" /></span>
                            <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 rounded-full pointer-events-none" />
                          </button>
                        </Link>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {slides.length > 1 && (
            <div className="absolute bottom-8 sm:bottom-12 left-1/2 -translate-x-1/2 z-50 flex gap-3 sm:gap-4 pointer-events-auto">
              {slides.map((_, i) => (
                <button key={i} onClick={() => setCurrentSlide(i)}
                  aria-label={`Go to slide ${i + 1}`}
                  className={`cursor-pointer h-1.5 transition-all duration-500 rounded-full ${i === currentSlide ? 'w-10 sm:w-12 bg-brandRed' : 'w-3 sm:w-4 bg-white/40'}`}
                />
              ))}
            </div>
          )}
        </section>

        <LaserDivider />

        {/* UPCOMING EXPERIENCE SPOTLIGHT */}
        <section className="relative pt-12 pb-12 sm:pt-20 sm:pb-20 overflow-hidden">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 relative z-20">
            <div className="text-center mb-10 sm:mb-16">
                <div className="flex items-center justify-center gap-4 mb-6">
                    <div className="h-px w-16 bg-brandRed/40" />
                    <span className="bg-brandRed px-5 py-2 rounded-sm text-white font-sans font-black text-xs sm:text-sm tracking-[0.4em] uppercase shadow-[0_0_20px_rgba(255,0,0,0.3)]">
                        Upcoming Event
                    </span>
                    <div className="h-px w-16 bg-brandRed/40" />
                </div>
                <h2 className="text-5xl sm:text-7xl md:text-[120px] font-black uppercase italic leading-[0.75] tracking-[-0.05em] text-white">
                    Next<br /><span className="text-brandRed">Experience</span>
                </h2>
            </div>

            {upcoming.length > 0 ? (
              <div className="space-y-12 sm:space-y-16">
                <div className="flex flex-wrap justify-center gap-8 lg:gap-16 items-start">
                  {upcoming.map((event) => (
                    <div key={event.id} className="group relative flex flex-col items-center w-full lg:w-[calc(50%-32px)] max-w-[550px]">
                      <div className="w-full relative">
                        <div className="absolute -top-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 bg-zinc-950 border border-white/10 px-6 py-3 rounded-full shadow-2xl">
                          <div className="w-2 h-2 rounded-full bg-brandRed animate-ping" />
                          <span className="text-white font-sans font-black text-[11px] tracking-widest uppercase whitespace-nowrap">
                            {event.title} · Live {new Date().getFullYear()}
                          </span>
                        </div>
                        <div 
                          className="relative overflow-hidden rounded-3xl border border-white/10 bg-zinc-950/80 md:bg-white/[0.03] md:backdrop-blur-xl shadow-2xl group-hover:border-brandRed/30 transition-all duration-500"
                          style={{ transform: 'translateZ(0)' }}
                        >
                          <EventCard {...event} eventId={event._id} isUpcoming={true} showDescription={true} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex flex-col items-center mt-4">
                  <Link href="/events" className="group/link text-white hover:text-brandRed font-sans font-black text-lg sm:text-xl tracking-[0.3em] uppercase transition-all duration-300 flex items-center gap-5">
                    Explore Full Series 
                    <span className="group-hover:translate-x-4 transition-transform duration-300 text-brandRed text-3xl">→</span>
                  </Link>
                </div>
              </div>
            ) : (
              <div className="text-center py-10">
                <span className="text-white/40 font-black italic text-5xl uppercase tracking-tighter">Coming Soon</span>
              </div>
            )}
          </div>
        </section>

        <LaserDivider />

        {/* PAST EVENTS SECTION */}
        <section className="pt-8 pb-16 sm:pb-24 md:pb-40 relative overflow-hidden">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 relative z-20">
            <div className="flex justify-between items-end mb-10">
              <h2 className="text-4xl sm:text-5xl md:text-7xl font-black uppercase italic tracking-tighter text-white drop-shadow-2xl">
                Recent <span className="text-brandRed">Events</span>
              </h2>
              
              <Link 
  href="/events" 
  className="group relative flex items-center gap-2 px-5 py-2.5 text-sm sm:text-base font-black uppercase tracking-widest text-white transition-all whitespace-nowrap ml-4 overflow-hidden rounded-full border border-white/20 hover:border-brandRed bg-white/[0.05]"
>
  <span className="relative z-10 flex items-center gap-2">
    View All 
    <ArrowUpRight size={16} className="text-white group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
  </span>
  {/* Hover Fill Effect */}
  <div className="absolute inset-0 bg-brandRed translate-y-full group-hover:translate-y-0 transition-transform duration-300 z-0" />
</Link>
            </div>

            {past.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 sm:gap-8 relative z-30">
                {/* 🔥 Since 'past' is already sorted and sliced in the useEffect, we just map it! */}
                {past.map((event) => (
                  <div key={event.id || event._id} className="relative transition-transform duration-500 md:hover:-translate-y-4">
                    <div 
                      className="bg-zinc-950/80 md:bg-white/[0.03] md:backdrop-blur-xl rounded-[40px] border border-white/5 overflow-hidden"
                      style={{ transform: 'translateZ(0)' }}
                    >
                      <EventCard {...event} isUpcoming={false} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="w-full py-12 text-center border border-white/5 rounded-3xl bg-white/[0.02] mt-6">
                <p className="text-zinc-500 font-black uppercase tracking-widest text-[10px]">
                  No recent events found. 
                </p>
              </div>
            )}
          </div>
        </section>
        <LaserDivider />

        {/* RECENT RECAPS */}
        <section className="py-12 sm:py-24 md:py-32 relative overflow-hidden">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 relative z-20">
            <div className="mb-8 sm:mb-12">
              <div className="flex items-center gap-3 mb-4">
                <Zap size={16} className="text-brandRed fill-brandRed" />
                <h2 className="text-sm font-black uppercase tracking-[0.4em] sm:tracking-[0.5em] text-brandRed">Live Energy</h2>
              </div>
              <h3 className="text-4xl sm:text-5xl md:text-7xl font-black uppercase tracking-tighter text-white">
                High <span className="text-zinc-700 italic">Frequency</span>
              </h3>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-10 relative z-30">
                  <div 
                    className="group relative p-8 sm:p-12 rounded-[24px] sm:rounded-[40px] bg-zinc-950/80 md:bg-white/[0.03] md:backdrop-blur-xl border border-white/5 hover:border-brandRed/40 transition-all duration-700 overflow-hidden md:hover:-translate-y-2 shadow-2xl"
                    style={{ transform: 'translateZ(0)' }}
                  >                
                    <div className="absolute inset-0 z-0 opacity-40 group-hover:opacity-80 transition-opacity duration-1000">
                      <LazyVideo src="/videos/agam-recap.mp4" className="w-full h-full object-cover" skipOnPhones />
                      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent" />
                    </div>
                    <div className="relative z-10">
                      <span className="text-zinc-400 font-mono text-[11px] tracking-widest uppercase">Jan 2026</span>
                      <h4 className="text-3xl sm:text-4xl font-black uppercase mt-4 sm:mt-6 mb-3 sm:mb-4 tracking-tight group-hover:text-brandRed transition-colors">Agam Live Recap</h4>
                      <p className="text-zinc-300 text-[15px] sm:text-lg font-medium leading-relaxed italic">Experience the night Carnatic Progressive Rock met the heart of Pune.</p>
                    </div>
                  </div>

                  <div 
                    className="group relative p-8 sm:p-12 rounded-[24px] sm:rounded-[40px] bg-zinc-950/80 md:bg-white/[0.03] md:backdrop-blur-xl border border-white/5 md:hover:border-brandRed/40 transition-all duration-700 overflow-hidden md:hover:-translate-y-2 shadow-2xl"
                    style={{ transform: 'translateZ(0)' }}
                  >                
                    <div className="absolute inset-0 z-0 opacity-40 group-hover:opacity-80 transition-opacity duration-1000">
                      <LazyVideo src="/videos/jam.mp4" className="w-full h-full object-cover" skipOnPhones />
                      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent" />
                    </div>
                    <div className="relative z-10">
                      <span className="text-zinc-400 font-mono text-[11px] tracking-widest uppercase">Feb 2026</span>
                      <h4 className="text-3xl sm:text-4xl font-black uppercase mt-4 sm:mt-6 mb-3 sm:mb-4 tracking-tight group-hover:text-brandRed transition-colors">Jamming Session</h4>
                      <p className="text-zinc-300 text-[15px] sm:text-lg font-medium leading-relaxed italic">Our unplugged community jams bringing the raw soul of Kerala to the city streets.</p>
                    </div>
                  </div>
            </div>
          </div>
        </section>

        <LaserDivider />

        {/* FOUNDERS SECTION */}
        <section className="py-12 sm:py-24 md:py-32 relative overflow-hidden">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 text-center relative z-10">
            <h2 className="text-4xl sm:text-5xl md:text-8xl font-black uppercase italic tracking-tighter mb-12 sm:mb-20 text-white">
              Meet The <span className="text-brandRed">Founders</span>
            </h2>
            <div className="flex flex-wrap justify-center gap-10 sm:gap-16 lg:gap-32">
              <div className="group w-full max-w-[260px] sm:max-w-[340px]">
                <div 
                  className="aspect-[3/4] bg-zinc-950/80 md:bg-white/[0.03] md:backdrop-blur-md rounded-[32px] sm:rounded-[50px] mb-6 sm:mb-8 overflow-hidden border border-white/10 group-hover:border-brandRed transition-all duration-700 shadow-2xl relative"
                  style={{ transform: 'translateZ(0)' }}
                >                  
                  <Image 
                    src="/founders/suchi.jpg" 
                    alt="Suchi" 
                    fill 
                    sizes="(max-width: 640px) 260px, 340px"
                    quality={75}
                    loading="lazy"
                    className="object-cover group-hover:scale-105 transition-all duration-700" 
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                </div>
                <h4 className="text-2xl sm:text-3xl font-black uppercase tracking-tighter text-white">Sucheendran K.C</h4>
                <p className="text-brandRed font-black uppercase text-[12px] tracking-widest mt-2 sm:mt-3">Founder</p>
              </div>

              <div className="group w-full max-w-[260px] sm:max-w-[340px]">
                <div 
                  className="aspect-[3/4] bg-zinc-950/80 md:bg-white/[0.03] md:backdrop-blur-md rounded-[32px] sm:rounded-[50px] mb-6 sm:mb-8 overflow-hidden border border-white/10 group-hover:border-brandRed transition-all duration-700 shadow-2xl relative"
                  style={{ transform: 'translateZ(0)' }}
                >                  
                  <Image 
                    src="/founders/shehanas_2.jpeg" 
                    alt="Shehanas" 
                    fill 
                    sizes="(max-width: 640px) 260px, 340px"
                    quality={75}
                    loading="lazy"
                    className="object-cover group-hover:scale-105 transition-all duration-700" 
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                </div>
                <h4 className="text-2xl sm:text-3xl font-black uppercase tracking-tighter text-white">Shehanas.SHEIK</h4>
                <p className="text-brandRed font-black uppercase text-[12px] tracking-widest mt-2 sm:mt-3">Co-Founder</p>
              </div>
            </div>
            
            <div className="mt-12 sm:mt-20">
              <Link href="/about" className="group/btn relative inline-flex items-center gap-4 sm:gap-6 px-10 sm:px-14 py-5 sm:py-6 rounded-full border border-white/10 overflow-hidden hover:border-brandRed transition-all duration-500">
                <div className="absolute inset-0 bg-brandRed translate-y-full group-hover/btn:translate-y-0 transition-transform duration-500" />
                <span className="relative z-10 text-[11px] sm:text-xs font-black uppercase tracking-widest group-hover/btn:text-white">Learn About Our Journey</span>
                <ArrowUpRight className="relative z-10 group-hover/btn:rotate-45 transition-transform flex-shrink-0" size={16} />
              </Link>
            </div>
          </div>
        </section>
        <DynamicTribeAd />
        <LaserDivider />
      </div>
    </div>
  );
}