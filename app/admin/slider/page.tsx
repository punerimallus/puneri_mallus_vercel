"use client";
import { useState, useEffect } from 'react';
import { 
  Save, ImageIcon, Loader2, ArrowLeft, 
  Upload, Trash2, Plus, Info, Link as LinkIcon,
  Type, MousePointer2, Film, ArrowUp, ArrowDown,
  GripVertical, Eye, X, Smartphone, Monitor
} from 'lucide-react';
import Link from 'next/link';
import { createBrowserClient } from '@supabase/ssr';
import { logAdminActivity } from '@/app/admin/action';
import { useAlert } from '@/context/AlertContext';
import TribeConfirm from '@/components/TribeConfirm';
import { hasMobileAsset, isVideoAsset } from '@/lib/ui/hero-slides';

/** The two artwork slots a slide can carry. */
type Slot = 'mediaUrl' | 'mobileUrl';

export default function SliderAdmin() {
  const [slides, setSlides] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  /** Which slide, and which of its two assets, is mid-upload. */
  const [uploading, setUploading] = useState<{ idx: number; slot: Slot } | null>(null);
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  
  const { showAlert } = useAlert();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteIdx, setDeleteIdx] = useState<number | null>(null);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    fetch('/api/settings/slider')
      .then(res => res.json())
      .then(data => {
        const dataSlides = (data.slides || []).map((s: any) => ({
          ...s,
          visibility: s.visibility ?? 60,
          vOffset: s.vOffset ?? 50
        }));
        setSlides(dataSlides);
        setLoading(false);
      });
  }, []);

  const moveSlide = (index: number, direction: 'up' | 'down') => {
    const newSlides = [...slides];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= slides.length) return;
    [newSlides[index], newSlides[targetIndex]] = [newSlides[targetIndex], newSlides[index]];
    setSlides(newSlides);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, index: number, slot: Slot = 'mediaUrl') => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      showAlert("Master asset exceeds 15MB. Please compress for performance.", "error");
      return;
    }
    setUploading({ idx: index, slot });
    const tag = slot === 'mobileUrl' ? 'mobile' : 'hero';
    const fileName = `${tag}-${Date.now()}.${file.name.split('.').pop()}`;
    const filePath = `hero-slider/${fileName}`;
    
    const { error } = await supabase.storage.from('assets').upload(filePath, file);
    
    if (!error) {
      const { data } = supabase.storage.from('assets').getPublicUrl(filePath);
      updateSlide(index, slot, data.publicUrl);
      await logAdminActivity(`Slider Asset: ${fileName}`, "SLIDER_UPDATE");
      showAlert(slot === 'mobileUrl' ? "Phone cut synchronized" : "Visual Asset Synchronized", "success");
    } else {
      showAlert("Upload failed. Please try again.", "error");
    }
    // Picking the same file twice in a row fires no change event unless the input is cleared.
    e.target.value = '';
    setUploading(null);
  };

  /** Drops the phone cut so the slide falls back to the wide asset everywhere. */
  const clearMobile = (index: number) => {
    updateSlide(index, 'mobileUrl', '');
    showAlert("Phone cut removed. This slide now uses the wide asset everywhere.", "info");
  };

  const updateSlide = (index: number, key: string, value: any) => {
    setSlides(prev => {
      const newSlides = [...prev];
      newSlides[index] = { ...newSlides[index], [key]: value };
      return newSlides;
    });
  };

  const addSlide = () => {
    setSlides([...slides, { 
      mediaUrl: '', mobileUrl: '', title: '', subtitle: '', description: '', 
      buttonText: '', buttonLink: '', visibility: 60, vOffset: 50 
    }]);
  };

  const removeSlideRequest = (index: number) => {
    setDeleteIdx(index);
    setConfirmOpen(true);
  };

  const executeRemove = () => {
    if (deleteIdx !== null) {
      setSlides(slides.filter((_, i) => i !== deleteIdx));
      setConfirmOpen(false);
      setDeleteIdx(null);
      showAlert("Slot removed from Sequence", "info");
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/settings/slider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slides })
      });

      if (response.ok) {
        await logAdminActivity("Hero Slider Sequence", "SLIDER_UPDATE");
        showAlert("Sequence Deployed!", "success");
      }
    } catch (err) {
      showAlert("Deployment failed", "error");
    } finally {
      setSaving(false);
    }
  };

  const isVideo = isVideoAsset;

  if (loading) return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <Loader2 className="animate-spin text-brandRed" size={40} />
    </div>
  );

  return (
    /* Increased top padding from pt-32 to pt-48 to clear fixed Navbar */
    <div className="min-h-screen bg-black text-white pt-48 pb-20 px-6 selection:bg-brandRed/30">
      
      <TribeConfirm 
        isOpen={confirmOpen}
        title="Delete Slide Event"
        message={`Are you sure you want to remove Slot 0${(deleteIdx || 0) + 1} from the cinematic sequence?`}
        onConfirm={executeRemove}
        onCancel={() => setConfirmOpen(false)}
      />

      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-8 mb-16">
          <div className="space-y-2">
            <Link href="/admin" className="text-zinc-600 hover:text-white uppercase font-black text-[9px] tracking-[0.3em] flex items-center gap-2 mb-2">
              <ArrowLeft size={12} /> Return to Hub
            </Link>
            <h1 className="text-6xl font-black italic uppercase tracking-tighter leading-none">
              Hero <span className="text-brandRed">Sequencer.</span>
            </h1>
          </div>
          <button onClick={handleSave} disabled={saving} className="bg-brandRed text-white px-12 py-5 rounded-2xl font-black uppercase text-[11px] tracking-widest flex items-center gap-3 hover:scale-105 transition-all shadow-[0_0_30px_rgba(255,0,0,0.3)]">
            {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
            Deploy Order
          </button>
        </div>

        <div className="bg-zinc-950 border border-white/5 p-8 rounded-[40px] mb-12 flex flex-col md:flex-row gap-8 items-center relative overflow-hidden">
          <div className="w-16 h-16 rounded-2xl bg-brandRed/10 flex items-center justify-center shrink-0 border border-brandRed/20">
            <Film className="text-brandRed" size={32} />
          </div>
          <div className="space-y-1">
            <h4 className="text-[10px] font-black uppercase tracking-[0.4em] text-white">Framing & Visibility Control</h4>
            <p className="text-[10px] text-zinc-500 font-bold uppercase leading-relaxed tracking-wider max-w-2xl">
              Use the <span className="text-white">Vertical Nudge</span> to fix cropped heads (Top: 0%, Bottom: 100%). 
              Adjust <span className="text-brandRed">Dimmer</span> to ensure text readability over bright media.
            </p>
          </div>
        </div>

        <div className="space-y-12">
          {slides.map((slide, idx) => (
            <div key={idx} className="bg-zinc-950 border border-white/5 p-8 rounded-[40px] relative transition-all hover:border-brandRed/20 flex flex-col lg:flex-row gap-10">
              <div className="flex flex-row lg:flex-col items-center gap-4 shrink-0 bg-black/40 p-4 rounded-3xl border border-white/5">
                <button onClick={() => moveSlide(idx, 'up')} disabled={idx === 0} className="p-3 bg-zinc-900 border border-white/5 rounded-xl hover:text-brandRed disabled:opacity-10 transition-all"><ArrowUp size={20} /></button>
                <div className="text-3xl font-black text-brandRed italic">0{idx + 1}</div>
                <button onClick={() => moveSlide(idx, 'down')} disabled={idx === slides.length - 1} className="p-3 bg-zinc-900 border border-white/5 rounded-xl hover:text-brandRed disabled:opacity-10 transition-all"><ArrowDown size={20} /></button>
              </div>

              <div className="lg:w-72 space-y-6 shrink-0">
                <div className="aspect-square bg-black rounded-[32px] border border-white/10 overflow-hidden relative group shadow-2xl">
                  <div 
                    className="absolute inset-0 transition-all" 
                    style={{ opacity: (slide.visibility || 60) / 100, objectPosition: `50% ${slide.vOffset || 50}%` }}
                  >
                    {slide.mediaUrl ? (
                      isVideo(slide.mediaUrl) 
                      ? <video src={slide.mediaUrl} autoPlay muted loop className="w-full h-full object-cover" style={{ objectPosition: `50% ${slide.vOffset || 50}%` }} />
                      : <img src={slide.mediaUrl} className="w-full h-full object-cover" style={{ objectPosition: `50% ${slide.vOffset || 50}%` }} />
                    ) : <div className="absolute inset-0 flex items-center justify-center text-zinc-900"><ImageIcon size={48} /></div>}
                  </div>
                  <span className="absolute top-3 left-3 z-10 flex items-center gap-1.5 bg-black/70 border border-white/10 px-2.5 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest text-zinc-300 pointer-events-none">
                    <Monitor size={10} className="text-brandRed" /> Tablet &amp; desktop
                  </span>
                  <button onClick={() => setPreviewIdx(idx)} className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 font-black uppercase text-[10px] tracking-widest"><Eye size={20} /> Preview</button>
                  {uploading?.idx === idx && uploading.slot === 'mediaUrl' && <div className="absolute inset-0 bg-black/90 flex items-center justify-center"><Loader2 className="animate-spin text-brandRed" /></div>}
                </div>

                <div className="bg-black/40 p-5 rounded-[24px] border border-white/5 space-y-5">
                  <div className="space-y-2">
                    <div className="flex justify-between text-[9px] font-black uppercase text-zinc-500"><span>Dimmer</span><span className="text-brandRed">{slide.visibility || 60} %</span></div>
                    <input type="range" min="0" max="100" className="w-full accent-brandRed" value={slide.visibility || 60} onChange={(e) => updateSlide(idx, 'visibility', parseInt(e.target.value))} />
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-[9px] font-black uppercase text-zinc-500"><span>Vertical Nudge</span><span className="text-white">{slide.vOffset || 50} %</span></div>
                    <input type="range" min="0" max="100" className="w-full accent-white" value={slide.vOffset || 50} onChange={(e) => updateSlide(idx, 'vOffset', parseInt(e.target.value))} />
                  </div>
                </div>

                <label className="flex items-center justify-center gap-3 w-full py-4 bg-zinc-900 border border-white/5 rounded-2xl cursor-pointer hover:bg-white hover:text-black transition-all">
                  <Upload size={14} /> <span className="text-[10px] font-black uppercase tracking-widest">Swap Asset</span>
                  <input type="file" className="hidden" accept="image/*,video/*" onChange={(e) => handleFileUpload(e, idx)} />
                </label>

                {/* The phone cut.
                    Optional per slide: without one the wide asset is used at every size, which
                    is how every existing slide already behaves. It exists because a wide image
                    on a 390px screen is cropped to roughly its middle third by object-cover,
                    and that is usually not where the subject is. Only the phone downloads it. */}
                <div className={`rounded-[24px] border p-5 space-y-4 transition-all ${hasMobileAsset(slide) ? 'border-brandRed/30 bg-brandRed/[0.04]' : 'border-white/5 bg-black/40'}`}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-zinc-400">
                      <Smartphone size={12} className="text-brandRed" /> Phone cut
                    </span>
                    <span className={`text-[8px] font-black uppercase tracking-widest ${hasMobileAsset(slide) ? 'text-brandRed' : 'text-zinc-600'}`}>
                      {hasMobileAsset(slide) ? 'In use' : 'Using wide'}
                    </span>
                  </div>

                  {hasMobileAsset(slide) && (
                    <div className="relative w-full aspect-[9/16] max-h-56 mx-auto bg-black rounded-2xl border border-white/10 overflow-hidden">
                      {isVideo(slide.mobileUrl)
                        ? <video src={slide.mobileUrl} autoPlay muted loop playsInline className="w-full h-full object-cover" />
                        : <img src={slide.mobileUrl} className="w-full h-full object-cover" alt="Phone cut" />}
                      {uploading?.idx === idx && uploading.slot === 'mobileUrl' && <div className="absolute inset-0 bg-black/90 flex items-center justify-center"><Loader2 className="animate-spin text-brandRed" /></div>}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <label className="flex-1 flex items-center justify-center gap-2 py-3 bg-zinc-900 border border-white/5 rounded-xl cursor-pointer hover:bg-white hover:text-black transition-all">
                      {uploading?.idx === idx && uploading.slot === 'mobileUrl'
                        ? <Loader2 size={13} className="animate-spin" />
                        : <Upload size={13} />}
                      <span className="text-[9px] font-black uppercase tracking-widest">
                        {hasMobileAsset(slide) ? 'Replace' : 'Add phone image'}
                      </span>
                      <input type="file" className="hidden" accept="image/*,video/*" onChange={(e) => handleFileUpload(e, idx, 'mobileUrl')} />
                    </label>
                    {hasMobileAsset(slide) && (
                      <button
                        type="button"
                        onClick={() => clearMobile(idx)}
                        title="Use the wide asset on phones too"
                        className="px-3 py-3 bg-zinc-900 border border-white/5 rounded-xl text-zinc-500 hover:text-white hover:bg-brandRed hover:border-brandRed transition-all"
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>

                  <p className="text-[8px] font-bold uppercase tracking-widest text-zinc-600 leading-relaxed">
                    Shown below 768px only. Portrait suits it best. Leave empty to use the wide asset everywhere.
                  </p>
                </div>
              </div>

              <div className="flex-1 space-y-8">
                <div className="flex justify-between items-center border-b border-white/5 pb-4">
                  <div className="text-zinc-600 uppercase font-black text-[9px] tracking-[0.4em] flex items-center gap-3"><Type size={12} className="text-brandRed" /> Cinematic Metadata</div>
                  <button onClick={() => removeSlideRequest(idx)} className="text-zinc-800 hover:text-brandRed transition-all"><Trash2 size={20} /></button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-2">
                    <label className="text-[8px] font-black text-zinc-500 uppercase ml-1">Hero Title</label>
                    <input className="w-full bg-black border border-white/10 p-5 rounded-2xl outline-none focus:border-brandRed text-xs font-bold" value={slide.title || ''} onChange={(e) => updateSlide(idx, 'title', e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[8px] font-black text-brandRed uppercase ml-1">Subtitle (Italic)</label>
                    <input className="w-full bg-black border border-brandRed/20 p-5 rounded-2xl outline-none focus:border-brandRed text-xs font-bold italic" value={slide.subtitle || ''} onChange={(e) => updateSlide(idx, 'subtitle', e.target.value)} />
                  </div>
                </div>
                <textarea className="w-full bg-black border border-white/10 p-5 rounded-2xl outline-none focus:border-brandRed text-xs font-bold h-24 resize-none" value={slide.description || ''} onChange={(e) => updateSlide(idx, 'description', e.target.value)} placeholder="Tagline..." />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-4 border-t border-white/5">
                  <input className="bg-black border border-white/10 p-5 rounded-2xl text-xs font-bold" placeholder="Btn Text" value={slide.buttonText || ''} onChange={(e) => updateSlide(idx, 'buttonText', e.target.value)} />
                  <input className="bg-black border border-white/10 p-5 rounded-2xl text-xs font-bold" placeholder="Btn Link" value={slide.buttonLink || ''} onChange={(e) => updateSlide(idx, 'buttonLink', e.target.value)} />
                </div>
              </div>
            </div>
          ))}
        </div>

        <button onClick={addSlide} className="w-full mt-16 py-16 border-2 border-dashed border-white/5 rounded-[40px] text-zinc-800 hover:text-brandRed hover:border-brandRed/40 transition-all flex flex-col items-center gap-4">
          <Plus size={32} />
          <span className="font-black uppercase tracking-[0.5em] text-[10px]">Append Cinematic Slot</span>
        </button>
      </div>

      {/* --- LIVE FULLSCREEN PREVIEW MODAL --- */}
      {previewIdx !== null && (
        <div className="fixed inset-0 z-[100] bg-black flex items-center justify-center p-6 backdrop-blur-xl">
          <button onClick={() => setPreviewIdx(null)} className="absolute top-10 right-10 z-[110] p-4 bg-white/10 rounded-full hover:bg-brandRed transition-all"><X /></button>
          
          <div className="relative w-full h-full max-w-6xl max-h-[85vh] rounded-[48px] overflow-hidden border border-white/10 bg-zinc-950 shadow-[0_0_100px_rgba(255,0,0,0.2)]">
              {slides[previewIdx]?.mediaUrl ? (
                <>
                  <div className="absolute inset-0 transition-all" style={{ opacity: (slides[previewIdx]?.visibility || 60) / 100 }}>
                    {isVideo(slides[previewIdx].mediaUrl) 
                        ? <video src={slides[previewIdx].mediaUrl} autoPlay muted loop className="w-full h-full object-cover" style={{ objectPosition: `50% ${slides[previewIdx].vOffset || 50}%` }} />
                        : <img src={slides[previewIdx].mediaUrl} className="w-full h-full object-cover" style={{ objectPosition: `50% ${slides[previewIdx].vOffset || 50}%` }} />
                    }
                    <div className="absolute inset-0 bg-gradient-to-b from-black via-transparent to-black" />
                  </div>
                  <div className="relative z-10 h-full flex flex-col items-center justify-center text-center px-10">
                    <h1 className="text-5xl md:text-7xl font-black uppercase text-white/90 leading-tight">{slides[previewIdx]?.title || "Untitled Node"}</h1>
                    <h2 className="text-6xl md:text-9xl font-black uppercase italic text-brandRed drop-shadow-[0_0_30px_rgba(255,0,0,0.5)] leading-none">{slides[previewIdx]?.subtitle || "Prototype Phase"}</h2>
                    <p className="max-w-2xl text-zinc-400 font-bold uppercase tracking-[0.3em] mt-8 text-sm">{slides[previewIdx]?.description || "No transmission data found."}</p>
                    {slides[previewIdx]?.buttonText && (
                        <div className="mt-12 px-16 py-6 bg-brandRed rounded-full font-black uppercase tracking-[0.4em] text-xs">{slides[previewIdx].buttonText}</div>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center h-full space-y-6">
                  <div className="w-24 h-24 rounded-full bg-white/5 flex items-center justify-center border border-white/10">
                    <ImageIcon className="text-zinc-700" size={40} />
                  </div>
                  <div className="text-center">
                     <p className="text-brandRed font-black uppercase tracking-[0.4em] text-xs mb-2">Null Asset Detected</p>
                     <p className="text-zinc-500 font-bold uppercase text-[10px] tracking-widest">Inject media to initialize preview</p>
                  </div>
                </div>
              )}
          </div>
        </div>
      )}
    </div>
  );
}