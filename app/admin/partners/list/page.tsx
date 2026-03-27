"use client";
import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { createBrowserClient } from '@supabase/ssr';
import { 
  CheckCircle, ArrowRight, Loader2, ArrowLeft, 
  Image as ImageIcon, Plus, Briefcase, Phone, MessageSquare, Check, User, Trash2, Instagram, Globe
} from 'lucide-react';

const CATEGORIES = ["Advisory Board", "Board of Trustees", "Executive Council", "Trailblazers Panel"];
const DEFAULT_AVATAR = "https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_1280.png";

export default function ListMember() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get('edit');

  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1);
  const [gallery, setGallery] = useState<any[]>([]);
  const [showSuccess, setShowSuccess] = useState(false);
  const [isSameAsContact, setIsSameAsContact] = useState(false);

  const [formData, setFormData] = useState({
    name: '', category: 'Advisory Board', perk: '', 
    description: '', link: '', instagram: '', 
    contact: '', whatsapp: '', image: ''
  });

  const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

  useEffect(() => {
    if (editId) {
      fetch(`/api/partners?id=${editId}`).then(res => res.json()).then(item => {
        if (item) {
          setFormData({
            name: item.name || '',
            category: item.category || 'Advisory Board',
            perk: item.perk || '',
            description: item.description || '',
            link: item.link || '',
            instagram: item.instagram || '',
            contact: item.contact || '',
            whatsapp: item.whatsapp || '',
            image: item.image || ''
          });
          if (item.contact === item.whatsapp && item.contact !== '') setIsSameAsContact(true);
          if (item.image && item.image !== DEFAULT_AVATAR) {
             setGallery([{ id: 'main', type: 'existing', previewUrl: item.image }]);
          }
        }
      });
    }
  }, [editId]);

  useEffect(() => {
    if (isSameAsContact) {
      setFormData(prev => ({ ...prev, whatsapp: prev.contact }));
    }
  }, [isSameAsContact, formData.contact]);

  const handleFile = (e: any) => {
    const file = e.target.files[0];
    if (file) {
      setGallery([{ id: Date.now().toString(), type: 'new', file, previewUrl: URL.createObjectURL(file) }]);
    }
  };

  const handleSubmit = async () => {
    if (!formData.name) return alert("Member Name is mandatory.");
    setLoading(true);
    try {
      let finalImageUrl = formData.image || DEFAULT_AVATAR;

      if (gallery[0]?.type === 'new') {
        const file = gallery[0].file;
        const fileName = `member-${Date.now()}`;
        const { data } = await supabase.storage.from('partners').upload(fileName, file);
        if (data) {
          const { data: urlData } = supabase.storage.from('partners').getPublicUrl(data.path);
          finalImageUrl = urlData.publicUrl;
        }
      } else if (gallery.length === 0) {
        finalImageUrl = DEFAULT_AVATAR;
      }

      const payload = { ...formData, image: finalImageUrl };
      const res = await fetch('/api/partners/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editId ? { ...payload, _id: editId } : payload)
      });

      if (res.ok) {
        setShowSuccess(true);
        setTimeout(() => router.push('/admin/partners'), 2000);
      }
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-[#030303] text-white pt-40 pb-20 px-6">
      <AnimatePresence>
        {showSuccess && (
          <motion.div initial={{ opacity: 0, y: 50 }} animate={{ opacity: 1, y: 0 }} className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[200] bg-white text-black px-8 py-4 rounded-full flex items-center gap-3">
            <CheckCircle className="text-green-600" /> <span className="font-black uppercase text-xs">Member Updated</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="max-w-4xl mx-auto space-y-12">
        <div className="flex gap-2">
          {[1, 2].map(s => <div key={s} className={`h-1 flex-1 rounded-full ${step >= s ? 'bg-brandRed shadow-[0_0_10px_red]' : 'bg-zinc-800'}`} />)}
        </div>

        {step === 1 ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
            <h1 className="text-5xl font-black italic uppercase">Member <span className="text-brandRed">Core</span></h1>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-zinc-500 uppercase ml-2">Full Name</label>
                <input placeholder="NAME" className="w-full bg-zinc-900 border border-white/10 p-5 rounded-2xl outline-none focus:border-brandRed font-bold" value={formData.name || ''} onChange={e => setFormData({...formData, name: e.target.value.toUpperCase()})} />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-zinc-500 uppercase ml-2">Category</label>
                <select className="w-full bg-zinc-900 border border-white/10 p-5 rounded-2xl outline-none focus:border-brandRed font-bold appearance-none" value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})}>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="space-y-2 md:col-span-2">
                <label className="text-[10px] font-black text-zinc-500 uppercase ml-2">Profession</label>
                <input placeholder="E.G. DOCTOR / ENGINEER" className="w-full bg-zinc-900 border border-white/10 p-5 rounded-2xl outline-none focus:border-brandRed font-bold" value={formData.perk || ''} onChange={e => setFormData({...formData, perk: e.target.value.toUpperCase()})} />
              </div>
              
              <div className="space-y-2">
                <label className="text-[10px] font-black text-zinc-500 uppercase ml-2">Normal Contact</label>
                <div className="relative">
                  <Phone size={16} className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-600" />
                  <input placeholder="PHONE NUMBER" className="w-full bg-zinc-900 border border-white/10 p-5 pl-14 rounded-2xl outline-none focus:border-brandRed font-bold" value={formData.contact || ''} onChange={e => setFormData({...formData, contact: e.target.value.replace(/\D/g, '')})} />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center px-2">
                  <label className="text-[10px] font-black text-zinc-500 uppercase">WhatsApp Number</label>
                  <button onClick={() => setIsSameAsContact(!isSameAsContact)} className="flex items-center gap-2 group">
                    <div className={`w-4 h-4 rounded border ${isSameAsContact ? 'bg-brandRed border-brandRed' : 'border-zinc-600'} flex items-center justify-center transition-colors`}>
                      {isSameAsContact && <Check size={10} className="text-white" />}
                    </div>
                    <span className="text-[9px] font-black uppercase text-zinc-500 group-hover:text-white transition-colors">Same as Contact</span>
                  </button>
                </div>
                <div className="relative">
                  <MessageSquare size={16} className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-600" />
                  <input disabled={isSameAsContact} placeholder="WHATSAPP NUMBER" className={`w-full bg-zinc-900 border border-white/10 p-5 pl-14 rounded-2xl outline-none focus:border-brandRed font-bold ${isSameAsContact ? 'opacity-50 grayscale' : ''}`} value={formData.whatsapp || ''} onChange={e => setFormData({...formData, whatsapp: e.target.value.replace(/\D/g, '')})} />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-zinc-500 uppercase ml-2">Instagram Handle</label>
                <div className="relative">
                  <Instagram size={16} className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-600" />
                  <input placeholder="@USERNAME" className="w-full bg-zinc-900 border border-white/10 p-5 pl-14 rounded-2xl outline-none focus:border-brandRed font-bold" value={formData.instagram || ''} onChange={e => setFormData({...formData, instagram: e.target.value})} />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-zinc-500 uppercase ml-2">Website / Portfolio</label>
                <div className="relative">
                  <Globe size={16} className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-600" />
                  <input placeholder="HTTPS://..." className="w-full bg-zinc-900 border border-white/10 p-5 pl-14 rounded-2xl outline-none focus:border-brandRed font-bold text-xs" value={formData.link || ''} onChange={e => setFormData({...formData, link: e.target.value})} />
                </div>
              </div>
            </div>
            <button onClick={() => setStep(2)} className="w-full py-6 bg-white text-black rounded-2xl font-black uppercase tracking-widest hover:bg-brandRed hover:text-white transition-all flex items-center justify-center gap-2">Next: Photo & Bio <ArrowRight size={18} /></button>
          </motion.div>
        ) : (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
            <div className="flex items-center gap-4">
              <button onClick={() => setStep(1)} className="p-4 bg-zinc-900 rounded-xl hover:text-brandRed transition-colors"><ArrowLeft /></button>
              <h1 className="text-5xl font-black italic uppercase leading-none">Public <span className="text-brandRed">Persona</span></h1>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-zinc-500 uppercase ml-2">Display Picture</label>
                <label className="aspect-square border-2 border-dashed border-white/10 rounded-3xl flex flex-col items-center justify-center cursor-pointer hover:border-brandRed transition-all overflow-hidden bg-zinc-900/50 group relative">
                  {gallery[0] ? (
                    <>
                      <img src={gallery[0].previewUrl} className="w-full h-full object-cover" />
                      <button onClick={(e) => { e.preventDefault(); setGallery([]); }} className="absolute top-2 right-2 p-1.5 bg-black/60 rounded-lg text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-brandRed">
                         <Trash2 size={14} />
                      </button>
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                       <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-600">
                          <User size={32} />
                       </div>
                       <span className="text-[8px] font-black uppercase text-zinc-600">Tap to upload</span>
                    </div>
                  )}
                  <input type="file" className="hidden" onChange={handleFile} />
                </label>
                <p className="text-[8px] text-zinc-600 uppercase mt-2 ml-2 italic">* Reverts to default if cleared</p>
              </div>

              <div className="md:col-span-2 space-y-2">
                <label className="text-[10px] font-black text-zinc-500 uppercase ml-2">Bio / Narrative</label>
                <textarea placeholder="PROFESSIONAL BIO..." className="w-full bg-zinc-900 border border-white/10 p-6 rounded-3xl outline-none focus:border-brandRed min-h-[200px] font-medium" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} />
              </div>
            </div>

            <button onClick={handleSubmit} disabled={loading} className="w-full py-8 bg-brandRed text-white rounded-3xl font-black uppercase tracking-[0.4em] shadow-xl hover:bg-white hover:text-black transition-all">
              {loading ? <Loader2 className="animate-spin mx-auto" /> : 'Synchronize Member'}
            </button>
          </motion.div>
        )}
      </div>
    </div>
  );
}