// Which artwork a hero slide shows, and on what.
//
// A slide carries one asset for tablet and desktop (`mediaUrl`) and may carry a second cut for
// phones (`mobileUrl`). This is art direction, not resizing: the desktop file is wide, and on a
// 390px screen `object-cover` keeps roughly the middle third of it, which is where the subject
// usually is not. A portrait cut fixes that in a way no amount of scaling can.
//
// Both are optional per slide, so a slide with no phone cut simply uses the wide one everywhere
// and nothing about it changes.

export interface HeroSlide {
  /** The tablet and desktop asset. An image or a video. */
  mediaUrl?: string | null;
  /** Optional phone-only asset. Falls back to mediaUrl when it is not set. */
  mobileUrl?: string | null;
}

/** Phones only. Matches the `md` breakpoint the rest of the site lays out against. */
export const MOBILE_QUERY = '(max-width: 767px)';

/** Does this slide have its own phone cut? Drives the badge in the admin list. */
export const hasMobileAsset = (slide: HeroSlide | null | undefined): boolean =>
  typeof slide?.mobileUrl === 'string' && slide.mobileUrl.trim().length > 0;

/**
 * The asset this slide should actually load.
 *
 * One URL, not two: the hero's slides are fetched client-side and so nothing here is server
 * rendered, which means the viewport is already known by the time a slide first paints. Picking
 * here rather than rendering both and hiding one with CSS matters — a hidden `<img>` is still
 * downloaded, and the whole point of a phone cut is to send the phone less.
 */
export function slideAsset(slide: HeroSlide | null | undefined, isMobile: boolean): string {
  const wide = (slide?.mediaUrl ?? '').trim();
  if (!isMobile) return wide;
  const phone = (slide?.mobileUrl ?? '').trim();
  return phone || wide;
}

/**
 * Is this URL a video rather than an image?
 *
 * Lifted out of the page and the admin screen, which each had their own copy and had already
 * drifted apart on whether a query string counts. The extension is read from the path only, so
 * a Supabase URL with `?t=` still reads as a video.
 */
export function isVideoAsset(url: string | null | undefined): boolean {
  const path = String(url ?? '').split(/[?#]/)[0];
  return /\.(mp4|webm|ogg|ogv|mov|m4v)$/i.test(path) || /\/video\//i.test(path);
}

/**
 * Files in storage that no slide points at any more.
 *
 * The save endpoint deletes these, so getting it wrong either leaks files for ever or removes
 * artwork a live slide is still showing. Two rules matter and neither is obvious:
 *
 *   * BOTH assets count. A phone cut that is replaced or cleared leaves its old file behind
 *     exactly like a wide one does, and the original version of this only looked at mediaUrl.
 *   * A URL still used by ANY slide is never an orphan, even if the slide that used to own it
 *     is gone. The same file can be set on two slides, and one of them being deleted must not
 *     take the artwork out from under the other.
 */
export function orphanedAssets(oldSlides: HeroSlide[] | null | undefined, newSlides: HeroSlide[] | null | undefined): string[] {
  const urlsOf = (slides: HeroSlide[] | null | undefined) =>
    (Array.isArray(slides) ? slides : [])
      .flatMap((s) => [s?.mediaUrl, s?.mobileUrl])
      .map((u) => (typeof u === 'string' ? u.trim() : ''))
      .filter((u) => u.length > 0);

  const kept = new Set(urlsOf(newSlides));
  return [...new Set(urlsOf(oldSlides))].filter((url) => !kept.has(url));
}

/** The path inside the `assets` bucket for an uploaded slide asset, or null if it is not one. */
export function heroStoragePath(url: string): string | null {
  const name = String(url || '').split(/[?#]/)[0].split('/').pop();
  return name ? `hero-slider/${name}` : null;
}
