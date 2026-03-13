"use client";
import { useState } from 'react';
import Image from 'next/image';
import { Mail, MapPin, Send, Loader2, Globe, Users, ShieldCheck, MessageCircle } from 'lucide-react';
import { useAlert } from '@/context/AlertContext';

const LaserDivider = () => (
  <div className="relative w-full h-px flex items-center justify-center overflow-visible my-4">
    <div className="absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-brandRed/40 to-transparent" />
    <div className="absolute w-[45%] h-[2px] bg-brandRed shadow-[0_0_25px_#FF0000] z-10" />
    <div className="absolute w-full h-[80px] bg-brandRed/5 blur-[60px] opacity-70 pointer-events-none" />
    <div className="absolute w-24 h-px bg-white blur-[1.5px] opacity-40 z-20" />
  </div>
);

export default function ContactPage() {
  const { showAlert } = useAlert();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    subject: '',
    message: ''
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (res.ok) {
        showAlert("Message sent successfully", "success");
        setFormData({ name: '', email: '', subject: '', message: '' });
      } else {
        throw new Error();
      }
    } catch (err) {
      showAlert("Failed to send message", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#030303] text-white relative selection:bg-brandRed/30 overflow-x-hidden">
      
      {/* 1. FIXED BRANDED BACKGROUND - TUNED OPACITY (0.38) */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden bg-black">
        <Image 
          src="/events/contact2.png" 
          alt="Background Atmosphere"
          fill
          priority
          className="object-cover object-center opacity-[0.38] brightness-[1.0] saturate-[1.15] contrast-[1.05]" 
        />
        <div className="absolute inset-0 bg-gradient-radial from-transparent via-zinc-950/20 to-[#030303] z-[1]" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#030303] z-[1]" />
        <div className="absolute inset-0 opacity-[0.04] bg-[url('https://grainy-gradients.vercel.app/noise.svg')] mix-blend-overlay z-[2]" />
      </div>

      <main className="relative z-10 pt-48 pb-32 px-6">
        <div className="max-w-7xl mx-auto flex flex-col lg:grid lg:grid-cols-12 gap-12 lg:gap-20">
          
          {/* LEFT CONTENT: BRAND & INFO */}
          <div className="lg:col-span-6 xl:col-span-7 space-y-16">
            <div className="space-y-8">
              <h1 className="text-7xl md:text-8xl font-black uppercase italic tracking-tighter leading-[0.8] mb-6 text-glow">
                Get In <br />
                <span className="text-brandRed">Touch.</span>
              </h1>
              
              <p className="text-zinc-400 font-bold uppercase tracking-[0.2em] text-sm leading-relaxed max-w-md">
                Have a question or want to collaborate? Drop us a message and our community team will get back to you shortly.
              </p>
            </div>

            {/* WHATSAPP REDIRECTION CARD */}
            <a 
              href="https://wa.me/919175981863" 
              target="_blank" 
              rel="noopener noreferrer"
              className="block max-w-md p-8 bg-zinc-950/40 backdrop-blur-xl border border-white/5 rounded-[40px] group hover:border-green-500/50 transition-all duration-500 shadow-2xl overflow-hidden relative"
            >
              <div className="absolute -right-4 -top-4 opacity-5 group-hover:opacity-10 transition-opacity">
                 <MessageCircle size={140} />
              </div>
              <div className="relative z-10 space-y-4">
                <div className="w-12 h-12 rounded-2xl bg-green-500/10 flex items-center justify-center border border-green-500/20 group-hover:bg-green-500 group-hover:text-black transition-all">
                  <MessageCircle size={24} />
                </div>
                <div>
                  <h4 className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-600 mb-1">Instant Support</h4>
                  <p className="text-2xl font-black italic uppercase">Chat on <span className="text-green-500">WhatsApp</span></p>
                </div>
                <div className="flex items-center gap-2 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
                  <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  Online & Ready to help
                </div>
              </div>
            </a>

            {/* DIRECT COMMS */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 gap-6 max-w-md">
               <div className="flex items-center gap-6 p-4 rounded-3xl hover:bg-white/5 transition-all group backdrop-blur-sm bg-black/10 border border-white/5">
                <div className="w-14 h-14 rounded-2xl bg-zinc-950/60 border border-white/5 flex items-center justify-center group-hover:border-brandRed transition-colors">
                  <Mail className="text-brandRed" size={24} />
                </div>
                <div className="space-y-1">
                  <p className="text-[9px] font-black uppercase tracking-[0.3em] text-zinc-600">Email Us</p>
                  <p className="text-base font-bold">punerimallus1@gmail.com</p>
                </div>
              </div>

              <div className="flex items-center gap-6 p-4 rounded-3xl hover:bg-white/5 transition-all group backdrop-blur-sm bg-black/10 border border-white/5">
                <div className="w-14 h-14 rounded-2xl bg-zinc-950/60 border border-white/5 flex items-center justify-center group-hover:border-brandRed transition-colors">
                  <MapPin className="text-brandRed" size={24} />
                </div>
                <div className="space-y-1">
                  <p className="text-[9px] font-black uppercase tracking-[0.3em] text-zinc-600">Location</p>
                  <p className="text-base font-bold uppercase">Pune, Maharashtra</p>
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT CONTENT: MEDIUM FORM CARD */}
          <div className="lg:col-span-6 xl:col-span-5 flex flex-col justify-center">
            <div className="relative">
              <div className="bg-zinc-950/40 border border-white/5 p-8 md:p-10 rounded-[50px] backdrop-blur-3xl shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 p-8 opacity-5">
                  <ShieldCheck size={100} />
                </div>

                <form className="space-y-6" onSubmit={handleSubmit}>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500 ml-4">Full Name</label>
                    <input 
                      required
                      type="text" 
                      placeholder="NAME" 
                      className="w-full bg-black/40 border border-white/10 p-5 rounded-2xl outline-none focus:border-brandRed transition-all font-bold text-sm backdrop-blur-xl"
                      value={formData.name}
                      onChange={(e) => setFormData({...formData, name: e.target.value})}
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500 ml-4">Email Address</label>
                    <input 
                      required
                      type="email" 
                      placeholder="EMAIL" 
                      className="w-full bg-black/40 border border-white/10 p-5 rounded-2xl outline-none focus:border-brandRed transition-all font-bold text-sm backdrop-blur-xl"
                      value={formData.email}
                      onChange={(e) => setFormData({...formData, email: e.target.value})}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500 ml-4">Subject</label>
                    <input 
                      required
                      type="text" 
                      placeholder="HOW CAN WE HELP?" 
                      className="w-full bg-black/40 border border-white/10 p-5 rounded-2xl outline-none focus:border-brandRed transition-all font-bold text-sm backdrop-blur-xl"
                      value={formData.subject}
                      onChange={(e) => setFormData({...formData, subject: e.target.value})}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500 ml-4">Message</label>
                    <textarea 
                      required
                      placeholder="MESSAGE..." 
                      rows={4} 
                      className="w-full bg-black/40 border border-white/10 p-5 rounded-2xl outline-none focus:border-brandRed transition-all font-bold text-sm resize-none backdrop-blur-xl"
                      value={formData.message}
                      onChange={(e) => setFormData({...formData, message: e.target.value})}
                    ></textarea>
                  </div>
                  
                  <button 
                    disabled={loading}
                    className="w-full bg-brandRed hover:bg-white hover:text-black py-6 rounded-2xl font-black uppercase tracking-[0.3em] transition-all shadow-lg active:scale-95 text-[10px] flex items-center justify-center gap-4"
                  >
                    {loading ? <Loader2 className="animate-spin" size={18} /> : (
                      <>
                        Send Message <Send size={14} fill="currentColor" />
                      </>
                    )}
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>
        <div className="mt-20">
          <LaserDivider />
        </div>
      </main>
    </div>
  );
}