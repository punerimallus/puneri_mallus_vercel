"use client";
import { useState, useEffect, useMemo } from 'react';
import { 
  ShieldCheck, Trash2, Search, Loader2, 
  MapPin, ExternalLink, Globe, Instagram, MessageCircle, X, Check, Zap, GripVertical
} from 'lucide-react';
import Image from 'next/image';
import TribeConfirm from '@/components/TribeConfirm';
import { useAlert } from '@/context/AlertContext';
import { motion, AnimatePresence, Reorder } from 'framer-motion'; // 🔥 Added Reorder

export default function AdminMartManager() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const { showAlert } = useAlert();

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<any>(null);

  useEffect(() => { fetchItems(); }, []);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/mart');
      const data = await res.json();
      // Ensure data is sorted by an 'order' field if it exists
      const sortedData = Array.isArray(data) ? data.sort((a, b) => (a.order || 0) - (b.order || 0)) : [];
      setItems(sortedData);
    } catch (err) {
      showAlert("Terminal Connection Error", "error");
    } finally { setLoading(false); }
  };

  // 🔥 NEW: Save Reorder to Database
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

      if (res.ok) {
        showAlert("Sequence Synchronized", "success");
      }
    } catch (err) {
      showAlert("Ordering Sync Failed", "error");
    }
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
        showAlert("Listing Rejected & User Notified", "success");
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
        body: JSON.stringify({ 
          id: itemToDelete._id, 
          imagePaths: itemToDelete.imagePaths || [itemToDelete.imagePath] 
        })
      });
      if (res.ok) {
        setItems(items.filter(i => i._id !== itemToDelete._id));
        setConfirmOpen(false);
        showAlert("Professional Purged", "success");
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

  if (loading && items.length === 0) return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <Loader2 className="animate-spin text-brandRed" size={40} />
    </div>
  );

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

        {/* 🔥 Reorder Group Logic */}
        <Reorder.Group 
          axis="y" 
          values={items} 
          onReorder={setItems} 
          className="grid grid-cols-1 gap-4"
        >
          {filtered.map((item) => (
            <Reorder.Item 
              key={item._id} 
              value={item}
              onDragEnd={() => handleReorderSave(items)}
              dragListener={!updatingId} // Disable drag if updating
              className="group relative bg-zinc-950 border border-white/5 p-6 rounded-[32px] flex flex-col md:flex-row items-center gap-8 hover:bg-zinc-900/50 transition-all active:cursor-grabbing"
            >
              {/* Card Loader Overlay */}
              {updatingId === item._id && (
                <div className="absolute inset-0 z-[50] bg-black/70 backdrop-blur-sm rounded-[32px] flex items-center justify-center gap-3">
                  <Loader2 className="animate-spin text-brandRed" size={24} />
                  <span className="text-[10px] font-black uppercase tracking-[0.3em] text-brandRed">Updating Business...</span>
                </div>
              )}

              {/* Drag Handle Icon */}
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
                </div>
                <div className="flex flex-wrap justify-center md:justify-start gap-4 text-[10px] font-black text-zinc-500 uppercase tracking-widest">
                  <span className="text-brandRed">{item.category}</span>
                  <span>{item.area}</span>
                  <span className="text-zinc-700">{item.userEmail}</span>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button 
                  disabled={!!updatingId}
                  onClick={() => toggleApproval(item._id, item.isApproved)}
                  className={`flex items-center gap-2 px-6 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                    item.isApproved 
                    ? 'bg-green-600 text-white shadow-[0_0_20px_rgba(34,197,94,0.3)]' 
                    : 'bg-zinc-900 text-zinc-500 hover:text-white border border-white/5'
                  }`}
                >
                  {item.isApproved ? <Check size={14} /> : <Zap size={14} />}
                  {item.isApproved ? 'Approved' : 'Approve'}
                </button>

                {!item.isApproved && (
                  <button 
                    disabled={!!updatingId}
                    onClick={() => handleReject(item)} 
                    className="flex items-center gap-2 px-6 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest bg-zinc-900 text-zinc-500 hover:bg-brandRed hover:text-white transition-all border border-white/5"
                  >
                    <X size={14} /> Reject
                  </button>
                )}

                <button 
                  disabled={!!updatingId}
                  onClick={() => toggleVerify(item._id, item.isVerified)}
                  className={`flex items-center gap-2 px-6 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                    item.isVerified 
                    ? 'bg-brandRed text-white shadow-[0_0_20px_#FF0000]' 
                    : 'bg-zinc-900 text-zinc-500 hover:text-white border border-white/5'
                  }`}
                >
                  {item.isVerified ? <Check size={14} /> : <ShieldCheck size={14} />}
                  {item.isVerified ? 'Verified' : 'Verify'}
                </button>

                <button 
                  disabled={!!updatingId}
                  onClick={() => { setItemToDelete(item); setConfirmOpen(true); }}
                  className="p-3 bg-zinc-900 text-zinc-600 hover:text-brandRed hover:bg-brandRed/10 rounded-xl transition-all border border-white/5"
                >
                  <Trash2 size={20} />
                </button>
              </div>
            </Reorder.Item>
          ))}
        </Reorder.Group>
      </div>
    </div>
  );
}