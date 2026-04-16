"use client";
import { useState, useEffect, useMemo } from 'react';
import { 
  ShieldCheck, Trash2, Search, Loader2, 
  MapPin, ExternalLink, Globe, Instagram, MessageCircle, X, Check, Zap, GripVertical,
  FileText, Eye, User
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import TribeConfirm from '@/components/TribeConfirm';
import { useAlert } from '@/context/AlertContext';
import { motion, AnimatePresence, Reorder } from 'framer-motion';

export default function AdminMartManager() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const { showAlert } = useAlert();

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<any>(null);
  
  // 🔥 Verification Audit State
  const [auditItem, setAuditItem] = useState<any>(null);

  useEffect(() => { fetchItems(); }, []);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/mart');
      const data = await res.json();
      const sortedData = Array.isArray(data) ? data.sort((a, b) => (a.order || 0) - (b.order || 0)) : [];
      setItems(sortedData);
    } catch (err) {
      showAlert("Terminal Connection Error", "error");
    } finally { setLoading(false); }
  };

  const handleReorderSave = async (newOrderItems: any[]) => {
    try {
      const orderPayload = newOrderItems.map((item, index) => ({
        id: item._id,
        order: index
      }));

      const res = await fetch('/api/mart', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reorder: true, newOrder: orderPayload })
      });

      if (res.ok) showAlert("Sequence Synchronized", "success");
    } catch (err) { showAlert("Ordering Sync Failed", "error"); }
  };

  const toggleApproval = async (id: string, currentStatus: boolean) => {
    setUpdatingId(id);
    showAlert(`Processing ${currentStatus ? 'Revocation' : 'Approval'}...`, "info");
    try {
      const res = await fetch('/api/mart', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, isApproved: !currentStatus })
      });
      if (res.ok) {
        setItems(items.map(item => item._id === id ? { ...item, isApproved: !currentStatus } : item));
        showAlert(!currentStatus ? "Business Approved" : "Approval Revoked", "success");
      }
    } catch (err) { showAlert("Sync Failed", "error"); }
    finally { setUpdatingId(null); }
  };

  const toggleVerify = async (id: string, currentStatus: boolean) => {
    setUpdatingId(id);
    showAlert("Updating Verification Status...", "info");
    try {
      const res = await fetch('/api/mart', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, isVerified: !currentStatus })
      });
      if (res.ok) {
        setItems(items.map(item => item._id === id ? { ...item, isVerified: !currentStatus } : item));
        showAlert(!currentStatus ? "Business Verified" : "Verification Revoked", "success");
        setAuditItem(null); // Close audit modal if open
      }
    } catch (err) { showAlert("Sync Failed", "error"); }
    finally { setUpdatingId(null); }
  };

  const handleReject = async (item: any) => {
    setUpdatingId(item._id);
    showAlert("Initiating Rejection Protocol...", "info");
    try {
      const res = await fetch('/api/mart', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item._id, isRejected: true })
      });
      if (res.ok) {
        showAlert("Listing Rejected", "success");
        fetchItems(); 
      }
    } catch (err) { showAlert("Rejection Failed", "error"); }
    finally { setUpdatingId(null); }
  };

  const handleDelete = async () => {
    if (!itemToDelete) return;
    setUpdatingId(itemToDelete._id);
    try {
      const res = await fetch('/api/mart', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: itemToDelete._id })
      });
      if (res.ok) {
        setItems(items.filter(i => i._id !== itemToDelete._id));
        setConfirmOpen(false);
        showAlert("Professional removed", "success");
      }
    } catch (err) { showAlert("Purge Protocol Failed", "error"); }
    finally { setUpdatingId(null); }
  };

  const filtered = useMemo(() => {
    return items.filter(i => 
      i.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      i.category?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      i.userEmail?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [items, searchQuery]);

  return (
    <div className="min-h-screen bg-black pt-40 pb-20 px-6 lg:px-16 text-white">
      <TribeConfirm 
        isOpen={confirmOpen}
        title="Purge Listing"
        message={`Warning: You are permanently removing "${itemToDelete?.name}".`}
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
      />

      <div className="max-w-7xl mx-auto space-y-12">
        <div className="flex flex-col md:flex-row justify-between items-end gap-6 border-b border-white/5 pb-12">
          <div className="space-y-4">
            <h1 className="text-5xl md:text-7xl font-black italic uppercase tracking-tighter leading-none">
              Mart <span className="text-brandRed">Audit .</span>
            </h1>
            <p className="text-zinc-500 font-bold uppercase tracking-[0.3em] text-[10px]">
              Drag to reorder // {items.length} Registered Business
            </p>
          </div>

          <div className="relative group w-full md:w-80">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600 group-focus-within:text-brandRed" size={16} />
            <input 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="SEARCH BUSINESS OR EMAIL..."
              className="w-full bg-zinc-950 border border-white/5 p-4 pl-12 rounded-2xl text-[10px] font-black tracking-widest focus:border-brandRed outline-none"
            />
          </div>
        </div>

        <Reorder.Group axis="y" values={items} onReorder={setItems} className="grid grid-cols-1 gap-4">
          {filtered.map((item) => (
            <Reorder.Item 
              key={item._id} 
              value={item}
              onDragEnd={() => handleReorderSave(items)}
              dragListener={!updatingId}
              className="group relative bg-zinc-950 border border-white/5 p-6 rounded-[32px] flex flex-col md:flex-row items-center gap-8 hover:bg-zinc-900/50 transition-all active:cursor-grabbing"
            >
              {updatingId === item._id && (
                <div className="absolute inset-0 z-[50] bg-black/70 backdrop-blur-sm rounded-[32px] flex items-center justify-center gap-3">
                  <Loader2 className="animate-spin text-brandRed" size={24} />
                  <span className="text-[10px] font-black uppercase tracking-[0.3em] text-brandRed">Updating Business...</span>
                </div>
              )}

              <div className="hidden md:flex text-zinc-800 group-hover:text-zinc-500 cursor-grab active:cursor-grabbing transition-colors">
                <GripVertical size={24} />
              </div>

              <div className="w-24 h-24 rounded-2xl overflow-hidden bg-black shrink-0 relative">
                <Image 
                  src={`https://bhfrgcphqmbocplfcvbg.supabase.co/storage/v1/object/public/mallu-mart/${item.imagePaths?.[0] || item.imagePath}`}
                  alt="Thumb" fill unoptimized className="object-cover opacity-60 group-hover:opacity-100 transition-opacity"
                />
              </div>

              <div className="flex-1 space-y-2 text-center md:text-left">
                <div className="flex items-center justify-center md:justify-start gap-3">
                  <h3 className="text-xl font-black uppercase italic">{item.name}</h3>
                  {item.isVerified && <ShieldCheck className="text-brandRed" size={18} />}
                  {item.verificationStatus === 'PENDING' && (
                    <span className="px-3 py-1 bg-amber-500/10 text-amber-500 border border-amber-500/20 rounded-full text-[8px] font-black uppercase tracking-widest animate-pulse">Audit Required</span>
                  )}
                </div>
                <div className="flex flex-wrap justify-center md:justify-start gap-4 text-[10px] font-black text-zinc-500 uppercase tracking-widest">
                  <span className="text-brandRed">{item.category}</span>
                  <span>{item.area}</span>
                  <span className="text-zinc-700">{item.userEmail}</span>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Link href={`/directory/${item._id}`} target="_blank" className="p-3 bg-zinc-900 text-zinc-500 hover:text-brandRed rounded-xl transition-all border border-white/5">
                  <ExternalLink size={18}/>
                </Link>

                <button 
                  disabled={!!updatingId}
                  onClick={() => toggleApproval(item._id, item.isApproved)}
                  className={`flex items-center gap-2 px-6 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${item.isApproved ? 'bg-green-600 text-white shadow-[0_0_20px_rgba(34,197,94,0.3)]' : 'bg-zinc-900 text-zinc-500 hover:text-white border border-white/5'}`}
                >
                  {item.isApproved ? <Check size={14} /> : <Zap size={14} />}
                  {item.isApproved ? 'Live' : 'Approve'}
                </button>

                {/* 🔥 NEW: AUDIT BUTTON (Only if docs submitted) */}
                {item.verificationDocs && (
                  <button 
                    onClick={() => setAuditItem(item)}
                    className="flex items-center gap-2 px-6 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest bg-zinc-900 text-cyan-400 hover:text-white border border-cyan-400/20 transition-all"
                  >
                    <Eye size={14} /> Audit
                  </button>
                )}

                <button 
                  disabled={!!updatingId}
                  onClick={() => toggleVerify(item._id, item.isVerified)}
                  className={`flex items-center gap-2 px-6 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${item.isVerified ? 'bg-brandRed text-white shadow-[0_0_20px_#FF0000]' : 'bg-zinc-900 text-zinc-500 hover:text-white border border-white/5'}`}
                >
                  {item.isVerified ? <Check size={14} /> : <ShieldCheck size={14} />}
                  {item.isVerified ? 'Verified' : 'Verify'}
                </button>

                <button onClick={() => { setItemToDelete(item); setConfirmOpen(true); }} className="p-3 bg-zinc-900 text-zinc-600 hover:text-brandRed rounded-xl transition-all border border-white/5">
                  <Trash2 size={20} />
                </button>
              </div>
            </Reorder.Item>
          ))}
        </Reorder.Group>
      </div>

      {/* 🔥 VERIFICATION AUDIT MODAL */}
      <AnimatePresence>
        {auditItem && (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setAuditItem(null)} className="absolute inset-0 bg-black/95 backdrop-blur-xl" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-4xl bg-zinc-950 border border-white/10 rounded-[40px] p-10 overflow-hidden shadow-2xl">
              <div className="flex justify-between items-start mb-10">
                <div className="space-y-1">
                  <h2 className="text-3xl font-black italic uppercase tracking-tighter">Reviewing <span className="text-brandRed">{auditItem.name}</span></h2>
                  <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Verification Audit Protocol</p>
                </div>
                <button onClick={() => setAuditItem(null)} className="p-2 bg-zinc-900 rounded-full hover:text-brandRed transition-all"><X size={24} /></button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
                {[
                  { label: 'Shop Act / GST', key: 'shopAct', icon: FileText },
                  { label: 'Founder Identity', key: 'idProof', icon: User },
                  { label: 'Utility Bill', key: 'utility', icon: MapPin }
                ].map((doc) => (
                  auditItem.verificationDocs[doc.key] && (
                    <a 
                      key={doc.key}
                      href={`https://bhfrgcphqmbocplfcvbg.supabase.co/storage/v1/object/public/mallu-mart/${auditItem.verificationDocs[doc.key]}`} 
                      target="_blank"
                      className="group bg-zinc-900/50 p-6 rounded-[24px] border border-white/5 hover:border-brandRed/50 transition-all text-center space-y-4"
                    >
                      <div className="w-12 h-12 bg-black rounded-xl flex items-center justify-center mx-auto text-brandRed"><doc.icon size={24} /></div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-white">{doc.label}</p>
                      <button className="text-[8px] font-black uppercase tracking-[0.2em] bg-white text-black px-4 py-2 rounded-lg group-hover:bg-brandRed group-hover:text-white transition-all">Open File</button>
                    </a>
                  )
                ))}
              </div>

              <div className="flex gap-4">
                <button 
                  onClick={() => toggleVerify(auditItem._id, auditItem.isVerified)}
                  className="flex-1 py-5 bg-brandRed text-white font-black uppercase text-xs tracking-widest rounded-2xl hover:bg-white hover:text-black transition-all shadow-xl"
                >
                  Confirm & Verify Business
                </button>
                <button 
                  onClick={() => handleReject(auditItem)}
                  className="px-10 py-5 bg-zinc-900 text-zinc-500 font-black uppercase text-xs tracking-widest rounded-2xl hover:bg-red-600 hover:text-white transition-all"
                >
                  Reject Proofs
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}