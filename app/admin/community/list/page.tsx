"use client";
import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { createBrowserClient } from '@supabase/ssr';
import { 
  CheckCircle, ArrowRight, Loader2, ArrowLeft, 
  Image as ImageIcon, MapPin, Plus, Trash2, X, 
  Link as LinkIcon, Instagram, Phone, Globe, Briefcase, Camera, Check
} from 'lucide-react';

const INTERNAL_CATEGORIES = ["JAMMING", "SPORTS", "ARTS", "TECH", "COMMUNITY", "OTHER"];
const EXTERNAL_CATEGORIES = ["SAMAJAM", "TEMPLE", "CHURCH", "ORGANIZATION", "OTHER"];

export default function ListOrganization() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get('edit');

  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1);
  const [gallery, setGallery] = useState<any[]>([]);
  const [thumbnailId, setThumbnailId] = useState<string | null>(null); // Tracks the thumbnail
  const [services, setServices] = useState<any[]>([]);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showCustomCategory, setShowCustomCategory] = useState(false);

  const [formData, setFormData] = useState({
    title: '', category: 'COMMUNITY', customCategory: '', area: '', tagline: '',
    description: '', link: '', instagram: '', image: '', mapUrl: '', contact: '', website: ''
  });

  const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const isExternal = EXTERNAL_CATEGORIES.includes(formData.category) && !INTERNAL_CATEGORIES.includes(formData.category);

  useEffect(() => {
    if (editId) {
      fetch(`/api/community`).then(res => res.json()).then(data => {
        const item = data.find((i: any) => i._id === editId);
        if (item) {
          const allStandard = [...INTERNAL_CATEGORIES, ...EXTERNAL_CATEGORIES.filter(c => c !== "OTHER")];
          const isCustom = !allStandard.includes(item.category?.toUpperCase());
          
          setFormData({
            title: item.title || '',
            category: isCustom ? "OTHER" : (item.category || 'COMMUNITY'),
            customCategory: isCustom ? item.category : '',
            area: item.area || '',
            tagline: item.tagline || '',
            description: item.description || '',
            link: item.link || '',
            instagram: item.instagram || '',
            image: item.image || '',
            mapUrl: item.mapUrl || '',
            contact: item.contact || '',
            website: item.website || ''
          });
          setShowCustomCategory(isCustom);
          setServices(item.services || []);
          const paths = item.imagePaths || (item.image ? [item.image] : []);
          const existingGallery = paths.map((p: string) => ({ id: p, type: 'existing', previewUrl: p }));
          setGallery(existingGallery);
          // Set first image as thumbnail if editing
          if (existingGallery.length > 0) setThumbnailId(existingGallery[0].id);
        }
      });
    }
  }, [editId]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selected = Array.from(e.target.files);
      if (gallery.length + selected.length > 7) return alert("Max 7 assets allowed");
      const newImgs = selected.map(file => ({
        id: Math.random().toString(36).substr(2, 9),
        type: 'new', file, previewUrl: URL.createObjectURL(file)
      }));
      setGallery([...gallery, ...newImgs]);
      // Auto-set thumbnail if none selected
      if (!thumbnailId && newImgs.length > 0) setThumbnailId(newImgs[0].id);
    }
  };

  const handleSubmit = async () => {
    if (gallery.length === 0) return alert("At least one image is required");
    if (!thumbnailId) return alert("Please select a thumbnail for the card");
    if (!formData.description.trim()) return alert("Description is mandatory");

    setLoading(true);
    try {
      let finalThumbnailUrl = "";
      const finalPaths = await Promise.all(gallery.map(async (img) => {
        let url = img.previewUrl;
        if (img.type === 'new') {
          const fileName = `node-${Date.now()}-${Math.random().toString(36).substr(2,5)}`;
          const { data, error } = await supabase.storage.from('community').upload(fileName, img.file);
          if (error) throw error;
          const { data: urlData } = supabase.storage.from('community').getPublicUrl(data.path);
          url = urlData.publicUrl;
        }
        if (img.id === thumbnailId) finalThumbnailUrl = url;
        return url;
      }));

      const finalCategory = formData.category === "OTHER" ? formData.customCategory : formData.category;
      const payload = { 
        ...formData, 
        category: finalCategory.toUpperCase(), 
        image: finalThumbnailUrl, // The selected card thumbnail
        imagePaths: finalPaths, 
        services 
      };

      const res = await fetch('/api/community/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editId ? { ...payload, _id: editId } : payload)
      });

      if (res.ok) {
        setShowSuccess(true);
        setTimeout(() => router.push('/admin/community'), 2000);
      }
    } catch (err) { console.error(err); alert("Sync failed"); } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-[#030303] text-white pt-40 pb-20 px-6">
      <AnimatePresence>
        {showSuccess && (
          <motion.div initial={{ opacity: 0, y: 50 }} animate={{ opacity: 1, y: 0 }} className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[200] bg-white text-black px-8 py-4 rounded-full flex items-center gap-3 shadow-2xl">
            <CheckCircle className="text-green-600" /> <span className="font-black uppercase text-xs tracking-widest">Community Updated</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="max-w-4xl mx-auto space-y-12">
        <div className="flex gap-2">
          {[1, 2].map(s => <div key={s} className={`h-1 flex-1 rounded-full ${step >= s ? 'bg-cyan-400 shadow-[0_0_10px_cyan]' : 'bg-zinc-800'}`} />)}
        </div>

        {step === 1 ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
            <h1 className="text-5xl font-black italic uppercase leading-none">Node <span className="text-cyan-400">Core</span></h1>
            {/* Step 1 Inputs (Keep existing inputs here) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
               {/* Rest of Step 1 inputs as per original code */}
               <div className="space-y-2 md:col-span-2">
                <label className="text-[10px] font-black uppercase text-zinc-500 ml-2">Node Name *</label>
                <input placeholder="NAME" className="w-full bg-zinc-900 border border-white/10 p-5 rounded-2xl outline-none focus:border-cyan-400 font-bold" value={formData.title || ''} onChange={e => setFormData({...formData, title: e.target.value.toUpperCase()})} />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase text-zinc-500 ml-2">Sector Type *</label>
                <select className="w-full bg-zinc-900 border border-white/10 p-5 rounded-2xl outline-none focus:border-cyan-400 font-bold appearance-none" value={formData.category} 
                  onChange={(e) => {
                    const val = e.target.value;
                    setFormData({...formData, category: val});
                    setShowCustomCategory(val === "OTHER");
                  }}>
                   <optgroup label="Internal Tribe">{INTERNAL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
                   <optgroup label="External Tie-ups">{EXTERNAL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase text-zinc-500 ml-2">Area / Base {isExternal && '*'}</label>
                <input placeholder={isExternal ? "MANDATORY AREA" : "OPTIONAL AREA"} className="w-full bg-zinc-900 border border-white/10 p-5 rounded-2xl outline-none focus:border-cyan-400 font-bold" value={formData.area || ''} onChange={e => setFormData({...formData, area: e.target.value.toUpperCase()})} />
              </div>
              {showCustomCategory && (
                <div className="space-y-2 md:col-span-2">
                  <label className="text-[10px] font-black uppercase text-cyan-400 ml-2">Custom Sector Name *</label>
                  <input placeholder="E.G. CHARITY FOUNDATION" className="w-full bg-zinc-900 border border-cyan-400/30 p-5 rounded-2xl outline-none focus:border-cyan-400 font-bold" value={formData.customCategory || ''} onChange={e => setFormData({...formData, customCategory: e.target.value.toUpperCase()})} />
                </div>
              )}
              <div className="space-y-2 md:col-span-2">
                <label className="text-[10px] font-black uppercase text-zinc-500 ml-2">Google Maps Link {isExternal && '*'}</label>
                <div className="relative">
                  <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600" size={18} />
                  <input placeholder="PASTE GOOGLE MAPS LINK" className="w-full bg-zinc-900 border border-white/10 p-5 pl-12 rounded-2xl outline-none focus:border-cyan-400 font-bold text-xs" value={formData.mapUrl || ''} onChange={e => setFormData({...formData, mapUrl: e.target.value})} />
                </div>
              </div>
            </div>
            <button onClick={() => setStep(2)} className="w-full py-6 bg-white text-black rounded-2xl font-black uppercase tracking-widest hover:bg-cyan-400 transition-all flex items-center justify-center gap-3 shadow-xl">Next: Media & Details <ArrowRight size={20}/></button>
          </motion.div>
        ) : (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
            <div className="flex items-center gap-4">
              <button onClick={() => setStep(1)} className="p-4 bg-zinc-900 rounded-xl hover:bg-cyan-400 transition-all"><ArrowLeft /></button>
              <h1 className="text-5xl font-black italic uppercase leading-none">Visual <span className="text-cyan-400">Identity</span></h1>
            </div>

            {/* 1. THUMBNAIL SELECTION SECTION */}
            <div className="bg-zinc-900/30 p-8 rounded-[40px] border border-white/5 space-y-6">
                <div className="flex items-center gap-3 text-cyan-400">
                    <Camera size={20}/>
                    <label className="text-[11px] font-black uppercase tracking-widest text-white">Select Card Thumbnail *</label>
                </div>
                <div className="flex gap-4 overflow-x-auto pb-4 no-scrollbar">
                    {gallery.length > 0 ? (
                        gallery.map((img) => (
                            <button 
                                key={img.id}
                                onClick={() => setThumbnailId(img.id)}
                                className={`relative flex-shrink-0 w-32 h-32 rounded-2xl overflow-hidden border-2 transition-all ${thumbnailId === img.id ? 'border-cyan-400 scale-105 shadow-[0_0_15px_rgba(34,211,238,0.4)]' : 'border-white/5 opacity-50'}`}
                            >
                                <img src={img.previewUrl} className="w-full h-full object-cover" alt="thumb" />
                                {thumbnailId === img.id && (
                                    <div className="absolute inset-0 bg-cyan-400/20 flex items-center justify-center">
                                        <div className="bg-cyan-400 text-black rounded-full p-1"><Check size={12} strokeWidth={4} /></div>
                                    </div>
                                )}
                            </button>
                        ))
                    ) : (
                        <div className="w-full h-32 flex items-center justify-center border border-dashed border-white/10 rounded-2xl text-zinc-600 text-[10px] font-bold uppercase">
                            Upload images below first
                        </div>
                    )}
                </div>
                <p className="text-[9px] text-zinc-500 font-bold uppercase italic">* This image will be shown on the main directory card.</p>
            </div>

            {/* 2. MEDIA GALLERY SECTION */}
            <div className="bg-zinc-900/30 p-8 rounded-[40px] border border-white/5 space-y-6">
                <div className="flex items-center gap-3 text-cyan-400">
                    <ImageIcon size={20}/>
                    <label className="text-[11px] font-black uppercase tracking-widest text-white">Media Assets ({gallery.length}/7)</label>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {gallery.map((img) => (
                    <div key={img.id} className="relative aspect-square rounded-3xl overflow-hidden border border-white/10">
                      <img src={img.previewUrl} className="w-full h-full object-cover" alt="Gallery" />
                      <button 
                        onClick={() => {
                            setGallery(gallery.filter(g => g.id !== img.id));
                            if (thumbnailId === img.id) setThumbnailId(null);
                        }} 
                        className="absolute top-2 right-2 p-1.5 bg-black/60 text-white rounded-lg hover:bg-red-500 transition-colors"
                      >
                        <X size={12}/>
                      </button>
                    </div>
                  ))}
                  {gallery.length < 7 && (
                    <label className="aspect-square border-2 border-dashed border-white/10 rounded-3xl flex flex-col items-center justify-center cursor-pointer hover:border-cyan-400 transition-all bg-zinc-950/50 group">
                      <Plus size={30} className="text-zinc-700 group-hover:text-cyan-400 transition-colors" />
                      <span className="text-[8px] font-black uppercase text-zinc-600 mt-1">Add Media</span>
                      <input type="file" multiple className="hidden" onChange={handleFileChange} />
                    </label>
                  )}
                </div>
            </div>

            <div className="space-y-2">
                <label className="text-[10px] font-black uppercase text-zinc-500 ml-2">Description / Bio *</label>
                <textarea placeholder="TELL THE STORY..." className="w-full bg-zinc-900 border border-white/10 p-6 rounded-3xl outline-none focus:border-cyan-400 min-h-[150px] font-medium italic" value={formData.description || ''} onChange={e => setFormData({...formData, description: e.target.value})} />
            </div>

            {/* Step 2 Sections (Services, Contact - No logic changes) */}
            <div className="bg-zinc-900/30 p-8 rounded-[40px] border border-white/5 space-y-6">
                <div className="flex justify-between items-center">
                   <div className="flex items-center gap-3 text-cyan-400"><Briefcase size={20}/><label className="text-[11px] font-black uppercase tracking-widest text-white">Services ({services.length}/10)</label></div>
                   <button onClick={() => setServices([...services, { name: '', desc: '' }])} className="p-3 bg-cyan-400 text-black rounded-xl hover:bg-white transition-all text-[10px] font-black uppercase tracking-tighter flex items-center gap-2"><Plus size={16}/> Add</button>
                </div>
                <div className="space-y-4">
                  {services.map((s, i) => (
                    <div key={i} className="flex flex-col md:flex-row gap-4 p-5 bg-black rounded-2xl border border-white/5">
                      <input className="flex-1 bg-zinc-900 border border-white/10 rounded-xl p-3 text-[11px] font-bold outline-none focus:border-cyan-400" placeholder="NAME" value={s.name || ''} onChange={e => { const copy = [...services]; copy[i].name = e.target.value.toUpperCase(); setServices(copy); }} />
                      <input className="flex-[2] bg-zinc-900 border border-white/10 rounded-xl p-3 text-[11px] text-zinc-400 outline-none focus:border-cyan-400" placeholder="DESCRIPTION" value={s.desc || ''} onChange={e => { const copy = [...services]; copy[i].desc = e.target.value; setServices(copy); }} />
                      <button onClick={() => setServices(services.filter((_, idx) => idx !== i))} className="p-3 text-zinc-600 hover:text-red-500"><Trash2 size={18} /></button>
                    </div>
                  ))}
                </div>
            </div>

            {/* CONTACTS (Logic kept exactly same) */}
            <div className="bg-zinc-900/30 p-8 rounded-[40px] border border-white/5 space-y-6">
                <h3 className="text-xs font-black uppercase tracking-widest text-cyan-400 ml-2">Contact & Social Channels</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-zinc-500 ml-2">WhatsApp Number {isExternal && '*'}</label>
                        <div className="relative"><Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600" size={16} /><input placeholder="10 DIGITS" maxLength={10} className="w-full bg-black border border-white/10 p-5 pl-12 rounded-2xl outline-none focus:border-cyan-400 font-bold" value={formData.contact || ''} onChange={e => setFormData({...formData, contact: e.target.value.replace(/\D/g,'')})} /></div>
                    </div>
                    <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-zinc-500 ml-2">Instagram Handle {!isExternal && '*'}</label>
                        <div className="relative"><Instagram className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600" size={16} /><input placeholder="@USERNAME" className="w-full bg-black border border-white/10 p-5 pl-12 rounded-2xl outline-none focus:border-cyan-400 font-bold uppercase" value={formData.instagram || ''} onChange={e => setFormData({...formData, instagram: e.target.value})} /></div>
                    </div>
                    <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-zinc-500 ml-2">WhatsApp Community Link {!isExternal && '*'}</label>
                        <div className="relative"><LinkIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600" size={16} /><input placeholder="HTTPS://CHAT..." className="w-full bg-black border border-white/10 p-5 pl-12 rounded-2xl outline-none focus:border-cyan-400 font-bold text-xs" value={formData.link || ''} onChange={e => setFormData({...formData, link: e.target.value})} /></div>
                    </div>
                    <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-zinc-500 ml-2">Website</label>
                        <div className="relative"><Globe className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600" size={16} /><input placeholder="WWW.SITE.COM" className="w-full bg-black border border-white/10 p-5 pl-12 rounded-2xl outline-none focus:border-cyan-400 font-bold text-xs" value={formData.website || ''} onChange={e => setFormData({...formData, website: e.target.value})} /></div>
                    </div>
                </div>
            </div>

            <button onClick={handleSubmit} disabled={loading || gallery.length === 0} className="w-full py-8 bg-cyan-500 text-black rounded-3xl font-black uppercase tracking-[0.4em] shadow-xl hover:bg-white transition-all disabled:opacity-50">
              {loading ? <Loader2 className="animate-spin mx-auto" /> : editId ? 'Sync Node Intelligence' : 'Broadcast to Grid'}
            </button>
          </motion.div>
        )}
      </div>
    </div>
  );
}