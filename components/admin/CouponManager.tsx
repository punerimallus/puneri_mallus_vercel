"use client";

// Coupons: a code a buyer types at checkout for money off, free passes, or both.
//
// The usage cap is not enforced on this screen and cannot be. It is checked and incremented
// under a row lock at checkout, because a cap policed here would be handed out to everyone who
// loaded the page before anyone bought. What this screen does is create the code, switch it
// off, and show what it has actually given away.

import { useCallback, useEffect, useState } from 'react';
import { BadgePercent, Check, Gift, Loader2, Pencil, Plus, Power, Ticket, Trash2, X } from 'lucide-react';
import { useAlert } from '@/context/AlertContext';
import TribeConfirm from '@/components/TribeConfirm';
import { formatAmount } from '@/lib/payments/format';
import { MAX_CODE_LENGTH, MAX_FREE_QTY, couponAvailability, normalizeCode } from '@/lib/payments/coupons';
import { seatsLeft } from '@/lib/payments/seats';
import { publiclyListed } from '@/lib/payments/comp';

interface Coupon {
  id: string;
  code: string;
  event_id: string | null;
  kind: 'DISCOUNT' | 'FREE_TICKET' | 'BOTH';
  scope: 'INDIVIDUAL' | 'BUNDLE';
  discount_type: 'PERCENT' | 'FLAT' | null;
  discount_value: number | null;
  free_category_id: string | null;
  free_qty: number | null;
  max_uses: number | null;
  uses: number;
  per_account_uses: number;
  active: boolean;
  expires_at: string | null;
  note: string | null;
}

interface Redemption {
  id: string;
  coupon_id: string;
  email: string | null;
  booking_id: string | null;
  discount_amount: number;
  free_numbers: string[];
  created_at: string;
  confirmed_at: string | null;
}

interface Props {
  eventId: string;
  categories: any[];
}

const blank = {
  code: '', kind: 'DISCOUNT', scope: 'INDIVIDUAL',
  discountType: 'PERCENT', discountValue: '',
  freeCategoryId: '', freeQty: 1,
  maxUses: '', perAccountUses: 1, expiresAt: '', note: '',
};

