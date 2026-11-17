"use client";

// Bundle offers: several seats of one ticket type, sold together at a bundle price.
//
// Not a ticket type of its own. The seats come out of the category's existing capacity and go
// out as ordinary passes of that category, so this screen is deliberately about the OFFER —
// which type, how many seats, what it costs — and never about stock. There is no capacity
// field here because a bundle does not have one.

import { useCallback, useEffect, useState } from 'react';
import { Boxes, Check, Loader2, Package, Pause, Pencil, Play, Plus, Trash2, X } from 'lucide-react';
import { useAlert } from '@/context/AlertContext';
import TribeConfirm from '@/components/TribeConfirm';
import { formatAmount } from '@/lib/payments/format';
import { seatsLeft } from '@/lib/payments/seats';
import { MAX_BUNDLE_SIZE, MIN_BUNDLE_SIZE, bundleSaving, perSeatPrice } from '@/lib/payments/bundles';
import { bundleAvailability } from '@/lib/payments/pricing';
import { publiclyListed } from '@/lib/payments/comp';

interface Bundle {
  id: string;
  category_id: string;
  name: string;
  size: number;
  price: number;
  max_bundles: number | null;
  sold: number;
  active: boolean;
  /** Of `sold`, how many were actually paid for and how many are only held by a live checkout. */
  paid?: number | null;
  held?: number | null;
}

interface Props {
  eventId: string;
  categories: any[];
  /** Reload the dashboard, so the category stock above catches up. */
  onChanged: () => void;
}

const blank = { categoryId: '', name: '', size: 5, price: '', maxBundles: '' };

