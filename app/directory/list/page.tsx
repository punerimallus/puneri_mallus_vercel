"use client";
import { useState, useEffect, Suspense, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { createBrowserClient } from '@supabase/ssr';
import { 
  CheckCircle, ArrowRight, Loader2, ShieldCheck, 
  Instagram, Globe, Phone, Check, MousePointer2, ArrowLeft, X, Image as ImageIcon, MapPin, Star, Clock, MessageCircle, Plus, Trash2, Briefcase
} from 'lucide-react';
import Link from 'next/link';
import TribeConfirm from '@/components/TribeConfirm';
import TribeTimePicker from '@/components/ui/TribeTimePicker';
import EmailVerificationGate from '@/components/EmailVerificationGate'; // 🔥 Importing your untouched Gate

const FIXED_CATEGORIES = [
  "FOOD & BEVERAGE", "REAL ESTATE", "HEALTH & WELLNESS",  "SPORTS" ,"EDUCATION", 
  "IT SERVICES", "AUTOMOBILE", "BEAUTY & SALON", "HOME DECOR", 
  "LEGAL & FINANCE", "TRAVEL & TOURISM", "EVENT MANAGEMENT", "OTHER"
];

interface ServiceItem {
  id: string;
  name: string;
  desc: string;
}

interface UnifiedImage {
  id: string;
  type: 'existing' | 'new';
  path?: string;
  file?: File;
  previewUrl: string;
}

const Field = ({ label, icon: Icon, placeholder, value, onChange, onBlur, error, loading, type = "text", maxLength }: any) => (
  <div className="space-y-2 w-full group relative mb-2">
    <div className="flex items-center justify-between ml-2">
      <div className="flex items-center gap-2">
        {Icon && <Icon size={14} className="text-brandRed" />}
        <label className={`text-[11px] font-black uppercase tracking-[0.2em] ${error ? 'text-red-500' : 'text-white'}`}>{label}</label>
      </div>
      {loading && <Loader2 size={12} className="animate-spin text-brandRed mr-2" />}
    </div>
    <input 
      type={type} value={value || ''} onChange={onChange} onBlur={onBlur} placeholder={placeholder} maxLength={maxLength}
      className={`w-full bg-zinc-900 border-2 rounded-2xl p-5 text-white font-bold outline-none transition-all placeholder:text-zinc-600 ${error ? 'border-red-500 focus:border-red-500' : 'border-white/20 focus:border-brandRed'}`}
    />
    {error && <p className="text-red-500 text-[10px] font-bold uppercase tracking-widest ml-2 absolute -bottom-5 left-0">{error}</p>}
  </div>
);

function ListContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get('edit');
  const [sameForWhatsapp, setSameForWhatsapp] = useState(true);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [step, setStep] = useState(1);
  const [user, setUser] = useState<any>(null);
  
  const [isVerified, setIsVerified] = useState<boolean>(false);
  const [verifiedEmail, setVerifiedEmail] = useState<string>(''); 

  const [gallery, setGallery] = useState<UnifiedImage[]>([]);
  const [initialPaths, setInitialPaths] = useState<string[]>([]);
  const [services, setServices] = useState<ServiceItem[]>([
    { id: Math.random().toString(), name: '', desc: '' }
  ]);
  const [showOtherCategory, setShowOtherCategory] = useState(false);
  const [showSuccessToast, setShowSuccessToast] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState({ title: '', message: '' });

  const [nameError, setNameError] = useState<string | null>(null);
  const [checkingName, setCheckingName] = useState(false);
  
  const openTimeRef = useRef<HTMLDivElement>(null);
  const closeTimeRef = useRef<HTMLDivElement>(null);
  const [pickerField, setPickerField] = useState<'openTime' | 'closeTime' | null>(null);

  const [formData, setFormData] = useState({
    name: '', category: '', customCategory: '', area: '', mapUrl: '', 
    description: '', contact: '', instagram: '',
    website: '', buttonText: '', buttonUrl: '', openTime: '09:00 AM',
    closeTime: '06:00 PM', whatsapp: '', 
  });

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const trackingFired = useRef(false);

  const handleFirstInteraction = async () => {
    if (!trackingFired.current && user?.id) {
      trackingFired.current = true;
      console.log("⌨️ Form interaction detected! Upserting status to STARTED_FILLING...");
      
      await supabase
        .from('directory_owners')
        .upsert({ 
          user_id: user.id,
          source: 'MALLU_MART',
          status: 'STARTED_FILLING'
        }, { onConflict: 'user_id, source' });
    }
  };

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return router.push('/auth/login');
      setUser(user);

      try {
        const { data: ownerRecords } = await supabase
          .from('directory_owners')
          .select('is_verified, verified_email')
          .eq('user_id', user.id)
          .eq('source', 'MALLU_MART')
          .limit(1);

        const ownerRecord = ownerRecords?.[0];

        if (ownerRecord) {
          setIsVerified(ownerRecord.is_verified);
          if (ownerRecord.verified_email) {
            setVerifiedEmail(ownerRecord.verified_email);
          }
        }

        if (editId) {
          const res = await fetch(`/api/mart?t=${Date.now()}`, { cache: 'no-store' });
          const data = await res.json();
          const item = data.find((i: any) => i._id === editId);
          if (item) {
            const isCustomCat = !FIXED_CATEGORIES.includes(item.category);
            
            setFormData({
              ...item,
              category: isCustomCat ? "OTHER" : item.category,
              customCategory: isCustomCat ? item.category : '',
              whatsapp: item.whatsapp || item.contact || '' 
            });
            
            setShowOtherCategory(isCustomCat);
            setSameForWhatsapp(!item.whatsapp || item.contact === item.whatsapp);

            setServices(item.services?.length > 0 ? item.services : [{ id: Math.random().toString(), name: '', desc: '' }]);
            const paths = item.imagePaths || (item.imagePath ? [item.imagePath] : []);
            setInitialPaths(paths);
            setGallery(paths.map((p: string) => ({
              id: p, type: 'existing', path: p,
              previewUrl: `https://bhfrgcphqmbocplfcvbg.supabase.co/storage/v1/object/public/mallu-mart/${p}`
            })));
          }
        }
      } catch (err) { 
        console.error(err); 
      } finally { 
        setFetching(false); 
      }
    };
    init();
  }, [editId, router, supabase]);

  const verifyNameAvailability = async (nameVal: string) => {
    if (!nameVal.trim()) return setNameError(null);
    setCheckingName(true);
    try {
      const res = await fetch(`/api/check-name?name=${encodeURIComponent(nameVal)}${editId ? `&excludeId=${editId}` : ''}`);
      const data = await res.json();
      if (data.exists) {
        setNameError(`This name is already registered in ${data.source}.`);
      } else {
        setNameError(null);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setCheckingName(false);
    }
  };

  const triggerAlert = (title: string, message: string) => {
    setConfirmConfig({ title, message });
    setConfirmOpen(true);
  };

  const validateStep1 = () => {
    const { name, category, area, mapUrl, customCategory } = formData;
    if (!name || !category || !area || !mapUrl) return false;
    if (category === "OTHER" && !customCategory) return false;
    if (nameError) return false;
    return true;
  };

  const addService = () => {
    if (services.length >= 10) return triggerAlert("Limit Reached", "Max 10 services allowed.");
    setServices([...services, { id: Math.random().toString(), name: '', desc: '' }]);
  };

  const updateService = (id: string, field: 'name' | 'desc', val: string) => {
    if (field === 'desc' && val.length > 300) return; 
    setServices(services.map(s => s.id === id ? { ...s, [field]: val } : s));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selected = Array.from(e.target.files);
      if (gallery.length + selected.length > 7) return triggerAlert("Gallery Limit", "Max 7 images.");
      const newImgs: UnifiedImage[] = selected.map(file => ({
        id: Math.random().toString(36).substr(2, 9),
        type: 'new' as const, file, previewUrl: URL.createObjectURL(file)
      }));
      setGallery([...gallery, ...newImgs]);
    }
  };

  const swapImages = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= gallery.length) return;
    const newGallery = [...gallery];
    const [movedItem] = newGallery.splice(fromIndex, 1);
    newGallery.splice(toIndex, 0, movedItem);
    setGallery(newGallery);
  };

  const makeThumbnail = (index: number) => {
    const newArr = [...gallery];
    const [selected] = newArr.splice(index, 1);
    setGallery([selected, ...newArr]);
  };

  const processWebsite = (url: string) => {
    if (!url) return "";
    let formattedUrl = url.trim().toLowerCase();
    if (!/^https?:\/\//i.test(formattedUrl)) {
      formattedUrl = `https://${formattedUrl}`;
    }
    return formattedUrl;
  };

  // 🔥 Split into TWO functions: Validation & Execution

  const handlePreSubmit = (e: React.FormEvent, isDraftMode: boolean = false) => {
    e.preventDefault();

    if (!isDraftMode) {
      const phoneRegex = /^\d{10}$/; 
      if (phoneRegex.test(formData.instagram.trim())) return triggerAlert("Invalid Instagram", "You entered a phone number instead of an Instagram handle.");
      const cleanWeb = formData.website.trim();
      if (phoneRegex.test(cleanWeb)) return triggerAlert("Invalid Website", "Websites cannot be just a 10-digit phone number.");
      if (gallery.length === 0) return triggerAlert("Required", "Upload at least 1 image.");
      if (!formData.description) return triggerAlert("Required", "Add a business description.");
      
      const hasValidService = services.some(s => s.name.trim() !== '' && s.desc.trim() !== '');
      if (!hasValidService) return triggerAlert("Required", "Please add at least one specific service with a name and description.");
      
      const targetNumber = sameForWhatsapp ? formData.contact : formData.whatsapp;
      if (targetNumber.length !== 10) return triggerAlert("Invalid Number", "Please enter a valid 10-digit WhatsApp number.");

      // 🔥 THE MAGIC: If they are NOT verified yet, show the existing Gate component!
      if (!isVerified) {
        setStep(3);
        return; 
      }
    } else {
      if (!formData.name) return triggerAlert("Required", "Please at least provide a Business Name to save a draft.");
    }

    // If they ARE verified (or saving a draft), execute normally
    let submitEmail = verifiedEmail || user?.email || "";
    if (!submitEmail || submitEmail.includes('supabase.co')) {
      const manualEmail = window.prompt("We need a valid email address for notifications. Please enter it below:");
      if (manualEmail && manualEmail.includes('@')) {
        submitEmail = manualEmail;
      } else {
        return triggerAlert("Required", "A valid email is required to submit your listing.");
      }
    }

    executeSubmit(isDraftMode, submitEmail);
  };

  // The actual database upload logic
  const executeSubmit = async (isDraftMode: boolean, submitEmail: string) => {
    setLoading(true);
    try {
      const finalWebsite = processWebsite(formData.website);
      const currentExistingPaths = gallery.filter(img => img.type === 'existing').map(img => img.path);
      const pathsToDelete = initialPaths.filter(path => !currentExistingPaths.includes(path));

      if (pathsToDelete.length > 0) {
        await supabase.storage.from('mallu-mart').remove(pathsToDelete);
      }

      const uploadPromises = gallery.map(async (img) => {
        if (img.type === 'existing') return img.path;
        const fileName = `${user.id}-${Date.now()}-${Math.random().toString(36).substr(2,5)}`;
        const { data, error } = await supabase.storage.from('mallu-mart').upload(fileName, img.file!);
        if (error) throw error;
        return data.path;
      });

      const finalPaths = await Promise.all(uploadPromises);
      const finalCategory = formData.category === "OTHER" ? formData.customCategory : formData.category;
      
      const martData = { 
        ...formData,
        website: finalWebsite,   
        category: finalCategory ? finalCategory.toUpperCase() : "OTHER",
        imagePaths: finalPaths, 
        services,
        userEmail: submitEmail.toLowerCase(), 
        userId: user?.id, 
        isApproved: false, 
        emailVerified: isVerified, // We only get here if they are verified
        isDraft: isDraftMode 
      };

      const res = await fetch('/api/mart', {
        method: editId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editId ? { id: editId, userEmail: martData.userEmail, updatedData: martData } : martData),
      });

      if (res.ok) {
        setDraftSaved(isDraftMode);
        setShowSuccessToast(true);
        setTimeout(() => router.push('/directory'), 2500);
      }
    } catch (err) { 
      triggerAlert("Error", "Failed to save data.");
    } finally { 
      setLoading(false); 
    }
  };

  if (fetching) {
    return <div className="min-h-screen bg-black flex items-center justify-center"><Loader2 className="animate-spin text-brandRed" /></div>;
  }

  return (
    <div className="min-h-screen bg-[#030303] text-white pt-40 pb-20 px-6">
      
      <TribeConfirm 
        isOpen={confirmOpen}
        title={confirmConfig.title}
        message={confirmConfig.message}
        onConfirm={() => setConfirmOpen(false)}
        onCancel={() => setConfirmOpen(false)}
      />

      <AnimatePresence>
        {showSuccessToast && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }} 
            animate={{ opacity: 1, y: 0 }} 
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[200] bg-white text-black px-8 py-4 rounded-full flex items-center gap-3 shadow-[0_0_40px_rgba(255,255,255,0.2)]"
          >
            <CheckCircle className={draftSaved ? "text-zinc-500" : "text-green-600"} size={20} />
            <div className="flex flex-col">
              <span className="font-black uppercase text-xs tracking-widest">
                {draftSaved ? "Draft Saved" : "Broadcast Successful"}
              </span>
              <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-tight">
                {draftSaved 
                  ? "Finish and submit whenever you're ready" 
                  : "Visible once approved by the Admin"}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="max-w-4xl mx-auto">
        
        {/* Progress Bar (Hidden when showing Gate) */}
        {step !== 3 && (
          <div className="flex gap-3 mb-16">
            {[1, 2].map((s) => (
              <div key={s} className={`h-2 flex-1 rounded-full transition-all duration-700 ${step >= s ? 'bg-brandRed shadow-[0_0_20px_#FF0000]' : 'bg-zinc-800'}`} />
            ))}
          </div>
        )}

        <AnimatePresence mode="wait">
         {step === 1 && (
          <motion.div key="step1" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="space-y-10" onFocusCapture={handleFirstInteraction} onChangeCapture={handleFirstInteraction}>
            <div className="flex justify-between items-center gap-4">
              <h1 className="text-4xl md:text-6xl font-black italic uppercase leading-none text-white">Business <span className="text-brandRed">Core</span></h1>
              <Link href="/directory" className="p-3 md:p-4 bg-zinc-900 rounded-2xl border border-white/10 hover:bg-brandRed transition-all"><X /></Link>
            </div>

            <div className="grid grid-cols-1 gap-8">
              <Field 
                label="Business Name" 
                value={formData.name} 
                onChange={(e: any) => {
                  setFormData({...formData, name: e.target.value});
                  if (nameError) setNameError(null);
                }} 
                onBlur={(e: any) => verifyNameAvailability(e.target.value)}
                error={nameError}
                loading={checkingName}
                placeholder="e.g. THE MALABAR KITCHEN" 
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-2">
                  <label className="text-[11px] font-black uppercase text-white tracking-[0.2em] ml-2">Market Sector</label>
                  <select 
                    value={formData.category} 
                    onChange={(e) => {
                      setFormData({...formData, category: e.target.value});
                      setShowOtherCategory(e.target.value === "OTHER");
                    }}
                    className="w-full bg-zinc-900 border-2 border-white/20 rounded-2xl p-5 text-white font-bold outline-none focus:border-brandRed h-[64px] appearance-none"
                  >
                    <option value="">SELECT CATEGORY</option>
                    {FIXED_CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                  </select>
                </div>
                <Field label="Operational Area" value={formData.area} onChange={(e: any) => setFormData({...formData, area: e.target.value})} placeholder="e.g. Baner" />
              </div>

              {showOtherCategory && (
                <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
                  <Field label="Custom Category" value={formData.customCategory} onChange={(e: any) => setFormData({...formData, customCategory: e.target.value})} placeholder="e.g. CONSULTANCY" />
                </motion.div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-2 border-2 border-white/20 p-5 rounded-2xl focus-within:border-brandRed transition-all bg-zinc-900/50 hover:bg-zinc-900" ref={openTimeRef}>
                  <label className="text-[11px] font-black uppercase text-white tracking-[0.2em] ml-2 flex items-center gap-2">
                    <Clock size={14} className="text-brandRed" /> Opening Time
                  </label>
                  <div 
                    onClick={() => setPickerField('openTime')}
                    className="cursor-pointer font-bold text-white flex justify-between items-center py-2 px-2"
                  >
                    <span className="text-lg">{formData.openTime || "09:00 AM"}</span>
                    <Clock size={18} className="text-zinc-600 group-hover:text-white transition-colors" />
                  </div>
                </div>

                <div className="space-y-2 border-2 border-white/20 p-5 rounded-2xl focus-within:border-brandRed transition-all bg-zinc-900/50 hover:bg-zinc-900" ref={closeTimeRef}>
                  <label className="text-[11px] font-black uppercase text-white tracking-[0.2em] ml-2 flex items-center gap-2">
                    <Clock size={14} className="text-brandRed" /> Closing Time
                  </label>
                  <div 
                    onClick={() => setPickerField('closeTime')}
                    className="cursor-pointer font-bold text-white flex justify-between items-center py-2 px-2"
                  >
                    <span className="text-lg">{formData.closeTime || "06:00 PM"}</span>
                    <Clock size={18} className="text-zinc-600 group-hover:text-white transition-colors" />
                  </div>
                </div>
              </div>

              <Field label="Google Maps Link" icon={MapPin} value={formData.mapUrl} onChange={(e: any) => setFormData({...formData, mapUrl: e.target.value})} placeholder="Paste shared link..." />
              
              <div className="pt-4">
                <button 
                  onClick={() => {
                    if (nameError) return triggerAlert("Name Unavailable", "Please choose a different business name. This one is taken.");
                    if (checkingName) return;
                    validateStep1() ? setStep(2) : triggerAlert("Required", "Fill all Step 1 fields.");
                  }} 
                  className="w-full py-8 bg-white text-black rounded-[30px] font-black uppercase tracking-[0.4em] text-sm hover:bg-brandRed hover:text-white transition-all shadow-2xl flex items-center justify-center gap-3 active:scale-95"
                >
                  Next: Services & Visuals <ArrowRight size={20} />
                </button>
              </div>
            </div>

            <AnimatePresence>
              {pickerField && (
                <TribeTimePicker 
                  value={formData[pickerField]}
                  anchorRef={pickerField === 'openTime' ? openTimeRef : closeTimeRef}
                  onClose={() => setPickerField(null)}
                  onChange={(time) => setFormData({ ...formData, [pickerField]: time })}
                />
              )}
            </AnimatePresence>
          </motion.div>
         )}

          {step === 2 && (
            <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-12">
              <div className="flex items-center gap-4 md:gap-6">
                <button onClick={() => setStep(1)} className="p-3 md:p-4 bg-zinc-900 rounded-2xl border border-white/10 hover:bg-brandRed transition-all"><ArrowLeft /></button>
                <h1 className="text-4xl md:text-6xl font-black italic uppercase leading-none">Portfolio & <span className="text-brandRed">Work</span></h1>
              </div>

              <div className="bg-zinc-900/50 p-8 rounded-[40px] border-2 border-white/10 space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                   <div className="flex items-center gap-3 text-brandRed">
                     <Briefcase size={20} />
                     <span className="text-[12px] font-black uppercase tracking-widest text-white">Specific Services ({services.length}/10) *</span>
                   </div>
                   <button onClick={addService} className="p-3 bg-brandRed text-white rounded-xl hover:bg-white hover:text-black transition-all flex items-center justify-center gap-2 text-[10px] font-bold w-full sm:w-auto"><Plus size={16}/> ADD SERVICE</button>
                </div>
                <div className="space-y-4">
                {services.map((s) => (
                  <div key={s.id} className="flex flex-col md:flex-row gap-4 p-5 bg-black rounded-2xl border border-white/5 relative">
                      <input 
                        className="flex-1 bg-zinc-900 border border-white/10 rounded-xl p-3 text-[11px] font-bold text-white outline-none focus:border-brandRed" 
                        placeholder="Service Name *" 
                        value={s.name} 
                        onChange={(e) => updateService(s.id, 'name', e.target.value)} 
                      />
                      <input 
                        className="flex-[2] bg-zinc-900 border border-white/10 rounded-xl p-3 text-[11px] text-zinc-400 outline-none focus:border-brandRed" 
                        placeholder="Short Description *" 
                        value={s.desc} 
                        maxLength={300}
                        onChange={(e) => updateService(s.id, 'desc', e.target.value)} 
                      />
                      
                      {services.length > 1 && (
                        <button onClick={() => setServices(services.filter(x => x.id !== s.id))} className="p-3 text-zinc-600 hover:text-brandRed transition-colors flex justify-center">
                          <Trash2 size={18}/>
                        </button>
                      )}
                  </div>
                ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-black uppercase text-white tracking-[0.2em] ml-2">Business Narrative (Description)</label>
                <textarea 
                  className="w-full bg-zinc-900 border-2 border-white/20 rounded-[30px] p-8 text-white font-medium outline-none focus:border-brandRed transition-all min-h-[160px] italic leading-relaxed" 
                  value={formData.description || ''} 
                  onChange={(e) => setFormData({...formData, description: e.target.value})} 
                  placeholder="Detail your professional expertise..." 
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {gallery.map((img, idx) => (
                  <motion.div layout key={img.id} className={`relative aspect-square rounded-[35px] overflow-hidden border-4 bg-zinc-900 ${idx === 0 ? 'border-brandRed shadow-[0_0_30px_rgba(255,0,0,0.3)]' : 'border-white/20'}`}>
                    <img src={img.previewUrl} className="object-cover w-full h-full" alt="Preview" />
                    <div className="absolute top-4 left-4 right-4 flex justify-between z-20">
                       <button onClick={() => makeThumbnail(idx)} className={`p-2.5 rounded-full ${idx === 0 ? 'bg-brandRed text-white' : 'bg-black/60 text-white/40'}`}><Star size={16} fill={idx === 0 ? "white" : "none"} /></button>
                       <button onClick={() => setGallery(gallery.filter(g => g.id !== img.id))} className="p-2.5 bg-black/60 text-white rounded-full hover:bg-brandRed transition-all"><X size={16}/></button>
                    </div>
                    <div className="absolute bottom-4 left-4 right-4 flex gap-2 z-20">
                       <button onClick={() => swapImages(idx, idx - 1)} className="flex-1 bg-black/60 py-2 rounded-xl border border-white/10 flex justify-center"><ArrowLeft size={16}/></button>
                       <button onClick={() => swapImages(idx, idx + 1)} className="flex-1 bg-black/60 py-2 rounded-xl border border-white/10 flex justify-center"><ArrowRight size={16}/></button>
                    </div>
                  </motion.div>
                ))}
                {gallery.length < 7 && (
                  <label className="aspect-square border-4 border-dashed border-white/20 rounded-[35px] flex flex-col items-center justify-center bg-zinc-900 cursor-pointer hover:border-brandRed/50 transition-all">
                    <ImageIcon className="text-zinc-600 group-hover:text-brandRed mb-3" size={40} />
                    <input type="file" multiple accept="image/*" onChange={handleFileChange} className="hidden" />
                  </label>
                )}
              </div>

              <div className="space-y-6">

                <Field 
                  label="First Point of Contact (10 Digits)" 
                  icon={Phone} 
                  value={formData.contact} 
                  onChange={(e: any) => {
                    const val = e.target.value.replace(/\D/g, ''); 
                    if (val.length <= 10) {
                      setFormData({ 
                        ...formData, 
                        contact: val, 
                        ...(sameForWhatsapp ? { whatsapp: val } : {}) 
                      });
                    }
                  }} 
                  placeholder="9XXXXXXXXX" 
                  maxLength={10} 
                  type="tel"
                />

                <label className="flex items-center gap-3 cursor-pointer group px-2 w-fit -mt-2 mb-4">
                  <div className={`w-5 h-5 rounded border flex items-center justify-center transition-all duration-300 ${sameForWhatsapp ? 'bg-brandRed border-brandRed' : 'border-white/20 bg-black/50 group-hover:border-brandRed/50'}`}>
                    {sameForWhatsapp && <Check size={14} className="text-white" />}
                  </div>
                  <input 
                    type="checkbox" 
                    className="hidden" 
                    checked={sameForWhatsapp} 
                    onChange={(e) => {
                      const isChecked = e.target.checked;
                      setSameForWhatsapp(isChecked);
                      if (isChecked) {
                        setFormData({ ...formData, whatsapp: formData.contact });
                      }
                    }} 
                  />
                  <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400 group-hover:text-white transition-colors">
                    Number is same for WhatsApp
                  </span>
                </label>

                <AnimatePresence>
                  {!sameForWhatsapp && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.3, ease: "easeInOut" }}
                      className="overflow-hidden"
                    >
                      <div className="pt-2">
                        <Field 
                          label="WhatsApp Number (10 Digits)" 
                          icon={MessageCircle} 
                          value={formData.whatsapp} 
                          onChange={(e: any) => {
                            const val = e.target.value.replace(/\D/g, '');
                            if (val.length <= 10) {
                              setFormData({...formData, whatsapp: val});
                            }
                          }} 
                          placeholder="9XXXXXXXXX" 
                          maxLength={10} 
                          type="tel"
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <Field label="Instagram ID" icon={Instagram} value={formData.instagram} onChange={(e: any) => setFormData({...formData, instagram: e.target.value})} placeholder="Username" />

                <Field 
                  label="Official Website" 
                  icon={Globe} 
                  value={formData.website} 
                  onChange={(e: any) => setFormData({...formData, website: e.target.value})} 
                  placeholder="www.yourbusiness.com" 
                  type="url"
                />
                
                <div className="flex flex-col md:flex-row gap-4 mt-12">
                  <motion.button 
                    type="button"
                    initial={{ y: 0 }}
                    whileHover={{ 
                      y: -8, 
                      backgroundColor: "#27272a",
                      borderColor: "rgba(255,255,255,0.3)" 
                    }}
                    whileTap={{ scale: 0.98 }}
                    transition={{ type: "spring", stiffness: 400, damping: 17 }}
                    onClick={(e) => handlePreSubmit(e, true)} 
                    disabled={loading} 
                    className="flex-1 py-7 bg-zinc-900 text-zinc-300 border border-white/10 rounded-[30px] font-black uppercase tracking-[0.2em] text-[12px] flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {loading ? <Loader2 className="animate-spin" size={18} /> : <>Save as Draft</>}
                  </motion.button>

                  <motion.button 
                    type="button"
                    initial={{ y: 0 }}
                    whileHover={{ 
                      y: -8, 
                      scale: 1.01,
                      backgroundColor: "#ff1a1a",
                      boxShadow: "0 20px 40px rgba(255,0,0,0.25)" 
                    }}
                    whileTap={{ scale: 0.98 }}
                    transition={{ type: "spring", stiffness: 400, damping: 17 }}
                    onClick={(e) => handlePreSubmit(e, false)} 
                    disabled={loading} 
                    className="flex-[2] py-7 bg-brandRed text-white rounded-[30px] font-black uppercase tracking-[0.4em] text-[15px] flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {loading ? <Loader2 className="animate-spin" size={18} /> : (
                      <>
                        {editId ? 'Sync Updates' : 'Publish to Mart'}
                        {!editId && <ArrowRight size={16} />}
                      </>
                    )}
                  </motion.button>
                </div>
              </div>
            </motion.div>
          )}

         {/* 🔥 STEP 3: THE VERIFICATION GATE WRAPPER */}
         {step === 3 && (
           <motion.div key="step3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="py-2 space-y-8">
             
             {/* 🔥 THE CONSTANT HEADER WITH GO BACK BUTTON */}
             <div className="flex items-center gap-4 md:gap-6">
               <button onClick={() => setStep(2)} className="p-3 md:p-4 bg-zinc-900 rounded-2xl border border-white/10 hover:bg-brandRed transition-all">
                 <ArrowLeft />
               </button>
               <div>
                 <h1 className="text-3xl md:text-5xl font-black italic uppercase leading-none">One Last <span className="text-brandRed">Step</span></h1>
                 <p className="text-xs md:text-sm text-zinc-400 font-medium mt-1">Verify your email to submit your listing for review.</p>
               </div>
             </div>
             
             {/* THE UNTOUCHED GATE */}
             <EmailVerificationGate 
               userId={user.id} 
               source="MALLU_MART"
               prefillBusinessName={formData.name}
               onCancel={() => setStep(2)} // Fallback if they click the text button
               onVerified={(ownerData) => {
                 const confirmedEmail = ownerData.verified_email || ownerData.email;
                 setVerifiedEmail(confirmedEmail);
                 setIsVerified(true);
                 
                 // Instantly upload to MongoDB using their verified email
                 executeSubmit(false, confirmedEmail);
               }} 
             />
           </motion.div>
         )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default function ListProfession() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black flex items-center justify-center"><Loader2 className="animate-spin text-brandRed" /></div>}>
      <ListContent />
    </Suspense>
  );
}