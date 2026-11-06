"use client";

// Complimentary passes: real tickets, given away.
//
// These are not a lighter kind of ticket. They take their seats and numbers from the same
// reservation a paying buyer's do, land in the same bookings table and carry the same signed
// QR, so the gate treats a VIP exactly like anyone else. What this screen adds is a reason and
// a name against every free seat, and a running total of what the guest list costs.

import { useEffect, useState } from 'react';
import { DoorOpen, Gift, Loader2, Mail, Plus, Send, Ticket, Trash2, UserPlus } from 'lucide-react';
import { useAlert } from '@/context/AlertContext';
import { seatsLeft } from '@/lib/payments/seats';
import { groupSizeOf, isGroup } from '@/lib/payments/groups';
import { ACCESS_PASS, COMP_REASONS, MAX_COMP_PASSES, MAX_NOTE_LENGTH, isAccessPass } from '@/lib/payments/comp';
import { formatAmount } from '@/lib/payments/format';

interface Grant {
  id: string;
  booking_id: string;
  guest_name: string;
  guest_email: string;
  guest_phone: string | null;
  reason: string;
  note: string | null;
  passes: number;
  admits: number;
  face_value: number;
  issued_by: string;
  created_at: string;
}

interface Props {
  eventId: string;
  categories: any[];
  grants: Grant[];
  /** Reload the dashboard once passes have been issued or taken back, so stock and the ledger catch up. */
  onIssued: () => void;
}

const REASON_TONE: Record<string, string> = {
  VIP: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
  INVITEE: 'text-sky-400 border-sky-400/30 bg-sky-400/10',
  ARTIST: 'text-fuchsia-400 border-fuchsia-400/30 bg-fuchsia-400/10',
  SPONSOR: 'text-green-500 border-green-500/30 bg-green-500/10',
  CREW: 'text-zinc-300 border-white/15 bg-white/5',
  MEDIA: 'text-orange-400 border-orange-400/30 bg-orange-400/10',
  OTHER: 'text-zinc-400 border-white/10 bg-white/5',
};

