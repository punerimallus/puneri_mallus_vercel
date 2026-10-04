"use client";
import { useState, useEffect } from 'react';
import { Loader2, Plus, Save, Trash2, Ticket, Users } from 'lucide-react';
import { useAlert } from '@/context/AlertContext';
import { createBrowserClient } from '@supabase/ssr';
import { MAX_GROUP_SIZE } from '@/lib/payments/groups';
import { onEnter } from '@/lib/ui/enter';

type Category = {
  id?: string;
  name: string;
  price: number | '';
  prefix: string;
  capacity: number | '';
  active: boolean;
  sold?: number;
  /** 1 or missing = ordinary ticket. 2+ = one QR that admits that many people. '' while the admin is still typing. */
  group_size?: number | '';
};

const isGroupRow = (c: Category) => c.group_size === '' || Number(c.group_size) > 1;

export default function TicketConfig({ eventId, eventTitle }: { eventId: string, eventTitle: string }) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { showAlert } = useAlert();

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    async function fetchCats() {
      const { data } = await supabase.from('event_ticket_categories').select('*').eq('event_id', eventId).order('price', { ascending: true });
      if (data) setCategories(data as Category[]);
      setLoading(false);
    }
    fetchCats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const addCategory = () => setCategories([...categories, { name: '', price: '', prefix: '', capacity: 100, active: true }]);
  // A group block starts with the people count empty: the admin decides it (5, 6, 7... any number).
  const addGroup = () => setCategories([...categories, { name: '', price: '', prefix: '', capacity: 20, active: true, group_size: '' }]);

  const updateCategory = (index: number, patch: Partial<Category>) =>
    setCategories(categories.map((c, i) => (i === index ? { ...c, ...patch } : c)));

  const removeCategory = (index: number) => {
    const cat = categories[index];
    if (cat.id && (cat.sold || 0) > 0) {
      showAlert(`"${cat.name}" has ${cat.sold} sold. It will be taken off sale (not deleted) when you save, so existing tickets stay valid.`, 'info');
    }
    setCategories(categories.filter((_, i) => i !== index));
  };

  const saveConfig = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/tickets/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, categories })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { showAlert(data.error || 'Could not save ticket categories.', 'error'); return; }
      const extra = data.takenOffSale?.length ? ` ${data.takenOffSale.join(', ')} taken off sale (already sold).` : '';
      showAlert(`Ticket categories saved.${extra}`, 'success');
      // Reload so new rows get their ids and sold counts.
      const { data: fresh } = await supabase.from('event_ticket_categories').select('*').eq('event_id', eventId).order('price', { ascending: true });
      if (fresh) setCategories(fresh as Category[]);
    } catch {
      showAlert('Network error. Please try again.', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loader2 className="animate-spin text-brandRed mx-auto my-10" />;

  const input = 'w-full bg-zinc-950 border border-white/10 p-3 rounded-xl text-xs font-bold outline-none focus:border-brandRed';
  const lab = 'text-[9px] font-black uppercase tracking-widest text-zinc-600 ml-2';

  return (
    <div className="space-y-8">
      <div className="space-y-2 border-b border-white/5 pb-6">
        <h3 className="text-3xl font-black uppercase italic tracking-tighter text-white flex items-center gap-3">
          <Ticket className="text-brandRed" size={28} /> Configure Tickets
        </h3>
        <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Event: {eventTitle}</p>
      </div>

      <div className="space-y-4">
        {categories.map((cat, idx) => {
          const group = isGroupRow(cat);
          return (
            <div key={cat.id || idx} className={`p-5 border rounded-2xl bg-black/50 space-y-4 ${group ? 'border-brandRed/30' : 'border-white/5'} ${cat.active ? '' : 'opacity-60'}`} onKeyDown={onEnter(saveConfig, !saving)}>
              {group && (
                <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-brandRed">
                  <Users size={14} /> Group ticket: one QR code admits the whole group, and they can enter together or in parts
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
                <div className={`${group ? 'md:col-span-3' : 'md:col-span-4'} space-y-1`}>
                  <label className={lab}>Category Name</label>
                  <input placeholder={group ? 'e.g. FRIENDS GROUP' : 'e.g. VIP FULL COVER'} value={cat.name} onChange={(e) => updateCategory(idx, { name: e.target.value.toUpperCase() })} className={`${input} uppercase tracking-widest text-white`} />
                </div>
                {group && (
                  <div className="md:col-span-2 space-y-1">
                    <label className={lab}>People in group</label>
                    <input type="number" min={2} max={MAX_GROUP_SIZE} placeholder="How many?" value={cat.group_size ?? ''} onChange={(e) => updateCategory(idx, { group_size: e.target.value === '' ? '' : Number(e.target.value) })} className={`${input} text-white`} />
                  </div>
                )}
                <div className="md:col-span-2 space-y-1">
                  <label className={lab}>{group ? 'Price per group (₹)' : 'Price (₹)'}</label>
                  <input type="number" min={0} placeholder="0" value={cat.price} onChange={(e) => updateCategory(idx, { price: e.target.value === '' ? '' : Number(e.target.value) })} className={`${input} text-brandRed`} />
                </div>
                <div className="md:col-span-2 space-y-1">
                  <label className={lab}>Ticket Prefix</label>
                  <input placeholder={group ? 'e.g. GRP-' : 'e.g. VIP-'} value={cat.prefix} onChange={(e) => updateCategory(idx, { prefix: e.target.value.toUpperCase() })} className={`${input} text-white uppercase`} />
                </div>
                <div className="md:col-span-2 space-y-1">
                  <label className={lab}>{group ? 'Groups available' : 'Capacity'}</label>
                  <input type="number" min={1} placeholder="100" value={cat.capacity} onChange={(e) => updateCategory(idx, { capacity: e.target.value === '' ? '' : Number(e.target.value) })} className={`${input} text-white`} />
                </div>
                <div className="md:col-span-1 flex justify-end">
                  <button type="button" onClick={() => removeCategory(idx)} aria-label="Remove category" className="w-10 h-10 bg-white/5 hover:bg-brandRed rounded-xl flex items-center justify-center text-zinc-400 hover:text-white transition-all">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-4 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" className="accent-brandRed w-4 h-4" checked={cat.active} onChange={(e) => updateCategory(idx, { active: e.target.checked })} /> On sale
                </label>
                {cat.id && <span>{cat.sold || 0} sold</span>}
                {group && Number(cat.group_size) > 1 && Number(cat.capacity) > 0 && <span>Up to {Number(cat.group_size) * Number(cat.capacity)} people</span>}
                {group && Number(cat.group_size) > 1 && Number(cat.price) > 0 && <span>₹{(Number(cat.price) / Number(cat.group_size)).toFixed(2)} per person</span>}
              </div>
            </div>
          );
        })}
        {categories.length === 0 && <p className="text-zinc-500 text-sm text-center py-6">No tickets yet. Add a category to start selling.</p>}
      </div>

      <div className="flex flex-col sm:flex-row gap-4 pt-4 border-t border-white/5">
        <button type="button" onClick={addCategory} className="flex-1 py-4 border border-dashed border-white/20 rounded-2xl flex items-center justify-center gap-2 text-zinc-400 hover:text-white hover:border-brandRed hover:bg-brandRed/10 transition-all font-black text-xs uppercase tracking-widest">
          <Plus size={16} /> Add Category
        </button>
        <button type="button" onClick={addGroup} className="flex-1 py-4 border border-dashed border-white/20 rounded-2xl flex items-center justify-center gap-2 text-zinc-400 hover:text-white hover:border-brandRed hover:bg-brandRed/10 transition-all font-black text-xs uppercase tracking-widest">
          <Users size={16} /> Add Group Ticket
        </button>
        {categories.length > 0 && (
          <button type="button" onClick={saveConfig} disabled={saving} className="flex-1 py-4 bg-brandRed text-white font-black uppercase tracking-widest rounded-2xl hover:bg-white hover:text-black transition-all shadow-xl active:scale-95 text-xs flex items-center justify-center gap-2 disabled:opacity-60">
            {saving ? <Loader2 className="animate-spin" size={16} /> : <><Save size={16} /> Save Tickets</>}
          </button>
        )}
      </div>
    </div>
  );
}
