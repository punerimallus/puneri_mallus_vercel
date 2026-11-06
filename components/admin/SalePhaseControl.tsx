"use client";

// When an event goes on sale, and what the banner above the box office says while it is.
//
// Both live on the event document rather than in the ticket tables, because the thing being
// controlled is whether the PUBLIC EVENT LIST shows the event at all — see /api/events, which
// leaves a scheduled event out of the response entirely rather than returning it with a flag
// the browser is trusted to honour.

import { useEffect, useMemo, useState } from 'react';
import { AlarmClock, CalendarClock, Check, Loader2, Megaphone, Radio, Rocket } from 'lucide-react';
import { useAlert } from '@/context/AlertContext';
import { MAX_HEADLINE, MAX_PHASE_ALERT, PHASE_ALERT_IDEAS, fromLocalInput, isSaleLive, phaseAlert, saleHeadline, scheduleLabel, toLocalInput } from '@/lib/events/sale-phase';

interface AdminEvent {
  _id: string;
  title: string;
  date?: string;
  time?: string;
  goLiveAt?: string | null;
  salesHeadline?: string | null;
  phaseAlert?: string | null;
}

const HEADLINE_IDEAS = ['Early bird tickets are live', 'Phase 1 is live', 'Phase 2 — prices up 15%', 'Final release'];

