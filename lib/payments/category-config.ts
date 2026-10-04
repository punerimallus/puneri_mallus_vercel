// Validation for the admin "Configure Tickets" form, kept pure so every bad input can be tested.

import { MAX_GROUP_SIZE, groupSizeOf } from './groups';

export interface CategoryInput {
  id?: string;
  name?: unknown;
  price?: unknown;
  prefix?: unknown;
  capacity?: unknown;
  active?: unknown;
  group_size?: unknown;
}

export interface ExistingCategory {
  id: string;
  name: string;
  sold: number | null;
}

export interface CleanCategory {
  id?: string;
  name: string;
  price: number;
  prefix: string;
  capacity: number;
  active: boolean;
  group_size: number;
}

export type ConfigCheck =
  | { ok: true; categories: CleanCategory[]; remove: ExistingCategory[]; deactivate: ExistingCategory[] }
  | { ok: false; error: string };

export function checkCategoryConfig(input: unknown, existing: ExistingCategory[]): ConfigCheck {
  if (!Array.isArray(input)) return { ok: false, error: 'Categories are missing.' };
  if (input.length > 30) return { ok: false, error: 'Too many categories (30 is the limit).' };

  const soldById = new Map(existing.map((e) => [e.id, e.sold || 0]));
  const clean: CleanCategory[] = [];
  const seenNames = new Set<string>();
  const seenPrefixes = new Set<string>();

  for (let i = 0; i < input.length; i++) {
    const raw = (input[i] || {}) as CategoryInput;
    const label = String(raw.name || '').trim() || `Category ${i + 1}`;

    const name = String(raw.name || '').replace(/\s+/g, ' ').trim().toUpperCase();
    if (!name) return { ok: false, error: `Category ${i + 1} needs a name.` };

    const price = Number(raw.price);
    if (!Number.isFinite(price) || price < 0) return { ok: false, error: `"${label}": enter a valid price (0 or more).` };
    if (Math.abs(price * 100 - Math.round(price * 100)) > 1e-6) return { ok: false, error: `"${label}": price can have at most 2 decimal places.` };

    const prefix = String(raw.prefix || '').trim().toUpperCase();
    if (!prefix) return { ok: false, error: `"${label}": a ticket prefix is required (e.g. GEN-).` };
    if (!/^[A-Z0-9-]{1,12}$/.test(prefix)) return { ok: false, error: `"${label}": the prefix can only use letters, numbers and dashes (max 12).` };

    const capacity = Number(raw.capacity);
    if (!Number.isInteger(capacity) || capacity < 1) return { ok: false, error: `"${label}": capacity must be a whole number, at least 1.` };
    const sold = raw.id ? soldById.get(String(raw.id)) || 0 : 0;
    if (capacity < sold) return { ok: false, error: `"${label}": ${sold} already sold, so capacity cannot go below ${sold}.` };

    // A blank group size means an ordinary ticket; anything else must be a real group (2 or more).
    const rawGroup = raw.group_size;
    const isBlank = rawGroup === undefined || rawGroup === null || rawGroup === '';
    let group_size = 1;
    if (!isBlank) {
      const g = Number(rawGroup);
      if (!Number.isInteger(g) || g < 1 || g > MAX_GROUP_SIZE) return { ok: false, error: `"${label}": people per ticket must be a whole number from 1 to ${MAX_GROUP_SIZE}.` };
      group_size = groupSizeOf(g);
    }

    if (seenNames.has(name)) return { ok: false, error: `Two categories are both called "${name}". Names must be different.` };
    if (seenPrefixes.has(prefix)) return { ok: false, error: `Two categories use the prefix "${prefix}". Each needs its own so ticket numbers never repeat.` };
    seenNames.add(name);
    seenPrefixes.add(prefix);

    clean.push({ ...(raw.id ? { id: String(raw.id) } : {}), name, price, prefix, capacity, active: raw.active !== false, group_size });
  }

  // Anything the form no longer lists: delete if never sold, otherwise just take it off sale so past tickets keep their meaning.
  const keptIds = new Set(clean.filter((c) => c.id).map((c) => c.id));
  const dropped = existing.filter((e) => !keptIds.has(e.id));
  return {
    ok: true,
    categories: clean,
    remove: dropped.filter((e) => !(e.sold || 0)),
    deactivate: dropped.filter((e) => (e.sold || 0) > 0),
  };
}