export default function CouponManager({ eventId, categories }: Props) {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [redemptions, setRedemptions] = useState<Redemption[]>([]);
  const [ready, setReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showUses, setShowUses] = useState<string | null>(null);
  const [form, setForm] = useState<typeof blank>(blank);
  /** The coupon being edited, or null when the form is creating a new one. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const { showAlert } = useAlert();

  const sellable = (categories || []).filter((c) => publiclyListed(c));

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/coupons?eventId=${eventId}`);
      const data = await res.json().catch(() => ({}));
      setCoupons(data.coupons || []);
      setRedemptions(data.redemptions || []);
      setReady(data.ready !== false);
    } catch {
      setCoupons([]);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { load(); }, [load]);
  // Reset on CLOSE, not on open: editing fills the form and opens it in the same breath.
  useEffect(() => { if (!open) { setForm(blank); setEditingId(null); } }, [open]);

  /**
   * Load an existing coupon into the form.
   *
   * The code itself is editable, but changing it on a coupon people already hold is how a
   * printed card stops working, so the field warns rather than silently accepting it.
   */
  const startEdit = (c: Coupon) => {
    setForm({
      code: c.code,
      kind: c.kind,
      scope: c.scope || 'INDIVIDUAL',
      discountType: c.discount_type || 'PERCENT',
      discountValue: c.discount_value == null ? '' : String(c.discount_value),
      freeCategoryId: c.free_category_id ? String(c.free_category_id) : '',
      freeQty: c.free_qty ?? 1,
      maxUses: c.max_uses == null ? '' : String(c.max_uses),
      perAccountUses: c.per_account_uses ?? 1,
      expiresAt: c.expires_at ? String(c.expires_at).slice(0, 16) : '',
      note: c.note || '',
    });
    setEditingId(c.id);
    setOpen(true);
  };

  const givesDiscount = form.kind === 'DISCOUNT' || form.kind === 'BOTH';
  const givesFree = form.kind === 'FREE_TICKET' || form.kind === 'BOTH';

  const create = async () => {
    setSaving(true);
    try {
      // One form, both jobs. PATCH carries the id; POST carries the event.
      const res = await fetch('/api/admin/coupons', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingId ? { id: editingId, ...form } : { eventId, ...form }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showAlert(data.error || `Could not ${editingId ? 'save' : 'create'} that coupon.`, 'error');
        return;
      }
      const saved = data.coupon?.code || normalizeCode(form.code);
      showAlert(editingId ? `${saved} updated.` : `${saved} is live.`, 'success');
      setOpen(false);
      await load();
    } catch {
      showAlert('Network error. Nothing was created.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (c: Coupon) => {
    setBusyId(c.id);
    try {
      const res = await fetch('/api/admin/coupons', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: c.id, active: !c.active }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { showAlert(data.error || 'Could not change that.', 'error'); return; }
      showAlert(c.active ? `${c.code} switched off.` : `${c.code} is live again.`, 'success');
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
      const res = await fetch('/api/admin/coupons', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: deleteId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { showAlert(data.error || 'Could not delete that coupon.', 'error'); return; }
      showAlert('Coupon removed.', 'info');
      await load();
    } finally {
      setBusyId(null);
      setDeleteId(null);
    }
  };

  const offerOf = (c: Coupon) => {
    const parts: string[] = [];
    if (c.discount_value) {
      parts.push(c.discount_type === 'PERCENT' ? `${Number(c.discount_value)}% off` : `₹${formatAmount(Number(c.discount_value))} off`);
    }
    if (c.free_qty) {
      const cat = categories.find((x) => String(x.id) === String(c.free_category_id));
      parts.push(`${c.free_qty} free ${cat?.name || 'ticket'}${c.scope === 'BUNDLE' ? ' per group' : ''}`);
    }
    return parts.join(' + ') || '—';
  };

  const input = 'w-full bg-zinc-950 border border-white/10 p-3.5 rounded-xl text-xs font-bold outline-none focus:border-brandRed text-white';
  const lab = 'text-[9px] font-black uppercase tracking-widest text-zinc-600 ml-1';
  // Room in the type a new code would give from. An EXISTING code is editable at any seat
  // count: the one that has stopped working is exactly the one whose category or expiry needs
  // changing.
  const chosenFree = sellable.find((c) => String(c.id) === form.freeCategoryId);
  const freeRoom = chosenFree ? seatsLeft(chosenFree) : null;
  const tooFewSeats = !editingId && givesFree && freeRoom !== null && freeRoom < Math.max(1, Number(form.freeQty) || 0);

  const canSave = normalizeCode(form.code).length >= 3
    && (!givesDiscount || Number(form.discountValue) > 0)
    && (!givesFree || (!!form.freeCategoryId && Number(form.freeQty) >= 1))
    && !tooFewSeats;

  if (loading) {
    return <div className="py-10 flex justify-center"><Loader2 className="animate-spin text-brandRed" size={22} /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1.5">
          <h3 className="text-2xl font-black uppercase italic tracking-tighter flex items-center gap-3">
            <BadgePercent className="text-brandRed" size={24} /> Coupons
          </h3>
          <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
            A code buyers type in the cart — money off, free passes, or both
          </p>
        </div>
        {ready && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-white bg-brandRed px-4 py-3 rounded-xl hover:bg-white hover:text-black transition-all shadow-lg active:scale-95"
          >
            {open ? <X size={14} /> : <Plus size={14} />} {open ? 'Cancel' : 'New coupon'}
          </button>
        )}
      </div>

      {!ready && (
        <p className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-[11px] font-bold uppercase tracking-widest text-amber-300 leading-relaxed">
          Coupons need a one-time database update. Run supabase/migrations/20261114_coupons.sql in Supabase, then reload.
        </p>
      )}

      {open && (
        <div className="rounded-[30px] border border-brandRed/30 bg-brandRed/[0.04] p-6 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              {editingId && (
                <p className="md:col-span-2 text-[10px] font-black uppercase tracking-widest text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 leading-relaxed">
                  Editing a live coupon. Changing the code stops any card or post already carrying
                  the old one from working, and uses already taken are not given back.
                </p>
              )}
              <label className={lab}>Code buyers type</label>
              {/* Upper-cased as it is typed, because that is how it is stored and matched. */}
              <input
                value={form.code}
                maxLength={MAX_CODE_LENGTH}
                placeholder="SAVE20"
                onChange={(e) => setForm({ ...form, code: normalizeCode(e.target.value) })}
                className={`${input} tracking-[0.2em]`}
              />
            </div>
            <div className="space-y-1.5">
              <label className={lab}>What it gives</label>
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} className={`${input} [color-scheme:dark]`}>
                <option value="DISCOUNT">Money off</option>
                <option value="FREE_TICKET">Free tickets</option>
                <option value="BOTH">Both</option>
              </select>
            </div>

            {givesDiscount && (
              <>
                <div className="space-y-1.5">
                  <label className={lab}>Discount type</label>
                  <select value={form.discountType} onChange={(e) => setForm({ ...form, discountType: e.target.value })} className={`${input} [color-scheme:dark]`}>
                    <option value="PERCENT">Percentage</option>
                    <option value="FLAT">Flat rupees</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className={lab}>{form.discountType === 'PERCENT' ? 'Percent off' : 'Rupees off'}</label>
                  <input type="number" min={1} value={form.discountValue} placeholder={form.discountType === 'PERCENT' ? '20' : '250'}
                    onChange={(e) => setForm({ ...form, discountValue: e.target.value })} className={input} />
                </div>
              </>
            )}

            {givesFree && (
              <>
                <div className="space-y-1.5">
                  <label className={lab}>Free tickets come from</label>
                  <select value={form.freeCategoryId} onChange={(e) => setForm({ ...form, freeCategoryId: e.target.value })} className={`${input} [color-scheme:dark]`}>
                    <option value="">Choose a type…</option>
                    {sellable.map((c) => (
                      <option key={c.id} value={c.id}>{c.name} — {seatsLeft(c) ?? '∞'} left</option>
                    ))}
                  </select>
                  {tooFewSeats && (
                    <p className="text-[10px] font-bold uppercase tracking-widest text-brandRed leading-relaxed">
                      Only {freeRoom} {chosenFree?.name} left — a coupon giving {form.freeQty} away cannot be honoured
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className={lab}>How many free{form.scope === 'BUNDLE' ? ' per group' : ''}</label>
                  <input type="number" min={1} max={MAX_FREE_QTY} value={form.freeQty}
                    onChange={(e) => setForm({ ...form, freeQty: Number(e.target.value) })} className={input} />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <label className={lab}>Counted how</label>
                  <div className="grid grid-cols-2 gap-2">
                    {([['INDIVIDUAL', 'Once per order'], ['BUNDLE', 'Per group bought']] as const).map(([value, label]) => (
                      <button key={value} type="button" onClick={() => setForm({ ...form, scope: value })}
                        className={`py-3.5 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all ${form.scope === value ? 'bg-brandRed/15 border-brandRed/50 text-white' : 'bg-zinc-950 border-white/10 text-zinc-500 hover:border-white/25'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-600 ml-1 leading-relaxed pt-1">
                    {form.scope === 'BUNDLE'
                      ? `Two groups bought gives ${Number(form.freeQty) * 2} free. Nothing if the cart has no group.`
                      : `${form.freeQty} free, however much is bought.`}
                  </p>
                </div>
              </>
            )}

            <div className="space-y-1.5">
              <label className={lab}>Total uses (blank = unlimited)</label>
              <input type="number" min={1} value={form.maxUses} placeholder="Unlimited"
                onChange={(e) => setForm({ ...form, maxUses: e.target.value })} className={input} />
            </div>
            <div className="space-y-1.5">
              <label className={lab}>Uses per account</label>
              <input type="number" min={1} value={form.perAccountUses}
                onChange={(e) => setForm({ ...form, perAccountUses: Number(e.target.value) })} className={input} />
            </div>
            <div className="space-y-1.5">
              <label className={lab}>Expires (blank = never)</label>
              <input type="datetime-local" value={form.expiresAt}
                onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} className={`${input} [color-scheme:dark]`} />
            </div>
            <div className="space-y-1.5">
              <label className={lab}>Note to yourself</label>
              <input value={form.note} maxLength={160} placeholder="For the radio ad"
                onChange={(e) => setForm({ ...form, note: e.target.value })} className={input} />
            </div>
          </div>

          <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-600 leading-relaxed">
            Set total uses to 1 for a one-time code — it stops working the moment it is used.
          </p>

          <button
            type="button"
            onClick={create}
            disabled={!canSave || saving}
            className="w-full py-4 bg-brandRed text-white font-black uppercase tracking-widest rounded-2xl hover:bg-white hover:text-black transition-all shadow-xl active:scale-95 text-[10px] flex items-center justify-center gap-2 disabled:opacity-40"
          >
            {saving ? <Loader2 className="animate-spin" size={14} /> : <><Check size={14} /> {editingId ? 'Save changes' : 'Create coupon'}</>}
          </button>
        </div>
      )}

      {coupons.length > 0 ? (
        <div className="space-y-3">
          {coupons.map((c) => {
            const used = redemptions.filter((r) => r.coupon_id === c.id);
            const left = c.max_uses == null ? null : Math.max(0, c.max_uses - (c.uses || 0));
            const expired = !!c.expires_at && new Date(c.expires_at) <= new Date();
            // Both limits at once, the same rule the cart and the checkout use: switched off,
            // expired, spent — and whether the type it gives away still has a seat to give.
            const avail = couponAvailability(c as never, categories as never, (x) => seatsLeft(x));
            const freeCat = categories.find((x) => String(x.id) === String(c.free_category_id));
            const dead = !avail.usable;
            return (
              <div key={c.id} className={`rounded-[24px] border p-5 space-y-3 transition-all ${dead ? 'border-white/5 bg-zinc-950/50' : 'border-white/10 bg-zinc-950'}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1.5">
                    <p className={`font-black uppercase tracking-[0.2em] text-lg ${dead ? 'text-zinc-600' : 'text-white'}`}>{c.code}</p>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-brandRed">{offerOf(c)}</p>
                    {c.note && <p className="text-[10px] text-zinc-600 italic">{c.note}</p>}
                    {avail.autoPaused && (
                      <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 leading-relaxed">
                        Nobody can use it right now — it comes back by itself if {freeCat?.name || 'those'} seats free up.
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 text-[9px] font-black uppercase tracking-widest shrink-0">
                    <span className="px-2.5 py-1 rounded-lg border border-white/10 text-zinc-400">
                      {c.uses || 0} used{left !== null ? ` · ${left} left` : ''}
                    </span>
                    {c.event_id == null && <span className="px-2.5 py-1 rounded-lg border border-white/10 text-zinc-500">All events</span>}
                    {expired && <span className="px-2.5 py-1 rounded-lg border border-amber-500/30 text-amber-400">Expired</span>}
                    {left === 0 && <span className="px-2.5 py-1 rounded-lg border border-amber-500/30 text-amber-400">Used up</span>}
                    {!c.active && <span className="px-2.5 py-1 rounded-lg border border-zinc-700 text-zinc-500">Off</span>}
                    {/* Said apart from a hand switch-off, because they undo differently: this
                        one lifts itself as soon as a refund or a void frees a seat. */}
                    {avail.autoPaused && (
                      <span className="px-2.5 py-1 rounded-lg border border-orange-500/40 bg-orange-500/10 text-orange-400">
                        Auto-paused · {avail.seatsLeft} {freeCat?.name || 'seats'} left, gives {avail.seatsNeeded}
                      </span>
                    )}
                    {avail.stop === 'CATEGORY_CLOSED' && (
                      <span className="px-2.5 py-1 rounded-lg border border-orange-500/40 bg-orange-500/10 text-orange-400">
                        {freeCat?.name || 'That type'} is not on sale
                      </span>
                    )}
                    {avail.stop === 'CATEGORY_GONE' && (
                      <span className="px-2.5 py-1 rounded-lg border border-brandRed/40 bg-brandRed/10 text-brandRed">
                        Its ticket type is gone
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => toggle(c)} disabled={busyId === c.id}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-white/10 bg-zinc-900 text-[9px] font-black uppercase tracking-widest hover:bg-white hover:text-black transition-all disabled:opacity-40">
                    {busyId === c.id ? <Loader2 size={12} className="animate-spin" /> : <Power size={12} />}
                    {c.active ? 'Switch off' : 'Switch on'}
                  </button>
                  {used.length > 0 && (
                    <button type="button" onClick={() => setShowUses(showUses === c.id ? null : c.id)}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-white/10 bg-zinc-900 text-[9px] font-black uppercase tracking-widest hover:bg-white hover:text-black transition-all">
                      <Ticket size={12} /> Who used it ({used.length})
                    </button>
                  )}
                  <button type="button" onClick={() => startEdit(c)} disabled={busyId === c.id}
                    title="Edit this coupon"
                    className="px-3 py-2.5 rounded-xl border border-white/10 bg-zinc-900 text-zinc-400 hover:text-black hover:bg-white transition-all disabled:opacity-40">
                    <Pencil size={12} />
                  </button>
                  <button type="button" onClick={() => { setDeleteId(c.id); setConfirmOpen(true); }} disabled={busyId === c.id}
                    title={(c.uses || 0) > 0 ? 'Already used — switch it off instead' : 'Delete this coupon'}
                    className="px-3 py-2.5 rounded-xl border border-white/10 bg-zinc-900 text-zinc-500 hover:text-white hover:bg-brandRed hover:border-brandRed transition-all disabled:opacity-40">
                    <Trash2 size={12} />
                  </button>
                </div>

                {showUses === c.id && (
                  <div className="rounded-2xl border border-white/5 bg-black/40 divide-y divide-white/5">
                    {used.map((r) => (
                      <div key={r.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[11px] font-bold text-zinc-200 truncate">{r.email || 'unknown'}</p>
                          <p className="text-[9px] text-zinc-600 font-bold uppercase tracking-widest mt-0.5">
                            {new Date(r.created_at).toLocaleString('en-IN')}
                            {!r.confirmed_at && ' · not completed'}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2 text-[9px] font-black uppercase tracking-widest">
                          {Number(r.discount_amount) > 0 && (
                            <span className="px-2.5 py-1 rounded-lg border border-white/10 text-zinc-300">
                              ₹{formatAmount(Number(r.discount_amount))} off
                            </span>
                          )}
                          {/* Which pass numbers went out free — the question the gate asks. */}
                          {(r.free_numbers || []).map((n) => (
                            <span key={n} className="px-2.5 py-1 rounded-lg border border-green-500/30 text-green-400 flex items-center gap-1.5">
                              <Gift size={9} /> {n}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : ready && (
        <p className="text-zinc-500 text-sm italic py-6 text-center border border-white/5 rounded-[24px] bg-zinc-950">
          No coupons yet.
        </p>
      )}

      <TribeConfirm
        isOpen={confirmOpen}
        onCancel={() => { setConfirmOpen(false); setDeleteId(null); }}
        onConfirm={remove}
        title="Delete this coupon?"
        message="If anyone has already used it, switch it off instead — deleting would erase the record of who used it and what they got."
      />
    </div>
  );
}
