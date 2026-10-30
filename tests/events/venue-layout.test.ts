import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COLS,
  DEFAULT_PLAN_OPACITY,
  DEFAULT_ROWS,
  GRID_MAX,
  GRID_MIN,
  MAX_CELLS_PER_ZONE,
  MAX_PLAN_URL,
  gridForAspect,
  normalizePlanUrl,
  boundsOf,
  cellKey,
  checkLayout,
  emptyLayout,
  hasMap,
  labelPoint,
  LAYOUT_PRESETS,
  normalizeLayout,
  normalizeZone,
  presetById,
  rowRuns,
  shareRows,
  zoneColor,
  zoneState,
  type Cell,
  type ZoneCategory,
} from '@/lib/events/venue-layout';

const cat = (id: string, price: number, capacity = 100, group_size = 1): ZoneCategory =>
  ({ id, name: id.toUpperCase(), price, capacity, group_size });

describe('normalizeLayout', () => {
  it('fills in a sane grid when nothing is stored', () => {
    const blank = { cols: DEFAULT_COLS, rows: DEFAULT_ROWS, features: [], planUrl: null, planOpacity: DEFAULT_PLAN_OPACITY };
    expect(normalizeLayout(null)).toEqual(blank);
    expect(normalizeLayout({})).toEqual(blank);
    // emptyLayout is the same thing, so a never-saved map and a blank saved one behave alike.
    expect(emptyLayout()).toEqual(blank);
  });

  it('clamps a grid size nobody could render', () => {
    expect(normalizeLayout({ cols: 999, rows: -4 }).cols).toBe(GRID_MAX);
    expect(normalizeLayout({ cols: 999, rows: -4 }).rows).toBe(4);
    expect(normalizeLayout({ cols: 'wide' }).cols).toBe(DEFAULT_COLS);
  });

  it('keeps a fixture inside the grid instead of letting it hang off the edge', () => {
    const l = normalizeLayout({ cols: 10, rows: 10, features: [{ kind: 'stage', x: 8, y: 0, w: 50, h: 2 }] });
    expect(l.features[0]).toMatchObject({ x: 8, w: 2 }); // 8 + 2 = the right edge, not 58
  });

  it('turns an unrecognised fixture kind into a plain label rather than dropping it', () => {
    expect(normalizeLayout({ features: [{ kind: 'helipad', x: 0, y: 0, w: 1, h: 1 }] }).features[0].kind).toBe('label');
  });

  it('ignores junk where the fixture list should be', () => {
    expect(normalizeLayout({ features: 'none' }).features).toEqual([]);
  });
});

describe('normalizeZone', () => {
  it('drops cells that fall outside the grid', () => {
    const z = normalizeZone({ cells: [[0, 0], [11, 15], [12, 0], [0, 16], [-1, 2]] }, 12, 16);
    expect(z?.cells).toEqual([[0, 0], [11, 15]]);
  });

  it('drops duplicates and sorts top-left first, so stored maps compare equal', () => {
    const z = normalizeZone({ cells: [[3, 1], [0, 0], [3, 1], [1, 0]] }, 12, 16);
    expect(z?.cells).toEqual([[0, 0], [1, 0], [3, 1]]);
  });

  it('is null when nothing survives, which is how "not placed" is stored', () => {
    expect(normalizeZone(null, 12, 16)).toBeNull();
    expect(normalizeZone({ cells: [] }, 12, 16)).toBeNull();
    expect(normalizeZone({ cells: [[50, 50]] }, 12, 16)).toBeNull();
  });

  it('keeps only a real hex colour', () => {
    expect(normalizeZone({ cells: [[0, 0]], color: '#e11d48' }, 12, 16)?.color).toBe('#e11d48');
    expect(normalizeZone({ cells: [[0, 0]], color: 'red' }, 12, 16)?.color).toBeUndefined();
    expect(normalizeZone({ cells: [[0, 0]], color: '#fff' }, 12, 16)?.color).toBeUndefined();
  });

  it('refuses an absurdly large zone', () => {
    const huge = Array.from({ length: 1000 }, (_, i) => [i % 24, Math.floor(i / 24)] as Cell);
    expect(normalizeZone({ cells: huge }, 24, 24)!.cells.length).toBe(MAX_CELLS_PER_ZONE);
  });

  it('survives cells that are not pairs of numbers', () => {
    const z = normalizeZone({ cells: [[1, 1], 'x', [2], null, [3, 'y'], [2, 2]] }, 12, 16);
    expect(z?.cells).toEqual([[1, 1], [2, 2]]);
  });
});

