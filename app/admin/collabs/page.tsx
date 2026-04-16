"use client";
import { useState, useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { 
  Trash2, Power, Plus, ExternalLink, Loader2, 
  Clock, Timer, Edit3, X, Eye 
} from 'lucide-react';
import Image from 'next/image';
import { useAlert } from '@/context/AlertContext'; 
import TribeConfirm from '@/components/TribeConfirm';

interface CollaborationAd {
  _id: string;
  title: string;
  subtitle: string;
  link: string;
  imageUrl: string;
  isActive: boolean;
  delay?: number;
  duration?: number;
  createdAt: string;
}

export default function AdminCollabPage() {
  const [ads, setAds] = useState<CollaborationAd[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const { showAlert } = useAlert();

  // --- CUSTOM POPUP STATES ---
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [collabToDelete, setCollabToDelete] = useState<{id: string, title: string} | null>(null);

  const [form, setForm] = useState({ 
    title: '', 
    subtitle: '', 
    link: '',
    delay: 3000, 
    duration: 10000 
  });

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const fetchAds = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/popup?mode=all');
      const data = await res.json();
      setAds(data);
    } catch (error) {
      showAlert("Terminal Sync Failed", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAds(); }, []);

  // Handle local image preview
  useEffect(() => {
    if (!file) {
      // If we are not editing, clear preview. If editing, startEdit handles it.
      if (!editingId) setPreviewUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file, editingId]);

  const startEdit = (ad: CollaborationAd) => {
    setEditingId(ad._id);
    setPreviewUrl(ad.imageUrl);
    setForm({
      title: ad.title,
      subtitle: ad.subtitle,
      link: ad.link,
      delay: ad.delay || 3000,
      duration: ad.duration || 10000
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm({ title: '', subtitle: '', link: '', delay: 3000, duration: 10000 });
    setFile(null);
    setPreviewUrl(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const currentAd = ads.find((a) => a._id === editingId);
      let finalImageUrl = currentAd?.imageUrl || "";

      // Only upload if a new file was actually picked
      if (file) {
        const fileName = `collab-${Date.now()}`;
        const { error: uploadError } = await supabase.storage.from('ads').upload(fileName, file);
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from('ads').getPublicUrl(fileName);
        finalImageUrl = urlData.publicUrl;
      }

      if (!finalImageUrl) {
        showAlert("Asset link required", "error");
        setSaving(false);
        return;
      }

      const method = editingId ? 'PATCH' : 'POST';
      const payload = editingId 
        ? { id: editingId, ...form, imageUrl: finalImageUrl } 
        : { ...form, imageUrl: finalImageUrl, isActive: true };

      const res = await fetch('/api/admin/popup', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        showAlert(editingId ? "Node Updated" : "Collab Deployed", "success");
        cancelEdit();
        fetchAds();
      }
    } catch (err: any) {
      showAlert("Protocol Breach: Execution Failed", "error");
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (id: string, currentStatus: boolean) => {
    const res = await fetch('/api/admin/popup', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, isActive: !currentStatus })
    });
    if (res.ok) {
      showAlert(!currentStatus ? "Object Live" : "Object Hibernated", "success");
      fetchAds();
    }
  };

  const handlePurgeRequest = (id: string, title: string) => {
    setCollabToDelete({ id, title });
    setConfirmOpen(true);
  };

  const executePurge = async () => {
    try {
      const res = await fetch('/api/admin/popup', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: collabToDelete?.id })
      });
      if (res.ok) {
        showAlert("Object Deleted from Terminal", "success");
        fetchAds();
      }
    } catch (error) {
      showAlert("Purge Command Failed", "error");
    } finally {
      setConfirmOpen(false);
      setCollabToDelete(null);
    }
  };

  if (loading && ads.length === 0) return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <Loader2 className="animate-spin text-brandRed" size={40} />
    </div>
  );

  return (
    <div className="min-h-screen bg-black text-white pt-48 pb-20 px-8 selection:bg-brandRed/30">
      
      <TribeConfirm 
        isOpen={confirmOpen}
        title="Purge Command"
        message={`Warning: Permanently delete partnership with "${collabToDelete?.title}"? This asset will be wiped from storage.`}
        onConfirm={executePurge}
        onCancel={() => {
            setConfirmOpen(false);
            setCollabToDelete(null);
        }}
      />

      <div className="max-w-7xl mx-auto">
        <div className="flex items-center gap-4 mb-10">
          <div className="h-10 w-1 bg-brandRed shadow-[0_0_15px_#FF0000]" />
          <h1 className="text-5xl font-black italic uppercase tracking-tighter">
            Collab <span className="text-brandRed">Terminal .</span>
          </h1>
        </div>

        <div className="grid lg:grid-cols-12 gap-12">
          {/* FORM SECTION */}
          <div className="lg:col-span-4">
            <div className="bg-zinc-950 p-8 rounded-[40px] border border-white/5 sticky top-32 shadow-2xl">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-black uppercase italic tracking-tighter text-white">
                  {editingId ? 'Edit' : 'New'} <span className="text-brandRed">Collab .</span>
                </h2>
                {editingId && (
                  <button onClick={cancelEdit} className="p-2 hover:bg-white/5 rounded-full text-zinc-500 hover:text-white">
                    <X size={20} />
                  </button>
                )}
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* PREVIEW BOX */}
                <div className="relative group rounded-3xl overflow-hidden bg-black border border-white/5 aspect-video mb-4 flex items-center justify-center">
                  {previewUrl ? (
                    <>
                      <Image src={previewUrl} alt="Preview" fill className="object-cover opacity-60" />
                      <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent" />
                      <div className="absolute bottom-4 left-4 flex items-center gap-2">
                          <Eye size={12} className="text-brandRed" />
                          <span className="text-[8px] font-black uppercase tracking-widest text-white/70">Visual Buffer</span>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-zinc-800">
                      <Eye size={24} />
                      <span className="text-[9px] font-black uppercase tracking-widest">No Link</span>
                    </div>
                  )}
                </div>

                <div className="space-y-1 text-[10px]">
                    <label className="font-black uppercase tracking-[0.3em] text-zinc-600 ml-2">Designation</label>
                    <input placeholder="BUSINESS NAME" value={form.title} required className="w-full bg-black border border-white/10 p-4 rounded-2xl font-bold focus:border-brandRed outline-none uppercase tracking-widest text-white" onChange={e => setForm({...form, title: e.target.value.toUpperCase()})} />
                </div>

                <div className="space-y-1 text-[10px]">
                    <label className="font-black uppercase tracking-[0.3em] text-zinc-600 ml-2">Transmission Subtitle</label>
                    <input placeholder="OFFER / SUBTITLE" value={form.subtitle} required className="w-full bg-black border border-white/10 p-4 rounded-2xl font-bold focus:border-brandRed outline-none uppercase tracking-widest text-white" onChange={e => setForm({...form, subtitle: e.target.value.toUpperCase()})} />
                </div>

                <div className="space-y-1 text-[10px]">
                    <label className="font-black uppercase tracking-[0.3em] text-zinc-600 ml-2">External Protocol (URL)</label>
                    <input placeholder="https://link.com" value={form.link} required className="w-full bg-black border border-white/10 p-4 rounded-2xl font-bold focus:border-brandRed outline-none text-blue-400" onChange={e => setForm({...form, link: e.target.value})} />
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-600 ml-2">Delay (ms)</label>
                    <input type="number" value={form.delay} className="w-full bg-black border border-white/10 p-3 rounded-xl font-bold focus:border-brandRed outline-none text-white" onChange={e => setForm({...form, delay: Number(e.target.value)})} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-600 ml-2">Duration (ms)</label>
                    <input type="number" value={form.duration} className="w-full bg-black border border-white/10 p-3 rounded-xl font-bold focus:border-brandRed outline-none text-white" onChange={e => setForm({...form, duration: Number(e.target.value)})} />
                  </div>
                </div>

                <div className="space-y-1 pt-2">
                    <label className="font-black uppercase tracking-[0.3em] text-zinc-600 ml-2 text-[10px]">Media Asset</label>
                    <label className="flex items-center justify-center gap-3 bg-zinc-900 border border-white/5 p-4 rounded-2xl cursor-pointer hover:bg-brandRed transition-all">
                        <Plus size={16} className="text-brandRed" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-white">Link Banner</span>
                        <input type="file" accept="image/*" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
                    </label>
                </div>

                <button type="submit" disabled={saving} className={`w-full py-5 rounded-2xl font-black uppercase tracking-[0.3em] text-xs transition-all shadow-xl mt-4 ${editingId ? 'bg-blue-600' : 'bg-brandRed'} hover:bg-white hover:text-black`}>
                  {saving ? <Loader2 className="animate-spin mx-auto text-white" /> : editingId ? 'Commit Changes' : 'Publish Protocol'}
                </button>
              </form>
            </div>
          </div>

          {/* LIST SECTION */}
          <div className="lg:col-span-8 space-y-6">
            <h3 className="text-[10px] font-black uppercase tracking-[0.5em] text-zinc-600 flex items-center gap-4">
              Active Transmissions
              <div className="h-px flex-1 bg-zinc-900" />
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {ads.map((ad) => (
                <div key={ad._id} className="relative group p-6 rounded-[40px] bg-zinc-950 border border-white/5 transition-all hover:border-brandRed/30 shadow-2xl">
                  
                  <div className="absolute top-4 right-4 z-40 flex gap-2 opacity-0 group-hover:opacity-100 transition-all scale-90 group-hover:scale-100">
                    <button onClick={() => toggleStatus(ad._id, ad.isActive)} className={`p-4 rounded-2xl backdrop-blur-md border border-white/10 transition-all ${ad.isActive ? 'bg-brandRed text-white shadow-lg' : 'bg-black/80 hover:bg-brandRed text-white'}`}>
                      <Power size={16} />
                    </button>
                    <button onClick={() => startEdit(ad)} className="p-4 bg-black/80 backdrop-blur-md hover:bg-blue-600 rounded-2xl transition-all border border-white/10 text-white"><Edit3 size={16}/></button>
                    <button onClick={() => handlePurgeRequest(ad._id, ad.title)} className="p-4 bg-black/80 backdrop-blur-md hover:bg-red-600 rounded-2xl transition-all border border-white/10 text-white"><Trash2 size={16}/></button>
                  </div>

                  <div className="flex gap-6 items-center">
                    <div className="relative w-28 h-28 rounded-3xl overflow-hidden shrink-0 border border-white/5 bg-black">
                      <Image src={ad.imageUrl} alt="" fill className="object-cover" />
                    </div>
                    <div className="grow overflow-hidden">
                      <h4 className="font-black italic uppercase text-xl text-white truncate">{ad.title}</h4>
                      <p className="text-[10px] text-zinc-500 font-bold tracking-widest uppercase mb-3 truncate">{ad.subtitle}</p>
                      
                      <div className="flex items-center gap-4 text-[8px] font-black text-zinc-700 uppercase tracking-widest">
                        <span className="flex items-center gap-1"><Clock size={10}/> {ad.delay}ms</span>
                        <span className="flex items-center gap-1"><Timer size={10}/> {ad.duration}ms</span>
                      </div>
                      
                      {ad.isActive && (
                        <div className="mt-3 inline-flex items-center gap-2 px-3 py-1 bg-brandRed/10 border border-brandRed/20 rounded-full">
                            <div className="w-1 h-1 rounded-full bg-brandRed animate-pulse" />
                            <span className="text-[7px] font-black text-brandRed uppercase tracking-wider">Transmitting</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}