"use client";
import { useState, useEffect } from 'react';
import { 
  Trash2, Edit3, Plus, Globe, Instagram, 
  Loader2, Search, X, ShieldCheck, Zap, Eye, Handshake, Star, Briefcase,
  ArrowLeft, ArrowRight, Move, Save
} from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import TribeConfirm from '@/components/TribeConfirm';
import { useAlert } from '@/context/AlertContext';

// EXACT HIERARCHY FOR CONSISTENT ADMIN VIEW
const HIERARCHY = [
  "Advisory Board",
  "Board of Trustees", 
  "Executive Council", 
  "Trailblazers Panel"
];

export default function PartnerAdmin() {
  const [partners, setPartners] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState(""); 
  const { showAlert } = useAlert();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<any>(null);

  // 🔥 NEW: Reorder States
  const [reorderMode, setReorderMode] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [isSavingOrder, setIsSavingOrder] = useState(false);

  const fetchPartners = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/partners');
      const data = await res.json();
      // Ensure everyone has an order value initially to prevent sorting bugs
      const normalizedData = data.map((p: any, idx: number) => ({ ...p, order: p.order ?? idx }));
      setPartners(normalizedData);
    } catch (error) { 
      console.error("Failed to fetch members:", error); 
    } finally { 
      setLoading(false); 
    }
  };

  useEffect(() => { fetchPartners(); }, []);

  const handleDelete = async () => {
    if (!itemToDelete) return;
    try {
      const res = await fetch(`/api/partners/delete?id=${itemToDelete._id}`, { method: 'DELETE' });
      if (res.ok) {
        setPartners(partners.filter(p => p._id !== itemToDelete._id));
        showAlert("Member Removed", "success");
      }
    } catch (error) { 
      showAlert("Operation failed", "error"); 
    } finally { 
      setConfirmOpen(false); 
      setItemToDelete(null);
    }
  };

  // 🔥 NEW: Movement Logic
  const handleMove = (cat: string, index: number, direction: number) => {
    // Isolate members of the current category and sort them by their current order
    const catMembers = partners
      .filter(p => p.category === cat)
      .sort((a, b) => (a.order || 0) - (b.order || 0));

    // Prevent out-of-bounds movement
    if (direction === -1 && index === 0) return;
    if (direction === 1 && index === catMembers.length - 1) return;

    const newCatMembers = [...catMembers];
    
    // Swap the elements
    const temp = newCatMembers[index];
    newCatMembers[index] = newCatMembers[index + direction];
    newCatMembers[index + direction] = temp;

    // Re-assign sequential order values to the isolated category
    newCatMembers.forEach((item, i) => {
      item.order = i;
    });

    // Merge the newly ordered category back into the main state
    setPartners(prev => {
      const otherCategories = prev.filter(p => p.category !== cat);
      return [...otherCategories, ...newCatMembers];
    });
    
    setHasChanges(true);
  };

  // 🔥 NEW: Save Sequence Logic
  const saveLayoutSequence = async () => {
    setIsSavingOrder(true);
    try {
      // Send a mapped array of just the IDs and their new order values
      const payload = partners.map(p => ({ _id: p._id, order: p.order }));
      
      const res = await fetch('/api/partners/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (res.ok) {
        showAlert("Layout sequence synchronized", "success");
        setReorderMode(false);
        setHasChanges(false);
      } else {
        showAlert("Failed to sync layout", "error");
      }
    } catch (error) {
      showAlert("Network override failed", "error");
    } finally {
      setIsSavingOrder(false);
    }
  };

  if (loading) return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <Loader2 className="animate-spin text-brandRed" size={40} strokeWidth={1} />
    </div>
  );

  return (
    <div className="min-h-screen bg-black pt-40 pb-20 px-6 lg:px-16 text-white selection:bg-brandRed/30">
      
      <TribeConfirm 
        isOpen={confirmOpen} 
        title="Remove Member" 
        message={`Confirm: Remove "${itemToDelete?.name}" from the structural grid?`} 
        onConfirm={handleDelete} 
        onCancel={() => setConfirmOpen(false)} 
      />

      <div className="max-w-7xl mx-auto space-y-20">
        
        {/* HEADER */}
        <div className="flex flex-col md:flex-row justify-between items-center gap-6 border-b border-white/5 pb-10">
          <div className="space-y-1 text-center md:text-left">
            <div className="flex items-center justify-center md:justify-start gap-2 text-brandRed font-black uppercase text-[10px] tracking-[0.3em]">
              <ShieldCheck size={12} fill="currentColor" /> Structural Grid Management
            </div>
            <h1 className="text-4xl md:text-5xl font-black italic uppercase tracking-tighter">
              Network <span className="text-brandRed">Partners .</span>
            </h1>
          </div>
          
          <div className="flex flex-col md:flex-row gap-4 w-full md:w-auto">
            {/* Search Bar - Disabled during reorder mode to prevent index corruption */}
            <div className={`relative group flex-1 md:w-72 transition-opacity ${reorderMode ? 'opacity-30 pointer-events-none' : ''}`}>
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600 group-focus-within:text-brandRed" size={16} />
              <input 
                placeholder="SEARCH MEMBERS..." 
                disabled={reorderMode}
                className="w-full bg-zinc-900/50 border border-white/10 p-4 pl-12 rounded-2xl text-[10px] font-black uppercase outline-none focus:border-brandRed transition-all"
                value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              />
            </div>

            {/* 🔥 REORDER & SAVE TOGGLES */}
            {!reorderMode ? (
              <>
                <button 
                  onClick={() => { setReorderMode(true); setSearchQuery(""); }} 
                  className="w-full md:w-auto bg-zinc-900 text-white border border-white/10 px-6 py-4 rounded-2xl font-black uppercase text-[10px] tracking-widest hover:border-brandRed transition-all flex items-center justify-center gap-2 shadow-xl active:scale-95"
                >
                  <Move size={16} className="text-brandRed" /> Reorder Mode
                </button>
                <Link href="/admin/partners/list">
                  <button className="w-full md:w-auto bg-white text-black px-8 py-4 rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-brandRed hover:text-white transition-all flex items-center justify-center gap-2 shadow-xl active:scale-95">
                    <Plus size={16} /> Add Member
                  </button>
                </Link>
              </>
            ) : (
              <>
                <button 
                  onClick={() => { setReorderMode(false); fetchPartners(); setHasChanges(false); }} 
                  className="w-full md:w-auto bg-zinc-900 text-white border border-white/10 px-6 py-4 rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-zinc-800 transition-all flex items-center justify-center gap-2 shadow-xl active:scale-95"
                >
                  <X size={16} /> Cancel
                </button>
                <button 
                  onClick={saveLayoutSequence}
                  disabled={!hasChanges || isSavingOrder}
                  className={`w-full md:w-auto px-8 py-4 rounded-2xl font-black uppercase text-[10px] tracking-widest transition-all flex items-center justify-center gap-2 shadow-xl active:scale-95 ${
                    hasChanges 
                    ? 'bg-brandRed text-white hover:bg-white hover:text-black' 
                    : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                  }`}
                >
                  {isSavingOrder ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} 
                  Save Layout
                </button>
              </>
            )}
          </div>
        </div>

        {/* SECTIONAL GRID BASED ON HIERARCHY */}
        <div className="space-y-24">
          {HIERARCHY.map((cat) => {
            // 🔥 Sort members by their order attribute before rendering
            const sectionMembers = partners
              .filter(p => p.category === cat && 
                (p.name?.toLowerCase().includes(searchQuery.toLowerCase()) || 
                 p.perk?.toLowerCase().includes(searchQuery.toLowerCase()))
              )
              .sort((a, b) => (a.order || 0) - (b.order || 0));

            if (sectionMembers.length === 0) return null;

            return (
              <section key={cat} className="space-y-10">
                {/* SECTION DIVIDER */}
                <div className="flex items-center gap-6">
                  <h3 className="text-xl md:text-2xl font-black uppercase italic tracking-tighter text-zinc-400">
                    {cat} <span className="text-[10px] not-italic text-zinc-600 ml-2">// {sectionMembers.length} ACTIVE</span>
                  </h3>
                  <div className="h-px flex-1 bg-gradient-to-r from-white/10 to-transparent" />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                  {sectionMembers.map((member, idx) => (
                    <div key={member._id} className={`group bg-zinc-950 border rounded-[40px] overflow-hidden transition-all duration-500 shadow-2xl flex flex-col relative ${reorderMode ? 'border-brandRed/50 scale-[0.98]' : 'border-white/5 hover:border-brandRed/30'}`}>
                      
                      {/* 🔥 REORDER OVERLAY */}
                      {reorderMode && (
                        <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-between px-6 opacity-0 group-hover:opacity-100 transition-opacity rounded-[40px]">
                          <button 
                            disabled={idx === 0}
                            onClick={() => handleMove(cat, idx, -1)}
                            className="p-4 bg-zinc-900 rounded-full border border-white/10 hover:bg-brandRed hover:border-brandRed disabled:opacity-30 disabled:hover:bg-zinc-900 text-white transition-all shadow-2xl"
                          >
                            <ArrowLeft size={24} />
                          </button>
                          
                          <div className="flex flex-col items-center">
                            <Move size={24} className="text-zinc-500 mb-2" />
                            <span className="font-black text-white tracking-widest text-[10px] uppercase">Pos: {idx + 1}</span>
                          </div>

                          <button 
                            disabled={idx === sectionMembers.length - 1}
                            onClick={() => handleMove(cat, idx, 1)}
                            className="p-4 bg-zinc-900 rounded-full border border-white/10 hover:bg-brandRed hover:border-brandRed disabled:opacity-30 disabled:hover:bg-zinc-900 text-white transition-all shadow-2xl"
                          >
                            <ArrowRight size={24} />
                          </button>
                        </div>
                      )}

                      {/* MEMBER ASSET SECTION */}
                      <div className="h-56 relative bg-white/[0.01] flex items-center justify-center overflow-hidden border-b border-white/5">
                        <div className="relative w-32 h-32 rounded-full overflow-hidden border-4 border-zinc-900 shadow-2xl group-hover:border-brandRed transition-all duration-500">
                          <Image 
                            src={member.image || "/about/placeholder.jpeg"} 
                            alt={member.name} 
                            fill 
                            className="object-cover transition-all duration-700 group-hover:scale-110" 
                            unoptimized
                          />
                        </div>
                        
                        {/* FLOATING ACTION OVERLAY - Disabled during Reorder Mode */}
                        {!reorderMode && (
                          <div className="absolute top-6 right-6 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-all translate-x-4 group-hover:translate-x-0 z-40">
                             <Link 
                               href={`/partners/${member._id}`} 
                               className="p-3 bg-white text-black rounded-xl hover:bg-brandRed hover:text-white transition-all shadow-xl"
                             >
                                <Eye size={16}/>
                             </Link>
                             
                             <Link 
                               href={`/admin/partners/list?edit=${member._id}`} 
                               className="p-3 bg-zinc-900 text-white rounded-xl hover:text-brandRed border border-white/10 transition-all"
                             >
                                <Edit3 size={16}/>
                             </Link>
                             
                             <button 
                               onClick={() => { setItemToDelete(member); setConfirmOpen(true); }} 
                               className="p-3 bg-zinc-900 text-white rounded-xl hover:text-red-500 border border-white/10 transition-all"
                             >
                                <Trash2 size={16}/>
                             </button>
                          </div>
                        )}
                      </div>

                      {/* MEMBER INFO */}
                      <div className="p-8 space-y-4 flex-1 flex flex-col">
                        <div className="space-y-1 text-center">
                          <h3 className="text-2xl font-black italic uppercase tracking-tighter group-hover:text-brandRed transition-colors">
                            {member.name}
                          </h3>
                          {member.perk && (
                            <div className="flex items-center justify-center gap-2 text-zinc-500">
                               <Briefcase size={12} className="text-brandRed" />
                               <p className="text-[9px] font-bold uppercase tracking-[0.2em]">
                                  {member.perk}
                                </p>
                            </div>
                          )}
                        </div>

                        <div className="flex items-center justify-center gap-6 pt-6 border-t border-white/5 mt-auto">
                           {member.link && <Globe size={14} className="text-zinc-700 hover:text-white transition-colors" />}
                           {member.instagram && <Instagram size={14} className="text-zinc-700 hover:text-white transition-colors" />}
                           {member.whatsapp && <Handshake size={14} className="text-zinc-700 hover:text-white transition-colors" />}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>

        {/* EMPTY STATE */}
        {partners.length === 0 && !loading && (
            <div className="py-32 text-center border-2 border-dashed border-white/5 rounded-[50px] bg-zinc-950/20">
                <ShieldCheck size={48} className="mx-auto text-zinc-800 mb-4" />
                <p className="text-zinc-600 font-black uppercase text-xs tracking-[0.3em]">Grid is currently offline</p>
                <Link href="/admin/partners/list">
                  <button className="mt-6 text-brandRed font-black uppercase text-[10px] hover:underline">Add First Member</button>
                </Link>
            </div>
        )}
      </div>
    </div>
  );
}