describe('rowRuns', () => {
  it('merges a contiguous row into one rectangle', () => {
    expect(rowRuns([[0, 0], [1, 0], [2, 0]])).toEqual([{ x: 0, y: 0, w: 3 }]);
  });

  it('splits a row where there is a gap, so an aisle stays an aisle', () => {
    expect(rowRuns([[0, 0], [1, 0], [4, 0], [5, 0]])).toEqual([
      { x: 0, y: 0, w: 2 },
      { x: 4, y: 0, w: 2 },
    ]);
  });

  it('gives one run per row for a block', () => {
    const runs = rowRuns([[0, 0], [1, 0], [0, 1], [1, 1]]);
    expect(runs).toEqual([{ x: 0, y: 0, w: 2 }, { x: 0, y: 1, w: 2 }]);
  });

  it('covers exactly the cells it was given', () => {
    const cells: Cell[] = [[1, 0], [2, 0], [5, 0], [1, 1], [2, 1], [3, 1]];
    const covered = new Set<string>();
    for (const r of rowRuns(cells)) for (let x = r.x; x < r.x + r.w; x++) covered.add(cellKey(x, r.y));
    expect([...covered].sort()).toEqual(cells.map(([x, y]) => cellKey(x, y)).sort());
  });
});

describe('boundsOf and labelPoint', () => {
  it('measures the bounding box', () => {
    expect(boundsOf([[2, 3], [4, 5]])).toEqual({ x: 2, y: 3, w: 3, h: 3 });
    expect(boundsOf([])).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });

  it('labels a rectangle at its centre', () => {
    expect(labelPoint([[0, 0], [1, 0], [0, 1], [1, 1]])).toEqual({ x: 1, y: 1 });
  });

  it('keeps the label on painted floor when the shape is an L', () => {
    // An L whose bounding-box centre is in the empty corner.
    const cells: Cell[] = [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]];
    const at = labelPoint(cells);
    const owned = new Set(cells.map(([x, y]) => cellKey(x, y)));
    expect(owned.has(cellKey(Math.floor(at.x), Math.floor(at.y)))).toBe(true);
  });
});

describe('zoneState', () => {
  it('shades on the same thresholds the pass list uses', () => {
    expect(zoneState(null)).toBe('available');  // no capacity limit
    expect(zoneState(0)).toBe('sold-out');
    expect(zoneState(10)).toBe('filling');      // the list calls this Fast Filling
    expect(zoneState(11)).toBe('available');
  });
});

