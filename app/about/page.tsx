"use client";
import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import InstagramGlimpse from '@/components/about/InstagramGlimpse';
import { 
  ShieldCheck, 
  Handshake, 
  Globe, 
  Zap, 
  ArrowRight, 
  Music, 
  Heart,
  MapPin,
  ArrowUpRight,
  Instagram,
  Facebook,
  MessageCircle
} from 'lucide-react';

const LaserDivider = () => (
  <div className="relative w-full h-px flex items-center justify-center overflow-visible my-32">
    <div className="absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-brandRed/40 to-transparent" />
    <div className="absolute w-[45%] h-[2px] bg-brandRed shadow-[0_0_20px_#FF0000] z-10" />
    <div className="absolute w-full h-[100px] bg-brandRed/5 blur-[80px] opacity-50 pointer-events-none" />
  </div>
);

export default function AboutPage() {
  const [cycle, setCycle] = useState(false);
  const fullText = "THE JAMMING SESSIONS"; 
  const [displayText, setDisplayText] = useState("");
  const [textIndex, setTextIndex] = useState(0);
  const [startTypewriter, setStartTypewriter] = useState(false);
  const [galleryImages, setGalleryImages] = useState<string[]>([]);

  useEffect(() => {
    async function fetchGallery() {
      try {
        const res = await fetch('/api/settings/gallery?t=' + Date.now());
        const data = await res.json();
        if (data && Array.isArray(data.images) && data.images.length > 0) {
          setGalleryImages(data.images);
        } else {
          setGalleryImages(['/gallery/img1.jpg', '/gallery/img2.jpg', '/gallery/img3.jpg', '/gallery/img4.jpg', '/gallery/img5.jpg', '/gallery/img6.jpg']);
        }
      } catch (err) {
        console.error("Gallery Sync Error:", err);
        setGalleryImages(['/gallery/img1.jpg', '/gallery/img2.jpg', '/gallery/img3.jpg', '/gallery/img4.jpg', '/gallery/img5.jpg', '/gallery/img6.jpg']);
      }
    }
    fetchGallery();
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setStartTypewriter(true);
        }
      },
      { threshold: 0.3 }
    );
    const element = document.getElementById('jamming-section');
    if (element) observer.observe(element);
    return () => {
      if (element) observer.unobserve(element);
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setCycle((prev) => !prev);
    }, 4000); 

    if (startTypewriter && textIndex < fullText.length) {
      const timeout = setTimeout(() => {
        setDisplayText((prev) => prev + fullText[textIndex]);
        setTextIndex((prev) => prev + 1);
      }, 60); 
      return () => {
        clearInterval(interval);
        clearTimeout(timeout);
      };
    }
    return () => clearInterval(interval);
  }, [textIndex, startTypewriter]);

  return (
    <main className="min-h-screen bg-[#030303] text-white pt-40 pb-20 px-6 relative selection:bg-brandRed/30">
      
      {/* 1. FIXED BRANDED BACKGROUND (UPDATED OPACITY FOR VISIBILITY) */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
        <Image 
          src="/events/about5.png" 
          alt="About Background"
          fill
          className="object-cover object-center opacity-40 brightness-[0.7] saturate-[0.9]"
          priority
        />
        {/* ATMOSPHERIC OVERLAYS */}
        <div className="absolute inset-0 bg-gradient-radial from-transparent via-[#030303]/30 to-[#030303]" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#030303]" />
        
        {/* Subtle Brand Glows */}
        <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[60%] bg-brandRed/10 blur-[150px] rounded-full opacity-30" />
        
        {/* Filmic Grain */}
        <div className="absolute inset-0 opacity-[0.03] bg-[url('https://grainy-gradients.vercel.app/noise.svg')] mix-blend-overlay" />
      </div>

      <div className="relative z-10">
        {/* 1. HERO: THE ORIGIN STORY */}
        <section className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-20 items-center mb-40">
          <div className="relative aspect-square rounded-[40px] overflow-hidden border border-white/10 group shadow-2xl bg-zinc-950">
            <Image 
              src="/about/community.jpeg" 
              alt="Community" 
              fill 
              className="object-cover grayscale-[20%] group-hover:grayscale-0 transition-all duration-1000 group-hover:scale-105" 
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-80" />
          </div>
          <div className="space-y-10">
            <h1 className="text-7xl md:text-9xl font-black uppercase tracking-tighter italic leading-[0.8] mb-4">
              About <br /><span className="text-brandRed">Puneri <br />Mallus.</span>
            </h1>
            <p className="text-2xl text-zinc-400 font-medium leading-relaxed italic max-w-xl">
              The heartbeat of the Kerala diaspora in Pune. A cultural bridge, a support system, and a family away from home.
            </p>
          </div>
        </section>

        <LaserDivider />

        {/* 2. AGAM: FLAGSHIP PROGRAM */}
        <section className="max-w-7xl mx-auto mb-40">
          <div className="relative p-12 lg:p-24 rounded-[80px] bg-zinc-950/40 border border-brandRed/20 backdrop-blur-3xl overflow-hidden group">
            <div className="flex flex-col lg:flex-row gap-20 items-center">
              <div className="w-full lg:w-2/5 space-y-8 order-2 lg:order-1">
                <div className="flex items-center gap-3">
                   <Zap size={18} className="text-brandRed fill-brandRed" />
                   <span className="text-brandRed font-black uppercase text-[10px] tracking-[0.5em]">Intellectual Property</span>
                </div>
                <h2 className="text-6xl md:text-8xl font-black uppercase italic tracking-tighter leading-[0.85]">
                  Agam: The <br /><span className="text-white">Pioneer <br />Program</span>
                </h2>
                <p className="text-zinc-500 text-xl italic border-l border-brandRed/30 pl-6">Bringing the best of Kerala's art and music blockbusters to Pune.</p>
              </div>
              <div className="w-full lg:w-3/5 order-1 lg:order-2">
                <div className="relative h-[500px] lg:h-[700px] w-full rounded-[50px] overflow-hidden border border-white/5 shadow-2xl">
                  <Image src="/about/agams.jpg" alt="Agam" fill className="object-cover group-hover:scale-110 transition-transform duration-1000" />
                </div>
              </div>
            </div>
          </div>
        </section>

        <LaserDivider />

        {/* 3. JAMMING SESSIONS */}
        <section id="jamming-section" className="max-w-7xl mx-auto mb-40 relative">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
            <div className="lg:col-span-7 relative h-[600px] rounded-[60px] overflow-hidden border border-white/10 shadow-2xl bg-zinc-950">
              <Image 
                src="/about/image_1.jpeg" 
                alt="Jamming" 
                fill 
                className={`object-cover transition-opacity duration-500 ease-in-out ${cycle ? 'opacity-0' : 'opacity-80'}`} 
                priority
              />
              <video 
                autoPlay loop muted playsInline preload="auto"
                className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ease-in-out ${cycle ? 'opacity-80' : 'opacity-0'}`}
              >
                <source src="/videos/jam.mp4" type="video/mp4" />
              </video>
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
                    Transmitting...
                  </span>
                </div>
                <h3 className="text-6xl md:text-8xl font-black uppercase italic tracking-tighter leading-[0.85] min-h-[160px]">
                  <span className="text-white">
                    {displayText.includes("THE") ? "THE " : ""}
                  </span>
                  <span className="text-brandRed drop-shadow-[0_0_15px_rgba(255,0,0,0.5)]">
                    {displayText.replace("THE ", "").split(" ")[0]}
                  </span> 
                  <br />
                  <span className="text-white">
                    {displayText.split(" ").slice(2).join(" ")}
                  </span>
                  <span className="inline-block w-3 h-12 bg-brandRed ml-3 animate-pulse align-middle" />
                </h3>
                <p className="text-xl text-zinc-500 italic leading-relaxed border-l-2 border-brandRed/20 pl-6 max-w-sm">
                  Raw musical energy recreating the magic of Kerala unplugged.
                </p>
              </div>
            </div>
          </div>
        </section>

        <LaserDivider />

        {/* 4. BEAUTY PAGEANT */}
        <section className="max-w-7xl mx-auto mb-40">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-24 items-center">
            <div className="space-y-8">
                <div className="flex items-center gap-3">
                    <span className="w-12 h-px bg-brandRed" />
                    <span className="text-brandRed font-black uppercase text-[10px] tracking-[0.5em]">Annual Glamour</span>
                 </div>
              <h2 className="text-6xl md:text-8xl font-black uppercase italic tracking-tighter leading-none">
                The <span className="text-brandRed">Beauty</span> <br />Pageant Pune.
              </h2>
              <p className="text-xl text-zinc-400 italic font-medium">Elegance, culture, and identity on a single stage.</p>
            </div>
            <div className="relative h-[650px] w-full rounded-[60px] overflow-hidden border border-white/10 shadow-2xl">
              <Image 
                src="/about/beauty.jpeg" 
                alt="Pageant" 
                fill 
                className={`object-cover transition-opacity duration-1000 ${cycle ? 'opacity-0' : 'opacity-80'}`} 
              />
              <video 
                autoPlay loop muted playsInline 
                className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-1000 ${cycle ? 'opacity-80' : 'opacity-0'}`}
              >
                <source src="/videos/beauty.mp4" type="video/mp4" />
              </video>
            </div>
          </div>
        </section>

        <LaserDivider />

        {/* 5. ARCHITECTS (Founders) */}
        <section className="max-w-7xl mx-auto text-center mb-40">
          <h2 className="text-5xl md:text-8xl font-black uppercase italic tracking-tighter mb-24">The <span className="text-brandRed">Architects</span></h2>
          <div className="flex flex-wrap justify-center gap-24">
            <div className="group w-full max-w-[320px]">
              <div className="aspect-[3/4] rounded-[50px] overflow-hidden border border-white/10 mb-8 bg-zinc-950 shadow-2xl transition-all group-hover:border-brandRed group-hover:scale-105 duration-700">
                <Image src="/founders/suchi.jpg" alt="Sucheendran" width={400} height={533} className="object-cover w-full h-full grayscale group-hover:grayscale-0 transition-all duration-700" />
              </div>
              <h4 className="text-3xl font-black uppercase italic">Sucheendran K.C</h4>
              <p className="text-brandRed font-black uppercase text-xs tracking-[0.4em] mt-3">Founder</p>
            </div>
            <div className="group w-full max-w-[320px]">
              <div className="aspect-[3/4] rounded-[50px] overflow-hidden border border-white/10 mb-8 bg-zinc-950 shadow-2xl transition-all group-hover:border-brandRed group-hover:scale-105 duration-700">
                <Image src="/founders/shehanas.jpg" alt="Shena" width={400} height={533} className="object-cover w-full h-full grayscale group-hover:grayscale-0 transition-all duration-700" />
              </div>
              <h4 className="text-3xl font-black uppercase italic">Shena</h4>
              <p className="text-brandRed font-black uppercase text-xs tracking-[0.4em] mt-3">Co-Founder</p>
            </div>
          </div>
        </section>

        <LaserDivider />

        {/* 6. CONCISE GALLERY SECTION */}
        <section className="max-w-[90%] mx-auto mb-40 relative">
          <div className="flex flex-col md:flex-row items-baseline gap-6 mb-12">
            <h2 className="text-5xl md:text-7xl font-black uppercase italic tracking-tighter text-white">
              The <span className="text-brandRed">Archive</span>
            </h2>
            <p className="text-zinc-500 font-bold uppercase tracking-[0.3em] text-[10px]">
              Visual Legacy // 2026
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {(galleryImages.length > 0 ? galleryImages : [1, 2, 3, 4, 5, 6]).map((item, idx) => {
              const src = typeof item === 'string' ? item : `/gallery/img${item}.jpg`;
              return (
                <div key={idx} className="relative aspect-video md:aspect-[4/3] rounded-2xl overflow-hidden border border-white/5 group bg-zinc-900 shadow-2xl">
                  <Image 
                    src={src} 
                    alt={`Archive Legacy ${idx + 1}`} 
                    fill 
                    sizes="(max-width: 768px) 50vw, 33vw"
                    className="object-cover transition-all duration-700 grayscale group-hover:grayscale-0 group-hover:scale-110" 
                    priority={idx < 3}
                  />
                  <div className="absolute inset-0 bg-brandRed/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
                  <div className="absolute top-4 right-4 w-6 h-[1px] bg-white/20 group-hover:bg-brandRed transition-colors" />
                  <div className="absolute top-4 right-4 h-6 w-[1px] bg-white/20 group-hover:bg-brandRed transition-colors" />
                </div>
              );
            })}
          </div>
        </section>
        
        <LaserDivider />
        <InstagramGlimpse />
        <LaserDivider />
        
        {/* 6. NETWORK SECTION (REBALANCED FOR 3 CARDS) */}
<section className="max-w-7xl mx-auto text-center mb-40">
  <h2 className="text-6xl font-black uppercase italic tracking-tighter mb-24">Our <span className="text-brandRed">Network</span></h2>
  <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
    {[
      { name: "Pune Malayali Fed.", icon: <Handshake size={40}/> },
      { name: "Digital Partners", icon: <ShieldCheck size={40}/> },
      { name: "Community Support", icon: <Heart size={40}/> },
    ].map((partner, idx) => (
      <div key={idx} className="p-14 bg-zinc-950/50 border border-white/5 rounded-[40px] flex flex-col items-center justify-center group hover:border-brandRed transition-all duration-500 shadow-xl backdrop-blur-md">
        <div className="text-zinc-700 group-hover:text-brandRed mb-6 transition-colors">
          {partner.icon}
        </div>
        <span className="text-xs font-black uppercase tracking-[0.2em] text-zinc-500 group-hover:text-white transition-colors">
          {partner.name}
        </span>
      </div>
    ))}
  </div>
</section>

        {/* 7. CTA: THE TRIBE */}
        <section className="max-w-5xl mx-auto text-center pb-40">
          <div className="p-24 rounded-[80px] bg-gradient-to-br from-brandRed to-red-950 shadow-2xl relative overflow-hidden group">
            <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20" />
            <h2 className="text-5xl md:text-8xl font-black uppercase italic tracking-tighter mb-12 relative z-10 leading-none text-white">Become a part <br /> of the tribe.</h2>
            <Link href="/auth/login" className="relative z-10 inline-flex items-center gap-4 bg-white text-black px-16 py-6 rounded-full font-black uppercase tracking-widest text-sm hover:scale-110 transition shadow-2xl">
              Join Us Now <ArrowRight size={20} />
            </Link>
          </div>
        </section>
        <LaserDivider />
      </div>
    </main>
  );
}