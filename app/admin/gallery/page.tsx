"use client";
import { useState, useEffect } from 'react';
import { Camera, Save, ImageIcon, Loader2, ArrowLeft, Eye, Upload, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { createBrowserClient } from '@supabase/ssr';
import { logAdminActivity } from '@/app/admin/action';
import { useAlert } from '@/context/AlertContext';
import TribeConfirm from '@/components/TribeConfirm'; // 1. Import Confirm Component

export default function GalleryAdmin() {
  const [images, setImages] = useState<string[]>(Array(6).fill(''));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);
  const { showAlert } = useAlert();
  
  // 2. State for Confirmation Dialog
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [targetIdx, setTargetIdx] = useState<number | null>(null);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    async function fetchGallery() {
      try {
        const res = await fetch('/api/settings/gallery');
        const data = await res.json();
        if (data && data.images) {
          const filled = [...data.images, ...Array(6).fill('')].slice(0, 6);
          setImages(filled);
        }
      } catch (err) { console.error(err); } 
      finally { setLoading(false); }
    }
    fetchGallery();
  }, []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, index: number) => {
    try {
      const file = e.target.files?.[0];
      if (!file) return;
      setUploadingIdx(index);
      
      const fileExt = file.name.split('.').pop();
      const fileName = `archive-${Date.now()}.${fileExt}`;
      const filePath = `about-gallery/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('assets') 
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from('assets').getPublicUrl(filePath);
      const newImages = [...images];
      newImages[index] = data.publicUrl;
      setImages(newImages);

      await logAdminActivity(`Asset Upload: ${fileName}`, "GALLERY_UPDATE");
      showAlert("Visual Asset Synchronized", "success");
      
    } catch (error: any) {
      showAlert('Upload Protocol Failed', "error");
    } finally {
      setUploadingIdx(null);
    }
  };

  // 3. Clear Function wrapped in Confirmation
  const confirmClear = (index: number) => {
    setTargetIdx(index);
    setConfirmOpen(true);
  };

  const executeClear = () => {
    if (targetIdx !== null) {
      const newImages = [...images];
      newImages[targetIdx] = '';
      setImages(newImages);
      setConfirmOpen(false);
      setTargetIdx(null);
      showAlert("Slot removed", "info");
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/settings/gallery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: images.filter(img => img.trim() !== '') })
      });

      if (response.ok) {
        await logAdminActivity("Main Gallery Archive", "GALLERY_UPDATE");
        showAlert("Archive Logic Updated!", "success");
      }
    } catch (err) { 
      showAlert("Injection Failed", "error"); 
    } finally { 
      setSaving(false); 
    }
  };

  if (loading) return <div className="min-h-screen bg-black flex items-center justify-center"><Loader2 className="animate-spin text-brandRed" /></div>;

  return (
    <div className="min-h-screen bg-black text-white pt-32 pb-20 px-6">
      {/* 4. THE TRIBE CONFIRM DIALOG */}
      <TribeConfirm 
        isOpen={confirmOpen}
        title="Purge Slot"
        message={`Are you sure you want to clear Slot 0${(targetIdx || 0) + 1}? This action is local until you Save.`}
        onConfirm={executeClear}
        onCancel={() => setConfirmOpen(false)}
      />

      <div className="max-w-6xl mx-auto">
        <Link href="/admin" className="inline-flex items-center gap-2 text-zinc-500 hover:text-white mb-12 uppercase font-black text-[10px] tracking-widest transition-colors">
          <ArrowLeft size={14} /> Back to Portal
        </Link>
        
        <h1 className="text-6xl md:text-8xl font-black italic uppercase tracking-tighter leading-none mb-16">
          The <span className="text-brandRed">Archive.</span>
        </h1>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {images.map((url, idx) => (
            <div key={idx} className="bg-zinc-950 border border-white/5 p-6 rounded-[40px] space-y-6 group relative">
              
              {/* Image Preview Container */}
              <div className="aspect-[4/3] rounded-3xl bg-black border border-white/10 overflow-hidden flex items-center justify-center relative shadow-2xl">
                 {url ? (
                   <>
                     <img src={url} className="w-full h-full object-cover" alt="Preview" />
                     {/* Clear Button Overlay */}
                     <button 
                        onClick={() => confirmClear(idx)}
                        className="absolute top-4 right-4 p-2 bg-black/60 hover:bg-brandRed text-white rounded-xl backdrop-blur-md opacity-0 group-hover:opacity-100 transition-all border border-white/10"
                     >
                       <X size={14} />
                     </button>
                   </>
                 ) : (
                   <Camera className="text-zinc-900" size={48} />
                 )}
                 
                 {uploadingIdx === idx && (
                   <div className="absolute inset-0 bg-black/80 flex items-center justify-center backdrop-blur-sm">
                      <Loader2 className="animate-spin text-brandRed" size={32} />
                   </div>
                 )}
                 
                 <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-md text-[8px] font-black px-3 py-1.5 rounded-full uppercase border border-white/10">Slot 0{idx + 1}</div>
              </div>

              <div className="space-y-4">
                <input 
                  placeholder="Manual URL..." 
                  className="w-full bg-black border border-white/10 p-4 rounded-2xl outline-none focus:border-brandRed transition-all font-bold text-[10px] text-zinc-400 focus:text-white"
                  value={url || ''}
                  onChange={(e) => {
                    const newImgs = [...images];
                    newImgs[idx] = e.target.value;
                    setImages(newImgs);
                  }}
                />
                <label className="flex items-center justify-center gap-3 w-full py-4 bg-zinc-900 border border-white/5 rounded-2xl cursor-pointer hover:bg-brandRed transition-all">
                  <Upload size={14} />
                  <span className="text-[9px] font-black uppercase tracking-widest">Upload Asset</span>
                  <input type="file" className="hidden" accept="image/*" onChange={(e) => handleFileUpload(e, idx)} disabled={uploadingIdx !== null} />
                </label>
              </div>
            </div>
          ))}
        </div>

        <button 
          onClick={handleSave} 
          disabled={saving || uploadingIdx !== null} 
          className="w-full mt-16 bg-brandRed text-white py-8 rounded-[32px] font-black uppercase tracking-[0.3em] text-[12px] flex items-center justify-center gap-4 hover:bg-white hover:text-black transition-all shadow-xl active:scale-[0.98] disabled:opacity-50"
        >
          {saving ? <Loader2 className="animate-spin" /> : <><Save size={20} /> Commit Archive Changes</>}
        </button>
      </div>
    </div>
  );
}