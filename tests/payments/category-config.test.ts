import { describe, expect, it } from 'vitest';
import { checkCategoryConfig } from '@/lib/payments/category-config';

const ok = { name: 'general', price: 500, prefix: 'gen-', capacity: 100 };
const check = (cats: unknown, existing: any[] = []) => checkCategoryConfig(cats, existing);

describe('ticket category validation', () => {
  it('accepts a normal category and tidies it', () => {
    const r = check([ok]);
    expect(r.ok && r.categories[0]).toMatchObject({ name: 'GENERAL', prefix: 'GEN-', price: 500, capacity: 100, active: true });
  });
  it('ignores a group size left over from the old model', () => {
    // The form no longer sends one, but a stale tab or a saved payload might. It is dropped,
    // not stored: there is nowhere left for it to go.
    const r = check([{ ...ok, group_size: 5 }]);
    expect(r.ok).toBe(true);
    expect(r.ok && 'group_size' in r.categories[0]).toBe(false);
  });
  it('rejects missing names, bad prices, bad prefixes and bad capacity', () => {
    expect(check([{ ...ok, name: '  ' }])).toMatchObject({ ok: false });
    expect(check([{ ...ok, price: -1 }])).toMatchObject({ ok: false });
    expect(check([{ ...ok, price: 'abc' }])).toMatchObject({ ok: false });
    expect(check([{ ...ok, price: 10.123 }])).toMatchObject({ ok: false });
    expect(check([{ ...ok, prefix: '' }])).toMatchObject({ ok: false });
    expect(check([{ ...ok, prefix: 'A B!' }])).toMatchObject({ ok: false });
    expect(check([{ ...ok, capacity: 0 }])).toMatchObject({ ok: false });
    expect(check([{ ...ok, capacity: 2.5 }])).toMatchObject({ ok: false });
    expect(check('nope')).toMatchObject({ ok: false });
  });
  it('allows a free category (price 0)', () => {
    expect(check([{ ...ok, price: 0 }])).toMatchObject({ ok: true });
  });
  it('rejects duplicate names or prefixes so ticket numbers never repeat', () => {
    expect(check([ok, { ...ok, prefix: 'X-' }])).toMatchObject({ ok: false });
    expect(check([ok, { ...ok, name: 'vip' }])).toMatchObject({ ok: false });
    expect(check([ok, { ...ok, name: 'vip', prefix: 'GEN-' }])).toMatchObject({ ok: false });
  });
  it('will not let capacity drop below the seats already taken', () => {
    const r = check([{ id: 'c1', ...ok, capacity: 30 }], [{ id: 'c1', name: 'GENERAL', sold: 40 }]);
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.error).toContain('40 seats are already taken');
  });
  it('deletes a removed category that never sold, but only takes a sold one off sale', () => {
    const r = check([{ id: 'keep', ...ok }], [
      { id: 'keep', name: 'GENERAL', sold: 0 },
      { id: 'unsold', name: 'OLD', sold: 0 },
      { id: 'sold', name: 'EARLY', sold: 12 },
    ]);
    expect(r.ok && r.remove.map((c) => c.id)).toEqual(['unsold']);
    expect(r.ok && r.deactivate.map((c) => c.id)).toEqual(['sold']);
  });
  it('keeps a category switched off when the admin switched it off', () => {
    const r = check([{ id: 'c1', ...ok, active: false }], [{ id: 'c1', name: 'GENERAL', sold: 0 }]);
    expect(r.ok && r.categories[0].active).toBe(false);
  });
});
