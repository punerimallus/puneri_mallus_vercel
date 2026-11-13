"use client";

// The figures under the hero on the home page.
//
// Deliberately its own small screen rather than a field bolted onto the Hero Sequencer: the
// slider page is already long, and these numbers are the kind of thing somebody updates on its
// own ("we crossed 2,500") without wanting to scroll past six slides to reach it.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, Plus, Save, Trash2, Users } from 'lucide-react';
import { useAlert } from '@/context/AlertContext';
import { logAdminActivity } from '@/app/admin/action';
import {
  MAX_LABEL_LENGTH,
  MAX_STATS,
  MAX_VALUE_LENGTH,
  blankStat,
  communityStats,
  statSpanClass,
  statsGridClass,
  type CommunityStat,
} from '@/lib/ui/community-stats';

const IDEAS: CommunityStat[] = [
  { value: '2,400+', label: 'Mallus in Pune' },
  { value: '40+', label: 'Events hosted' },
  { value: '12', label: 'Active circles' },
];

export default function CommunityStatsAdmin() {
  const [stats, setStats] = useState<CommunityStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { showAlert } = useAlert();

  useEffect(() => {
    fetch('/api/settings/community-stats')
      .then((r) => r.json())
      .then((d) => {
        const saved = communityStats(d?.stats);
        // One empty row to type into when there is nothing yet, rather than an empty screen
        // with only an "add" button on it.
        setStats(saved.length > 0 ? saved : [blankStat()]);
      })
      .catch(() => setStats([blankStat()]))
      .finally(() => setLoading(false));
  }, []);

  const update = (index: number, key: keyof CommunityStat, value: string) =>
    setStats((prev) => prev.map((s, i) => (i === index ? { ...s, [key]: value } : s)));

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings/community-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stats }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { showAlert(data.error || 'Could not save those numbers.', 'error'); return; }
      // Echo back what the server kept, so a half-filled row disappearing is visible here
      // rather than being a surprise on the live page.
      const kept = communityStats(data.stats);
      setStats(kept.length > 0 ? kept : [blankStat()]);
      await logAdminActivity('Community numbers', 'SETTINGS_UPDATE');
      showAlert(kept.length > 0 ? `${kept.length} figure${kept.length === 1 ? '' : 's'} published.` : 'Strip hidden — nothing to show.', 'success');
    } catch {
      showAlert('Network error. Nothing was saved.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const live = communityStats(stats);
  const input = 'w-full bg-black border border-white/10 p-4 rounded-2xl outline-none focus:border-brandRed text-sm font-bold';

  if (loading) {
    return <div className="min-h-screen bg-black flex items-center justify-center"><Loader2 className="animate-spin text-brandRed" size={40} /></div>;
  }

  return (
    <div className="min-h-screen bg-black text-white pt-48 pb-20 px-6 selection:bg-brandRed/30">
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-wrap justify-between items-end gap-6 mb-12">
          <div className="space-y-3">
            <Link href="/admin" className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-white transition-colors">
              <ArrowLeft size={14} /> Back to admin
            </Link>
            <h1 className="text-5xl sm:text-6xl font-black italic uppercase tracking-tighter leading-none">
              Community <span className="text-brandRed">Numbers.</span>
            </h1>
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
              Shown as a strip under the hero on the home page
            </p>
          </div>
          <button
            onClick={save}
            disabled={saving}
            className="bg-brandRed text-white px-10 py-5 rounded-2xl font-black uppercase text-[11px] tracking-widest flex items-center gap-3 hover:scale-105 transition-all shadow-[0_0_30px_rgba(255,0,0,0.3)] disabled:opacity-60"
          >
            {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />} Publish
          </button>
        </div>

        <div className="bg-zinc-950 border border-white/5 p-8 rounded-[40px] mb-10 flex flex-col md:flex-row gap-8 items-center">
          <div className="w-16 h-16 rounded-2xl bg-brandRed/10 flex items-center justify-center shrink-0 border border-brandRed/20">
            <Users className="text-brandRed" size={32} />
          </div>
          <p className="text-[10px] text-zinc-500 font-bold uppercase leading-relaxed tracking-wider">
            Write the number exactly as you want it read — <span className="text-white">2,400+</span> or{' '}
            <span className="text-white">2.4K</span>, whichever suits. A row needs both a number and a
            label to appear. Clear every row and the strip disappears from the home page entirely.
          </p>
        </div>

        <div className="space-y-4">
          {stats.map((stat, idx) => (
            <div key={idx} className="bg-zinc-950 border border-white/5 p-6 rounded-[32px] flex flex-col sm:flex-row gap-4 items-stretch sm:items-end">
              <div className="text-3xl font-black text-brandRed italic shrink-0 w-10 pb-1">0{idx + 1}</div>
              <div className="flex-1 space-y-2">
                <label className="text-[8px] font-black uppercase tracking-widest text-zinc-600 ml-1">Number</label>
                <input
                  value={stat.value}
                  maxLength={MAX_VALUE_LENGTH}
                  placeholder="2,400+"
                  onChange={(e) => update(idx, 'value', e.target.value)}
                  className={input}
                />
              </div>
              <div className="flex-[2] space-y-2">
                <label className="text-[8px] font-black uppercase tracking-widest text-zinc-600 ml-1">Label</label>
                <input
                  value={stat.label}
                  maxLength={MAX_LABEL_LENGTH}
                  placeholder="Mallus in Pune"
                  onChange={(e) => update(idx, 'label', e.target.value)}
                  className={input}
                />
              </div>
              <button
                onClick={() => setStats((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : [blankStat()]))}
                title="Remove this figure"
                className="shrink-0 p-4 text-zinc-700 hover:text-brandRed transition-colors"
              >
                <Trash2 size={18} />
              </button>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-3 mt-6">
          {stats.length < MAX_STATS && (
            <button
              onClick={() => setStats((prev) => [...prev, blankStat()])}
              className="flex items-center gap-2 px-6 py-4 bg-zinc-950 border border-white/10 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-white hover:text-black transition-all"
            >
              <Plus size={14} /> Add figure
            </button>
          )}
          {live.length === 0 && (
            <button
              onClick={() => setStats(IDEAS)}
              className="flex items-center gap-2 px-6 py-4 bg-zinc-950 border border-white/10 rounded-2xl text-[10px] font-black uppercase tracking-widest text-zinc-400 hover:bg-white hover:text-black transition-all"
            >
              Use an example set
            </button>
          )}
        </div>

        {/* The strip as the home page will build it, from the same normalised data. */}
        <div className="mt-12">
          <p className="text-[8px] font-black uppercase tracking-widest text-zinc-600 mb-3 ml-1">
            Live preview {live.length === 0 && <span className="text-brandRed">— nothing will show</span>}
          </p>
          <div className="rounded-[32px] border border-white/10 bg-black overflow-hidden">
            {live.length > 0 ? (
              <div className="border-y border-white/10 bg-gradient-to-r from-brandRed/[0.07] via-transparent to-brandRed/[0.07] py-8 px-6">
                <div className={`grid gap-6 text-center ${statsGridClass(live.length)}`}>
                  {live.map((stat, i) => (
                    <div key={i} className={`min-w-0 ${statSpanClass(live.length, i)}`}>
                      <p className="text-3xl sm:text-4xl font-black italic tracking-tighter text-white leading-none">{stat.value}</p>
                      <p className="mt-2 text-[8px] sm:text-[9px] font-black uppercase tracking-[0.2em] text-zinc-500 break-words">{stat.label}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="py-10 text-center text-[10px] font-bold uppercase tracking-widest text-zinc-700">
                Fill a number and a label to see the strip
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
