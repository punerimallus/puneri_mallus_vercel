// Creating and editing a bundle offer, from the admin side.
//
// A bundle is "N seats of this category, bought together, for this price". The checks here are
// the ones an admin can get wrong in a way that is expensive rather than cosmetic: a size of
// one is not a bundle, a price above the individual total is a worse deal advertised as a
// better one, and a unit cap larger than the category can supply promises seats that are not
// there.

import { PaymentInputError } from './types';
import { seatsLeft } from './seats';

export const MIN_BUNDLE_SIZE = 2;
export const MAX_BUNDLE_SIZE = 50;
export const MAX_BUNDLE_NAME = 40;

export interface BundleInput {
  categoryId?: unknown;
  name?: unknown;
  size?: unknown;
  price?: unknown;
  maxBundles?: unknown;
  active?: unknown;
}

export interface CleanBundle {
  categoryId: string;
  name: string;
  size: number;
  price: number;
  maxBundles: number | null;
  active: boolean;
}

/** The category a bundle draws from, as much of it as these checks need. */
export interface BundleCategory {
  id: string;
  name: string;
  price: number;
  capacity: number | null;
  /** Seat counters, when the caller has them. Absent means "only check against capacity". */
  sold?: number | null;
  released?: number | null;
  active?: boolean | null;
  comp_only?: boolean | null;
}

export interface BundleCheckOptions {
  /**
   * True when this is a NEW offer rather than an edit.
   *
   * A new group is measured against the seats still FREE, not the hall's capacity: creating a
   * "Group of 10" on a type with nine left would be born auto-paused, which reads as a bug.
   * An edit is measured against capacity only, because an offer that has stopped selling is
   * exactly the one whose price or name an admin needs to change.
   */
  isNew?: boolean;
}

/** What one seat costs inside a bundle. What the receipt prints per pass. */
export const perSeatPrice = (price: number, size: number): number =>
  size > 0 ? Math.round((price / size) * 100) / 100 : 0;

/** How much cheaper the bundle is than buying the same seats one by one, in rupees. */
export const bundleSaving = (price: number, size: number, categoryPrice: number): number =>
  Math.round((categoryPrice * size - price) * 100) / 100;

/**
 * Validates and tidies what an admin typed.
 *
 * Throws rather than returning errors: the API turns a PaymentInputError into a status and a
 * sentence, and every refusal here is something the admin can fix on the form in front of them.
 */
export function checkBundleInput(
  input: BundleInput,
  categories: BundleCategory[],
  opts: BundleCheckOptions = {},
): CleanBundle {
  const categoryId = String(input.categoryId ?? '').trim();
  const category = categories.find((c) => String(c.id) === categoryId);
  if (!category) throw new PaymentInputError('Pick the ticket type this bundle is made of.');
  if (category.comp_only === true) {
    // The access pass is never sold, so a bundle of them could never be bought.
    throw new PaymentInputError('That ticket type is for complimentary passes only, so it cannot be bundled.');
  }

  const name = String(input.name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_BUNDLE_NAME);
  if (name.length < 2) throw new PaymentInputError('Give the bundle a name buyers will recognise, like "Squad of 5".');

  const size = Math.floor(Number(input.size));
  if (!Number.isFinite(size) || size < MIN_BUNDLE_SIZE) {
    throw new PaymentInputError(`A bundle needs at least ${MIN_BUNDLE_SIZE} tickets in it.`);
  }
  if (size > MAX_BUNDLE_SIZE) {
    throw new PaymentInputError(`A bundle can hold at most ${MAX_BUNDLE_SIZE} tickets.`);
  }
  if (category.capacity != null && size > category.capacity) {
    throw new PaymentInputError(`"${category.name}" only has ${category.capacity} seats, so a bundle of ${size} cannot be filled.`);
  }
  // A new offer also has to fit in what is actually LEFT, not just in the hall. Without this an
  // admin can create a group the booking page immediately greys out as auto-paused, and nothing
  // on the form explains why.
  if (opts.isNew === true && category.capacity != null) {
    const free = seatsLeft(category);
    if (free != null && size > free) {
      throw new PaymentInputError(
        `Only ${free} "${category.name}" seats are left, so a group of ${size} cannot be filled. Make it ${free} or fewer, or pick another type.`,
      );
    }
  }

  const price = Math.round(Number(input.price) * 100) / 100;
  if (!Number.isFinite(price) || price < 0) throw new PaymentInputError('Enter the price for the whole bundle.');
  // A bundle dearer than its parts is a worse deal presented as a better one. Caught here
  // rather than discovered by a buyer doing the arithmetic.
  if (price > category.price * size) {
    throw new PaymentInputError(
      `That is more than ${size} tickets bought separately (₹${category.price * size}). Lower the bundle price.`,
    );
  }

  let maxBundles: number | null = null;
  if (input.maxBundles !== undefined && input.maxBundles !== null && String(input.maxBundles).trim() !== '') {
    maxBundles = Math.floor(Number(input.maxBundles));
    if (!Number.isFinite(maxBundles) || maxBundles < 1) {
      throw new PaymentInputError('Leave the limit empty for unlimited, or enter at least 1.');
    }
    if (category.capacity != null && maxBundles * size > category.capacity) {
      const fits = Math.floor(category.capacity / size);
      throw new PaymentInputError(
        `${maxBundles} bundles of ${size} needs ${maxBundles * size} seats and "${category.name}" has ${category.capacity}. At most ${fits} fit.`,
      );
    }
  }

  return { categoryId, name, size, price, maxBundles, active: input.active !== false };
}
