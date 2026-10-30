// The 2D venue map: where each ticket category physically sits in the hall.
//
// This is a DISPLAY layer and nothing more. It does not reserve, number or allocate anything —
// a buyer still buys "2 x VIP", exactly as before, and the seat machinery in
// lib/payments/inventory.ts is untouched. The map only answers "where will I be standing?".
//
// Deliberately NOT seat-level: there is no seat identity here, so nobody can be promised chair
// H14. A zone is a painted area of floor; seating inside it is open. The buyer-facing copy in
// VenueMap says so, because a drawn map makes people assume otherwise.
//
// Geometry is stored in GRID CELLS, never pixels, so one definition renders correctly on a
// 360px phone and on a desktop without a second set of numbers.

export type Cell = [number, number];

/** A category's painted area. Any shape: cells need not be contiguous or rectangular. */
export interface Zone {
  cells: Cell[];
  color?: string | null;
}

export type FeatureKind = 'stage' | 'entry' | 'exit' | 'bar' | 'food' | 'washroom' | 'aisle' | 'label';

/** Something in the venue that is not for sale: the stage, the doors, the bar. */
export interface VenueFeature {
  kind: FeatureKind;
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
}

export interface VenueLayout {
  cols: number;
  rows: number;
  features: VenueFeature[];
  /**
   * The venue's own floor plan, drawn underneath the zones.
   *
   * Optional, and only ever a backdrop: the zones a buyer taps are still the painted cells, so
   * a plan that is missing, slow or deleted costs nothing but the picture.
   */
  planUrl?: string | null;
  /** How strongly the plan shows through, 10–100. Low by default so the zones stay legible. */
  planOpacity?: number;
}

export const GRID_MIN = 4;
export const GRID_MAX = 24;
export const DEFAULT_COLS = 12;
export const DEFAULT_ROWS = 16;
/** A painted zone past this is a mistake, not a venue. */
export const MAX_CELLS_PER_ZONE = 480;
export const MAX_FEATURES = 24;
export const DEFAULT_PLAN_OPACITY = 45;
export const MAX_PLAN_URL = 1000;

export const FEATURE_LABELS: Record<FeatureKind, string> = {
  stage: 'STAGE',
  entry: 'ENTRY',
  exit: 'EXIT',
  bar: 'BAR',
  food: 'FOOD',
  washroom: 'WC',
  aisle: 'AISLE',
  label: '',
};

/**
 * Zone colours, in the order they are handed out. Chosen to stay apart from each other and from
 * the sold-out grey, and to read on the site's black background.
 */
export const ZONE_COLORS = [
  '#e11d48', // red, nearest the brand
  '#f59e0b', // amber
  '#10b981', // emerald
  '#3b82f6', // blue
  '#a855f7', // purple
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f97316', // orange
] as const;

export function zoneColor(index: number): string {
  const n = ZONE_COLORS.length;
  return ZONE_COLORS[((index % n) + n) % n];
}

/** A blank map, built the same way a stored one is read, so both shapes are always identical. */
export const emptyLayout = (): VenueLayout => normalizeLayout({});

/**
 * The floor plan's address, or null.
 *
 * Only http(s) survives: the plan is put into an <image> on a public page, so a `javascript:` or
 * `data:` URL arriving from a tampered save must never reach the browser.
 */
export function normalizePlanUrl(raw: unknown): string | null {
  const url = String(raw ?? '').trim();
  if (!url || url.length > MAX_PLAN_URL) return null;
  if (!/^https?:\/\/[^\s]+$/i.test(url)) return null;
  return url;
}

/**
 * Grid proportions that match a floor plan's own, so the plan fills the map instead of sitting
 * in a letterbox. Kept inside the allowed grid range, and the long side is pinned to the usual
 * 16 so a zone never becomes too thin to tap.
 */
export function gridForAspect(width: number, height: number): { cols: number; rows: number } {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return { cols: DEFAULT_COLS, rows: DEFAULT_ROWS };
  }
  const long = DEFAULT_ROWS;
  const clamp = (n: number) => Math.min(GRID_MAX, Math.max(GRID_MIN, Math.round(n)));
  return w >= h
    ? { cols: clamp(long), rows: clamp((h / w) * long) }
    : { cols: clamp((w / h) * long), rows: clamp(long) };
}

