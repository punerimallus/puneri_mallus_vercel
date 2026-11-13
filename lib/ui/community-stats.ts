// The figures under the hero: how many people the community is, and whatever else is worth
// saying in three words.
//
// Each figure is two short strings rather than a number, on purpose. "2,400+" and "2.4K" and
// "12" are all things an admin will reasonably want to write, and the moment this is stored as
// a number the plus sign has to be reinvented in the renderer. It is a headline, not a metric.
//
// Nothing is seeded. An event site that invents its own membership figure is worse than one
// that does not mention it, so the strip simply does not render until somebody types a number.

export interface CommunityStat {
  /** The big part: "2,400+", "2.4K", "12". */
  value: string;
  /** The small part under it: "MALLUS IN PUNE", "EVENTS HOSTED". */
  label: string;
}

/** Three reads well on a phone and four still fits. Beyond that they start wrapping. */
export const MAX_STATS = 4;

/** "2,400+" is six characters; this leaves room without letting a sentence in. */
export const MAX_VALUE_LENGTH = 12;

export const MAX_LABEL_LENGTH = 24;

const text = (raw: unknown, limit: number): string =>
  String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);

/**
 * The figures as they should be shown, with anything unusable dropped.
 *
 * A figure needs both halves. A number with no label is a mystery on the page and a label with
 * no number is worse, so a half-filled row is left out rather than rendered as "MALLUS" on its
 * own — which is what an admin part-way through typing would otherwise publish.
 */
export function communityStats(raw: unknown): CommunityStat[] {
  const rows = Array.isArray(raw) ? raw : [];
  return rows
    .map((row) => {
      const item = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;
      return {
        value: text(item.value, MAX_VALUE_LENGTH),
        label: text(item.label, MAX_LABEL_LENGTH),
      };
    })
    .filter((stat) => stat.value.length > 0 && stat.label.length > 0)
    .slice(0, MAX_STATS);
}

/** An empty row for the admin to type into. */
export const blankStat = (): CommunityStat => ({ value: '', label: '' });

/**
 * The grid columns for a row of figures.
 *
 * Two across on a phone, whatever the count. Three columns at 390px leaves about 110px each,
 * which is fine for "MALLUS IN PUNE" and cramped for anything longer — and the label is free
 * text, so the layout has to survive the longest one an admin might reasonably write rather
 * than the shortest.
 */
export function statsGridClass(count: number): string {
  if (count <= 1) return 'grid-cols-1';
  if (count === 2) return 'grid-cols-2';
  if (count === 3) return 'grid-cols-2 sm:grid-cols-3';
  return 'grid-cols-2 sm:grid-cols-4';
}

/**
 * Extra classes for one figure in that grid.
 *
 * Three figures two-across leaves the last one alone on its own row, where it would sit in the
 * left column looking like a mistake. Spanning both columns centres it instead. Above `sm`
 * there are three real columns and it goes back to one.
 */
export function statSpanClass(count: number, index: number): string {
  return count === 3 && index === 2 ? 'col-span-2 sm:col-span-1' : '';
}
