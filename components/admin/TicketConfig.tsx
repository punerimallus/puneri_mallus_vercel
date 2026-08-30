"use client";
import { useState, useEffect } from 'react';
import { Loader2, Plus, Save, Trash2, Ticket } from 'lucide-react';
import { useAlert } from '@/context/AlertContext';
import { createBrowserClient } from '@supabase/ssr';

export default function TicketConfig({ eventId, eventTitle }: { eventId: string, eventTitle: string }) {
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { showAlert } = useAlert();

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // Load existing categories
  useEffect(() => {
    async function fetchCats() {
      const { data } = await supabase.from('event_ticket_categories').select('*').eq('event_id', eventId);
      if (data) setCategories(data);
      setLoading(false);
    }
    fetchCats();
  }, [eventId]);

  const addCategory = () => {
    setCategories([...categories, { name: '', price: 0, prefix: '', capacity: 100, active: true }]);
  };

  const updateCategory = (index: number, field: string, value: any) => {
    const updated = [...categories];
    updated[index][field] = value;
    setCategories(updated);
  };

  const saveConfig = async () => {
    setSaving(true);
    try {
      // Upsert via an API route to bypass RLS, or directly if admin RLS is setup
      const res = await fetch('/api/admin/tickets/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, categories })
      });
      if (res.ok) showAlert("Ticket categories synchronized!", "success");
      else throw new Error("Failed to save");
    } catch (err) {
      showAlert("Injection Failed", "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loader2 className="animate-spin text-brandRed mx-auto my-10" />;

  return (
    <div className="space-y-8">
      <div className="space-y-2 border-b border-white/5 pb-6">
        <h3 className="text-3xl font-black uppercase italic tracking-tighter text-white flex items-center gap-3">
          <Ticket className="text-brandRed" size={28} /> Configure Tickets
        </h3>
        <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Event: {eventTitle}</p>
      </div>

      <div className="space-y-4">
        {categories.map((cat, idx) => (
          <div key={idx} className="grid grid-cols-1 md:grid-cols-12 gap-4 p-5 border border-white/5 rounded-2xl bg-black/50 items-center">
            <div className="md:col-span-4 space-y-1">
              <label className="text-[9px] font-black uppercase tracking-widest text-zinc-600 ml-2">Category Name</label>
              <input placeholder="e.g. VIP FULL COVER" value={cat.name} onChange={(e) => updateCategory(idx, 'name', e.target.value.toUpperCase())} className="w-full bg-zinc-950 border border-white/10 p-3 rounded-xl text-xs font-bold uppercase tracking-widest text-white outline-none focus:border-brandRed" />
            </div>
            <div className="md:col-span-2 space-y-1">
              <label className="text-[9px] font-black uppercase tracking-widest text-zinc-600 ml-2">Price (₹)</label>
              <input type="number" placeholder="0" value={cat.price} onChange={(e) => updateCategory(idx, 'price', Number(e.target.value))} className="w-full bg-zinc-950 border border-white/10 p-3 rounded-xl text-xs font-bold text-brandRed outline-none focus:border-brandRed" />
            </div>
            <div className="md:col-span-3 space-y-1">
              <label className="text-[9px] font-black uppercase tracking-widest text-zinc-600 ml-2">Ticket Prefix</label>
              <input placeholder="e.g. VIP-" value={cat.prefix} onChange={(e) => updateCategory(idx, 'prefix', e.target.value.toUpperCase())} className="w-full bg-zinc-950 border border-white/10 p-3 rounded-xl text-xs font-bold text-white uppercase outline-none focus:border-brandRed" />
            </div>
            <div className="md:col-span-2 space-y-1">
              <label className="text-[9px] font-black uppercase tracking-widest text-zinc-600 ml-2">Capacity</label>
              <input type="number" placeholder="100" value={cat.capacity} onChange={(e) => updateCategory(idx, 'capacity', Number(e.target.value))} className="w-full bg-zinc-950 border border-white/10 p-3 rounded-xl text-xs font-bold text-white outline-none focus:border-brandRed" />
            </div>
            <div className="md:col-span-1 flex justify-end mt-4 md:mt-0">
              <button onClick={() => setCategories(categories.filter((_, i) => i !== idx))} className="w-10 h-10 bg-white/5 hover:bg-brandRed rounded-xl flex items-center justify-center text-zinc-400 hover:text-white transition-all">
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-4 pt-4 border-t border-white/5">
        <button onClick={addCategory} className="flex-1 py-4 border border-dashed border-white/20 rounded-2xl flex items-center justify-center gap-2 text-zinc-400 hover:text-white hover:border-brandRed hover:bg-brandRed/10 transition-all font-black text-xs uppercase tracking-widest">
          <Plus size={16} /> Add Category
        </button>
        {categories.length > 0 && (
          <button onClick={saveConfig} disabled={saving} className="flex-1 py-4 bg-brandRed text-white font-black uppercase tracking-widest rounded-2xl hover:bg-white hover:text-black transition-all shadow-xl active:scale-95 text-xs flex items-center justify-center gap-2">
            {saving ? <Loader2 className="animate-spin" size={16} /> : <><Save size={16} /> Commit Configuration</>}
          </button>
        )}
      </div>
    </div>
  );
}