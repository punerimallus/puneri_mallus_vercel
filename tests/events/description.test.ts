// Reading an event's description as the bullet list three screens render it as.
//
// The parsing moved out of the two screens that had a copy each, so the thing worth pinning is
// that it still reads EXACTLY as before: every event already in the database was written
// against this rule, and a "better" separator would silently re-flow descriptions that read
// correctly today.

import { describe, expect, it } from 'vitest';
import { descriptionBullets } from '@/lib/events/description';

describe('descriptionBullets', () => {
  it('splits an admin-typed description into its points', () => {
    const raw = '- Tournament: Mallu Premier League 2026 - Dates: 25 July 2026 - Registration Fee: Rs. 5000';
    expect(descriptionBullets(raw)).toEqual([
      'Tournament: Mallu Premier League 2026',
      'Dates: 25 July 2026',
      'Registration Fee: Rs. 5000',
    ]);
  });

  it('drops the empty segment a leading separator creates', () => {
    // Admins start the field with "- ", so the first split is always empty.
    expect(descriptionBullets('- One - Two')).toEqual(['One', 'Two']);
    expect(descriptionBullets('One - Two')).toEqual(['One', 'Two']);
  });

  it('drops blank runs from double separators and trailing ones', () => {
    expect(descriptionBullets('One -- Two -')).toEqual(['One', 'Two']);
    expect(descriptionBullets('  -  -  ')).toEqual([]);
  });

  it('trims the whitespace around each point', () => {
    expect(descriptionBullets('  One   -   Two  ')).toEqual(['One', 'Two']);
  });

  it('keeps a description with no separator as a single point', () => {
    expect(descriptionBullets('Just one thing to say')).toEqual(['Just one thing to say']);
  });

  it('is empty for an event that has no description, so nothing renders', () => {
    expect(descriptionBullets(undefined)).toEqual([]);
    expect(descriptionBullets(null)).toEqual([]);
    expect(descriptionBullets('')).toEqual([]);
    expect(descriptionBullets('   ')).toEqual([]);
  });

  it('still cuts a hyphenated word in half, exactly as it always has', () => {
    // Not a bug being documented as a feature: it is the rule every existing description was
    // written against. Changing it would re-flow events nobody has touched. An admin who needs
    // a hyphen inside a point uses an en dash.
    expect(descriptionBullets('Venue: Walhekar Wadi - Dates: 25-26 July')).toEqual([
      'Venue: Walhekar Wadi',
      'Dates: 25',
      '26 July',
    ]);
    expect(descriptionBullets('Dates: 25–26 July')).toEqual(['Dates: 25–26 July']);
  });

  it('survives whatever shape the database hands back', () => {
    expect(descriptionBullets(42)).toEqual(['42']);
    expect(descriptionBullets(['One - Two'])).toEqual(['One', 'Two']);
  });

  it('keeps emoji and punctuation the admin typed', () => {
    const raw = '- 🏆 Tournament: 7s Football - 📍 Venue: Akurdi, Pune';
    expect(descriptionBullets(raw)).toEqual(['🏆 Tournament: 7s Football', '📍 Venue: Akurdi, Pune']);
  });
});
