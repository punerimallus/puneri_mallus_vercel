"use client";
import { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Trash2, Star, Edit3, X, RefreshCcw, Plus, 
  Clock, MapPin, Link as LinkIcon, Loader2, Camera, Globe, Search, Calendar,
  ExternalLink, Zap, Ticket
} from 'lucide-react';
import EventCard from '@/components/EventCard';
import { createBrowserClient } from '@supabase/ssr';
import { logAdminActivity } from '@/app/admin/action';
import { useAlert } from '@/context/AlertContext';
import TribeConfirm from '@/components/TribeConfirm';
import TribeCalendar from '@/components/ui/TribeCalendar';
import TribeTimePicker from '@/components/ui/TribeTimePicker'; // Import Custom Calendar
import { AnimatePresence } from 'framer-motion';

interface TribeEvent {
  _id: string;
  title: string;
  date: string;
  time: string;
  location: string;
  mapUrl?: string;
  ticketUrl?: string;
  category: string;
  categoryLogo?: string; // 🔥 NEW
  image: string;
  featured: boolean;
  description: string;
}

export default function AdminEventsPage() {
  const [events, setEvents] = useState<TribeEvent[]>([]);
  const [isEditingId, setIsEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const { showAlert } = useAlert();
  
  // --- REFS & CALENDAR STATES ---
  const timeInputRef = useRef<HTMLInputElement>(null);
  const dateContainerRef = useRef<HTMLDivElement>(null); // Anchor for TribeCalendar
  const [showCalendar, setShowCalendar] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [eventToDelete, setEventToDelete] = useState<{id: string, title: string} | null>(null);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false); // New state for logo
  const timeContainerRef = useRef<HTMLDivElement>(null);
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const [form, setForm] = useState({ 
    title: '', date: '', time: '', location: '', mapUrl: '', 
    ticketUrl: '', category: 'CULTURAL', image: '', featured: false, description: '',categoryLogo: ''
  });
  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const file = e.target.files?.[0];
      if (!file) return;
      setLogoUploading(true);
      const fileName = `logo-${Date.now()}`;
      const { error: uploadError } = await supabase.storage.from('events').upload(`logos/${fileName}`, file);
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from('events').getPublicUrl(`logos/${fileName}`);
      setForm({ ...form, categoryLogo: data.publicUrl });
      showAlert("Category Logo Synchronized", "success");
    } catch (error: any) {
      showAlert('Logo Upload Failed', "error");
    } finally {
      setLogoUploading(false);
    }
  };

  const fetchFromMongo = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/events');
      const data = await res.json();
      setEvents(data);
    } catch (error) {
      showAlert("Node Connection Failure", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchFromMongo(); }, []);

  const { upcoming, past } = useMemo(() => {
    const now = new Date();
    const filtered = events.filter(event => 
      event.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (event.category && event.category.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (event.location && event.location.toLowerCase().includes(searchQuery.toLowerCase()))
    );

    return filtered.reduce((acc, event) => {
      const eventDateTime = new Date(`${event.date} ${event.time}`);
      if (isNaN(eventDateTime.getTime()) || eventDateTime >= now) {
        acc.upcoming.push(event);
      } else {
        acc.past.push(event);
      }
      return acc;
    }, { upcoming: [] as TribeEvent[], past: [] as TribeEvent[] });
  }, [events, searchQuery]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const file = e.target.files?.[0];
      if (!file) return;
      setUploading(true);
      const fileName = `poster-${Date.now()}`;
      const { error: uploadError } = await supabase.storage.from('events').upload(`posters/${fileName}`, file);
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from('events').getPublicUrl(`posters/${fileName}`);
      setForm({ ...form, image: data.publicUrl });
      showAlert("Visual Asset Linked", "success");
    } catch (error: any) {
      showAlert('Upload Protocol Failed', "error");
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.date || !form.time) {
      showAlert("Temporal parameters required", "error");
      return;
    }

    setSaving(true);
    const sanitizedForm = {
      ...form,
      title: form.title.trim().toUpperCase(),
      location: form.location.trim().toUpperCase(),
      category: form.category.trim().toUpperCase(),
    };

    try {
      const payload = isEditingId ? { ...sanitizedForm, _id: isEditingId } : sanitizedForm;
      const res = await fetch('/api/events/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        await logAdminActivity(sanitizedForm.title, isEditingId ? "EVENT_UPDATE" : "EVENT_PUBLISH");
        showAlert(isEditingId ? "Event Logic Updated" : "New Event Published", "success");
        resetForm();
        fetchFromMongo();
      }
    } catch (error) {
      showAlert("Data Injection Failed", "error");
    } finally {
      setSaving(false);
    }
  };

  const toggleFeatured = async (event: TribeEvent) => {
    if (event.featured) {
      executeToggle(event);
      return;
    }
    const now = new Date();
    const eventDateTime = new Date(`${event.date} ${event.time}`);
    const isUpcoming = isNaN(eventDateTime.getTime()) || eventDateTime >= now;

    if (isUpcoming) {
      if (upcoming.filter(e => e.featured).length >= 2) {
        showAlert("LIMIT REACHED: Max 2 Featured Upcoming events allowed.", "error");
        return;
      }
    } else {
      if (past.filter(e => e.featured).length >= 3) {
        showAlert("LIMIT REACHED: Max 3 Featured Past events allowed.", "error");
        return;
      }
    }
    executeToggle(event);
  };

  const executeToggle = async (event: TribeEvent) => {
    try {
      const res = await fetch('/api/events/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...event, featured: !event.featured })
      });
      if (res.ok) {
        showAlert(event.featured ? "Unpinned from Home" : "Pinned to Home", "success");
        fetchFromMongo();
      }
    } catch (error) {
      showAlert("Status Toggle Failed", "error");
    }
  };

  const startEdit = (event: TribeEvent) => {
    setIsEditingId(event._id);
    const { _id, ...cleanData } = event;
    // @ts-ignore
    setForm(cleanData);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const resetForm = () => {
    setForm({ 
      title: '', date: '', time: '', location: '', mapUrl: '', 
      ticketUrl: '', category: 'CULTURAL', image: '', featured: false, description: '',categoryLogo: ''
    });
    setIsEditingId(null);
  };

  const handleDateSelect = (date: string) => {
    const formatted = new Date(date).toLocaleDateString('en-US', { 
      month: 'short', day: 'numeric', year: 'numeric'
    }).toUpperCase();
    setForm({ ...form, date: formatted });
    setShowCalendar(false);
  };

  const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (!raw) return;
    const [h, m] = raw.split(':');
    const hours = parseInt(h);
    const suffix = hours >= 12 ? 'PM' : 'AM';
    const displayTime = `${hours % 12 || 12}:${m} ${suffix}`;
    setForm({ ...form, time: displayTime });
  };

  if (loading) return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <Loader2 className="animate-spin text-brandRed" size={40} />
    </div>
  );

  return (
    <div className="min-h-screen bg-black pt-48 pb-20 px-6 lg:px-16 text-white selection:bg-brandRed/30">
      <TribeConfirm 
        isOpen={confirmOpen}
        title="Purge Command"
        message={`Warning: You are about to permanently delete "${eventToDelete?.title}". This cannot be undone.`}
        onConfirm={async () => {
            const res = await fetch(`/api/events/delete?id=${eventToDelete?.id}`, { method: 'DELETE' });
            if(res.ok) { fetchFromMongo(); setConfirmOpen(false); showAlert("Object removed", "success"); }
        }}
        onCancel={() => setConfirmOpen(false)}
      />

      <div className="max-w-[1600px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12">
        <div className="lg:col-span-4">
          <div className="bg-zinc-950 p-8 rounded-[40px] border border-white/5 sticky top-32 shadow-2xl">
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-3xl font-black uppercase italic tracking-tighter">
                {isEditingId ? 'Edit' : 'New'} <span className="text-brandRed">Event .</span>
              </h2>
              {isEditingId && (
                <button onClick={resetForm} className="p-2 hover:bg-white/5 rounded-full transition-colors text-zinc-500 hover:text-white">
                  <RefreshCcw size={18} />
                </button>
              )}
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-1 text-[10px]">
                <label className="font-black uppercase tracking-[0.3em] text-zinc-600 ml-2">Designation</label>
                <input required className="w-full bg-black border border-white/10 p-5 rounded-2xl font-bold focus:border-brandRed outline-none uppercase tracking-widest text-white" value={form.title} onChange={e => setForm({...form, title: e.target.value})} />
              </div>

              <div className="space-y-4">
                <div className="space-y-1 text-[10px]">
                  <label className="font-black uppercase tracking-[0.3em] text-zinc-600 ml-2">Venue / Location</label>
                  <div className="relative">
                    <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-700" size={14} />
                    <input required className="w-full bg-black border border-white/10 p-5 pl-12 rounded-2xl font-bold focus:border-brandRed outline-none uppercase tracking-widest" value={form.location} onChange={e => setForm({...form, location: e.target.value})} />
                  </div>
                </div>
                <div className="space-y-1 text-[10px]">
                  <label className="font-black uppercase tracking-[0.3em] text-zinc-600 ml-2">Google Maps URL</label>
                  <div className="relative">
                    <LinkIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-700" size={14} />
                    <input className="w-full bg-black border border-white/10 p-5 pl-12 rounded-2xl font-bold focus:border-brandRed outline-none text-blue-400" value={form.mapUrl} onChange={e => setForm({...form, mapUrl: e.target.value})} />
                  </div>
                </div>
              </div>
              {/* 🔥 ENHANCED: CATEGORY & LOGO SECTION */}
<div className="grid grid-cols-1 gap-6">
  <div className="space-y-1 text-[10px]">
    <label className="font-black uppercase tracking-[0.3em] text-zinc-600 ml-2">Category</label>
    <input 
      list="event-cats" 
      className="w-full bg-black border border-white/10 p-5 rounded-2xl font-bold focus:border-brandRed outline-none uppercase tracking-widest" 
      value={form.category} 
      onChange={e => setForm({...form, category: e.target.value})} 
    />
    <datalist id="event-cats">
      <option value="CULTURAL" /><option value="JAMMING" /><option value="SPORTS" />
      <option value="WORKSHOP" /><option value="FESTIVAL" /><option value="MEETUP" />
    </datalist>
  </div>

  <div className="space-y-1 text-[10px]">
    <label className="font-black uppercase tracking-[0.3em] text-zinc-600 ml-2">Category Logo (Circle Icon)</label>
    <div className="flex gap-4">
      {/* 🔥 Increased size to w-20 h-20 for better Admin visibility */}
      <div className="w-20 h-20 bg-zinc-900 border border-white/10 rounded-full overflow-hidden shrink-0 flex items-center justify-center p-0 shadow-inner group relative">
        {form.categoryLogo ? (
          <img 
            src={form.categoryLogo} 
            className="w-full h-full object-cover" 
            alt="Logo Preview" 
          />
        ) : (
          <Zap className="text-zinc-800" size={24} />
        )}
        
        {/* Simple "Remove" overlay if a logo exists */}
        {form.categoryLogo && (
          <button 
            type="button"
            onClick={() => setForm({...form, categoryLogo: ''})}
            className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-brandRed"
          >
            <X size={20} />
          </button>
        )}
      </div>

      <label className="flex-1 flex items-center justify-center gap-3 bg-black border border-white/5 rounded-2xl cursor-pointer hover:border-brandRed transition-all group">
        {logoUploading ? (
          <Loader2 className="animate-spin text-brandRed" size={18} />
        ) : (
          <Camera size={18} className="text-zinc-500 group-hover:text-brandRed transition-colors" />
        )}
        <div className="flex flex-col">
          <span className="text-[10px] font-black uppercase tracking-widest">Select Icon</span>
          <span className="text-[8px] text-zinc-600 font-bold uppercase tracking-tight">Square PNG recommended</span>
        </div>
        <input type="file" className="hidden" onChange={handleLogoUpload} accept="image/*" />
      </label>
    </div>
  </div>
</div>

              <div className="space-y-1 text-[10px]">
                <label className="font-black uppercase tracking-[0.3em] text-zinc-600 ml-2">Ticket / Booking URL</label>
                <div className="relative">
                  <Ticket className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-700" size={14} />
                  <input 
                    placeholder="https://booking-link.com"
                    className="w-full bg-black border border-white/10 p-5 pl-12 rounded-2xl font-bold focus:border-brandRed outline-none text-brandRed italic" 
                    value={form.ticketUrl||''} 
                    onChange={e => setForm({...form, ticketUrl: e.target.value})} 
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-600 ml-2">Calendar</label>
                  <div className="relative" ref={dateContainerRef}>
                    <div 
                      className="bg-zinc-900 border border-white/5 rounded-2xl h-16 flex items-center px-4 cursor-pointer hover:border-brandRed/50 transition-all relative z-0" 
                      onClick={() => setShowCalendar(!showCalendar)}
                    >
                      <Calendar size={16} className="text-brandRed" />
                      <span className="ml-3 text-[11px] font-black uppercase tracking-widest truncate">{form.date || "SET DATE"}</span>
                    </div>

                    <AnimatePresence>
                      {showCalendar && (
                        <>
                          <div className="fixed inset-0 z-[90]" onClick={() => setShowCalendar(false)} />
                          <TribeCalendar 
  value={form.date} 
  onChange={handleDateSelect} 
  onClose={() => setShowCalendar(false)}
  anchorRef={dateContainerRef} // ✅ CORRECT PROP NAME
/>
                        </>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                <div className="space-y-1">
  <label className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-600 ml-2">Clock</label>
  <div className="relative" ref={timeContainerRef}>
    <div 
      className="bg-zinc-900 border border-white/5 rounded-2xl h-16 flex items-center px-4 cursor-pointer hover:border-brandRed/50 transition-all relative z-0" 
      onClick={() => setShowTimePicker(!showTimePicker)}
    >
      <Clock size={16} className="text-brandRed" />
      <span className="ml-3 text-[11px] font-black uppercase tracking-widest truncate">{form.time || "SET TIME"}</span>
    </div>

    <AnimatePresence>
      {showTimePicker && (
        <>
          <div className="fixed inset-0 z-[90]" onClick={() => setShowTimePicker(false)} />
          <TribeTimePicker 
            value={form.time} 
            onChange={(time) => setForm({...form, time})} 
            onClose={() => setShowTimePicker(false)}
            anchorRef={timeContainerRef}
          />
        </>
      )}
    </AnimatePresence>
  </div>
</div>
              </div>

              <div className="space-y-1 text-[10px]">
                <label className="font-black uppercase tracking-[0.3em] text-zinc-600 ml-2">Category</label>
                <input list="event-cats" className="w-full bg-black border border-white/10 p-5 rounded-2xl font-bold focus:border-brandRed outline-none uppercase tracking-widest" value={form.category} onChange={e => setForm({...form, category: e.target.value})} />
                <datalist id="event-cats">
                  <option value="CULTURAL" /><option value="JAMMING" /><option value="SPORTS" />
                  <option value="WORKSHOP" /><option value="FESTIVAL" /><option value="MEETUP" />
                </datalist>
              </div>

              <div className="space-y-1 text-[10px]">
                <label className="font-black uppercase tracking-[0.3em] text-zinc-600 ml-2">Narrative / Description</label>
                <textarea 
                  required 
                  rows={4}
                  className="w-full bg-black border border-white/10 p-5 rounded-2xl font-bold focus:border-brandRed outline-none uppercase tracking-widest text-white text-[11px] leading-relaxed resize-none" 
                  value={form.description} 
                  onChange={e => setForm({...form, description: e.target.value})} 
                />
              </div>

              <div className="space-y-1 text-[10px]">
                <label className="font-black uppercase tracking-[0.3em] text-zinc-600 ml-2">Poster Media</label>
                <div className="flex gap-4">
                  <div className="w-20 h-20 bg-black border border-white/10 rounded-2xl overflow-hidden shrink-0">
                    {form.image ? <img src={form.image} className="w-full h-full object-cover" /> : <Camera className="m-auto mt-6 text-zinc-800" />}
                  </div>
                  <label className="flex-1 flex items-center justify-center gap-3 bg-zinc-900 border border-white/5 rounded-2xl cursor-pointer hover:bg-brandRed transition-all">
                    {uploading ? <Loader2 className="animate-spin text-white" /> : <Plus size={16} className="text-brandRed" />}
                    <span className="text-[10px] font-black uppercase tracking-widest">Link Asset</span>
                    <input type="file" className="hidden" onChange={handleImageUpload} />
                  </label>
                </div>
              </div>

              <label className="flex items-center gap-4 p-5 bg-white/5 rounded-2xl cursor-pointer border border-white/5 hover:border-brandRed/20 transition-all">
                <input type="checkbox" className="accent-brandRed w-5 h-5" checked={form.featured} onChange={e => setForm({...form, featured: e.target.checked})} />
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">Featured Placement</span>
              </label>

              <button type="submit" disabled={saving || uploading} className="w-full py-5 bg-brandRed text-white font-black uppercase tracking-widest rounded-2xl hover:bg-white hover:text-black transition-all shadow-xl active:scale-95 text-xs">
                {saving ? <Loader2 className="animate-spin mx-auto" /> : isEditingId ? 'Commit Changes' : 'Publish Node'}
              </button>
            </form>
          </div>
        </div>

        <div className="lg:col-span-8 space-y-16">
          <div className="flex justify-between items-end border-b border-white/5 pb-8">
            <h2 className="text-5xl font-black uppercase italic tracking-tighter leading-none">Live <span className="text-brandRed">Terminal .</span></h2>
            <div className="relative group w-64">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-700 group-focus-within:text-brandRed" size={14} />
              <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="SEARCH NODES..." className="w-full bg-zinc-950 border border-white/5 p-3 pl-11 rounded-full text-[10px] font-bold uppercase tracking-widest focus:border-brandRed outline-none" />
            </div>
          </div>

          <section className="space-y-8">
            <h3 className="text-[10px] font-black uppercase tracking-[0.5em] text-zinc-600 flex items-center gap-4">
              Upcoming Events 
              <span className={`px-3 py-1 rounded-full border text-[9px] ${upcoming.filter(e => e.featured).length >= 2 ? 'border-brandRed text-brandRed animate-pulse' : 'border-zinc-800 text-zinc-500'}`}>
                Featured: {upcoming.filter(e => e.featured).length} / 2
              </span>
              <div className="h-px flex-1 bg-zinc-900" />
            </h3>

            {upcoming.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                {upcoming.map(event => (
                  <div key={event._id} className="relative group">
                    <div className="absolute top-4 right-4 z-40 flex gap-2 opacity-0 group-hover:opacity-100 transition-all scale-90 group-hover:scale-100">
                      <button onClick={() => toggleFeatured(event)} className={`p-4 rounded-2xl backdrop-blur-md border border-white/10 transition-all ${event.featured ? 'bg-brandRed text-white shadow-lg' : 'bg-black/80 hover:bg-brandRed text-white'}`}>
                        <Star size={16} fill={event.featured ? "currentColor" : "none"} />
                      </button>
                      <button onClick={() => startEdit(event)} className="p-4 bg-black/80 backdrop-blur-md hover:bg-blue-600 rounded-2xl transition-all border border-white/10 text-white"><Edit3 size={16}/></button>
                      <button onClick={() => {setEventToDelete({id: event._id, title: event.title}); setConfirmOpen(true);}} className="p-4 bg-black/80 backdrop-blur-md hover:bg-red-600 rounded-2xl transition-all border border-white/10 text-white"><Trash2 size={16}/></button>
                    </div>
                    <EventCard {...event} isUpcoming={true} />
                  </div>
                ))}
              </div>
            ) : <p className="text-[10px] font-black text-zinc-800 uppercase italic">No Active Events</p>}
          </section>

          <section className="space-y-8 pt-10">
            <h3 className="text-[10px] font-black uppercase tracking-[0.5em] text-zinc-600 flex items-center gap-4">
              Past Archive 
              <span className={`px-3 py-1 rounded-full border text-[9px] ${past.filter(e => e.featured).length >= 3 ? 'border-brandRed text-brandRed animate-pulse' : 'border-zinc-800 text-zinc-500'}`}>
                Featured: {past.filter(e => e.featured).length} / 3
              </span>
              <div className="h-px flex-1 bg-zinc-900" />
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-10 opacity-60 grayscale hover:grayscale-0 hover:opacity-100 transition-all duration-500">
              {past.map(event => (
                <div key={event._id} className="relative group">
                  <div className="absolute top-4 right-4 z-40 flex gap-2 opacity-0 group-hover:opacity-100 transition-all scale-90 group-hover:scale-100">
                    <button 
                      onClick={() => toggleFeatured(event)} 
                      className={`p-4 rounded-2xl backdrop-blur-md border border-white/10 transition-all ${event.featured ? 'bg-brandRed text-white shadow-lg' : 'bg-black/80 hover:bg-brandRed text-white'}`}
                    >
                      <Star size={16} fill={event.featured ? "currentColor" : "none"} />
                    </button>
                    <button onClick={() => startEdit(event)} className="p-4 bg-black/80 backdrop-blur-md hover:bg-blue-600 rounded-2xl transition-all border border-white/10 text-white"><Edit3 size={16}/></button>
                    <button onClick={() => {setEventToDelete({id: event._id, title: event.title}); setConfirmOpen(true);}} className="p-4 bg-black/80 backdrop-blur-md hover:bg-red-600 rounded-2xl transition-all border border-white/10 text-white"><Trash2 size={16}/></button>
                  </div>
                  <EventCard {...event} isUpcoming={false} />
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}