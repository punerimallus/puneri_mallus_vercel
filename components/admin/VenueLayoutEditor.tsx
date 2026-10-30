"use client";

// The admin side of the 2D venue map.
//
// Three things, in the order an admin needs them:
//   1. a preset, which places every category automatically — most events never go past this;
//   2. a painter, for the rooms that are not a neat set of bands;
//   3. a preview that is the REAL buyer component, so what is approved here is what ships.
//
// It only moves shapes about. Prices, capacities and ticket numbers belong to TicketConfig and
// are never touched from here.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { Loader2, Save, Eraser, Map as MapIcon, Trash2, Plus, Wand2, SlidersHorizontal, Upload, X } from 'lucide-react';
import { useAlert } from '@/context/AlertContext';
import { seatsLeft } from '@/lib/payments/seats';
import { groupSizeOf } from '@/lib/payments/groups';
import VenueMap, { type MapZone } from '@/components/VenueMap';
import {
  DEFAULT_COLS,
  DEFAULT_PLAN_OPACITY,
  DEFAULT_ROWS,
  FEATURE_LABELS,
  GRID_MAX,
  GRID_MIN,
  LAYOUT_PRESETS,
  cellKey,
  emptyLayout,
  gridForAspect,
  normalizeLayout,
  normalizeZone,
  zoneColor,
  type FeatureKind,
  type VenueFeature,
  type VenueLayout,
  type Zone,
} from '@/lib/events/venue-layout';

interface Cat {
  id: string;
  name: string;
  price: number;
  capacity: number | null;
  sold: number | null;
  released: number | null;
  group_size: number | null;
  zone: unknown;
}

const FEATURE_KINDS: FeatureKind[] = ['stage', 'entry', 'exit', 'bar', 'food', 'washroom', 'aisle', 'label'];