function clampInt(value: unknown, lo: number, hi: number, fallback: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

export const cellKey = (x: number, y: number): string => `${x},${y}`;

/** Reads whatever is in the database into a usable layout, never throwing on bad stored data. */
export function normalizeLayout(raw: unknown): VenueLayout {
  const src = (raw || {}) as Partial<VenueLayout>;
  const cols = clampInt(src.cols, GRID_MIN, GRID_MAX, DEFAULT_COLS);
  const rows = clampInt(src.rows, GRID_MIN, GRID_MAX, DEFAULT_ROWS);
  const list = Array.isArray(src.features) ? src.features : [];
  const features: VenueFeature[] = [];
  for (const item of list.slice(0, MAX_FEATURES)) {
    const f = (item || {}) as Partial<VenueFeature>;
    const raw_kind = String(f.kind || '');
    const kind: FeatureKind = raw_kind in FEATURE_LABELS ? (raw_kind as FeatureKind) : 'label';
    const x = clampInt(f.x, 0, cols - 1, 0);
    const y = clampInt(f.y, 0, rows - 1, 0);
    const w = clampInt(f.w, 1, cols - x, 1);
    const h = clampInt(f.h, 1, rows - y, 1);
    const label = String(f.label ?? FEATURE_LABELS[kind] ?? '').slice(0, 24);
    features.push({ kind, x, y, w, h, ...(label ? { label } : {}) });
  }
  // Database rows arrive snake_cased and the editor hands back camelCase; accept either so a
  // layout can be read straight out of Supabase without a mapping step in between.
  const row = (raw || {}) as Record<string, unknown>;
  return {
    cols,
    rows,
    features,
    planUrl: normalizePlanUrl(src.planUrl ?? row.plan_url),
    planOpacity: clampInt(src.planOpacity ?? row.plan_opacity, 10, 100, DEFAULT_PLAN_OPACITY),
  };
}

/** Reads a stored zone: drops cells off the grid, drops duplicates, keeps a stable order. */
export function normalizeZone(raw: unknown, cols: number, rows: number): Zone | null {
  const src = (raw || {}) as Partial<Zone>;
  const list = Array.isArray(src.cells) ? src.cells : [];
  const seen = new Set<string>();
  const cells: Cell[] = [];
  for (const item of list) {
    if (!Array.isArray(item) || item.length < 2) continue;
    const x = Math.floor(Number(item[0]));
    const y = Math.floor(Number(item[1]));
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
    const key = cellKey(x, y);
    if (seen.has(key)) continue;
    seen.add(key);
    cells.push([x, y]);
    if (cells.length >= MAX_CELLS_PER_ZONE) break;
  }
  if (!cells.length) return null;
  cells.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const color = typeof src.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(src.color) ? src.color : null;
  return { cells, ...(color ? { color } : {}) };
}

/**
 * Merges a zone's cells into one rectangle per horizontal run.
 *
 * Painted cells drawn one by one look like confetti; merged per row they read as rows of
 * seating, which is what a venue plan is meant to look like. It also keeps the SVG small.
 */
export function rowRuns(cells: Cell[]): { x: number; y: number; w: number }[] {
  const byRow = new Map<number, number[]>();
  for (const [x, y] of cells) {
    const row = byRow.get(y) || [];
    row.push(x);
    byRow.set(y, row);
  }
  const runs: { x: number; y: number; w: number }[] = [];
  for (const y of [...byRow.keys()].sort((a, b) => a - b)) {
    const xs = [...new Set(byRow.get(y) as number[])].sort((a, b) => a - b);
    let start = xs[0];
    let prev = xs[0];
    for (let i = 1; i <= xs.length; i++) {
      const cur = xs[i];
      if (cur === prev + 1) { prev = cur; continue; }
      runs.push({ x: start, y, w: prev - start + 1 });
      start = cur;
      prev = cur;
    }
  }
  return runs;
}

export function boundsOf(cells: Cell[]): { x: number; y: number; w: number; h: number } {
  if (!cells.length) return { x: 0, y: 0, w: 0, h: 0 };
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const [x, y] of cells) {
    if (x < x1) x1 = x;
    if (y < y1) y1 = y;
    if (x > x2) x2 = x;
    if (y > y2) y2 = y;
  }
  return { x: x1, y: y1, w: x2 - x1 + 1, h: y2 - y1 + 1 };
}

/**
 * Where to print the zone's name. The bounding-box centre is right for any normal shape, but on
 * an L the centre can land on bare floor; then the widest run is used so the label sits on paint.
 */
export function labelPoint(cells: Cell[]): { x: number; y: number } {
  const b = boundsOf(cells);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const owned = new Set(cells.map(([x, y]) => cellKey(x, y)));
  if (owned.has(cellKey(Math.floor(cx), Math.floor(cy)))) return { x: cx, y: cy };
  const runs = rowRuns(cells);
  const widest = runs.reduce((best, r) => (r.w > best.w ? r : best), runs[0]);
  return { x: widest.x + widest.w / 2, y: widest.y + 0.5 };
}

export interface ZoneCategory {
  id: string;
  name?: string;
  price?: number;
  capacity?: number | null;
  sold?: number | null;
  released?: number | null;
  group_size?: number | null;
}

export type ZoneState = 'available' | 'filling' | 'sold-out';