export default function SalePhaseControl({ events, onSaved }: { events: AdminEvent[]; onSaved?: () => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [headline, setHeadline] = useState('');
  const [nextPhase, setNextPhase] = useState('');
  const [scheduled, setScheduled] = useState(false);
  const [when, setWhen] = useState('');
  const [saving, setSaving] = useState(false);
  const { showAlert } = useAlert();

  const selected = useMemo(() => events.find((e) => e._id === openId) || null, [events, openId]);

  // Load the event's own settings into the form when it is opened, and whenever the parent
  // refetches after a save, so the form never shows a value the server no longer holds.
  useEffect(() => {
    if (!selected) return;
    setHeadline(selected.salesHeadline || '');
    setNextPhase(selected.phaseAlert || '');
    setScheduled(!!selected.goLiveAt && !isSaleLive(selected.goLiveAt));
    setWhen(toLocalInput(selected.goLiveAt));
  }, [selected]);

  const save = async () => {
    if (!selected) return;
    // Unticking "schedule for later" means on sale now, which is null rather than a past date:
    // a date in the past would work but reads as a schedule nobody set.
    const goLiveAt = scheduled ? fromLocalInput(when) : null;
    if (scheduled && !goLiveAt) {
      showAlert('Pick the date and time the tickets should go live.', 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/admin/boxoffice', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: selected._id,
          salesHeadline: saleHeadline(headline),
          phaseAlert: phaseAlert(nextPhase),
          goLiveAt,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { showAlert(data.error || 'Could not save that.', 'error'); return; }
      showAlert(goLiveAt ? `"${selected.title}" goes live ${scheduleLabel(goLiveAt).replace('Goes live ', '')}` : `"${selected.title}" is on sale now.`, 'success');
      onSaved?.();
    } catch {
      showAlert('Network error. Please try again.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const input = 'w-full bg-zinc-950 border border-white/10 p-3.5 rounded-xl text-xs font-bold outline-none focus:border-brandRed text-white';

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-2xl font-black uppercase italic tracking-tighter flex items-center gap-3">
          <Rocket className="text-brandRed" size={24} /> Go Live &amp; Phases
        </h3>
        <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
          Pick an event to set its banner, or schedule when it appears on the site
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {events.map((ev) => {
          const live = isSaleLive(ev.goLiveAt);
          const open = openId === ev._id;
          return (
            <div key={ev._id} className={`rounded-[24px] border transition-all ${open ? 'border-brandRed/50 bg-brandRed/[0.04]' : 'border-white/10 bg-zinc-950 hover:border-white/25'}`}>
              <button
                type="button"
                onClick={() => setOpenId(open ? null : ev._id)}
                className="w-full flex items-start justify-between gap-4 p-5 text-left"
              >
                <div className="min-w-0 space-y-1.5">
                  <p className="font-black uppercase text-sm text-white truncate">{ev.title}</p>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">{ev.date} · {ev.time}</p>
                  <p className={`text-[9px] font-black uppercase tracking-widest ${live ? 'text-green-500' : 'text-amber-400'}`}>
                    {scheduleLabel(ev.goLiveAt)}
                  </p>
                  {ev.salesHeadline && (
                    <p className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest text-zinc-400 pt-1">
                      <Megaphone size={10} className="text-brandRed shrink-0" />
                      <span className="truncate">{ev.salesHeadline}</span>
                    </p>
                  )}
                  {ev.phaseAlert && (
                    <p className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-brandRed">
                      <AlarmClock size={10} className="shrink-0" />
                      <span className="truncate">{ev.phaseAlert}</span>
                    </p>
                  )}
                </div>
                <span className={`shrink-0 w-2.5 h-2.5 rounded-full mt-1.5 ${live ? 'bg-green-500' : 'bg-amber-400 animate-pulse'}`} />
              </button>

              {open && (
                <div className="px-5 pb-5 space-y-5 border-t border-white/5 pt-5">
                  <div className="space-y-2">
                    <label className="text-[9px] font-black uppercase tracking-widest text-zinc-600 ml-1">
                      Banner above the box office
                    </label>
                    <input
                      value={headline}
                      maxLength={MAX_HEADLINE}
                      placeholder="e.g. Early bird tickets are live"
                      onChange={(e) => setHeadline(e.target.value)}
                      className={input}
                    />
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {HEADLINE_IDEAS.map((idea) => (
                        <button
                          key={idea}
                          type="button"
                          onClick={() => setHeadline(idea)}
                          className="text-[9px] font-bold uppercase tracking-widest text-zinc-400 border border-white/10 rounded-lg px-2.5 py-1.5 hover:bg-white hover:text-black transition-all"
                        >
                          {idea}
                        </button>
                      ))}
                      {headline && (
                        <button
                          type="button"
                          onClick={() => setHeadline('')}
                          className="text-[9px] font-bold uppercase tracking-widest text-brandRed border border-brandRed/30 rounded-lg px-2.5 py-1.5 hover:bg-brandRed hover:text-white transition-all"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[9px] font-black uppercase tracking-widest text-zinc-600 ml-1 flex items-center gap-1.5">
                      <AlarmClock size={11} className="text-brandRed" /> Next phase warning
                    </label>
                    <input
                      value={nextPhase}
                      maxLength={MAX_PHASE_ALERT}
                      placeholder="e.g. Phase 2 starts in 48 hours"
                      onChange={(e) => setNextPhase(e.target.value)}
                      className={input}
                    />
                    <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-600 ml-1 leading-relaxed">
                      Shown large and glowing red on every step of the ticket screen, from the terms
                      to the cart. Leave it empty and nothing appears. {MAX_PHASE_ALERT - nextPhase.length} left.
                    </p>
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {PHASE_ALERT_IDEAS.map((idea) => (
                        <button
                          key={idea}
                          type="button"
                          onClick={() => setNextPhase(idea)}
                          className="text-[9px] font-bold uppercase tracking-widest text-zinc-400 border border-white/10 rounded-lg px-2.5 py-1.5 hover:bg-white hover:text-black transition-all"
                        >
                          {idea}
                        </button>
                      ))}
                      {nextPhase && (
                        <button
                          type="button"
                          onClick={() => setNextPhase('')}
                          className="text-[9px] font-bold uppercase tracking-widest text-brandRed border border-brandRed/30 rounded-lg px-2.5 py-1.5 hover:bg-brandRed hover:text-white transition-all"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    {nextPhase.trim() && (
                      <div className="mt-2 rounded-xl border border-brandRed/30 bg-black/60 px-3 py-3">
                        <p className="text-[8px] font-black uppercase tracking-widest text-zinc-600 mb-1.5">Preview</p>
                        <p className="phase-alert-text text-center font-black uppercase italic tracking-tight leading-tight text-base">
                          {phaseAlert(nextPhase)}
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="space-y-3">
                    <label className="text-[9px] font-black uppercase tracking-widest text-zinc-600 ml-1">When tickets go live</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setScheduled(false)}
                        className={`flex items-center justify-center gap-2 py-3.5 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all ${!scheduled ? 'bg-green-500/15 border-green-500/50 text-green-400' : 'bg-zinc-950 border-white/10 text-zinc-500 hover:border-white/25'}`}
                      >
                        <Radio size={13} /> On sale now
                      </button>
                      <button
                        type="button"
                        onClick={() => setScheduled(true)}
                        className={`flex items-center justify-center gap-2 py-3.5 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all ${scheduled ? 'bg-amber-500/15 border-amber-500/50 text-amber-400' : 'bg-zinc-950 border-white/10 text-zinc-500 hover:border-white/25'}`}
                      >
                        <CalendarClock size={13} /> Schedule later
                      </button>
                    </div>

                    {scheduled && (
                      <div className="space-y-2">
                        <input
                          type="datetime-local"
                          value={when}
                          onChange={(e) => setWhen(e.target.value)}
                          className={`${input} [color-scheme:dark]`}
                        />
                        <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-600 ml-1 leading-relaxed">
                          India time. Until then the event is hidden from the site completely — not
                          listed, and not bookable by anyone with the link.
                        </p>
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={save}
                    disabled={saving}
                    className="w-full py-4 bg-brandRed text-white font-black uppercase tracking-widest rounded-2xl hover:bg-white hover:text-black transition-all shadow-xl active:scale-95 text-[10px] flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    {saving ? <Loader2 className="animate-spin" size={14} /> : <><Check size={14} /> Save</>}
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {events.length === 0 && (
          <p className="text-zinc-500 text-sm italic col-span-full py-6 text-center">No box office events yet.</p>
        )}
      </div>
    </div>
  );
}
