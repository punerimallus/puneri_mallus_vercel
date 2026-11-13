// The figures under the hero.
//
// Small surface, but it renders on the landing page straight from whatever is in the database,
// so the thing worth pinning is what it refuses to show: half-filled rows, essays typed into a
// number box, and anything that would publish a figure nobody actually entered.

import { describe, expect, it } from 'vitest';
import {
  MAX_LABEL_LENGTH,
  MAX_STATS,
  MAX_VALUE_LENGTH,
  blankStat,
  communityStats,
  statSpanClass,
  statsGridClass,
} from '@/lib/ui/community-stats';

describe('communityStats', () => {
  it('keeps what the admin typed', () => {
    expect(communityStats([{ value: '2,400+', label: 'Mallus in Pune' }])).toEqual([
      { value: '2,400+', label: 'Mallus in Pune' },
    ]);
  });

  it('keeps the number exactly as written, however it was written', () => {
    // Stored as text on purpose: "2,400+" and "2.4K" are both reasonable and neither survives
    // a round trip through a number column.
    for (const value of ['2,400+', '2.4K', '12', '500 +', '1,00,000']) {
      expect(communityStats([{ value, label: 'Members' }])[0].value).toBe(value.replace(/\s+/g, ' ').trim());
    }
  });

  it('drops a row that is missing its label', () => {
    // A bare "2,400" on the landing page is a mystery, and this is exactly what an admin
    // half-way through typing would otherwise publish.
    expect(communityStats([{ value: '2,400+', label: '' }])).toEqual([]);
    expect(communityStats([{ value: '2,400+', label: '   ' }])).toEqual([]);
    expect(communityStats([{ value: '2,400+' }])).toEqual([]);
  });

  it('drops a row that is missing its number', () => {
    expect(communityStats([{ value: '', label: 'Mallus in Pune' }])).toEqual([]);
    expect(communityStats([{ label: 'Mallus in Pune' }])).toEqual([]);
  });

  it('keeps the complete rows out of a part-finished list', () => {
    const rows = [
      { value: '2,400+', label: 'Mallus in Pune' },
      { value: '', label: '' },
      { value: '40+', label: 'Events hosted' },
    ];
    expect(communityStats(rows)).toEqual([
      { value: '2,400+', label: 'Mallus in Pune' },
      { value: '40+', label: 'Events hosted' },
    ]);
  });

  it('is empty when nothing has ever been set, so the strip does not render', () => {
    // How it ships. A community site that invents its own headcount is worse than one that
    // does not mention it.
    expect(communityStats(undefined)).toEqual([]);
    expect(communityStats(null)).toEqual([]);
    expect(communityStats([])).toEqual([]);
  });

  it('survives whatever shape the database hands back', () => {
    expect(communityStats('not an array')).toEqual([]);
    expect(communityStats({ value: '1', label: 'x' })).toEqual([]);
    expect(communityStats([null, undefined, 42, 'x'])).toEqual([]);
  });

  it('caps how many are shown, so the row cannot be made to wrap', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ value: `${i + 1}`, label: `Thing ${i + 1}` }));
    const kept = communityStats(many);
    expect(kept).toHaveLength(MAX_STATS);
    expect(kept[0].value).toBe('1');
  });

  it('cuts an essay typed into either box', () => {
    const essay = 'x'.repeat(400);
    const [stat] = communityStats([{ value: essay, label: essay }]);
    expect(stat.value).toHaveLength(MAX_VALUE_LENGTH);
    expect(stat.label).toHaveLength(MAX_LABEL_LENGTH);
  });

  it('tidies the whitespace a paste brings with it', () => {
    expect(communityStats([{ value: '  2,400+ ', label: ' Mallus   in\nPune ' }])).toEqual([
      { value: '2,400+', label: 'Mallus in Pune' },
    ]);
  });

  it('is stable when run on its own output, which the admin screen does', () => {
    const once = communityStats([{ value: '2,400+', label: 'Mallus in Pune' }, { value: '', label: 'x' }]);
    expect(communityStats(once)).toEqual(once);
  });

  it('gives the admin an empty row to type into', () => {
    expect(blankStat()).toEqual({ value: '', label: '' });
    // And a blank row is never published.
    expect(communityStats([blankStat()])).toEqual([]);
  });

  it('leaves room for a real label without letting a sentence in', () => {
    expect(MAX_VALUE_LENGTH).toBeGreaterThanOrEqual('2,400+'.length);
    expect(MAX_LABEL_LENGTH).toBeGreaterThanOrEqual('Mallus across Pune'.length);
    expect(MAX_LABEL_LENGTH).toBeLessThan(60);
  });
});

describe('how the figures are laid out', () => {
  it('never puts more than two across on a phone', () => {
    // The label is free text, and three columns at 390px leaves about 110px each. Anything
    // longer than "MALLUS IN PUNE" starts breaking up.
    for (const count of [1, 2, 3, 4]) {
      const phone = statsGridClass(count).split(' ').find((c) => !c.includes(':'));
      expect(phone, `${count} figures`).toMatch(/^grid-cols-(1|2)$/);
    }
  });

  it('opens up to the natural number of columns above the phone breakpoint', () => {
    expect(statsGridClass(1)).toBe('grid-cols-1');
    expect(statsGridClass(2)).toBe('grid-cols-2');
    expect(statsGridClass(3)).toBe('grid-cols-2 sm:grid-cols-3');
    expect(statsGridClass(4)).toBe('grid-cols-2 sm:grid-cols-4');
  });

  it('centres the odd one out when three figures wrap to two rows', () => {
    // Three two-across leaves the last alone on its own row. Without this it sits in the left
    // column looking like a mistake rather than a layout.
    expect(statSpanClass(3, 0)).toBe('');
    expect(statSpanClass(3, 1)).toBe('');
    expect(statSpanClass(3, 2)).toBe('col-span-2 sm:col-span-1');
  });

  it('leaves every other count alone, because they divide evenly', () => {
    for (const count of [1, 2, 4]) {
      for (let i = 0; i < count; i++) expect(statSpanClass(count, i), `${count}/${i}`).toBe('');
    }
  });

  it('copes with a count the admin can never actually reach', () => {
    expect(statsGridClass(0)).toBe('grid-cols-1');
    expect(statsGridClass(99)).toBe('grid-cols-2 sm:grid-cols-4');
    expect(statSpanClass(0, 0)).toBe('');
  });
});
