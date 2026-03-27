"use client";
import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { 
  MessageCircle, Globe, Instagram, 
  ExternalLink, Share2, 
  Zap, Loader2, ArrowLeft, Briefcase, Phone
} from 'lucide-react';

export default function MemberDetailsPage() {
  const { id } = useParams();
  const [item, setItem] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchDetails() {
      try {
        const res = await fetch(`/api/partners?id=${id}`);
        const data = await res.json();
        if (data && !data.error) setItem(data);
      } catch (err) { console.error(err); } finally { setLoading(false); }
    }
    fetchDetails();
  }, [id]);

  if (loading) return <div className="min-h-screen bg-black flex items-center justify-center"><Loader2 className="animate-spin text-brandRed" size={30} /></div>;
  if (!item) return <div className="min-h-screen bg-black flex flex-col items-center justify-center text-white"><h1>Member Not Found</h1><Link href="/partners" className="mt-4 px-6 py-2 bg-brandRed rounded-full text-[10px] font-black uppercase">Return</Link></div>;

  // Helper to find the phone number in any possible field name
  const phoneNumber = item.contact || item.phone || item.mobile;

  const getWhatsAppLink = () => {
    const waNum = item.whatsapp || phoneNumber;
    if (waNum) return `https://wa.me/91${waNum.toString().replace(/\D/g,'')}`;
    return "#";
  };

  return (
    <div className="min-h-screen bg-[#030303] text-zinc-100 relative overflow-x-hidden selection:bg-brandRed/30">
      
      <div className="fixed inset-0 z-0 pointer-events-none bg-black">
        <Image src="/events/partner_3.png" alt="BG" fill priority className="object-cover opacity-[0.50] brightness-[0.7]" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#030303] via-transparent to-[#030303]" />
      </div>

      <main className="max-w-6xl mx-auto px-6 pt-44 pb-32 relative z-10">
        
        <Link href="/partners" className="inline-flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-zinc-500 hover:text-white mb-12 transition-all group">
          <ArrowLeft size={14} className="group-hover:-translate-x-1 transition-transform" /> Back to Architects
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
          
          <div className="lg:col-span-4 space-y-6">
            <div className="relative aspect-[4/5] rounded-[40px] overflow-hidden border border-white/10 bg-zinc-900 shadow-2xl group">
              <Image src={item.image} alt={item.name} fill unoptimized className="object-cover transition-transform duration-700 group-hover:scale-105" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <button onClick={() => navigator.share({title: item.name, url: window.location.href})} className="absolute top-4 right-4 p-3 bg-black/60 backdrop-blur-md rounded-full text-white hover:bg-brandRed transition-all z-20">
                <Share2 size={16} />
              </button>
            </div>

            <div className="bg-black/40 border border-white/10 p-8 rounded-[40px] space-y-6 backdrop-blur-xl">
               <h3 className="text-[9px] font-black uppercase tracking-[0.4em] text-zinc-500 border-b border-white/5 pb-4">Communication</h3>
               
               <div className="space-y-4">
                  {phoneNumber && (
                    <div className="flex flex-col gap-1">
                      <p className="text-[8px] font-black uppercase text-zinc-600 tracking-widest">Mobile Contact</p>
                      <a href={`tel:${phoneNumber}`} className="flex items-center gap-3 hover:text-brandRed transition-colors">
                        <Phone size={14} className="text-brandRed" />
                        <span className="text-xs font-bold tracking-widest">+91 {phoneNumber}</span>
                      </a>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-4 items-center pt-2">
                    {item.instagram && (
                      <a href={`https://instagram.com/${item.instagram.replace('@','')}`} target="_blank" className="text-zinc-400 hover:text-brandRed transition-all hover:scale-110"><Instagram size={24} /></a>
                    )}
                    {item.link && (
                      <a href={item.link} target="_blank" className="text-zinc-400 hover:text-brandRed transition-all hover:scale-110"><Globe size={24} /></a>
                    )}
                  </div>
               </div>
            </div>
          </div>

          <div className="lg:col-span-8 space-y-10">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-brandRed/10 border border-brandRed/20 rounded-lg">
                <Zap size={12} className="text-brandRed fill-brandRed" />
                <span className="text-[9px] font-black uppercase tracking-[0.2em] text-brandRed">{item.category}</span>
              </div>
              <h1 className="text-5xl md:text-7xl font-black text-white italic uppercase tracking-tighter leading-[0.9]">{item.name}</h1>
              <div className="flex items-center gap-3 text-zinc-400 pt-2">
                 <Briefcase size={16} className="text-brandRed" />
                 <p className="font-bold uppercase tracking-[0.3em] text-[10px] md:text-xs">{item.perk}</p>
              </div>
            </div>

            <div className="bg-black/40 border border-white/10 p-10 rounded-[45px] space-y-6 backdrop-blur-md">
                <h2 className="text-[9px] font-black text-white uppercase tracking-[0.4em] flex items-center gap-3">
                  <div className="w-10 h-px bg-brandRed" /> Profile Biography
                </h2>
                <p className="text-zinc-300 text-base md:text-lg leading-relaxed italic border-l-2 border-brandRed/20 pl-8 whitespace-pre-wrap break-words">
                  {item.description || "The biography for this member is currently being synchronized."}
                </p>
            </div>

            {/* TWO PRIMARY BUTTONS */}
<div className="flex flex-col sm:flex-row gap-4 max-w-2xl pt-4">
    {/* 1. DIRECT CALL BUTTON */}
    {phoneNumber && (
        <a 
        href={`tel:${phoneNumber}`} 
        className="w-full sm:flex-1 h-16 sm:h-20 bg-white text-black rounded-2xl flex items-center justify-center gap-3 font-black uppercase text-[11px] sm:text-xs tracking-widest hover:bg-brandRed hover:text-white transition-all shadow-2xl active:scale-95"
        >
        <Phone size={20} /> Call Representative
        </a>
    )}

    {/* 2. WHATSAPP BUTTON - Optimized for Mobile height and width */}
    {(item.whatsapp || phoneNumber) && (
        <a 
        href={getWhatsAppLink()} 
        target="_blank" 
        className="w-full sm:flex-1 h-16 sm:h-20 bg-[#25D366] text-white rounded-2xl flex items-center justify-center gap-3 font-black uppercase text-[11px] sm:text-xs tracking-widest hover:bg-white hover:text-[#25D366] border border-[#25D366]/20 transition-all shadow-2xl active:scale-95"
        >
        <MessageCircle size={22} /> WhatsApp Chat
        </a>
    )}
</div>
          </div>
        </div>
      </main>
    </div>
  );
}