export default function VenueLayoutEditor({ eventId, eventTitle }: { eventId: string; eventTitle: string }) {
  const [cats, setCats] = useState<Cat[]>([]);
  const [layout, setLayout] = useState<VenueLayout>(emptyLayout());
  const [zones, setZones] = useState<Record<string, Zone>>({});
  const [tool, setTool] = useState<string | null>(null);
  const [preset, setPreset] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [planUploading, setPlanUploading] = useState(false);
  const painting = useRef(false);
  const { showAlert } = useAlert();

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    async function load() {
      // Price ascending, the same order the booking page reads them in, so the colour a
      // category gets here is the colour it gets there.
      const { data: catData } = await supabase
        .from('event_ticket_categories')
        .select('*')
        .eq('event_id', eventId)
        .eq('active', true)
        .order('price', { ascending: true });

      const list = (catData || []) as Cat[];
      setCats(list);

      const { data: layoutRow } = await supabase
        .from('event_venue_layouts')
        .select('cols, rows, features, preset, plan_url, plan_opacity')
        .eq('event_id', eventId)
        .maybeSingle();

      const l = layoutRow ? normalizeLayout(layoutRow) : emptyLayout();
      setLayout(l);
      setPreset((layoutRow as { preset?: string } | null)?.preset || null);

      const existing: Record<string, Zone> = {};
      list.forEach((c) => {
        const z = normalizeZone(c.zone, l.cols, l.rows);
        if (z) existing[c.id] = z;
      });
      setZones(existing);
      setTool(list[0]?.id ?? null);
      setLoading(false);
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const colorFor = (id: string): string => {
    const stored = zones[id]?.color;
    if (stored) return stored;
    return zoneColor(cats.findIndex((c) => c.id === id));
  };

  /** Which category owns each cell, so the grid can paint itself in one pass. */
  const ownerByCell = useMemo(() => {
    const map = new Map<string, string>();
    for (const [id, zone] of Object.entries(zones)) {
      for (const [x, y] of zone.cells) map.set(cellKey(x, y), id);
    }
    return map;
  }, [zones]);

  const paintCell = (x: number, y: number) => {
    if (!tool) return;
    if (x < 0 || y < 0 || x >= layout.cols || y >= layout.rows) return;
    const key = cellKey(x, y);
    setZones((prev) => {
      const next: Record<string, Zone> = {};
      // A cell can only belong to one category, so painting takes it off whoever had it.
      for (const [id, zone] of Object.entries(prev)) {
        const kept = zone.cells.filter(([cx, cy]) => cellKey(cx, cy) !== key);
        if (kept.length) next[id] = { ...zone, cells: kept };
      }
      if (tool !== 'erase') {
        const mine = next[tool] || { cells: [], color: colorFor(tool) };
        next[tool] = { ...mine, color: mine.color || colorFor(tool), cells: [...mine.cells, [x, y]] };
      }
      return next;
    });
  };

  /**
   * Drag-painting that works with a finger as well as a mouse.
   *
   * On touch, pointerenter does not fire for the elements you drag ACROSS — only the one you
   * started on — so the cell under the pointer is looked up by position instead.
   */
  const onPointerMove = (e: React.PointerEvent) => {
    if (!painting.current) return;
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const data = el?.dataset?.cell;
    if (!data) return;
    const [x, y] = data.split(',').map(Number);
    if (Number.isFinite(x) && Number.isFinite(y)) paintCell(x, y);
  };

  const applyPreset = (id: string) => {
    const p = LAYOUT_PRESETS.find((x) => x.id === id);
    if (!p) return;
    if (!cats.length) { showAlert('Add and save your ticket categories first, then place them on the map.', 'info'); return; }
    const result = p.build(cats, layout.cols, layout.rows);
    // A preset rearranges the zones; it must not throw away an uploaded floor plan.
    setLayout({ ...result.layout, planUrl: layout.planUrl, planOpacity: layout.planOpacity });
    setZones(result.zones);
    setPreset(id);
    showAlert(`"${p.name}" applied. Repaint anything you want to move, then save.`, 'success');
  };

  /**
   * Uploads the hall's own floor plan and fits the grid to its shape.
   *
   * Images only: the plan is drawn into an SVG <image>, which cannot render a PDF. A plan that
   * arrives as a PDF has to be exported to PNG or JPG first, and the message below says so.
   *
   * The grid is then reshaped to the picture's proportions, so a wide hall gets a wide grid and
   * the plan fills the map rather than sitting in a letterbox with unusable cells either side.
   */
  const handlePlanUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showAlert('Please upload an image (PNG or JPG). If the venue sent a PDF, export it as an image first.', 'error');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      showAlert('That plan is over 8 MB. Please upload a smaller image.', 'error');
      return;
    }
    setPlanUploading(true);
    try {
      const path = `venues/plan-${eventId}-${Date.now()}`;
      const { error: uploadError } = await supabase.storage.from('events').upload(path, file);
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from('events').getPublicUrl(path);
      const url = data.publicUrl;

      // Read the picture's real proportions before shaping the grid to them.
      const fitted = await new Promise<{ cols: number; rows: number } | null>((resolve) => {
        const img = new window.Image();
        img.onload = () => resolve(gridForAspect(img.naturalWidth, img.naturalHeight));
        img.onerror = () => resolve(null);
        img.src = url;
      });

      setLayout((prev) => {
        const next = { ...prev, planUrl: url, planOpacity: prev.planOpacity ?? DEFAULT_PLAN_OPACITY, ...(fitted || {}) };
        return normalizeLayout(next);
      });
      if (fitted) {
        setZones((zs) => {
          const out: Record<string, Zone> = {};
          for (const [id, z] of Object.entries(zs)) {
            const kept = normalizeZone(z, fitted.cols, fitted.rows);
            if (kept) out[id] = kept;
          }
          return out;
        });
      }
      showAlert('Floor plan uploaded. Paint your zones over it, then save.', 'success');
    } catch {
      showAlert('Could not upload the floor plan. Please try again.', 'error');
    } finally {
      setPlanUploading(false);
      e.target.value = '';
    }
  };

  const removePlan = () => setLayout((prev) => ({ ...prev, planUrl: null }));

  const resize = (patch: Partial<Pick<VenueLayout, 'cols' | 'rows'>>) => {
    setLayout((prev) => {
      const next = normalizeLayout({ ...prev, ...patch });
      // Shrinking the grid drops whatever fell off it, rather than saving cells nobody can see.
      setZones((zs) => {
        const out: Record<string, Zone> = {};
        for (const [id, z] of Object.entries(zs)) {
          const kept = normalizeZone(z, next.cols, next.rows);
          if (kept) out[id] = kept;
        }
        return out;
      });
      return next;
    });
  };

  const updateFeature = (i: number, patch: Partial<VenueFeature>) =>
    setLayout((prev) => ({ ...prev, features: prev.features.map((f, j) => (j === i ? { ...f, ...patch } : f)) }));

  const addFeature = () =>
    setLayout((prev) => ({ ...prev, features: [...prev.features, { kind: 'label', x: 0, y: 0, w: 2, h: 1, label: '' }] }));

  const removeFeature = (i: number) =>
    setLayout((prev) => ({ ...prev, features: prev.features.filter((_, j) => j !== i) }));

  const save = async () => {
    const unsaved = cats.filter((c) => !c.id);
    if (unsaved.length) { showAlert('Save your ticket categories first.', 'error'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/admin/tickets/layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, layout, zones, preset }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { showAlert(data.error || 'Could not save the venue map.', 'error'); return; }
      showAlert(`Venue map saved. ${data.placed} of ${data.total} categories are on the plan.`, 'success');
    } catch {
      showAlert('Network error. Please try again.', 'error');
    } finally {
      setSaving(false);
    }
  };

  /** The preview is fed exactly what a buyer would get, so nothing can look different live. */
  const previewZones: MapZone[] = cats
    .map((c) => {
      const z = zones[c.id];
      if (!z?.cells.length) return null;
      return {
        id: c.id,
        name: c.name,
        price: Number(c.price) || 0,
        cells: z.cells,
        color: colorFor(c.id),
        left: seatsLeft(c),
        qty: 0,
        admits: groupSizeOf(c.group_size),
      } as MapZone;
    })
    .filter((z): z is MapZone => !!z);

  if (loading) return <Loader2 className="animate-spin text-brandRed mx-auto my-10" />;

  const placedCount = Object.values(zones).filter((z) => z.cells.length).length;
  const input = 'w-full bg-zinc-950 border border-white/10 p-2 rounded-lg text-xs font-bold outline-none focus:border-brandRed text-white';
  const lab = 'text-[9px] font-black uppercase tracking-widest text-zinc-600';

  return (
    <div className="space-y-8">
      <div className="space-y-2 border-b border-white/5 pb-6">
        <h3 className="text-3xl font-black uppercase italic tracking-tighter text-white flex items-center gap-3">
          <MapIcon className="text-brandRed" size={28} /> Venue Map
        </h3>
        <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Event: {eventTitle}</p>
        <p className="text-[11px] text-zinc-500 leading-relaxed max-w-2xl">
          Show buyers where each pass sits in the room. This is presentation only — it does not change prices,
          capacity or ticket numbers, and buyers are never promised a specific seat.
        </p>
      </div>

      {!cats.length ? (
        <p className="text-zinc-500 text-sm text-center py-10">
          No ticket categories yet. Add and save them under Configure Tickets, then come back to place them.
        </p>
      ) : (
        <>
          {/* 1. Presets ------------------------------------------------------------------- */}
          <div className="space-y-3">
            <p className={lab}>Start from a room shape</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {LAYOUT_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyPreset(p.id)}
                  className={`text-left p-4 rounded-2xl border transition-all active:scale-95 ${preset === p.id ? 'border-brandRed bg-brandRed/10' : 'border-white/10 bg-black/40 hover:border-white/30'}`}
                >
                  <span className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-white">
                    <Wand2 size={13} className="text-brandRed shrink-0" /> {p.name}
                  </span>
                  <span className="block mt-2 text-[10px] leading-relaxed text-zinc-500">{p.description}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 2. The hall's own floor plan ------------------------------------------------- */}
          <div className="space-y-3">
            <p className={lab}>Or trace the hall&apos;s own floor plan</p>
            <div className="p-4 rounded-2xl border border-white/10 bg-black/40 space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <label className={`flex items-center gap-2 px-4 py-3 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer ${planUploading ? 'opacity-60' : 'hover:border-brandRed hover:bg-brandRed/10'} border-white/20 bg-black/60 text-white`}>
                  {planUploading ? <Loader2 className="animate-spin" size={14} /> : <Upload size={14} className="text-brandRed" />}
                  {layout.planUrl ? 'Replace plan' : 'Upload floor plan'}
                  <input type="file" accept="image/*" className="hidden" onChange={handlePlanUpload} disabled={planUploading} />
                </label>

                {layout.planUrl && (
                  <button type="button" onClick={removePlan}
                    className="flex items-center gap-2 px-4 py-3 rounded-xl border border-white/10 bg-black/60 text-zinc-400 hover:text-white hover:border-brandRed text-[10px] font-black uppercase tracking-widest transition-all">
                    <X size={14} /> Remove
                  </button>
                )}
              </div>

              {layout.planUrl ? (
                <div className="space-y-2">
                  <label className={lab}>How strongly it shows through — {layout.planOpacity ?? DEFAULT_PLAN_OPACITY}%</label>
                  <input
                    type="range" min={10} max={100} step={5}
                    value={layout.planOpacity ?? DEFAULT_PLAN_OPACITY}
                    onChange={(e) => setLayout((prev) => ({ ...prev, planOpacity: Number(e.target.value) }))}
                    className="w-full accent-brandRed"
                  />
                  <p className="text-[10px] text-zinc-500 leading-relaxed">
                    Keep it low enough that your zone colours and labels stay readable. The grid was reshaped to
                    the plan&apos;s proportions so it fills the map.
                  </p>
                </div>
              ) : (
                <p className="text-[10px] text-zinc-500 leading-relaxed">
                  Optional. PNG or JPG — if the venue sent a PDF, export a page as an image first. The plan is a
                  backdrop you paint zones over; buyers always tap the zones, never the picture.
                </p>
              )}
            </div>
          </div>

          {/* 3. Painter ------------------------------------------------------------------- */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className={lab}>Paint the zones</p>
              <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-600">
                {placedCount} of {cats.length} placed
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {cats.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setTool(c.id)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all ${tool === c.id ? 'border-white bg-white/10 text-white' : 'border-white/10 bg-black/40 text-zinc-400 hover:border-white/30'}`}
                >
                  <span className="w-3 h-3 rounded-[3px] shrink-0" style={{ background: colorFor(c.id) }} />
                  {c.name}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setTool('erase')}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all ${tool === 'erase' ? 'border-brandRed bg-brandRed/10 text-white' : 'border-white/10 bg-black/40 text-zinc-400 hover:border-white/30'}`}
              >
                <Eraser size={13} /> Erase
              </button>
            </div>

            {/* touchAction none so dragging paints instead of scrolling the page. */}
            <div
              className="mx-auto w-full max-w-[420px] rounded-2xl border border-white/10 bg-black p-2"
              style={{ touchAction: 'none' }}
              onPointerDown={() => { painting.current = true; }}
              onPointerUp={() => { painting.current = false; }}
              onPointerLeave={() => { painting.current = false; }}
              onPointerMove={onPointerMove}
            >
              {/* The plan sits behind the grid with object-contain, which is the same fit the
                  buyer's SVG uses, and the grid has no gaps — so a cell painted here covers
                  exactly the part of the hall it covers there. */}
              <div className="relative">
                {layout.planUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={layout.planUrl}
                    alt=""
                    aria-hidden="true"
                    className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                    style={{ opacity: (layout.planOpacity ?? DEFAULT_PLAN_OPACITY) / 100 }}
                  />
                )}
                <div className="relative grid" style={{ gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))` }}>
                  {Array.from({ length: layout.cols * layout.rows }, (_, i) => {
                    const x = i % layout.cols;
                    const y = Math.floor(i / layout.cols);
                    const ownerId = ownerByCell.get(cellKey(x, y));
                    const feature = layout.features.find((f) => x >= f.x && x < f.x + f.w && y >= f.y && y < f.y + f.h);
                    const bare = layout.planUrl ? 'transparent' : 'rgba(255,255,255,0.03)';
                    return (
                      <button
                        key={i}
                        type="button"
                        data-cell={`${x},${y}`}
                        aria-label={`Cell ${x + 1}, ${y + 1}`}
                        onPointerDown={() => { painting.current = true; paintCell(x, y); }}
                        className="aspect-square border border-white/5 transition-colors"
                        style={{
                          background: ownerId
                            ? colorFor(ownerId)
                            : feature
                              ? 'rgba(255,255,255,0.14)'
                              : bare,
                          // Painted cells go translucent over a plan so the admin can still see
                          // the doors and pillars they are painting around.
                          opacity: ownerId && layout.planUrl ? 0.72 : 1,
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
            <p className="text-center text-[9px] font-bold uppercase tracking-widest text-zinc-600">
              Pick a category above, then tap or drag across the grid. Grey cells are the stage and doors.
            </p>
          </div>

          {/* 4. Grid size and the room's fixtures ----------------------------------------- */}
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => setAdvanced((v) => !v)}
              className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-zinc-400 hover:text-white"
            >
              <SlidersHorizontal size={13} /> Grid size, stage &amp; doors {advanced ? '▴' : '▾'}
            </button>

            {advanced && (
              <div className="space-y-4 p-4 rounded-2xl border border-white/10 bg-black/40">
                <div className="grid grid-cols-2 gap-4 max-w-xs">
                  <div className="space-y-1">
                    <label className={lab}>Columns</label>
                    <input type="number" min={GRID_MIN} max={GRID_MAX} value={layout.cols}
                      onChange={(e) => resize({ cols: Number(e.target.value) || DEFAULT_COLS })} className={input} />
                  </div>
                  <div className="space-y-1">
                    <label className={lab}>Rows</label>
                    <input type="number" min={GRID_MIN} max={GRID_MAX} value={layout.rows}
                      onChange={(e) => resize({ rows: Number(e.target.value) || DEFAULT_ROWS })} className={input} />
                  </div>
                </div>

                <div className="space-y-2">
                  <p className={lab}>Fixtures</p>
                  {layout.features.map((f, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-4 sm:col-span-3 space-y-1">
                        <label className={lab}>Type</label>
                        <select value={f.kind} onChange={(e) => {
                          const kind = e.target.value as FeatureKind;
                          updateFeature(i, { kind, label: FEATURE_LABELS[kind] || f.label || '' });
                        }} className={input}>
                          {FEATURE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                        </select>
                      </div>
                      <div className="col-span-8 sm:col-span-3 space-y-1">
                        <label className={lab}>Label</label>
                        <input value={f.label || ''} onChange={(e) => updateFeature(i, { label: e.target.value })} className={input} />
                      </div>
                      {(['x', 'y', 'w', 'h'] as const).map((k) => (
                        <div key={k} className="col-span-3 sm:col-span-1 space-y-1">
                          <label className={lab}>{k}</label>
                          <input type="number" min={k === 'w' || k === 'h' ? 1 : 0} value={f[k]}
                            onChange={(e) => updateFeature(i, { [k]: Number(e.target.value) || 0 } as Partial<VenueFeature>)} className={input} />
                        </div>
                      ))}
                      <div className="col-span-12 sm:col-span-2 flex sm:justify-end">
                        <button type="button" onClick={() => removeFeature(i)} aria-label="Remove fixture"
                          className="w-9 h-9 bg-white/5 hover:bg-brandRed rounded-lg flex items-center justify-center text-zinc-400 hover:text-white transition-all">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                  <button type="button" onClick={addFeature}
                    className="w-full py-3 border border-dashed border-white/20 rounded-xl flex items-center justify-center gap-2 text-zinc-400 hover:text-white hover:border-brandRed transition-all text-[10px] font-black uppercase tracking-widest">
                    <Plus size={14} /> Add fixture
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 5. Preview — the buyer's own component, not a lookalike ---------------------- */}
          <div className="space-y-3 pt-4 border-t border-white/5">
            <p className={lab}>Exactly what the buyer sees</p>
            {previewZones.length ? (
              <VenueMap layout={layout} zones={previewZones} />
            ) : (
              <p className="text-zinc-500 text-xs text-center py-8">
                Nothing placed yet. Pick a room shape above, or paint the grid.
              </p>
            )}
          </div>

          <div className="pt-4 border-t border-white/5">
            <button type="button" onClick={save} disabled={saving}
              className="w-full py-4 bg-brandRed text-white font-black uppercase tracking-widest rounded-2xl hover:bg-white hover:text-black transition-all shadow-xl active:scale-95 text-xs flex items-center justify-center gap-2 disabled:opacity-60">
              {saving ? <Loader2 className="animate-spin" size={16} /> : <><Save size={16} /> Save Venue Map</>}
            </button>
            <p className="mt-3 text-center text-[9px] font-bold uppercase tracking-widest text-zinc-600">
              Leave every zone empty to turn the map off — the pass list alone still sells.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