export default function BundleManager({ eventId, categories, onChanged }: Props) {
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [ready, setReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [form, setForm] = useState<typeof blank>(blank);
  /** The group being edited, or null when the form is creating a new one. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const { showAlert } = useAlert();

  // Only types a buyer can actually reach. Bundling the comp-only ACCESS PASS would make an
  // offer nobody could ever buy.
  const sellable = (categories || []).filter((c) => publiclyListed(c) && c.active !== false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/bundles?eventId=${eventId}`);
      const data = await res.json().catch(() => ({}));
      setBundles(data.bundles || []);
      setReady(data.ready !== false);
    } catch {
      setBundles([]);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  // A fresh form each time it CLOSES: leaving the last group's numbers in the boxes is how two
  // offers end up with one price by accident. Editing fills the form and opens it in one go,
  // so only the closing half resets.
  useEffect(() => { if (!open) { setForm(blank); setEditingId(null); } }, [open]);

  /** Load an existing group into the form. */
  const startEdit = (b: Bundle) => {
    setForm({
      categoryId: String(b.category_id),
      name: b.name,
      size: b.size,
      price: String(b.price),
      maxBundles: b.max_bundles == null ? '' : String(b.max_bundles),
    });
    setEditingId(b.id);
    setOpen(true);
  };

  const chosen = sellable.find((c) => String(c.id) === form.categoryId);
  const size = Math.max(0, Math.floor(Number(form.size) || 0));
  const price = Number(form.price) || 0;
  const separately = chosen ? Number(chosen.price) * size : 0;
  const saving$ = chosen && price > 0 ? bundleSaving(price, size, Number(chosen.price)) : 0;
  const roomFor = chosen && chosen.capacity != null && size > 0 ? Math.floor(seatsLeft(chosen)! / size) : null;

  const create = async () => {
    setSaving(true);
    try {
      // The same form does both. PATCH carries the id; POST carries the event.
      const res = await fetch('/api/admin/bundles', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingId ? { id: editingId, ...form } : { eventId, ...form }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showAlert(data.error || `Could not ${editingId ? 'save' : 'create'} that group.`, 'error');
        return;
      }
      const saved = data.bundle?.name || form.name;
      showAlert(editingId ? `"${saved}" updated.` : `"${saved}" is live.`, 'success');
      setOpen(false);
      await load();
      onChanged();
    } catch {
      showAlert('Network error. Nothing was created.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (b: Bundle) => {
    setBusyId(b.id);
    try {
      const res = await fetch('/api/admin/bundles', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: b.id, active: !b.active }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { showAlert(data.error || 'Could not change that.', 'error'); return; }
      showAlert(b.active ? `"${b.name}" paused.` : `"${b.name}" is live again.`, 'success');
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const remove = async () => {
    if (!deleteId) return;
    setBusyId(deleteId);
    setConfirmOpen(false);
    try {
      const res = await fetch('/api/admin/bundles', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: deleteId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { showAlert(data.error || 'Could not delete that group.', 'error'); return; }
      showAlert('Group removed.', 'info');
      await load();
      onChanged();
    } finally {
      setBusyId(null);
      setDeleteId(null);
    }
  };

  const input = 'w-full bg-zinc-950 border border-white/10 p-3.5 rounded-xl text-xs font-bold outline-none focus:border-brandRed text-white';
  const lab = 'text-[9px] font-black uppercase tracking-widest text-zinc-600 ml-1';
  // A brand-new group that cannot be filled today would be born auto-paused, which looks like
  // a bug rather than a decision. An EXISTING one is still editable at any seat count: its
  // price or name may well need changing precisely because it has stopped selling.
  const canSave = !!form.categoryId && form.name.trim().length > 1 && size >= MIN_BUNDLE_SIZE && price > 0
    && (editingId !== null || roomFor === null || roomFor > 0);

  if (loading) {
    return <div className="py-10 flex justify-center"><Loader2 className="animate-spin text-brandRed" size={22} /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1.5">
          <h3 className="text-2xl font-black uppercase italic tracking-tighter flex items-center gap-3">
            <Boxes className="text-brandRed" size={24} /> Group Tickets
          </h3>
          <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
            Several seats of one type, bought together — seats come out of that type&apos;s own stock
          </p>
        </div>
        {ready && sellable.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-white bg-brandRed px-4 py-3 rounded-xl hover:bg-white hover:text-black transition-all shadow-lg active:scale-95"
          >
            {open ? <X size={14} /> : <Plus size={14} />} {open ? 'Cancel' : 'New group'}
          </button>
        )}
      </div>

      {!ready && (
        <p className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-[11px] font-bold uppercase tracking-widest text-amber-300 leading-relaxed">
          Bundles need a one-time database update. Run supabase/migrations/20261115_ticket_bundles.sql in Supabase, then reload.
        </p>
      )}

      {open && (
        <div className="rounded-[30px] border border-brandRed/30 bg-brandRed/[0.04] p-6 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              {editingId && (
                <p className="md:col-span-2 text-[10px] font-black uppercase tracking-widest text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 leading-relaxed">
                  Editing an existing group. Seats already sold on it keep the price they were bought at.
                </p>
              )}
              <label className={lab}>Which ticket type</label>
              <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} className={`${input} [color-scheme:dark]`}>
                <option value="">Choose a type…</option>
                {sellable.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} — ₹{formatAmount(Number(c.price))} · {seatsLeft(c) ?? '∞'} left</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className={lab}>Name buyers see</label>
              <input value={form.name} maxLength={40} placeholder="Group of 8" onChange={(e) => setForm({ ...form, name: e.target.value })} className={input} />
            </div>
            <div className="space-y-1.5">
              <label className={lab}>Tickets in the group</label>
              <input type="number" min={MIN_BUNDLE_SIZE} max={MAX_BUNDLE_SIZE} value={form.size}
                onChange={(e) => setForm({ ...form, size: Number(e.target.value) })} className={input} />
            </div>
            <div className="space-y-1.5">
              <label className={lab}>Price for the whole group</label>
              <input type="number" min={0} value={form.price} placeholder="4500"
                onChange={(e) => setForm({ ...form, price: e.target.value })} className={input} />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <label className={lab}>How many of these to sell (blank = as many as the seats allow)</label>
              <input type="number" min={1} value={form.maxBundles} placeholder="Unlimited"
                onChange={(e) => setForm({ ...form, maxBundles: e.target.value })} className={input} />
            </div>
          </div>

          {/* The arithmetic, shown as it is typed. An admin should not have to work out whether
              the bundle is actually cheaper, or whether that many of them fit. */}
          {chosen && size >= MIN_BUNDLE_SIZE && (
            <div className="rounded-2xl border border-white/10 bg-black/50 p-4 space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                {size} × {chosen.name} separately is <span className="text-white">₹{formatAmount(separately)}</span>
              </p>
              {price > 0 && (
                <p className={`text-[10px] font-black uppercase tracking-widest ${saving$ > 0 ? 'text-green-400' : saving$ === 0 ? 'text-zinc-400' : 'text-brandRed'}`}>
                  {saving$ > 0
                    ? `Buyer saves ₹${formatAmount(saving$)} · ₹${formatAmount(perSeatPrice(price, size))} a seat`
                    : saving$ === 0
                      ? 'Same price as buying separately'
                      : `₹${formatAmount(-saving$)} MORE than buying separately — this will be refused`}
                </p>
              )}
              {roomFor !== null && (
                <p className={`text-[10px] font-bold uppercase tracking-widest ${roomFor === 0 ? 'text-brandRed' : 'text-zinc-500'}`}>
                  {roomFor === 0
                    ? `Only ${seatsLeft(chosen)} ${chosen.name} left — a group of ${size} cannot be filled`
                    : `${roomFor} of these fit in what is left of ${chosen.name}`}
                </p>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={create}
            disabled={!canSave || saving}
            className="w-full py-4 bg-brandRed text-white font-black uppercase tracking-widest rounded-2xl hover:bg-white hover:text-black transition-all shadow-xl active:scale-95 text-[10px] flex items-center justify-center gap-2 disabled:opacity-40"
          >
            {saving ? <Loader2 className="animate-spin" size={14} /> : <><Check size={14} /> {editingId ? 'Save changes' : 'Create group'}</>}
          </button>
        </div>
      )}

      {bundles.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {bundles.map((b) => {
            const cat = categories.find((c) => String(c.id) === String(b.category_id));
            // Both limits at once: the offer's own run, and whether the type it draws from can
            // still fill one group. The second is the automatic pause — a Group of 10 on a type
            // with nine seats left is finished whatever its own counter says.
            const avail = bundleAvailability(b, cat);
            const left = avail.units;
            const dim = !b.active || avail.autoPaused;
            return (
              <div key={b.id} className={`rounded-[24px] border p-5 space-y-3 transition-all ${dim ? 'border-white/5 bg-zinc-950/50 opacity-60' : 'border-white/10 bg-zinc-950'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-black uppercase text-sm text-white truncate flex items-center gap-2">
                      <Package size={14} className="text-brandRed shrink-0" /> {b.name}
                    </p>
                    <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 mt-1">
                      {b.size} × {cat?.name || 'unknown type'}
                    </p>
                  </div>
                  <p className="text-xl font-black text-white shrink-0">₹{formatAmount(Number(b.price))}</p>
                </div>

                <div className="flex flex-wrap gap-2 text-[9px] font-black uppercase tracking-widest">
                  <span className="px-2.5 py-1 rounded-lg border border-white/10 text-zinc-400">
                    ₹{formatAmount(perSeatPrice(Number(b.price), b.size))} a seat
                  </span>
                  <span className="px-2.5 py-1 rounded-lg border border-white/10 text-zinc-400">
                    {b.sold || 0} sold{left !== null ? ` · ${left} left` : ''}
                  </span>
                  {/* A checkout in flight holds its unit, and the hold counts against the run —
                      it has to, or two buyers could be sold the same last one. Saying so stops
                      "2 sold" reading as two sales when one is a cart nobody has paid for. */}
                  {(b.held || 0) > 0 && (
                    <span className="px-2.5 py-1 rounded-lg border border-sky-500/40 bg-sky-500/10 text-sky-400">
                      {b.paid || 0} paid · {b.held} held in checkout
                    </span>
                  )}
                  {!b.active && <span className="px-2.5 py-1 rounded-lg border border-amber-500/30 text-amber-400">Paused</span>}
                  {/* Said separately from a hand pause, because they undo differently: this one
                      lifts itself the moment seats come back from a refund, a void or an
                      abandoned cart. Nothing was written to the offer. */}
                  {b.active && avail.autoPaused && (
                    <span className="px-2.5 py-1 rounded-lg border border-orange-500/40 bg-orange-500/10 text-orange-400">
                      Auto-paused · {avail.seatsLeft} {cat?.name || 'seats'} left, needs {b.size}
                    </span>
                  )}
                </div>
                {b.active && avail.autoPaused && (
                  <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 leading-relaxed">
                    Off sale on its own — buyers cannot add it. It returns by itself if {cat?.name || 'those'} seats free up.
                  </p>
                )}

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => toggle(b)}
                    disabled={busyId === b.id}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-white/10 bg-zinc-900 text-[9px] font-black uppercase tracking-widest hover:bg-white hover:text-black transition-all disabled:opacity-40"
                  >
                    {busyId === b.id ? <Loader2 size={12} className="animate-spin" /> : b.active ? <Pause size={12} /> : <Play size={12} />}
                    {b.active ? 'Pause' : 'Resume'}
                  </button>
                  <button
                    type="button"
                    onClick={() => startEdit(b)}
                    disabled={busyId === b.id}
                    title="Edit this group"
                    className="px-3 py-2.5 rounded-xl border border-white/10 bg-zinc-900 text-zinc-400 hover:text-black hover:bg-white transition-all disabled:opacity-40"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => { setDeleteId(b.id); setConfirmOpen(true); }}
                    disabled={busyId === b.id}
                    title={b.sold > 0 ? 'Already sold — pause it instead' : 'Delete this group'}
                    className="px-3 py-2.5 rounded-xl border border-white/10 bg-zinc-900 text-zinc-500 hover:text-white hover:bg-brandRed hover:border-brandRed transition-all disabled:opacity-40"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : ready && (
        <p className="text-zinc-500 text-sm italic py-6 text-center border border-white/5 rounded-[24px] bg-zinc-950">
          {sellable.length === 0
            ? 'Add a ticket type first — a group is made of one.'
            : 'No groups yet. Buyers pick tickets one at a time.'}
        </p>
      )}

      <TribeConfirm
        isOpen={confirmOpen}
        onCancel={() => { setConfirmOpen(false); setDeleteId(null); }}
        onConfirm={remove}
        title="Delete this group?"
        message="Buyers will no longer see it. If any have already sold, pause it instead — deleting would detach the passes already issued."
      />
    </div>
  );
}