export default function CompPassIssuer({ eventId, categories, grants, onIssued }: Props) {
  const [open, setOpen] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [reason, setReason] = useState<string>('VIP');
  const [note, setNote] = useState('');
  const [items, setItems] = useState<Record<string, number>>({});
  const [issuing, setIssuing] = useState(false);
  const [makingPass, setMakingPass] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const { showAlert } = useAlert();

  /**
   * Make sure the event has an ACCESS PASS before anyone needs it.
   *
   * Most guests are not being put in a seating category at all — they are let in and seated by
   * a volunteer — so the common case should not require the admin to go and invent a category
   * first. Idempotent on the server, so opening the form repeatedly creates nothing extra.
   */
  const ensureAccessPass = async (capacity?: number) => {
    setMakingPass(true);
    try {
      const res = await fetch('/api/admin/tickets/comp', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, capacity }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { showAlert(data.error || 'Could not create the access pass.', 'error'); return; }
      if (data.created) showAlert(`Access pass created (${data.category.capacity} available). It is not shown to buyers.`, 'success');
      onIssued();
    } catch {
      showAlert('Network error. Please try again.', 'error');
    } finally {
      setMakingPass(false);
    }
  };

  // A fresh form each time it is opened. Leaving the last guest's name in the box is how two
  // people end up with passes addressed to one of them.
  useEffect(() => {
    if (open) return;
    setGuestName(''); setGuestEmail(''); setGuestPhone(''); setReason('VIP'); setNote(''); setItems({});
  }, [open]);

  // Paused categories are left out: reserve_order_inventory refuses an inactive category, so
  // offering one here would only ever produce a refusal.
  const sellable = categories.filter((c) => c.active !== false);
  const accessPass = categories.find((c) => isAccessPass(c));
  const chosen = Object.values(items).reduce((a, b) => a + b, 0);
  const admits = sellable.reduce((n, c) => n + (items[c.id] || 0) * groupSizeOf(c.group_size), 0);
  const faceValue = sellable.reduce((n, c) => n + (items[c.id] || 0) * (Number(c.price) || 0), 0);

  const bump = (cat: any, delta: number) => {
    const left = seatsLeft(cat) ?? Number.MAX_SAFE_INTEGER;
    const next = Math.max(0, (items[cat.id] || 0) + delta);
    if (next > left) { showAlert(`Only ${left} left in "${cat.name}".`, 'error'); return; }
    if (delta > 0 && chosen >= MAX_COMP_PASSES) { showAlert(`At most ${MAX_COMP_PASSES} passes in one go.`, 'error'); return; }
    setItems({ ...items, [cat.id]: next });
  };

  const issue = async () => {
    if (issuing) return;
    setIssuing(true);
    try {
      const res = await fetch('/api/admin/tickets/comp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, guestName, guestEmail, guestPhone, reason, note, items }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { showAlert(data.error || 'Could not issue those passes.', 'error'); return; }
      // Say what actually happened to the email rather than claiming it was sent: a comp whose
      // delivery failed is a guest who turns up with nothing to show at the gate.
      showAlert(
        data.delivery === 'SENT'
          ? `${data.passes} pass${data.passes > 1 ? 'es' : ''} issued and emailed to ${guestEmail}.`
          : `${data.passes} pass${data.passes > 1 ? 'es' : ''} issued, but the email did not send. Use Resend in the ledger below.`,
        data.delivery === 'SENT' ? 'success' : 'info',
      );
      setOpen(false);
      onIssued();
    } catch {
      showAlert('Network error. Nothing was issued.', 'error');
    } finally {
      setIssuing(false);
    }
  };

  /**
   * Take a grant back.
   *
   * Deleting rather than voiding, because a comp has no payment behind it: there is no receipt
   * to keep and a grant issued by mistake should leave the register. The confirmation spells
   * out the two things an admin will not think of - that the seats come back, and that the
   * guest is not told anything.
   */
  const remove = async (g: Grant) => {
    const confirmed = confirm(
      `Delete the ${g.passes} pass${g.passes === 1 ? '' : 'es'} given to ${g.guest_name}?\n\n` +
        `They stop working at the gate and the seats go straight back on sale.\n\n` +
        `This cannot be undone, and ${g.guest_email} is NOT told - tell them yourself if they are expecting to come.`,
    );
    if (!confirmed) return;
    setDeleting(g.booking_id);
    try {
      const res = await fetch('/api/admin/tickets/comp', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: g.booking_id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { showAlert(data.error || 'Could not delete that grant.', 'error'); return; }
      // Anything the server could not put back needs a human, so it is said out loud rather
      // than folded into a success message nobody reads.
      showAlert(data.note || `Passes for ${g.guest_name} deleted.`, data.unfreeable?.length ? 'info' : 'success');
      onIssued();
    } catch {
      showAlert('Network error. Nothing was deleted.', 'error');
    } finally {
      setDeleting(null);
    }
  };

  const totals = grants.reduce(
    (acc, g) => ({ passes: acc.passes + (g.passes || 0), admits: acc.admits + (g.admits || 0), value: acc.value + Number(g.face_value || 0) }),
    { passes: 0, admits: 0, value: 0 },
  );

  const input = 'w-full bg-zinc-950 border border-white/10 p-3.5 rounded-xl text-xs font-bold outline-none focus:border-brandRed text-white';
  const lab = 'text-[9px] font-black uppercase tracking-widest text-zinc-600 ml-1';
  const canIssue = guestName.trim().length > 0 && guestEmail.includes('@') && chosen > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h3 className="text-2xl font-black uppercase italic tracking-tighter flex items-center gap-3">
          <Gift className="text-brandRed" size={24} /> Complimentary Passes
        </h3>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-white bg-brandRed px-4 py-3 rounded-xl hover:bg-white hover:text-black transition-all shadow-lg active:scale-95"
        >
          <UserPlus size={14} /> {open ? 'Cancel' : 'Generate passes'}
        </button>
      </div>

      {open && (
        <div className="rounded-[30px] border border-brandRed/30 bg-brandRed/[0.04] p-6 space-y-6">
          <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 leading-relaxed">
            These are free, scannable passes. They take real seats out of the category, so the
            public count drops the moment you issue them.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className={lab}>Guest name</label>
              <input value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="Who is this for?" className={input} />
            </div>
            <div className="space-y-1.5">
              <label className={lab}>Email (passes go here)</label>
              <input type="email" value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} placeholder="guest@example.com" className={input} />
            </div>
            <div className="space-y-1.5">
              <label className={lab}>Phone (optional)</label>
              <input value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} placeholder="10 digits" className={input} />
            </div>
            <div className="space-y-1.5">
              <label className={lab}>Why</label>
              <select value={reason} onChange={(e) => setReason(e.target.value)} className={input}>
                {COMP_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className={lab}>Note (optional)</label>
            <input value={note} maxLength={MAX_NOTE_LENGTH} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Chief guest, confirmed by Rohit" className={input} />
          </div>

          <div className="space-y-3">
            <label className={lab}>Which passes</label>

            {/* The default. A guest who is not being put in a particular category still needs a
                scannable pass, and this is it — the door lets them in, a volunteer seats them. */}
            {!accessPass && (
              <button
                type="button"
                onClick={() => ensureAccessPass()}
                disabled={makingPass}
                className="w-full flex items-center gap-3 rounded-2xl border border-dashed border-amber-500/40 bg-amber-500/[0.06] p-4 text-left hover:bg-amber-500/10 transition-all disabled:opacity-60"
              >
                {makingPass ? <Loader2 size={18} className="animate-spin text-amber-400 shrink-0" /> : <DoorOpen size={18} className="text-amber-400 shrink-0" />}
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-black uppercase tracking-widest text-amber-400">Add an {ACCESS_PASS.name}</span>
                  <span className="block text-[10px] text-zinc-400 font-medium leading-relaxed mt-1">
                    General entry for guests with no seating category — volunteers seat them on the night.
                    Never shown to buyers.
                  </span>
                </span>
                <Plus size={16} className="text-amber-400 shrink-0" />
              </button>
            )}

            {sellable.map((cat) => {
              const left = seatsLeft(cat);
              const qty = items[cat.id] || 0;
              return (
                <div key={cat.id} className="flex items-center justify-between gap-4 bg-black/50 border border-white/10 rounded-2xl p-4">
                  <div className="min-w-0">
                    <p className="font-black uppercase text-xs text-white truncate flex items-center gap-2">
                      {cat.name}
                      {isAccessPass(cat) && (
                        <span className="shrink-0 text-[8px] font-black uppercase tracking-widest text-amber-400 border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 rounded-full">
                          General entry
                        </span>
                      )}
                    </p>
                    <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 mt-1">
                      ₹{formatAmount(cat.price)}
                      {isGroup(cat.group_size) ? ` · admits ${groupSizeOf(cat.group_size)}` : ''}
                      {left !== null ? ` · ${left} left` : ''}
                    </p>
                  </div>
                  <div className="shrink-0 flex items-center gap-3 bg-white text-black rounded-xl px-2 py-1.5">
                    <button type="button" onClick={() => bump(cat, -1)} className="px-2 font-black hover:text-brandRed transition-colors">-</button>
                    <span className="font-black text-sm w-5 text-center tabular-nums">{qty}</span>
                    <button type="button" onClick={() => bump(cat, 1)} className="px-2 font-black hover:text-brandRed transition-colors">+</button>
                  </div>
                </div>
              );
            })}
            {sellable.length === 0 && accessPass && (
              <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 py-4 text-center">
                Every category is paused. Resume one in Inventory Control to issue passes from it.
              </p>
            )}
          </div>

          {chosen > 0 && (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border border-white/10 bg-black/40 px-5 py-4 text-[10px] font-black uppercase tracking-widest">
              <span className="text-zinc-400">{chosen} pass{chosen > 1 ? 'es' : ''}</span>
              <span className="text-zinc-400">admits {admits}</span>
              <span className="text-brandRed">₹{formatAmount(faceValue)} given away</span>
            </div>
          )}

          <button
            type="button"
            onClick={issue}
            disabled={!canIssue || issuing}
            className="w-full py-4 bg-brandRed text-white font-black uppercase tracking-widest rounded-2xl hover:bg-white hover:text-black transition-all shadow-xl active:scale-95 text-[10px] flex items-center justify-center gap-2 disabled:opacity-40 disabled:hover:bg-brandRed disabled:hover:text-white"
          >
            {issuing ? <Loader2 className="animate-spin" size={14} /> : <><Send size={14} /> Issue &amp; email passes</>}
          </button>
        </div>
      )}

      {grants.length > 0 && (
        <>
          <div className="grid grid-cols-3 gap-4">
            {[
              ['Passes given', String(totals.passes), 'text-white'],
              ['People admitted', String(totals.admits), 'text-white'],
              ['Value given away', `₹${formatAmount(totals.value)}`, 'text-brandRed'],
            ].map(([label, value, tone]) => (
              <div key={label} className="bg-zinc-950 border border-white/10 rounded-[24px] p-5">
                <p className="text-[9px] text-zinc-600 font-black uppercase tracking-widest mb-2">{label}</p>
                <p className={`text-2xl font-black ${tone}`}>{value}</p>
              </div>
            ))}
          </div>

          <div className="bg-zinc-950 border border-white/10 rounded-[30px] overflow-hidden shadow-2xl overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[760px]">
              <thead>
                <tr className="bg-white/5 text-[9px] uppercase tracking-[0.2em] text-zinc-500 font-black border-b border-white/10">
                  <th className="p-5">Guest</th>
                  <th className="p-5">Why</th>
                  <th className="p-5">Passes</th>
                  <th className="p-5">Value</th>
                  <th className="p-5">Issued by</th>
                  <th className="p-5 text-right">Delete</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-sm font-bold">
                {grants.map((g) => (
                  <tr key={g.id} className="hover:bg-white/5 transition-colors">
                    <td className="p-5">
                      <span className="text-white uppercase tracking-wider block mb-1">{g.guest_name}</span>
                      <span className="text-[10px] text-zinc-500 flex items-center gap-1.5"><Mail size={9} /> {g.guest_email}</span>
                      {g.note && <span className="text-[10px] text-zinc-600 italic block mt-1">{g.note}</span>}
                    </td>
                    <td className="p-5">
                      <span className={`inline-block px-2.5 py-1 rounded-lg border text-[9px] font-black uppercase tracking-widest ${REASON_TONE[g.reason] || REASON_TONE.OTHER}`}>
                        {g.reason}
                      </span>
                    </td>
                    <td className="p-5">
                      <span className="flex items-center gap-1.5 text-[11px] text-zinc-300"><Ticket size={11} className="text-brandRed" /> {g.passes}</span>
                      <span className="text-[9px] text-zinc-600 font-bold uppercase tracking-widest mt-1 block">admits {g.admits}</span>
                    </td>
                    <td className="p-5 font-mono text-[11px] text-zinc-400">₹{formatAmount(Number(g.face_value || 0))}</td>
                    <td className="p-5">
                      <span className="text-[10px] text-zinc-500 block truncate max-w-[160px]">{g.issued_by}</span>
                      <span className="text-[9px] text-zinc-600 block mt-1">{new Date(g.created_at).toLocaleDateString('en-IN')}</span>
                    </td>
                    <td className="p-5 text-right">
                      <button
                        type="button"
                        onClick={() => remove(g)}
                        disabled={deleting === g.booking_id}
                        title={`Delete ${g.guest_name}'s passes and put the seats back on sale`}
                        aria-label={`Delete ${g.guest_name}'s passes`}
                        className="p-2.5 rounded-xl border border-white/10 text-zinc-500 hover:text-white hover:bg-brandRed hover:border-brandRed transition-all active:scale-95 disabled:opacity-40"
                      >
                        {deleting === g.booking_id ? <Loader2 className="animate-spin" size={13} /> : <Trash2 size={13} />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {grants.length === 0 && !open && (
        <p className="text-zinc-500 text-sm italic py-6 text-center border border-white/5 rounded-[24px] bg-zinc-950">
          No complimentary passes issued for this event.
        </p>
      )}
    </div>
  );
}