/** How a zone should be shaded, on the same thresholds the category list already uses. */
export function zoneState(left: number | null): ZoneState {
  if (left === null) return 'available';
  if (left <= 0) return 'sold-out';
  if (left <= 10) return 'filling';
  return 'available';
}

// ---------------------------------------------------------------------------
// Presets
//
// Most events never need to draw anything: pick the shape of the room and the categories are
// placed dearest-nearest-the-stage, which is how venues are actually sold. The painter exists
// for the ones that do.
// ---------------------------------------------------------------------------

export interface PresetResult {
  layout: VenueLayout;
  zones: Record<string, Zone>;
}

function fill(x1: number, y1: number, w: number, h: number): Cell[] {
  const cells: Cell[] = [];
  for (let y = y1; y < y1 + h; y++) for (let x = x1; x < x1 + w; x++) cells.push([x, y]);
  return cells;
}

/** Dearest first: the front of the room belongs to the most expensive pass. */
function byPriceDesc(cats: ZoneCategory[]): ZoneCategory[] {
  return [...cats].sort(
    (a, b) => (Number(b.price) || 0) - (Number(a.price) || 0) || String(a.id).localeCompare(String(b.id)),
  );
}

/**
 * Splits `total` rows between categories in proportion to how many people each holds, with at
 * least one row each. A 500-capacity general area should look bigger than a 20-seat VIP block.
 */
export function shareRows(cats: ZoneCategory[], total: number): number[] {
  const n = cats.length;
  if (n === 0) return [];
  if (total <= n) return cats.map(() => 1);
  const weights = cats.map((c) => Math.max(1, Number(c.capacity) || 1) * Math.max(1, Number(c.group_size) || 1));
  const sum = weights.reduce((a, b) => a + b, 0);
  const spare = total - n;
  const extra = weights.map((w) => Math.floor((w / sum) * spare));
  let used = extra.reduce((a, b) => a + b, 0);
  // Hand the rounding remainder to the biggest zones first.
  const order = weights.map((w, i) => [w, i] as const).sort((a, b) => b[0] - a[0]);
  for (let i = 0; used < spare; i++, used++) extra[order[i % n][1]] += 1;
  return extra.map((e) => e + 1);
}

/** Stage across the top, zones in full-width bands behind it, doors at the back. */
function hallPreset(cats: ZoneCategory[], cols: number, rows: number): PresetResult {
  const stageH = Math.max(1, Math.round(rows * 0.12));
  const features: VenueFeature[] = [
    { kind: 'stage', x: 0, y: 0, w: cols, h: stageH, label: 'STAGE' },
    { kind: 'entry', x: Math.max(0, Math.floor(cols / 2) - 1), y: rows - 1, w: Math.min(2, cols), h: 1, label: 'ENTRY' },
  ];
  const top = stageH + 1;
  const space = Math.max(1, rows - 1 - top);
  const ordered = byPriceDesc(cats);
  const heights = shareRows(ordered, space);
  const zones: Record<string, Zone> = {};
  let y = top;
  ordered.forEach((cat, i) => {
    const h = Math.min(heights[i], Math.max(0, rows - 1 - y));
    if (h > 0) zones[cat.id] = { cells: fill(0, y, cols, h), color: zoneColor(i) };
    y += h;
  });
  return { layout: { cols, rows, features }, zones };
}

/** An open ground: the dearest pass is a narrow pen at the barrier, each tier behind it wider. */
function groundPreset(cats: ZoneCategory[], cols: number, rows: number): PresetResult {
  const stageH = Math.max(1, Math.round(rows * 0.12));
  const features: VenueFeature[] = [
    { kind: 'stage', x: 0, y: 0, w: cols, h: stageH, label: 'STAGE' },
    { kind: 'entry', x: 0, y: rows - 1, w: Math.min(2, cols), h: 1, label: 'ENTRY' },
    { kind: 'exit', x: Math.max(0, cols - 2), y: rows - 1, w: Math.min(2, cols), h: 1, label: 'EXIT' },
  ];
  const top = stageH + 1;
  const space = Math.max(1, rows - 1 - top);
  const ordered = byPriceDesc(cats);
  const heights = shareRows(ordered, space);
  const zones: Record<string, Zone> = {};
  const n = ordered.length;
  let y = top;
  ordered.forEach((cat, i) => {
    const h = Math.min(heights[i], Math.max(0, rows - 1 - y));
    // Narrowest at the front, full width by the last tier.
    const width = n <= 1 ? cols : Math.max(2, Math.round(cols * (0.5 + (0.5 * i) / (n - 1))));
    const x = Math.floor((cols - width) / 2);
    if (h > 0) zones[cat.id] = { cells: fill(x, y, width, h), color: zoneColor(i) };
    y += h;
  });
  return { layout: { cols, rows, features }, zones };
}