describe('zoneColor', () => {
  it('wraps round the palette and never returns nothing', () => {
    expect(zoneColor(0)).toMatch(/^#[0-9a-f]{6}$/);
    expect(zoneColor(8)).toBe(zoneColor(0));
    expect(zoneColor(-1)).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('shareRows', () => {
  it('gives every category at least one row, even in a cramped grid', () => {
    expect(shareRows([cat('a', 100), cat('b', 50), cat('c', 10)], 2)).toEqual([1, 1, 1]);
  });

  it('hands out exactly the rows available', () => {
    const got = shareRows([cat('a', 100, 20), cat('b', 50, 500)], 10);
    expect(got.reduce((x, y) => x + y, 0)).toBe(10);
  });

  it('makes the roomier category look roomier', () => {
    const [vip, ga] = shareRows([cat('vip', 1000, 20), cat('ga', 200, 400)], 12);
    expect(ga).toBeGreaterThan(vip);
  });

  it('counts a group pass as the people it admits', () => {
    // 20 group passes of 10 is 200 people; 50 singles is 50. The group zone should be bigger.
    const [grp, single] = shareRows([cat('grp', 500, 20, 10), cat('one', 200, 50, 1)], 12);
    expect(grp).toBeGreaterThan(single);
  });

  it('copes with no categories', () => {
    expect(shareRows([], 10)).toEqual([]);
  });
});

describe('presets', () => {
  const cats = [cat('vip', 1000, 40), cat('gold', 500, 100), cat('ga', 200, 300)];

  for (const preset of LAYOUT_PRESETS) {
    describe(preset.id, () => {
      it('places every category', () => {
        const { zones } = preset.build(cats);
        expect(Object.keys(zones).sort()).toEqual(['ga', 'gold', 'vip']);
      });

      it('never overlaps two zones', () => {
        const { layout, zones } = preset.build(cats);
        const check = checkLayout(layout, zones, cats.map((c) => c.id));
        expect(check.ok).toBe(true);
      });

      it('keeps every cell on the grid', () => {
        const { layout, zones } = preset.build(cats, 12, 16);
        for (const z of Object.values(zones)) {
          for (const [x, y] of z.cells) {
            expect(x).toBeGreaterThanOrEqual(0);
            expect(y).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThan(layout.cols);
            expect(y).toBeLessThan(layout.rows);
          }
        }
      });

      it('never paints over the stage', () => {
        const { layout, zones } = preset.build(cats);
        const stage = layout.features.find((f) => f.kind === 'stage')!;
        const onStage = (x: number, y: number) => x >= stage.x && x < stage.x + stage.w && y >= stage.y && y < stage.y + stage.h;
        for (const z of Object.values(zones)) {
          expect(z.cells.some(([x, y]) => onStage(x, y))).toBe(false);
        }
      });

      it('gives each zone a colour', () => {
        const { zones } = preset.build(cats);
        for (const z of Object.values(zones)) expect(z.color).toMatch(/^#[0-9a-f]{6}$/);
      });

      it('works with one category and with none', () => {
        expect(Object.keys(preset.build([cat('only', 100)]).zones)).toEqual(['only']);
        expect(Object.keys(preset.build([]).zones)).toEqual([]);
      });

      it('still places everything in the smallest grid allowed', () => {
        const { zones } = preset.build(cats, 4, 4);
        // A 4x4 room cannot hold three bands plus a stage; whatever fits must still be valid.
        const check = checkLayout({ cols: 4, rows: 4 }, zones, cats.map((c) => c.id));
        expect(check.ok).toBe(true);
      });
    });
  }

  it('puts the dearest pass nearest the stage in the hall', () => {
    const { zones } = presetById('hall')!.build(cats);
    const top = (id: string) => boundsOf(zones[id].cells).y;
    expect(top('vip')).toBeLessThan(top('gold'));
    expect(top('gold')).toBeLessThan(top('ga'));
  });

  it('widens each tier away from the barrier on an open ground', () => {
    const { zones } = presetById('ground')!.build(cats);
    expect(boundsOf(zones.vip.cells).w).toBeLessThan(boundsOf(zones.ga.cells).w);
  });

  it('leaves the middle of a banquet room clear', () => {
    const { layout, zones } = presetById('banquet')!.build(cats, 12, 16);
    const floor = layout.features.find((f) => f.kind === 'aisle')!;
    const inFloor = (x: number) => x >= floor.x && x < floor.x + floor.w;
    for (const z of Object.values(zones)) expect(z.cells.some(([x]) => inFloor(x))).toBe(false);
  });

  it('is only the three shapes, looked up by id', () => {
    expect(LAYOUT_PRESETS.map((p) => p.id)).toEqual(['hall', 'ground', 'banquet']);
    expect(presetById('nope')).toBeUndefined();
  });
});

describe('checkLayout', () => {
  const ids = ['a', 'b'];

  it('accepts two zones that sit side by side', () => {
    const check = checkLayout({ cols: 12, rows: 16 }, { a: { cells: [[0, 0]] }, b: { cells: [[1, 0]] } }, ids);
    expect(check.ok).toBe(true);
  });

  it('refuses two categories standing on the same cell', () => {
    const check = checkLayout({ cols: 12, rows: 16 }, { a: { cells: [[0, 0]] }, b: { cells: [[0, 0]] } }, ids);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.error).toMatch(/overlap/i);
  });

  it('does not call a zone an overlap with itself', () => {
    const check = checkLayout({ cols: 12, rows: 16 }, { a: { cells: [[0, 0], [0, 0]] } }, ids);
    expect(check.ok).toBe(true);
  });

  it('silently forgets a category that no longer exists', () => {
    const check = checkLayout({ cols: 12, rows: 16 }, { a: { cells: [[0, 0]] }, ghost: { cells: [[5, 5]] } }, ids);
    expect(check.ok).toBe(true);
    if (check.ok) expect(Object.keys(check.zones)).toEqual(['a']);
  });

  it('refuses something that is not a map at all', () => {
    expect(checkLayout({}, [1, 2, 3], ids).ok).toBe(false);
    expect(checkLayout({}, 'map', ids).ok).toBe(false);
  });

  it('treats no zones as a valid empty map, which turns the map off', () => {
    const check = checkLayout({}, {}, ids);
    expect(check.ok).toBe(true);
    if (check.ok) expect(hasMap(check.zones)).toBe(false);
  });

  it('clips a zone to the grid rather than rejecting the whole save', () => {
    const check = checkLayout({ cols: 8, rows: 8 }, { a: { cells: [[0, 0], [20, 20]] } }, ids);
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.zones.a.cells).toEqual([[0, 0]]);
  });
});

describe('hasMap', () => {
  it('is the switch that decides whether a buyer sees a plan', () => {
    expect(hasMap({})).toBe(false);
    expect(hasMap({ a: null })).toBe(false);
    expect(hasMap({ a: { cells: [] } })).toBe(false);
    expect(hasMap({ a: { cells: [[0, 0]] } })).toBe(true);
  });
});

describe('normalizePlanUrl', () => {
  it('keeps an ordinary uploaded plan', () => {
    const url = 'https://bhfrgcphqmbocplfcvbg.supabase.co/storage/v1/object/public/events/venues/plan-1.png';
    expect(normalizePlanUrl(url)).toBe(url);
    expect(normalizePlanUrl('http://example.com/hall.jpg')).toBe('http://example.com/hall.jpg');
  });

  it('refuses anything that is not http(s), so no script can ride in on the plan', () => {
    // The plan is written into an <image> on a public page; these must never get that far.
    expect(normalizePlanUrl('javascript:alert(1)')).toBeNull();
    expect(normalizePlanUrl('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).toBeNull();
    expect(normalizePlanUrl('//evil.example.com/x.png')).toBeNull();
    expect(normalizePlanUrl('file:///etc/passwd')).toBeNull();
    expect(normalizePlanUrl('JaVaScRiPt:alert(1)')).toBeNull();
  });

  it('treats nothing, blank and junk as no plan', () => {
    expect(normalizePlanUrl(null)).toBeNull();
    expect(normalizePlanUrl(undefined)).toBeNull();
    expect(normalizePlanUrl('   ')).toBeNull();
    expect(normalizePlanUrl(42)).toBeNull();
  });

  it('refuses a URL too long to be real', () => {
    expect(normalizePlanUrl(`https://x.com/${'a'.repeat(MAX_PLAN_URL)}`)).toBeNull();
  });
});

describe('the plan on a stored layout', () => {
  it('reads the snake_cased columns Supabase returns', () => {
    const l = normalizeLayout({ cols: 12, rows: 16, plan_url: 'https://x.com/a.png', plan_opacity: 70 });
    expect(l.planUrl).toBe('https://x.com/a.png');
    expect(l.planOpacity).toBe(70);
  });

  it('reads the camelCase the editor sends back', () => {
    const l = normalizeLayout({ planUrl: 'https://x.com/b.png', planOpacity: 20 });
    expect(l.planUrl).toBe('https://x.com/b.png');
    expect(l.planOpacity).toBe(20);
  });

  it('clamps the opacity so the plan can never hide the zones completely', () => {
    expect(normalizeLayout({ plan_opacity: 0 }).planOpacity).toBe(10);
    expect(normalizeLayout({ plan_opacity: 500 }).planOpacity).toBe(100);
    expect(normalizeLayout({}).planOpacity).toBe(DEFAULT_PLAN_OPACITY);
  });

  it('strips an unsafe plan URL on the way out of the database too', () => {
    expect(normalizeLayout({ plan_url: 'javascript:alert(1)' }).planUrl).toBeNull();
  });

  it('survives a save that carries a plan', () => {
    const check = checkLayout(
      { cols: 12, rows: 16, planUrl: 'https://x.com/hall.png', planOpacity: 60 },
      { a: { cells: [[0, 0]] } },
      ['a'],
    );
    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.layout.planUrl).toBe('https://x.com/hall.png');
      expect(check.layout.planOpacity).toBe(60);
    }
  });
});

describe('gridForAspect', () => {
  it('gives a wide plan a wide grid and a tall plan a tall one', () => {
    const wide = gridForAspect(1600, 900);
    expect(wide.cols).toBeGreaterThan(wide.rows);
    const tall = gridForAspect(900, 1600);
    expect(tall.rows).toBeGreaterThan(tall.cols);
  });

  it('keeps a square plan square', () => {
    const g = gridForAspect(1000, 1000);
    expect(g.cols).toBe(g.rows);
  });

  it('roughly preserves the plan proportions, so it fills the map', () => {
    const g = gridForAspect(1600, 900);
    expect(g.cols / g.rows).toBeCloseTo(1600 / 900, 0);
  });

  it('stays inside the grid range whatever the picture', () => {
    for (const [w, h] of [[10000, 1], [1, 10000], [3, 2], [2, 3]]) {
      const g = gridForAspect(w, h);
      expect(g.cols).toBeGreaterThanOrEqual(GRID_MIN);
      expect(g.rows).toBeGreaterThanOrEqual(GRID_MIN);
      expect(g.cols).toBeLessThanOrEqual(GRID_MAX);
      expect(g.rows).toBeLessThanOrEqual(GRID_MAX);
    }
  });

  it('falls back to the default grid when the image dimensions are unusable', () => {
    for (const bad of [[0, 0], [NaN, 100], [-5, 10]]) {
      expect(gridForAspect(bad[0], bad[1])).toEqual({ cols: DEFAULT_COLS, rows: DEFAULT_ROWS });
    }
  });
});

describe('emptyLayout', () => {
  it('is a fresh object each time, so editing one event cannot change another', () => {
    const a = emptyLayout();
    a.features.push({ kind: 'stage', x: 0, y: 0, w: 1, h: 1 });
    expect(emptyLayout().features).toEqual([]);
  });
});
