"use client";
import { useState, useEffect, useMemo } from 'react';
import { 
  Trash2, Edit3, Plus, Users, Globe, 
  Loader2, Search, X, MapPin, ShieldCheck, Zap,
  Eye, EyeOff, CheckCircle, Clock, Check, ExternalLink, GripVertical
} from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import { Reorder } from 'framer-motion';
import TribeConfirm from '@/components/TribeConfirm';
import { useAlert } from '@/context/AlertContext';

const TABS = [
  { id: 'ALL', label: 'All Communities' },
  { id: 'PENDING', label: 'Pending Review' },
  { id: 'LIVE', label: 'Live on Grid' }
];

export default function CommunityAdmin() {
  const [circles, setCircles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState(""); 
  const [activeTab, setActiveTab] = useState('ALL');
  const { showAlert } = useAlert();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<any>(null);

  const fetchCircles = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/community?admin=true');
      const data = await res.json();
      const sortedData = Array.isArray(data) ? data.sort((a, b) => (a.order || 0) - (b.order || 0)) : [];
      setCircles(sortedData);
    } catch (error) { 
      showAlert("Sync Failed", "error");
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchCircles(); }, []);

  const handleReorderSave = async (newOrderCircles: any[]) => {
    try {
      const orderPayload = newOrderCircles.map((item, index) => ({
        id: item._id,
        order: index
      }));
      const res = await fetch('/api/community/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reorder: true, newOrder: orderPayload })
      });
      if (res.ok) showAlert("Sequence Synced", "success");
    } catch (err) { showAlert("Ordering Failed", "error"); }
  };

  const toggleApproval = async (circle: any) => {
    setUpdatingId(circle._id);
    showAlert(`Processing ${circle.isApproved ? 'Deactivation' : 'Approval'}...`, "info");
    try {
      const res = await fetch('/api/community/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _id: circle._id, isApproved: !circle.isApproved })
      });
      if (res.ok) {
        setCircles(circles.map(c => c._id === circle._id ? { ...c, isApproved: !c.isApproved } : c));
        showAlert(circle.isApproved ? "Node Hidden" : "Node Approved & Live", "success");
      }
    } catch (error) { showAlert("Action failed", "error"); }
    finally { setUpdatingId(null); }
  };

  const handleReject = async (circle: any) => {
    setUpdatingId(circle._id);
    showAlert("Initiating Rejection Protocol...", "info");
    try {
      const res = await fetch('/api/community/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _id: circle._id, isRejected: true })
      });
      if (res.ok) {
        showAlert("Submission Rejected", "success");
        fetchCircles(); 
      }
    } catch (error) { showAlert("Rejection failed", "error"); }
    finally { setUpdatingId(null); }
  };

  const handleDelete = async () => {
    if (!itemToDelete) return;
    setUpdatingId(itemToDelete._id);
    try {
      const res = await fetch(`/api/community/delete?id=${itemToDelete._id}`, { method: 'DELETE' });
      if (res.ok) {
        setCircles(circles.filter(c => c._id !== itemToDelete._id));
        showAlert("Node Dissolved", "success");
      }
    } catch (error) { showAlert("Action failed", "error"); }
    finally { setConfirmOpen(false); setUpdatingId(null); }
  };

  const filteredCircles = useMemo(() => {
    return circles.filter(c => {
      const matchesSearch = c.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            c.category?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesTab = activeTab === 'ALL' || 
                         (activeTab === 'PENDING' && !c.isApproved) || 
                         (activeTab === 'LIVE' && c.isApproved);
      return matchesSearch && matchesTab;
    });
  }, [circles, searchQuery, activeTab]);

  return (
    <div className="min-h-screen bg-black pt-40 pb-20 px-6 lg:px-16 text-white text-glow">
      <TribeConfirm 
        isOpen={confirmOpen} 
        title="Dissolve Community" 
        message={`Remove "${itemToDelete?.title}" permanently?`} 
        onConfirm={handleDelete} 
        onCancel={() => setConfirmOpen(false)} 
      />

      <div className="max-w-7xl mx-auto space-y-10">
        <div className="flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="space-y-1">
            <h2 className="text-4xl font-black italic uppercase tracking-tighter leading-none">Community <span className="text-cyan-400">Audit .</span></h2>
            <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">
              Drag to reorder // {circles.length} Nodes Registered
            </p>
          </div>
          <Link href="/admin/community/list">
            <button className="bg-white text-black px-8 py-4 rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-cyan-400 transition-all flex items-center gap-2 shadow-xl">
              <Plus size={16} /> Add Organization
            </button>
          </Link>
        </div>

        <div className="flex flex-col md:flex-row items-center justify-between gap-6 bg-zinc-900/20 p-4 rounded-[30px] border border-white/5 backdrop-blur-sm">
          <div className="flex bg-black p-1 rounded-xl border border-white/10 w-full md:w-auto overflow-x-auto no-scrollbar">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-6 py-2.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${activeTab === tab.id ? 'bg-cyan-400 text-black' : 'text-zinc-500 hover:text-white'}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="relative w-full md:w-80">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600" size={16} />
            <input 
              placeholder="SEARCH NODES..." 
              className="w-full bg-black border border-white/10 p-4 pl-12 rounded-2xl text-[10px] font-black uppercase outline-none focus:border-cyan-400 transition-all"
              value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {loading && circles.length === 0 ? (
          <div className="h-64 flex items-center justify-center"><Loader2 className="animate-spin text-cyan-400" size={40} /></div>
        ) : (
          <Reorder.Group 
            axis="y" 
            values={circles} 
            onReorder={setCircles} 
            className="grid grid-cols-1 gap-4"
          >
            {filteredCircles.map((circle) => (
              <Reorder.Item 
                key={circle._id} 
                value={circle}
                onDragEnd={() => handleReorderSave(circles)}
                dragListener={!updatingId}
                className="group relative bg-zinc-950 border border-white/5 p-6 rounded-[32px] flex flex-col md:flex-row items-center gap-8 hover:bg-zinc-900/50 transition-all active:cursor-grabbing"
              >
                {updatingId === circle._id && (
                  <div className="absolute inset-0 z-[100] bg-black/70 backdrop-blur-sm rounded-[32px] flex items-center justify-center gap-3">
                    <Loader2 className="animate-spin text-cyan-400" size={24} />
                    <span className="text-[10px] font-black uppercase tracking-[0.3em] text-cyan-400">Syncing Node...</span>
                  </div>
                )}

                {/* Drag Handle */}
                <div className="hidden md:flex text-zinc-800 group-hover:text-zinc-500 cursor-grab active:cursor-grabbing transition-colors">
                  <GripVertical size={24} />
                </div>

                {/* Thumbnail */}
                <div className="w-24 h-24 rounded-2xl overflow-hidden bg-black shrink-0 relative">
                  <img 
                    src={circle.image || "/about/placeholder.jpeg"} 
                    alt="Thumb" 
                    className="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity" 
                  />
                </div>

                {/* Content */}
                <div className="flex-1 space-y-2 text-center md:text-left">
                  <div className="flex items-center justify-center md:justify-start gap-3">
                    <h3 className="text-xl font-black uppercase italic">{circle.title}</h3>
                    {circle.isApproved ? <CheckCircle className="text-green-500" size={16} /> : <Clock className="text-amber-500" size={16} />}
                  </div>
                  <div className="flex flex-wrap justify-center md:justify-start gap-4 text-[10px] font-black text-zinc-500 uppercase tracking-widest">
                    <span className="text-cyan-400">{circle.category}</span>
                    <span className="flex items-center gap-1"><MapPin size={10} /> {circle.area}</span>
                    <span className="text-zinc-700">{circle.submittedBy?.split('@')[0]}</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-3">
                  <Link href={`/community/${circle._id}`} target="_blank" className="p-3 bg-zinc-900 text-zinc-500 hover:text-cyan-400 rounded-xl transition-all border border-white/5">
                    <ExternalLink size={18}/>
                  </Link>

                  <button 
                    disabled={!!updatingId}
                    onClick={() => toggleApproval(circle)} 
                    className={`flex items-center gap-2 px-6 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                      circle.isApproved 
                      ? 'bg-green-600 text-white shadow-[0_0_20px_rgba(34,197,94,0.3)]' 
                      : 'bg-zinc-900 text-zinc-500 hover:text-white border border-white/5'
                    }`}
                  >
                    {circle.isApproved ? <EyeOff size={14} /> : <Check size={14} />}
                    {circle.isApproved ? 'Live' : 'Approve'}
                  </button>

                  {!circle.isApproved && (
                    <button 
                      disabled={!!updatingId}
                      onClick={() => handleReject(circle)} 
                      className="p-3 bg-zinc-900 text-zinc-500 hover:text-brandRed hover:bg-brandRed/10 rounded-xl transition-all border border-white/5"
                    >
                      <X size={18} />
                    </button>
                  )}
                  
                  <Link href={`/admin/community/list?edit=${circle._id}`} className="p-3 bg-zinc-900 text-zinc-500 hover:text-cyan-400 rounded-xl transition-all border border-white/5">
                    <Edit3 size={18}/>
                  </Link>

                  <button 
                    disabled={!!updatingId} 
                    onClick={() => { setItemToDelete(circle); setConfirmOpen(true); }} 
                    className="p-3 bg-zinc-900 text-zinc-600 hover:text-red-500 rounded-xl transition-all border border-white/5"
                  >
                    <Trash2 size={18}/>
                  </button>
                </div>
              </Reorder.Item>
            ))}
          </Reorder.Group>
        )}
      </div>
    </div>
  );
}