"use client";
import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { createBrowserClient } from '@supabase/ssr';
import { 
  CheckCircle, ArrowRight, Loader2, ArrowLeft, 
  Image as ImageIcon, MapPin, Plus, Trash2, X, Check,MessageCircle,
  Link as LinkIcon, Phone, Globe, Briefcase, Camera, Clock, Instagram, Star, Users, Camera as CameraIcon
} from 'lucide-react';
import TribeTimePicker from '@/components/ui/TribeTimePicker';
import TribeAlert from '@/components/TribeAlert'; 
import EmailVerificationGate from '@/components/EmailVerificationGate';
import { onEnter } from '@/lib/ui/enter';

const EXTERNAL_CATEGORIES = ["SAMAJAM", "TEMPLE", "CHURCH", "ORGANIZATION","MOSQUE","OTHER"];

const LaserDivider = () => (
  <div className="relative w-full h-px flex items-center justify-center overflow-hidden my-2">
    <div className="absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-brandRed/40 to-transparent" />
    <div className="absolute w-[45%] h-[2px] bg-brandRed shadow-[0_0_25px_#FF0000] z-10" />
    <div className="absolute w-24 h-px bg-white blur-[1.5px] opacity-40 z-20" />
  </div>
);

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
  const editId = searchParams.get('edit'); 
  
  const [verifiedEmail, setVerifiedEmail] = useState<string>('');
  const [fetching, setFetching] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [isVerified, setIsVerified] = useState<boolean | null>(null);

  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1);
  const [gallery, setGallery] = useState<any[]>([]);
  const [thumbnailId, setThumbnailId] = useState<string | null>(null);
  const [services, setServices] = useState<any[]>([]); 
  const [showCustomCategory, setShowCustomCategory] = useState(false);

  // 🔥 UNIVERSAL NAME CHECKER STATES
  const [nameError, setNameError] = useState<string | null>(null);
  const [checkingName, setCheckingName] = useState(false);

  const [members, setMembers] = useState<any[]>([
    { id: Math.random().toString(), name: '', designation: '', contact: '', file: null, previewUrl: '', existingUrl: '' }
  ]);

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
  const [sameForWhatsapp, setSameForWhatsapp] = useState(true);
  const [formData, setFormData] = useState({
    title: '', category: 'SAMAJAM', customCategory: '', area: '', tagline: '',
    description: '', link: '', instagram: '', image: '', mapUrl: '', contact: '', website: '',
    whatsapp: '', openTime: '09:00 AM', closeTime: '06:00 PM'
  });

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!, 
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return router.push('/auth/login');
      setUser(user);

     try {
        const { data: ownerRecords } = await supabase
          .from('directory_owners')
          .select('*')
          .eq('user_id', user.id)
          .eq('source', 'COMMUNITY')
          .eq('is_verified', true) // 🔥 THE FIX: This keeps the gate locked!
          .limit(1); 

        const ownerRecord = ownerRecords?.[0];

        if (ownerRecord) {
          setIsVerified(true);
          setVerifiedEmail(ownerRecord.verified_email || ownerRecord.email || user.email || ''); 
          if (!editId) {
             setFormData(prev => ({
               ...prev,
               title: ownerRecord.business_name || '',
               contact: ownerRecord.phone_number || '',
               whatsapp: ownerRecord.phone_number || '' 
             }));
          }
        } else {
          // If the row exists but is_verified is false, it falls down here 
          // and keeps the EmailVerificationGate on their screen.
          setIsVerified(false);
        }

        if (editId) {
          const res = await fetch(`/api/community?id=${editId}&t=${Date.now()}`, { cache: 'no-store' });
          if (res.ok) {
            const data = await res.json();
            
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
              whatsapp: data.whatsapp || data.contact || '', 
              website: data.website || '',
              openTime: data.openTime || '09:00 AM',
              closeTime: data.closeTime || '06:00 PM'
            });

            if (data.services) setServices(data.services);
            if (data.category === "OTHER" || !EXTERNAL_CATEGORIES.includes(data.category)) setShowCustomCategory(true);
            if (data.whatsapp && data.contact !== data.whatsapp) {
              setSameForWhatsapp(false);
            } else {
              setSameForWhatsapp(true);
            }
            if (data.members && data.members.length > 0) {
              setMembers(data.members.map((m: any) => ({
                id: Math.random().toString(),
                name: m.name || '',
                designation: m.designation || '',
                contact: m.contact || '',
                file: null,
                previewUrl: m.image || '',
                existingUrl: m.image || ''
              })));
            }

            if (data.imagePaths) {
              const existingGallery = data.imagePaths.map((url: string) => ({
                id: Math.random().toString(36).substr(2, 9),
                type: 'existing', file: null, previewUrl: url
              }));
              setGallery(existingGallery);

              const thumb = existingGallery.find((img: any) => img.previewUrl === data.image);
              if (thumb) setThumbnailId(thumb.id);
            }
          }
        }
      }catch (err) {
        console.error("Initialization Error:", err);
      } finally {
        setFetching(false);
      }
    };
    init();
  }, [editId, router, supabase]);

  // 🔥 UNIVERSAL NAME CHECKER FUNCTION
  const verifyNameAvailability = async (title: string) => {
    if (!title.trim()) return setNameError(null);
    setCheckingName(true);
    try {
      const res = await fetch(`/api/check-name?name=${encodeURIComponent(title)}${editId ? `&excludeId=${editId}` : ''}`);
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

  const addService = () => setServices([...services, { name: '', desc: '' }]);
  const removeService = (index: number) => setServices(services.filter((_, i) => i !== index));
  const updateService = (index: number, field: string, value: string) => {
    const updated = [...services];
    updated[index][field] = value;
    setServices(updated);
  };

  const addMember = () => {
    if (members.length >= 3) return triggerAlert("Max 3 members allowed", "error");
    setMembers([...members, { id: Math.random().toString(), name: '', designation: '', contact: '', file: null, previewUrl: '', existingUrl: '' }]);
  };
  const removeMember = (id: string) => {
    if (members.length <= 1) return triggerAlert("At least one member is required", "error");
    setMembers(members.filter(m => m.id !== id));
  };
  const updateMember = (id: string, field: string, value: any) => {
    setMembers(prevMembers => prevMembers.map(m => m.id === id ? { ...m, [field]: value } : m));
  };

  const handleMemberImage = (id: string, e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const newPreviewUrl = URL.createObjectURL(file);
      setMembers(prevMembers => prevMembers.map(m => 
        m.id === id ? { ...m, file: file, previewUrl: newPreviewUrl } : m
      ));
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selected = Array.from(e.target.files);
      if (gallery.length + selected.length > 5) return triggerAlert("Max 5 images allowed", "error");
      const newImgs = selected.map(file => ({
        id: Math.random().toString(36).substr(2, 9),
        type: 'new', file, previewUrl: URL.createObjectURL(file)
      }));
      setGallery([...gallery, ...newImgs]);
      if (!thumbnailId && newImgs.length > 0) setThumbnailId(newImgs[0].id);
    }
  };

  const handleRemoveImage = (id: string) => {
    setGallery(prev => prev.filter(img => img.id !== id));
    if (thumbnailId === id) setThumbnailId(null);
  };

  // Same action as the "Next" button, so Enter in any field of step 1 moves on too.
  const goNextFromStep1 = () => {
    if (nameError) return triggerAlert("Please choose a different organization name. This one is taken.", "error");
    if (checkingName) return;
    setStep(2);
  };

  const handleSubmit = async (isDraftMode: boolean = false) => {
    if (!isDraftMode) {
      if (gallery.length === 0) return triggerAlert("At least one image is required", "error");
      if (!thumbnailId) return triggerAlert("Please select a cover thumbnail", "error");
      if (!formData.title.trim()) return triggerAlert("Organization Name is required", "error");
      if (!formData.area.trim()) return triggerAlert("Location Area is required", "error");
      if (!formData.description.trim() || formData.description.length < 20) {
        return triggerAlert("Community Story is too short (min 20 chars)", "error");
      }
      if (!formData.contact || formData.contact.length !== 10) {
        return triggerAlert("Valid 10-digit WhatsApp contact required", "error");
      }
      const targetNumber = sameForWhatsapp ? formData.contact : formData.whatsapp;
      if (!targetNumber || targetNumber.length !== 10) {
        return triggerAlert("Valid 10-digit WhatsApp contact required", "error");
      }
      for (let i = 0; i < members.length; i++) {
        const m = members[i];
        if (!m.name.trim() || !m.designation.trim() || !m.contact.trim() || (!m.file && !m.existingUrl)) {
          return triggerAlert(`Please complete all fields and upload an image for Member ${i + 1}`, "error");
        }
        if (m.contact.length !== 10) {
          return triggerAlert(`Valid 10-digit contact required for Member ${i + 1}`, "error");
        }
      }
    } else {
      if (!formData.title.trim()) return triggerAlert("Provide a name to save draft", "info");
    }

    let submitEmail = verifiedEmail || user?.email || "";
    if (!submitEmail || submitEmail.includes('supabase.co')) {
      const manualEmail = window.prompt("We need a valid email address to send your approval notification. Please enter it below:");
      if (manualEmail && manualEmail.includes('@')) {
        submitEmail = manualEmail;
        setVerifiedEmail(manualEmail);
      } else {
        return triggerAlert("A valid email is required to submit.", "error");
      }
    }

    setLoading(true);
    try {
      let finalThumbnailUrl = formData.image || "";

      const finalPaths = await Promise.all(gallery.map(async (img) => {
        if (img.type === 'existing') {
          if (img.id === thumbnailId) finalThumbnailUrl = img.previewUrl;
          return img.previewUrl;
        }
        const fileName = `community-node-${Date.now()}-${Math.random().toString(36).substr(2,5)}`;
        const { data, error } = await supabase.storage.from('community').upload(fileName, img.file);
        if (error) throw error;
        const { data: urlData } = supabase.storage.from('community').getPublicUrl(data.path);
        
        if (img.id === thumbnailId) finalThumbnailUrl = urlData.publicUrl;
        return urlData.publicUrl;
      }));

      const finalMembers = await Promise.all(members.map(async (m) => {
        let imageUrl = m.existingUrl || m.previewUrl;
        if (m.file) {
          const fileName = `community-member-${Date.now()}-${Math.random().toString(36).substr(2,5)}`;
          const { data, error } = await supabase.storage.from('community').upload(fileName, m.file);
          if (error) throw error;
          const { data: urlData } = supabase.storage.from('community').getPublicUrl(data.path);
          imageUrl = urlData.publicUrl;
        }
        return { name: m.name, designation: m.designation, contact: m.contact, image: imageUrl };
      }));

      const finalCategory = formData.category === "OTHER" ? formData.customCategory : formData.category;
      
      const payload = { 
        ...formData, 
        _id: editId, 
        category: finalCategory.toUpperCase(), 
        image: finalThumbnailUrl, 
        imagePaths: finalPaths, 
        services,
        members: finalMembers,
        isApproved: false,
        isDraft: isDraftMode, 
        submittedBy: submitEmail.toLowerCase(),
        userId: user?.id 
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

  if (fetching || isVerified === null) {
    return <div className="min-h-screen bg-black flex items-center justify-center"><Loader2 className="animate-spin text-brandRed" /></div>;
  }

  if (isVerified === false && user) {
    return (
      <div className="min-h-screen bg-[#030303] text-white pt-40 pb-20 px-6">
        <EmailVerificationGate 
          userId={user.id} 
          source="COMMUNITY" 
          onVerified={(ownerData) => {
            setVerifiedEmail(ownerData.verified_email || ownerData.email || user.email || '');
            if (!editId) {
              setFormData(prev => ({
                ...prev,
                title: ownerData.businessName || '',
                contact: ownerData.phone || ''
              }));
            }
            setIsVerified(true);
          }} 
        />
      </div>
    );
  }

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
          <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="space-y-10" onKeyDown={onEnter(goNextFromStep1)}>
            <header className="space-y-2">
               <h1 className="text-5xl font-black italic uppercase leading-none">
                 Register <span className="text-brandRed">Circle .</span>
               </h1>
               <p className="text-zinc-500 text-[10px] font-black uppercase tracking-[0.3em]">Phase 01: Core Identity</p>
            </header>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              
              {/* 🔥 UPDATED: UNIVERSAL NAME CHECKER FIELD */}
              <div className={`space-y-2 md:col-span-2 border p-6 rounded-[32px] transition-all relative ${nameError ? 'border-red-500' : 'border-white/25 focus-within:border-brandRed'}`}>
                <div className="flex justify-between items-center mr-2">
                   <label className={`text-[10px] font-black uppercase ml-2 ${nameError ? 'text-red-500' : 'text-zinc-500'}`}>Organization Name *</label>
                   {checkingName && <Loader2 size={12} className="animate-spin text-brandRed" />}
                </div>
                <input 
                  placeholder="E.G. PUNE MALAYALEE ASSOCIATION" 
                  className="w-full bg-transparent outline-none font-bold text-white text-xl uppercase" 
                  value={formData.title} 
                  onChange={e => {
                    setFormData({...formData, title: e.target.value});
                    if (nameError) setNameError(null); 
                  }} 
                  onBlur={(e) => verifyNameAvailability(e.target.value)}
                />
                {nameError && <p className="text-red-500 text-[9px] font-bold uppercase tracking-widest absolute bottom-2 left-6">{nameError}</p>}
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
            
            {/* 🔥 UPDATED: Blocks advancement if name is taken */}
            <button 
              onClick={goNextFromStep1} 
              className="w-full py-8 bg-white text-black rounded-[32px] font-black uppercase tracking-[0.3em] transition-all hover:bg-brandRed hover:text-white flex items-center justify-center gap-4"
            >
              <span>Next: Services & Media</span><ArrowRight size={20} />
            </button>
          </motion.div>
        ) : (
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-10">
            <div className="flex items-center gap-4">
              <button onClick={() => setStep(1)} className="p-4 border border-white/25 rounded-2xl hover:bg-brandRed transition-all text-white"><ArrowLeft /></button>
              <h1 className="text-5xl font-black italic uppercase leading-none text-white">Visual <span className="text-brandRed">Identity .</span></h1>
            </div>

            {/* SERVICES SECTION */}
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
                    <button 
                      onClick={() => removeService(index)} 
                      className="absolute -top-3 -right-3 p-2 bg-red-600 text-white rounded-full z-20 opacity-0 group-hover:opacity-100 transition-all shadow-xl hover:scale-110 active:scale-90 border-2 border-[#030303]"
                    >
                      <X size={14} strokeWidth={3} />
                    </button>

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

                    <div className="border border-white/10 p-5 rounded-[24px] bg-zinc-950/40 focus-within:border-brandRed transition-all">
                      <label className="text-[11px] font-black uppercase text-zinc-500 ml-1 mb-1 block tracking-widest">
                        Offer Details
                      </label>
                      <textarea 
                        placeholder="DESCRIBE THE SCOPE OF THIS SERVICE..." 
                        rows={2} 
                        className="w-full bg-transparent outline-none text-xl font-medium text-zinc-400 italic px-1 resize-none" 
                        value={service.desc} 
                        onChange={(e) => updateService(index, 'desc', e.target.value)} 
                      />
                    </div>
                  </div>
                ))}

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

            {/* 🔥 NEW MEMBERS SECTION */}
            <div className="border border-white/25 p-8 rounded-[40px] space-y-6">
              <div className="flex justify-between items-center px-2">
                <div className="flex items-center gap-3 text-brandRed">
                  <Users size={20} />
                  <label className="text-[11px] font-black uppercase tracking-widest text-white">Top Members (Up to 3) *</label>
                </div>
                {members.length < 3 && (
                  <button 
                    onClick={addMember} 
                    className="text-[10px] bg-white text-black px-5 py-2 rounded-full font-black uppercase hover:bg-brandRed hover:text-white transition-all shadow-lg active:scale-95"
                  >
                    + Add Member
                  </button>
                )}
              </div>

              <div className="space-y-6">
                {members.map((member, index) => (
                  <div key={member.id} className="relative group border border-white/10 p-5 md:p-6 rounded-[32px] bg-zinc-950/40 focus-within:border-brandRed transition-all">
                    
                    {members.length > 1 && (
                      <button 
                        onClick={() => removeMember(member.id)} 
                        className="absolute -top-3 -right-3 p-2 bg-red-600 text-white rounded-full z-20 opacity-0 group-hover:opacity-100 transition-all shadow-xl hover:scale-110 active:scale-90 border-2 border-[#030303]"
                      >
                        <X size={14} strokeWidth={3} />
                      </button>
                    )}

                    <div className="flex flex-col md:flex-row gap-6 items-start">
                      {/* Member Image Upload */}
                      <label className="shrink-0 relative w-24 h-24 rounded-full border-2 border-dashed border-white/20 hover:border-brandRed transition-all flex flex-col items-center justify-center cursor-pointer overflow-hidden bg-black/50 group/img">
                        {member.previewUrl ? (
                          <img src={member.previewUrl} className="w-full h-full object-cover group-hover/img:opacity-50 transition-all" alt="Member" />
                        ) : (
                          <CameraIcon size={20} className="text-zinc-600 group-hover/img:text-brandRed" />
                        )}
                        <input type="file" accept="image/*" className="hidden" onChange={(e) => handleMemberImage(member.id, e)} />
                      </label>

                      {/* Member Details */}
                      <div className="flex-1 w-full space-y-4">
                        <input 
                          placeholder="FULL NAME *" 
                          className="w-full bg-transparent outline-none text-base font-black uppercase text-white border-b border-white/10 pb-2 focus:border-brandRed transition-all" 
                          value={member.name} 
                          onChange={(e) => updateMember(member.id, 'name', e.target.value)} 
                        />
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <input 
                            placeholder="DESIGNATION *" 
                            className="w-full bg-transparent outline-none text-xs font-bold uppercase text-zinc-400 border-b border-white/10 pb-2 focus:border-brandRed transition-all" 
                            value={member.designation} 
                            onChange={(e) => updateMember(member.id, 'designation', e.target.value)} 
                          />
                          <input 
                            placeholder="CONTACT NUMBER *" 
                            maxLength={10}
                            className="w-full bg-transparent outline-none text-xs font-bold text-zinc-400 border-b border-white/10 pb-2 focus:border-brandRed transition-all" 
                            value={member.contact} 
                            onChange={(e) => {
                              const val = e.target.value.replace(/\D/g, '');
                              updateMember(member.id, 'contact', val);
                            }} 
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* GALLERY SECTION */}
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

            {/* DESCRIPTION SECTION */}
            <div className="border border-white/25 p-8 rounded-[40px] focus-within:border-brandRed transition-all">
                <label className="text-[10px] font-black uppercase text-zinc-500 mb-4 block ml-2">Description / Bio *</label>
                <textarea placeholder="TELL YOUR STORY..." className="w-full bg-transparent outline-none min-h-[150px] font-medium italic text-white text-lg leading-relaxed" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} />
            </div>

            {/* CONTACT LINKS SECTION */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* 1. FIRST POINT OF CONTACT */}
                <div className="border border-white/25 p-6 rounded-[32px] focus-within:border-brandRed transition-all flex flex-col justify-center">
                  <label className="text-[10px] font-black uppercase text-zinc-500 ml-2">First Point of Contact (10 Digits) *</label>
                  <div className="flex items-center mt-2">
                    <Phone className="text-zinc-600 mr-3" size={16} />
                    <input 
                      placeholder="10 DIGITS" 
                      className="w-full bg-transparent outline-none font-bold text-white text-sm" 
                      value={formData.contact} 
                      onChange={e => {
                        const val = e.target.value.replace(/\D/g, ''); // Numbers only
                        if (val.length <= 10) {
                          setFormData({
                            ...formData, 
                            contact: val,
                            ...(sameForWhatsapp ? { whatsapp: val } : {}) // Auto-sync
                          });
                        }
                      }} 
                    />
                  </div>
                </div>

                {/* 2. THE CUSTOM CHECKBOX & CONDITIONAL WHATSAPP */}
                <div className="flex flex-col justify-center gap-4 border border-white/25 p-6 rounded-[32px] focus-within:border-brandRed transition-all">
                  <label className="flex items-center gap-3 cursor-pointer group w-fit ml-2">
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
                      Same for WhatsApp
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
                        <div className="pt-3 border-t border-white/10 mt-1">
                          <label className="text-[10px] font-black uppercase text-zinc-500 ml-2">Custom WhatsApp (10 Digits) *</label>
                          <div className="flex items-center mt-2">
                            <MessageCircle className="text-zinc-600 mr-3" size={16} />
                            <input 
                              placeholder="10 DIGITS" 
                              className="w-full bg-transparent outline-none font-bold text-white text-sm" 
                              value={formData.whatsapp} 
                              onChange={e => {
                                const val = e.target.value.replace(/\D/g, '');
                                if (val.length <= 10) setFormData({...formData, whatsapp: val});
                              }} 
                            />
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* THE REMAINING LINKS */}
                {[
                  { label: 'Group Link', icon: LinkIcon, key: 'link', placeholder: 'HTTPS://CHAT...' },
                  { label: 'Instagram Handle', icon: Instagram, key: 'instagram', placeholder: '@USERNAME' },
                  { label: 'Official Website', icon: Globe, key: 'website', placeholder: 'WWW.DOMAIN.COM' }
                ].map((field) => (
                  <div key={field.key} className="border border-white/25 p-6 rounded-[32px] focus-within:border-brandRed transition-all">
                    <label className="text-[10px] font-black uppercase text-zinc-500 ml-2">{field.label}</label>
                    <div className="flex items-center mt-2">
                      <field.icon className="text-zinc-600 mr-3" size={16} />
                      <input 
                        placeholder={field.placeholder} 
                        className="w-full bg-transparent outline-none font-bold text-white text-sm" 
                        value={formData[field.key as keyof typeof formData]} 
                        onChange={e => setFormData({...formData, [field.key]: e.target.value})} 
                      />
                    </div>
                  </div>
                ))}
            </div>

            {/* ACTION BUTTONS */}
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