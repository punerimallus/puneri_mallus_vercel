// What the buyer sees in the pass list, and in what order.
//
// Pulled out of the booking page because the rule is easy to get wrong and impossible to see
// in JSX: the page used to ask the database for active categories only, which meant a paused
// VIP block simply vanished and the room read as "there is no VIP". Now everything is fetched
// and the paused ones are shown as coming soon — never buyable, because the reservation
// refuses an inactive category anyway, but visible, because people stop looking otherwise.

export interface SaleCategory {
  id?: string;
  name?: string;
  price?: number | null;
  /** false means an admin has paused it. Missing means on sale, which is the old default. */
  active?: boolean | null;
}

/** Can this category actually be bought right now? */
export const onSale = (cat: SaleCategory | null | undefined): boolean => !!cat && cat.active !== false;

/**
 * On sale first, cheapest first within each group.
 *
 * A buyer should never have to scroll past things they cannot buy to reach the ones they can,
 * and the "coming soon" block reads better as a tail than as a gap in the middle of the prices.
 * Stable: two categories at the same price keep the order the database gave them.
 */
export function sortForSale<T extends SaleCategory>(categories: readonly T[]): T[] {
  return [...categories].sort((a, b) => {
    const live = Number(onSale(b)) - Number(onSale(a));
    if (live !== 0) return live;
    return (Number(a.price) || 0) - (Number(b.price) || 0);
  });
}

/** Split for the places that need the two groups separately (limits, empty states). */
export function partitionBySale<T extends SaleCategory>(categories: readonly T[]): { live: T[]; comingSoon: T[] } {
  return {
    live: categories.filter((c) => onSale(c)),
    comingSoon: categories.filter((c) => !onSale(c)),
  };
}
