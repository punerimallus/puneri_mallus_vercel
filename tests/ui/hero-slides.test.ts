// The hero slider's two artwork slots.
//
// A slide carries a wide asset for tablet and desktop and may carry a separate cut for phones.
// Two things here are worth real tests: which file a given viewport loads, and which files the
// save endpoint is allowed to DELETE from storage — the second one is destructive and quietly
// so, because nobody notices a missing hero image until the home page is already wrong.

import { describe, expect, it } from 'vitest';
import {
  MOBILE_QUERY,
  hasMobileAsset,
  heroStoragePath,
  isVideoAsset,
  orphanedAssets,
  slideAsset,
  type HeroSlide,
} from '@/lib/ui/hero-slides';

const WIDE = 'https://x.supabase.co/storage/v1/object/public/assets/hero-slider/hero-1.jpeg';
const PHONE = 'https://x.supabase.co/storage/v1/object/public/assets/hero-slider/mobile-1.jpeg';

describe('which asset a slide shows', () => {
  it('uses the wide asset on tablet and desktop', () => {
    expect(slideAsset({ mediaUrl: WIDE, mobileUrl: PHONE }, false)).toBe(WIDE);
  });

  it('uses the phone cut on a phone, when there is one', () => {
    expect(slideAsset({ mediaUrl: WIDE, mobileUrl: PHONE }, true)).toBe(PHONE);
  });

  it('falls back to the wide asset on a phone when no cut is set', () => {
    // Every slide that exists today is in this state, so it is the case that must not change.
    expect(slideAsset({ mediaUrl: WIDE }, true)).toBe(WIDE);
    expect(slideAsset({ mediaUrl: WIDE, mobileUrl: null }, true)).toBe(WIDE);
    expect(slideAsset({ mediaUrl: WIDE, mobileUrl: '' }, true)).toBe(WIDE);
    expect(slideAsset({ mediaUrl: WIDE, mobileUrl: '   ' }, true)).toBe(WIDE);
  });

  it('never shows the phone cut on a desktop, even by accident', () => {
    // The admin uploads a portrait crop; stretched across 1920px it would look broken.
    expect(slideAsset({ mediaUrl: '', mobileUrl: PHONE }, false)).toBe('');
  });

  it('is empty rather than undefined for a slide with no artwork at all', () => {
    expect(slideAsset({}, true)).toBe('');
    expect(slideAsset(null, false)).toBe('');
    expect(slideAsset(undefined, true)).toBe('');
  });

  it('reports whether a slide has its own phone cut', () => {
    expect(hasMobileAsset({ mediaUrl: WIDE, mobileUrl: PHONE })).toBe(true);
    expect(hasMobileAsset({ mediaUrl: WIDE })).toBe(false);
    expect(hasMobileAsset({ mediaUrl: WIDE, mobileUrl: '  ' })).toBe(false);
    expect(hasMobileAsset(null)).toBe(false);
  });

  it('switches at the same breakpoint the rest of the site lays out against', () => {
    expect(MOBILE_QUERY).toBe('(max-width: 767px)');
  });
});

describe('telling a video from an image', () => {
  it('knows the formats the slider accepts', () => {
    for (const ext of ['mp4', 'webm', 'ogg', 'ogv', 'mov', 'm4v', 'MP4', 'MOV']) {
      expect(isVideoAsset(`https://x/assets/hero-slider/hero-1.${ext}`)).toBe(true);
    }
  });

  it('treats images as images', () => {
    for (const ext of ['jpeg', 'jpg', 'png', 'webp', 'avif', 'gif']) {
      expect(isVideoAsset(`https://x/assets/hero-slider/hero-1.${ext}`)).toBe(false);
    }
  });

  it('reads the extension past a query string, which Supabase adds', () => {
    expect(isVideoAsset('https://x/hero-1.mp4?token=abc')).toBe(true);
    expect(isVideoAsset('https://x/hero-1.jpeg?t=123')).toBe(false);
  });

  it('is not fooled by the word video in a file name', () => {
    // The old copy of this used url.includes('video'), so a still called "video-thumb.jpg"
    // was rendered inside a <video> element and showed nothing at all.
    expect(isVideoAsset('https://x/assets/hero-slider/video-thumb.jpg')).toBe(false);
    expect(isVideoAsset('https://x/assets/video/clip')).toBe(true);
  });

  it('is false for nothing', () => {
    expect(isVideoAsset('')).toBe(false);
    expect(isVideoAsset(null)).toBe(false);
    expect(isVideoAsset(undefined)).toBe(false);
  });
});

