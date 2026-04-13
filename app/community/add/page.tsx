"use client";
import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { createBrowserClient } from '@supabase/ssr';
import { 
  CheckCircle, ArrowRight, Loader2, ArrowLeft, 
  Image as ImageIcon, MapPin, Plus, Trash2, X, 
  Link as LinkIcon, Phone, Globe, Briefcase, Camera, Check, Clock, Instagram, Star
} from 'lucide-react';
import TribeTimePicker from '@/components/ui/TribeTimePicker';
import TribeAlert from '@/components/TribeAlert'; 

const EXTERNAL_CATEGORIES = ["SAMAJAM", "TEMPLE", "CHURCH", "ORGANIZATION", "OTHER"];

const LaserDivider = () => (
  <div className="relative w-full h-px flex items-center justify-center overflow-hidden my-2">
    <div className="absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-brandRed/40 to-transparent" />
    <div className="absolute w-[45%] h-[2px] bg-brandRed shadow-[0_0_25px_#FF0000] z-10" />
    <div className="absolute w-24 h-px bg-white blur-[1.5px] opacity-40 z-20" />
  </div>
);

// --- WRAPPER FOR NEXT.JS SEARCH PARAMS ---
export default function AddCommunityPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black flex items-center justify-center"><Loader2 className="animate-spin text-brandRed" /></div>}>
      <AddCommunityForm />
    </Suspense>
  );
}

function AddCommunityForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get('edit'); // 🔥 CAPTURE EDIT ID

  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1);
  const [gallery, setGallery] = useState<any[]>([]);
  const [thumbnailId, setThumbnailId] = useState<string | null>(null);
  const [services, setServices] = useState<any[]>([]); 
  const [showCustomCategory, setShowCustomCategory] = useState(false);

  const [alertConfig, setAlertConfig] = useState<{
    isVisible: boolean;
    message: string;
    type: 'success' | 'error' | 'info';
  }>({ isVisible: false, message: '', type: 'info' });

  const triggerAlert = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setAlertConfig({ isVisible: true, message, type });
  };

  const [pickerField, setPickerField] = useState<'openTime' | 'closeTime' | null>(null);
  const openTimeRef = useRef<HTMLDivElement>(null);
  const closeTimeRef = useRef<HTMLDivElement>(null);

  const [formData, setFormData] = useState({
    title: '', 
    category: 'SAMAJAM', 
    customCategory: '', 
    area: '', 
    tagline: '',
    description: '', 
    link: '', 
    instagram: '', 
    image: '', 
    mapUrl: '', 
    contact: '', 
    website: '',
    openTime: '09:00 AM', 
    closeTime: '06:00 PM'
  });

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!, 
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // 🔥 1. HYDRATION LOGIC: Load existing data if editing
  useEffect(() => {
    if (editId) {
      const fetchDraftData = async () => {
        try {
          const res = await fetch(`/api/community?id=${editId}`);
          if (res.ok) {
            const data = await res.json();
            
            // Map main fields
            setFormData({
              ...formData,
              title: data.title || '',
              category: EXTERNAL_CATEGORIES.includes(data.category) ? data.category : 'OTHER',
              customCategory: !EXTERNAL_CATEGORIES.includes(data.category) ? data.category : '',
              area: data.area || '',
              tagline: data.tagline || '',
              description: data.description || '',
              link: data.link || '',
              instagram: data.instagram || '',
              image: data.image || '',
              mapUrl: data.mapUrl || '',
              contact: data.contact || '',
              website: data.website || '',
              openTime: data.openTime || '09:00 AM',
              closeTime: data.closeTime || '06:00 PM'
            });

            if (data.services) setServices(data.services);
            if (data.category === "OTHER" || !EXTERNAL_CATEGORIES.includes(data.category)) setShowCustomCategory(true);

            // 🔥 Map existing images so they don't get lost
            if (data.imagePaths) {
              const existingGallery = data.imagePaths.map((url: string) => ({
                id: Math.random().toString(36).substr(2, 9),
                type: 'existing', // Mark as existing to skip re-upload
                file: null,
                previewUrl: url
              }));
              setGallery(existingGallery);

              // Set thumbnail focus
              const thumb = existingGallery.find((img: any) => img.previewUrl === data.image);
              if (thumb) setThumbnailId(thumb.id);
            }
          }
        } catch (err) {
          console.error("Hydration Error:", err);
        }
      };
      fetchDraftData();
    }
  }, [editId]);

  const addService = () => setServices([...services, { name: '', desc: '' }]);
  const removeService = (index: number) => setServices(services.filter((_, i) => i !== index));
  const updateService = (index: number, field: string, value: string) => {
    const updated = [...services];
    updated[index][field] = value;
    setServices(updated);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selected = Array.from(e.target.files);
      if (gallery.length + selected.length > 5) return triggerAlert("Max 5 images allowed", "error");
      const newImgs = selected.map(file => ({
        id: Math.random().toString(36).substr(2, 9),
        type: 'new', 
        file, 
        previewUrl: URL.createObjectURL(file)
      }));
      setGallery([...gallery, ...newImgs]);
      if (!thumbnailId && newImgs.length > 0) setThumbnailId(newImgs[0].id);
    }
  };

  const handleRemoveImage = (id: string) => {
    setGallery(prev => prev.filter(img => img.id !== id));
    if (thumbnailId === id) setThumbnailId(null);
  };

  // 🔥 2. SMART SUBMIT LOGIC
  const handleSubmit = async (isDraftMode: boolean = false) => {
    if (!isDraftMode) {
      if (gallery.length === 0) return triggerAlert("At least one image is required", "error");
      if (!thumbnailId) return triggerAlert("Please select a cover thumbnail", "error");
      if (!formData.title.trim()) return triggerAlert("Circle Name is required", "error");
      if (!formData.area.trim()) return triggerAlert("Location Area is required", "error");
      if (!formData.description.trim() || formData.description.length < 20) {
        return triggerAlert("Community Story is too short (min 20 chars)", "error");
      }
      if (!formData.contact || formData.contact.length !== 10) {
        return triggerAlert("Valid 10-digit WhatsApp contact required", "error");
      }
    } else {
      // Minimal check for drafts
      if (!formData.title.trim()) return triggerAlert("Provide a name to save draft", "info");
    }

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      let finalThumbnailUrl = formData.image || "";

      // 🔥 Process Images: Only upload 'new' ones
      const finalPaths = await Promise.all(gallery.map(async (img) => {
        if (img.type === 'existing') {
          if (img.id === thumbnailId) finalThumbnailUrl = img.previewUrl;
          return img.previewUrl;
        }

        const fileName = `user-node-${Date.now()}-${Math.random().toString(36).substr(2,5)}`;
        const { data, error } = await supabase.storage.from('community').upload(fileName, img.file);
        if (error) throw error;
        const { data: urlData } = supabase.storage.from('community').getPublicUrl(data.path);
        
        if (img.id === thumbnailId) finalThumbnailUrl = urlData.publicUrl;
        return urlData.publicUrl;
      }));

      const finalCategory = formData.category === "OTHER" ? formData.customCategory : formData.category;
      
      const payload = { 
        ...formData, 
        _id: editId, // 🔥 CRITICAL: Ensures MongoDB updates instead of creating new
        category: finalCategory.toUpperCase(), 
        image: finalThumbnailUrl, 
        imagePaths: finalPaths, 
        services,
        isApproved: false,
        isDraft: isDraftMode, 
        submittedBy: user?.email?.toLowerCase()
      };

      const res = await fetch('/api/community/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        triggerAlert(isDraftMode ? "Draft Updated Successfully" : "Submitted for Tribe Review", "success");
        setTimeout(() => router.push('/community'), 2500);
      }
    } catch (err) { 
      triggerAlert("Process failed. Please try again.", "error"); 
    } finally { 
      setLoading(false); 
    }
  };

  return (
    <div className="min-h-screen bg-[#030303] text-white pt-40 pb-20 px-6 selection:bg-brandRed/30">
      
      <TribeAlert 
        message={alertConfig.message}
        type={alertConfig.type}
        isVisible={alertConfig.isVisible}
        onClose={() => setAlertConfig(prev => ({ ...prev, isVisible: false }))}
      />

      <div className="max-w-4xl mx-auto space-y-12">
        <div className="flex gap-2">
          {[1, 2].map(s => (
            <div key={s} className={`h-1 flex-1 rounded-full transition-all duration-500 ${step >= s ? 'bg-brandRed shadow-[0_0_10px_#FF0000]' : 'bg-zinc-800'}`} />
          ))}
        </div>

        {step === 1 ? (
          <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="space-y-10">
            <header className="space-y-2">
               <h1 className="text-5xl font-black italic uppercase leading-none">
                 Register <span className="text-brandRed">Circle .</span>
               </h1>
               <p className="text-zinc-500 text-[10px] font-black uppercase tracking-[0.3em]">Phase 01: Core Identity</p>
            </header>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-2 md:col-span-2 border border-white/25 p-6 rounded-[32px] focus-within:border-brandRed transition-all">
                <label className="text-[10px] font-black uppercase text-zinc-500 ml-2">Organization Name *</label>
                <input placeholder="E.G. PUNE MALAYALEE ASSOCIATION" className="w-full bg-transparent outline-none font-bold text-white text-xl uppercase" value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} />
              </div>

              <div className="space-y-2 border border-white/25 p-6 rounded-[32px] focus-within:border-brandRed transition-all">
                <label className="text-[10px] font-black uppercase text-zinc-500 ml-2">Sector Type *</label>
                <select className="w-full bg-transparent outline-none font-bold text-white cursor-pointer" value={formData.category} onChange={(e) => { setFormData({...formData, category: e.target.value}); setShowCustomCategory(e.target.value === "OTHER"); }}>
                  {EXTERNAL_CATEGORIES.map(c => <option key={c} value={c} className="bg-black">{c}</option>)}
                </select>
              </div>

              <div className="space-y-2 border border-white/25 p-6 rounded-[32px] focus-within:border-brandRed transition-all">
                <label className="text-[10px] font-black uppercase text-zinc-500 ml-2">Area / Location *</label>
                <input placeholder="E.G. BANER" className="w-full bg-transparent outline-none font-bold text-white uppercase" value={formData.area} onChange={e => setFormData({...formData, area: e.target.value})} />
              </div>

              <div className="space-y-2 border border-white/25 p-6 rounded-[32px] focus-within:border-brandRed transition-all" ref={openTimeRef}>
                <label className="text-[10px] font-black uppercase text-zinc-500 ml-2 flex items-center gap-2"><Clock size={12}/> Opening Time</label>
                <div onClick={() => setPickerField('openTime')} className="cursor-pointer font-bold text-white flex justify-between items-center py-2">{formData.openTime}</div>
              </div>

              <div className="space-y-2 border border-white/25 p-6 rounded-[32px] focus-within:border-brandRed transition-all" ref={closeTimeRef}>
                <label className="text-[10px] font-black uppercase text-zinc-500 ml-2 flex items-center gap-2"><Clock size={12}/> Closing Time</label>
                <div onClick={() => setPickerField('closeTime')} className="cursor-pointer font-bold text-white flex justify-between items-center py-2">{formData.closeTime}</div>
              </div>

              {showCustomCategory && (
                <div className="space-y-2 md:col-span-2 border border-brandRed/30 p-6 rounded-[32px]">
                  <label className="text-[10px] font-black uppercase text-brandRed ml-2">Custom Category Name *</label>
                  <input placeholder="SPECIFY CATEGORY" className="w-full bg-transparent outline-none font-bold text-white uppercase" value={formData.customCategory} onChange={e => setFormData({...formData, customCategory: e.target.value})} />
                </div>
              )}

              <div className="space-y-2 md:col-span-2 border border-white/25 p-6 rounded-[32px] focus-within:border-brandRed transition-all">
                <label className="text-[10px] font-black uppercase text-zinc-500 ml-2">Google Maps Link</label>
                <input placeholder="PASTE GOOGLE MAPS LINK" className="w-full bg-transparent outline-none font-bold text-xs text-white" value={formData.mapUrl} onChange={e => setFormData({...formData, mapUrl: e.target.value})} />
              </div>
            </div>
            
            <button onClick={() => setStep(2)} className="w-full py-8 bg-white text-black rounded-[32px] font-black uppercase tracking-[0.3em] transition-all hover:bg-brandRed hover:text-white flex items-center justify-center gap-4">
              <span>Next: Services & Media</span><ArrowRight size={20} />
            </button>
          </motion.div>
        ) : (
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-10">
            <div className="flex items-center gap-4">
              <button onClick={() => setStep(1)} className="p-4 border border-white/25 rounded-2xl hover:bg-brandRed transition-all text-white"><ArrowLeft /></button>
              <h1 className="text-5xl font-black italic uppercase leading-none text-white">Visual <span className="text-brandRed">Identity .</span></h1>
            </div>

            {/* 🔥 SERVICES SECTION (RESTORED & SEPARATED) */}
<div className="border border-white/25 p-8 rounded-[40px] space-y-6">
  <div className="flex justify-between items-center px-2">
    <div className="flex items-center gap-3 text-brandRed">
      <Briefcase size={20} />
      <label className="text-[11px] font-black uppercase tracking-widest text-white">Specific Services</label>
    </div>
    <button 
      onClick={addService} 
      className="text-[10px] bg-white text-black px-5 py-2 rounded-full font-black uppercase hover:bg-brandRed hover:text-white transition-all shadow-lg active:scale-95"
    >
      + Add Service
    </button>
  </div>

  <div className="space-y-10">
    {services.map((service, index) => (
      <div key={index} className="relative group space-y-4">
        {/* DELETE BUTTON */}
        <button 
          onClick={() => removeService(index)} 
          className="absolute -top-3 -right-3 p-2 bg-red-600 text-white rounded-full z-20 opacity-0 group-hover:opacity-100 transition-all shadow-xl hover:scale-110 active:scale-90 border-2 border-[#030303]"
        >
          <X size={14} strokeWidth={3} />
        </button>

        {/* SEPARATED HEADER BOX */}
        <div className="border border-white/10 p-5 rounded-[24px] bg-zinc-950/40 focus-within:border-brandRed transition-all">
          <label className="text-[9px] font-black uppercase text-zinc-500 ml-1 mb-1 block tracking-widest">
            Service Designation
          </label>
          <input 
            placeholder="E.G. EMERGENCY WELFARE" 
            className="w-full bg-transparent outline-none text-sm font-black uppercase text-white px-1" 
            value={service.name} 
            onChange={(e) => updateService(index, 'name', e.target.value)} 
          />
        </div>

        {/* SEPARATED DESCRIPTION BOX */}
        <div className="border border-white/10 p-5 rounded-[24px] bg-zinc-950/40 focus-within:border-brandRed transition-all">
          <label className="text-[9px] font-black uppercase text-zinc-500 ml-1 mb-1 block tracking-widest">
            Offer Details
          </label>
          <textarea 
            placeholder="DESCRIBE THE SCOPE OF THIS SERVICE..." 
            rows={2} 
            className="w-full bg-transparent outline-none text-xs font-medium text-zinc-400 italic px-1 resize-none" 
            value={service.desc} 
            onChange={(e) => updateService(index, 'desc', e.target.value)} 
          />
        </div>
      </div>
    ))}

    {/* EMPTY STATE */}
    {services.length === 0 && (
      <div className="border border-dashed border-white/5 rounded-[32px] py-12 flex flex-col items-center justify-center gap-3">
        <Briefcase size={24} className="text-zinc-800" />
        <p className="text-zinc-600 text-[10px] font-black uppercase tracking-[0.2em] italic text-center">
          Inventory Empty: No Services Cataloged
        </p>
      </div>
    )}
  </div>
</div>

            {/* 🔥 GALLERY SECTION (RESTORED) */}
            <div className="border border-white/25 p-8 rounded-[40px] space-y-6">
                <div className="flex items-center gap-3 text-brandRed px-2"><Camera size={20}/><label className="text-[11px] font-black uppercase tracking-widest text-white">Media Gallery *</label></div>
                <div className="flex gap-6 overflow-x-auto pb-6 pt-4 no-scrollbar">
                    {gallery.map((img) => (
                        <div key={img.id} className="relative flex-shrink-0 group">
                          <button type="button" onClick={() => setThumbnailId(img.id)} className={`relative w-32 h-32 rounded-[24px] overflow-hidden border-2 transition-all ${thumbnailId === img.id ? 'border-brandRed scale-105' : 'border-white/5 opacity-40'}`}>
                              <img src={img.previewUrl} className="w-full h-full object-cover" alt="Preview" />
                              {thumbnailId === img.id && <div className="absolute inset-0 bg-brandRed/10 flex items-center justify-center text-white"><Star size={20} fill="currentColor" /></div>}
                          </button>
                          <button type="button" onClick={() => handleRemoveImage(img.id)} className="absolute -top-3 -right-3 p-2 bg-red-600 text-white rounded-full opacity-0 group-hover:opacity-100 transition-all z-[30]"><X size={14}/></button>
                        </div>
                    ))}
                    {gallery.length < 5 && (
                      <label className="shrink-0 w-32 h-32 border-2 border-dashed border-white/25 rounded-[24px] flex flex-col items-center justify-center cursor-pointer hover:border-brandRed transition-all text-zinc-700">
                        <Plus size={24} /><input type="file" multiple className="hidden" onChange={handleFileChange} />
                      </label>
                    )}
                </div>
            </div>

            <div className="border border-white/25 p-8 rounded-[40px] focus-within:border-brandRed transition-all">
                <label className="text-[10px] font-black uppercase text-zinc-500 mb-4 block ml-2">Description / Bio *</label>
                <textarea placeholder="TELL YOUR STORY..." className="w-full bg-transparent outline-none min-h-[150px] font-medium italic text-white text-lg leading-relaxed" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} />
            </div>

            {/* 🔥 DIGITAL CONNECTIONS (RESTORED) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {[
                  { label: 'WhatsApp Contact *', icon: Phone, key: 'contact', placeholder: '10 DIGITS' },
                  { label: 'Group Link', icon: LinkIcon, key: 'link', placeholder: 'HTTPS://CHAT...' },
                  { label: 'Instagram Handle', icon: Instagram, key: 'instagram', placeholder: '@USERNAME' },
                  { label: 'Official Website', icon: Globe, key: 'website', placeholder: 'WWW.DOMAIN.COM' }
                ].map((field) => (
                  <div key={field.key} className="border border-white/25 p-6 rounded-[32px] focus-within:border-brandRed transition-all">
                    <label className="text-[10px] font-black uppercase text-zinc-500 ml-2">{field.label}</label>
                    <div className="flex items-center mt-2">
                      <field.icon className="text-zinc-600 mr-3" size={16} />
                      <input placeholder={field.placeholder} className="w-full bg-transparent outline-none font-bold text-white text-sm" value={formData[field.key as keyof typeof formData]} onChange={e => setFormData({...formData, [field.key]: e.target.value})} />
                    </div>
                  </div>
                ))}
            </div>

            <div className="flex flex-col md:flex-row gap-4 pt-6">
              <motion.button whileHover={{ y: -5 }} onClick={() => handleSubmit(true)} disabled={loading} className="flex-1 py-7 bg-zinc-900 text-zinc-400 border border-white/10 rounded-[32px] font-black uppercase tracking-[0.2em] text-[15px] flex items-center justify-center gap-2">
                {loading ? <Loader2 className="animate-spin" size={18} /> : "Save as Draft"}
              </motion.button>
              <motion.button whileHover={{ y: -5, scale: 1.01 }} onClick={() => handleSubmit(false)} disabled={loading} className="flex-[2] py-7 bg-brandRed text-white rounded-[32px] font-black uppercase tracking-[0.4em] text-[15px] flex items-center justify-center gap-2 shadow-xl">
                {loading ? <Loader2 className="animate-spin" size={18} /> : <>Finalize Submission <CheckCircle size={18} /></>}
              </motion.button>
            </div>
          </motion.div>
        )}
        <LaserDivider/>
      </div>

      <AnimatePresence>
        {pickerField && <TribeTimePicker value={formData[pickerField]} anchorRef={pickerField === 'openTime' ? openTimeRef : closeTimeRef} onClose={() => setPickerField(null)} onChange={(time) => setFormData({ ...formData, [pickerField]: time })} />}
      </AnimatePresence>
    </div>
  );
}