/** A banquet room: tables down both sides, the middle left clear as a dance floor. */
function banquetPreset(cats: ZoneCategory[], cols: number, rows: number): PresetResult {
  const stageH = Math.max(1, Math.round(rows * 0.12));
  const aisle = Math.max(2, Math.round(cols * 0.25));
  const side = Math.max(1, Math.floor((cols - aisle) / 2));
  const top = stageH + 1;
  const features: VenueFeature[] = [
    { kind: 'stage', x: 0, y: 0, w: cols, h: stageH, label: 'STAGE' },
    { kind: 'aisle', x: side, y: top, w: cols - side * 2, h: Math.max(1, rows - 1 - top), label: 'DANCE FLOOR' },
    { kind: 'entry', x: Math.max(0, Math.floor(cols / 2) - 1), y: rows - 1, w: Math.min(2, cols), h: 1, label: 'ENTRY' },
  ];
  const space = Math.max(1, rows - 1 - top);
  const ordered = byPriceDesc(cats);
  // Alternate down the two sides so the dearest pair flanks the stage.
  const left = ordered.filter((_, i) => i % 2 === 0);
  const right = ordered.filter((_, i) => i % 2 === 1);
  const zones: Record<string, Zone> = {};
  const place = (group: ZoneCategory[], x: number) => {
    const heights = shareRows(group, space);
    let y = top;
    group.forEach((cat, i) => {
      const h = Math.min(heights[i], Math.max(0, rows - 1 - y));
      const at = ordered.findIndex((c) => c.id === cat.id);
      if (h > 0) zones[cat.id] = { cells: fill(x, y, side, h), color: zoneColor(at) };
      y += h;
    });
  };
  place(left, 0);
  place(right, cols - side);
  return { layout: { cols, rows, features }, zones };
}

export interface LayoutPreset {
  id: string;
  name: string;
  description: string;
  build(cats: ZoneCategory[], cols?: number, rows?: number): PresetResult;
}

export const LAYOUT_PRESETS: LayoutPreset[] = [
  {
    id: 'hall',
    name: 'Hall — stage in front',
    description: 'Stage across the front, zones in bands behind it. Dearest pass nearest the stage.',
    build: (cats, cols = DEFAULT_COLS, rows = DEFAULT_ROWS) => hallPreset(cats, cols, rows),
  },
  {
    id: 'ground',
    name: 'Open ground',
    description: 'A narrow pen at the barrier for the top pass, each tier behind it wider.',
    build: (cats, cols = DEFAULT_COLS, rows = DEFAULT_ROWS) => groundPreset(cats, cols, rows),
  },
  {
    id: 'banquet',
    name: 'Banquet — dance floor',
    description: 'Seating down both sides with the middle of the room left clear.',
    build: (cats, cols = DEFAULT_COLS, rows = DEFAULT_ROWS) => banquetPreset(cats, cols, rows),
  },
];

export const presetById = (id: string): LayoutPreset | undefined => LAYOUT_PRESETS.find((p) => p.id === id);

// ---------------------------------------------------------------------------
// Validation, run before anything is saved
// ---------------------------------------------------------------------------

export type LayoutCheck =
  | { ok: true; layout: VenueLayout; zones: Record<string, Zone> }
  | { ok: false; error: string };

/**
 * A zone may not share a cell with another zone: two categories standing on the same square foot
 * is the one mistake a map can make that misleads a buyer about what they bought.
 */
export function checkLayout(rawLayout: unknown, rawZones: unknown, knownIds: string[]): LayoutCheck {
  const layout = normalizeLayout(rawLayout);
  if (rawZones !== null && rawZones !== undefined && (typeof rawZones !== 'object' || Array.isArray(rawZones))) {
    return { ok: false, error: 'The map is not in a readable shape.' };
  }
  const src = (rawZones || {}) as Record<string, unknown>;

  const allowed = new Set(knownIds.map(String));
  const zones: Record<string, Zone> = {};
  const owner = new Map<string, string>();

  for (const [id, raw] of Object.entries(src)) {
    if (!allowed.has(String(id))) continue; // a category deleted in the same save
    const zone = normalizeZone(raw, layout.cols, layout.rows);
    if (!zone) continue;
    for (const [x, y] of zone.cells) {
      const key = cellKey(x, y);
      const taken = owner.get(key);
      if (taken && taken !== id) {
        return { ok: false, error: 'Two zones overlap on the map. Each area can belong to only one category.' };
      }
      owner.set(key, id);
    }
    zones[id] = zone;
  }
  return { ok: true, layout, zones };
}

/** True when at least one category has been placed, i.e. there is a map worth showing a buyer. */
export const hasMap = (zones: Record<string, Zone | null | undefined>): boolean =>
  Object.values(zones).some((z) => !!z && z.cells.length > 0);
