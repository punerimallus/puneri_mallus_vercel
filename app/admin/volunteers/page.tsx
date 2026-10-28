"use client";
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Loader2, UserPlus, ShieldCheck, Trash2, ToggleLeft, ToggleRight,
  QrCode, Info, Search, CalendarDays, Copy, Check,
} from 'lucide-react';
import { useAlert } from '@/context/AlertContext';

interface Staff {
  id: string;
  email: string;
  role: string;
  event_id: string | null;
  active: boolean;
  note: string | null;
  added_by: string | null;
  created_at: string;
}

interface EventOption {
  _id: string;
  title: string;
  date?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The gate list: who may scan passes at the door.
 *
 * Scanning used to require full admin rights, so every volunteer on the gate could also see
 * pricing, payments and every member's details. A volunteer added here can do exactly one
 * thing — admit people on a valid pass — and every admission they make is recorded against
 * their email.
 */
export default function GateVolunteersPage() {
  const { showAlert } = useAlert();
  const [staff, setStaff] = useState<Staff[]>([]);
  const [events, setEvents] = useState<EventOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [schemaBehind, setSchemaBehind] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [email, setEmail] = useState('');
  const [eventId, setEventId] = useState('');
  const [note, setNote] = useState('');
  const [query, setQuery] = useState('');

  const gateLink = typeof window === 'undefined' ? '/gate' : `${window.location.origin}/gate`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/staff');
      const data = await res.json();
      if (!res.ok) {
        if (data.schemaBehind) setSchemaBehind(data.error || 'The ticketing migration has not been run yet.');
        else showAlert(data.error || 'Could not load the gate list.', 'error');
        setStaff([]);
        return;
      }
      setSchemaBehind(null);
      setStaff(data.staff || []);
    } catch {
      showAlert('Could not load the gate list.', 'error');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
    // The event list is only used to scope a volunteer to one show; failing to load it is not fatal.
    fetch('/api/events')
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setEvents(Array.isArray(d) ? d : d?.events || []))
      .catch(() => setEvents([]));
  }, [load]);

  const add = async () => {
    const clean = email.trim().toLowerCase();
    if (!EMAIL_RE.test(clean)) {
      showAlert('Enter a valid email address.', 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/admin/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: clean, eventId: eventId || null, note: note.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        showAlert(data.error || 'Could not add them.', 'error');
        return;
      }
      showAlert(`${clean} can now scan passes at the gate.`, 'success');
      setEmail('');
      setNote('');
      await load();
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (s: Staff) => {
    const res = await fetch('/api/admin/staff', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: s.id, active: !s.active }),
    });
    if (!res.ok) {
      showAlert('Could not update them.', 'error');
      return;
    }
    showAlert(s.active ? `${s.email} can no longer scan.` : `${s.email} can scan again.`, 'success');
    setStaff((prev) => prev.map((r) => (r.id === s.id ? { ...r, active: !r.active } : r)));
  };

  const remove = async (s: Staff) => {
    if (!confirm(`Remove ${s.email} from the gate list? Their past scans stay in the log.`)) return;
    const res = await fetch(`/api/admin/staff?id=${encodeURIComponent(s.id)}`, { method: 'DELETE' });
    if (!res.ok) {
      showAlert('Could not remove them.', 'error');
      return;
    }
    showAlert(`${s.email} removed from the gate list.`, 'success');
    setStaff((prev) => prev.filter((r) => r.id !== s.id));
  };

  const eventTitle = (id: string | null) => {
    if (!id) return 'All events';
    return events.find((e) => e._id === id)?.title || 'One event';
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return staff;
    return staff.filter((s) => s.email.toLowerCase().includes(q) || (s.note || '').toLowerCase().includes(q));
  }, [staff, query]);

  const activeCount = staff.filter((s) => s.active).length;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-24 pb-32 text-white">
      <header className="mb-8 space-y-2">
        <h1 className="text-3xl sm:text-4xl font-black uppercase italic tracking-tighter">
          Gate <span className="text-brandRed">Volunteers</span>
        </h1>
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
          Who can scan passes at the door
        </p>
      </header>

      {schemaBehind && (
        <div className="mb-8 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 space-y-2">
          <p className="text-sm font-black uppercase tracking-widest text-amber-400">Database update needed</p>
          <p className="text-xs text-amber-200/80 leading-relaxed">{schemaBehind}</p>
          <p className="text-xs text-amber-200/60 leading-relaxed">
            Run that file in the Supabase SQL editor, then reload this page. Until it is applied,
            ticket checkout is paused rather than running in a half-working state.
          </p>
        </div>
      )}

      <div className="rounded-3xl border border-white/10 bg-zinc-950/60 p-5 sm:p-7 mb-8">
        <div className="flex items-center gap-2 mb-5">
          <UserPlus size={16} className="text-brandRed" />
          <h2 className="text-sm font-black uppercase tracking-widest">Add a volunteer</h2>
        </div>

        <div className="grid gap-4 sm:grid-cols-[1.3fr_1fr_1fr_auto] items-end">
          <label className="block space-y-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Their login email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
              placeholder="volunteer@example.com"
              className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:border-brandRed/50 focus:outline-none"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Which event</span>
            <select
              value={eventId}
              onChange={(e) => setEventId(e.target.value)}
              className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-brandRed/50 focus:outline-none"
            >
              <option value="">All events</option>
              {events.map((e) => (
                <option key={e._id} value={e._id}>{e.title}</option>
              ))}
            </select>
          </label>

          <label className="block space-y-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Note (optional)</span>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Main gate"
              className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:border-brandRed/50 focus:outline-none"
            />
          </label>

          <button
            onClick={add}
            disabled={saving}
            className="bg-brandRed text-white px-6 py-3 rounded-xl font-black uppercase tracking-widest text-xs active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2 h-[46px]"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
            Add
          </button>
        </div>

        <div className="mt-5 flex items-start gap-2 text-[11px] text-zinc-500 leading-relaxed">
          <Info size={13} className="mt-0.5 shrink-0" />
          <p>
            They must sign in to the site with this exact email. They will only be able to open the
            gate scanner — not the admin panel — and every person they admit is recorded against
            their name.
          </p>
        </div>
      </div>

      <div className="rounded-3xl border border-white/10 bg-zinc-950/60 p-5 sm:p-7 mb-8">
        <div className="flex items-center gap-2 mb-3">
          <QrCode size={16} className="text-brandRed" />
          <h2 className="text-sm font-black uppercase tracking-widest">Send them this link</h2>
        </div>
        <p className="text-[11px] text-zinc-500 mb-4 leading-relaxed">
          Volunteers scan a pass QR with their phone camera, which opens the gate screen directly.
          This link is for checking their access works before the doors open.
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <code className="flex-1 min-w-[200px] bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-xs text-zinc-300 font-mono break-all">
            {gateLink}
          </code>
          <button
            onClick={() => {
              navigator.clipboard?.writeText(gateLink).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
              });
            }}
            className="bg-white/5 border border-white/15 px-5 py-3 rounded-xl font-black uppercase tracking-widest text-xs active:scale-95 flex items-center gap-2"
          >
            {copied ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      <div className="rounded-3xl border border-white/10 bg-zinc-950/60 overflow-hidden">
        <div className="p-5 sm:p-7 border-b border-white/10 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className="text-brandRed" />
            <h2 className="text-sm font-black uppercase tracking-widest">
              On the gate list
              <span className="ml-2 text-zinc-500 font-bold">{activeCount} active</span>
            </h2>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              className="bg-black/50 border border-white/10 rounded-xl pl-9 pr-4 py-2.5 text-xs text-white placeholder:text-zinc-600 focus:border-brandRed/50 focus:outline-none"
            />
          </div>
        </div>

        {loading ? (
          <div className="py-16 flex justify-center">
            <Loader2 className="animate-spin text-brandRed" size={28} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 px-6 text-center space-y-2">
            <p className="text-sm font-bold uppercase tracking-widest text-zinc-500">
              {staff.length === 0 ? 'Nobody on the gate list yet' : 'No matches'}
            </p>
            {staff.length === 0 && (
              <p className="text-xs text-zinc-600">
                Admins can always scan. Add volunteers here so they do not need admin rights.
              </p>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-white/5">
            {filtered.map((s) => (
              <li key={s.id} className="p-5 sm:px-7 flex items-center gap-4 flex-wrap">
                <div className="flex-1 min-w-[180px] space-y-1">
                  <p className={`text-sm font-bold break-all ${s.active ? 'text-white' : 'text-zinc-500 line-through'}`}>
                    {s.email}
                  </p>
                  <div className="flex items-center gap-3 flex-wrap text-[10px] font-bold uppercase tracking-widest">
                    <span className="flex items-center gap-1 text-zinc-500">
                      <CalendarDays size={11} /> {eventTitle(s.event_id)}
                    </span>
                    {s.note && <span className="text-zinc-600">{s.note}</span>}
                    {s.added_by && <span className="text-zinc-700">added by {s.added_by}</span>}
                  </div>
                </div>

                <span
                  className={`shrink-0 px-2.5 py-1 rounded-md border text-[10px] font-black uppercase tracking-widest ${
                    s.active
                      ? 'text-green-400 border-green-500/30 bg-green-500/10'
                      : 'text-zinc-500 border-white/10 bg-white/5'
                  }`}
                >
                  {s.active ? 'Can scan' : 'Switched off'}
                </span>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => toggle(s)}
                    title={s.active ? 'Switch off their access' : 'Switch their access back on'}
                    className="p-2.5 rounded-xl bg-white/5 border border-white/10 hover:border-white/25 active:scale-95 transition-all"
                  >
                    {s.active ? <ToggleRight size={16} className="text-green-500" /> : <ToggleLeft size={16} className="text-zinc-500" />}
                  </button>
                  <button
                    onClick={() => remove(s)}
                    title="Remove from the gate list"
                    className="p-2.5 rounded-xl bg-white/5 border border-white/10 hover:border-brandRed/40 hover:text-brandRed active:scale-95 transition-all"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