describe('which files the save endpoint may delete', () => {
  const slide = (mediaUrl: string, mobileUrl?: string): HeroSlide => ({ mediaUrl, mobileUrl });

  it('deletes a wide asset that was swapped out', () => {
    expect(orphanedAssets([slide('a.jpg')], [slide('b.jpg')])).toEqual(['a.jpg']);
  });

  it('deletes a phone cut that was swapped out', () => {
    // The bug this closes: the original only looked at mediaUrl, so every replaced phone cut
    // stayed in the bucket for ever.
    expect(orphanedAssets([slide('a.jpg', 'a-m.jpg')], [slide('a.jpg', 'b-m.jpg')])).toEqual(['a-m.jpg']);
  });

  it('deletes a phone cut that was cleared back to the wide asset', () => {
    expect(orphanedAssets([slide('a.jpg', 'a-m.jpg')], [slide('a.jpg', '')])).toEqual(['a-m.jpg']);
  });

  it('deletes both when a whole slide is removed', () => {
    const before = [slide('a.jpg', 'a-m.jpg'), slide('b.jpg', 'b-m.jpg')];
    expect(orphanedAssets(before, [slide('b.jpg', 'b-m.jpg')]).sort()).toEqual(['a-m.jpg', 'a.jpg']);
  });

  it('never deletes a file another slide is still using', () => {
    // Two slides can point at the same upload. Removing one of them must not pull the artwork
    // out from under the other, which a naive per-slide diff would do.
    const before = [slide('shared.jpg'), slide('shared.jpg', 'a-m.jpg')];
    expect(orphanedAssets(before, [slide('shared.jpg')])).toEqual(['a-m.jpg']);
  });

  it('never deletes a file that only moved to the other slot', () => {
    // An admin promoting the phone cut to be the wide asset: same file, different key.
    expect(orphanedAssets([slide('a.jpg', 'm.jpg')], [slide('m.jpg')])).toEqual(['a.jpg']);
  });

  it('deletes nothing when nothing changed', () => {
    const same = [slide('a.jpg', 'a-m.jpg'), slide('b.jpg')];
    expect(orphanedAssets(same, same)).toEqual([]);
  });

  it('deletes nothing on a first save, when there is no old list', () => {
    expect(orphanedAssets(null, [slide('a.jpg')])).toEqual([]);
    expect(orphanedAssets([], [slide('a.jpg')])).toEqual([]);
  });

  it('ignores blanks rather than trying to delete an empty path', () => {
    expect(orphanedAssets([slide('', ''), slide('a.jpg')], [])).toEqual(['a.jpg']);
  });

  it('lists a file once even if several slides used it', () => {
    const before = [slide('dup.jpg'), slide('dup.jpg'), slide('dup.jpg', 'dup.jpg')];
    expect(orphanedAssets(before, [])).toEqual(['dup.jpg']);
  });
});

describe('where a slide asset lives in the bucket', () => {
  it('maps a public URL to its path', () => {
    expect(heroStoragePath(WIDE)).toBe('hero-slider/hero-1.jpeg');
    expect(heroStoragePath(PHONE)).toBe('hero-slider/mobile-1.jpeg');
  });

  it('drops a query string, so the delete targets the real object', () => {
    expect(heroStoragePath(`${WIDE}?token=abc`)).toBe('hero-slider/hero-1.jpeg');
  });

  it('is null for something with no file name to delete', () => {
    expect(heroStoragePath('')).toBeNull();
  });
});
