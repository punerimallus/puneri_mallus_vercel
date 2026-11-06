// Builds public/events/boxoffice-bg.jpg — the artwork behind the box office.
//
// Run after changing the source image:
//   node scripts/make-boxoffice-bg.mjs
//
// SOURCE is gitignored: it is the 1.1 MB original poster, too heavy for the repo and publicly
// downloadable if left under public/. The two files this writes ARE committed, so a clone can
// build and serve the site without it -- you only need the original to regenerate them.
//
// It resizes and compresses, and that is all. An earlier version blurred this to the point of
// abstraction because the source is an event POSTER: it carries its own date, its own venue and
// its own branding, and behind a page selling a different night a reader can take the wrong date
// off it. That risk is real but it is the owner's to take — and for the event this artwork
// actually belongs to, the poster and the page agree, so there is nothing to take.
//
// What remains worth knowing if you change this:
//
//   * The card over it is translucent and relies on backdrop-blur for contrast, and
//     globals.css switches backdrop-filter OFF below 768px for scroll performance. So on a
//     phone the card is only its own background colour over this image. If you make this
//     brighter or busier, raise the card's opacity in the booking page to match, or the type
//     starts fighting the artwork on exactly the devices most buyers use.
//   * Browsers and the CDN cache by URL, so after regenerating, bump the ?v= on the <img> in
//     app/events/[id]/book/page.tsx or nobody will see the new file.

import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const SOURCE = join(ROOT, 'public', 'JOB KURIAN.jpg.jpeg');
const OUTPUT = join(ROOT, 'public', 'events', 'boxoffice-bg.jpg');

/** Covers a desktop without shipping the full 1920 the source happens to be. */
const WIDTH = 1600;
const HEIGHT = 900;

const OUTPUT_PORTRAIT = join(ROOT, 'public', 'events', 'boxoffice-bg-portrait.jpg');

/**
 * A phone needs its own crop, and this is the one thing here that is not just taste.
 *
 * The background is fixed to the viewport, so on a 390x844 screen object-cover scales a 16:9
 * image up until it covers — keeping roughly the middle quarter of it. On this poster the
 * middle is the text column: the title, the date and the day. The result was the poster's own
 * date rendered enormous behind a page selling a different night.
 *
 * Cropping from the right keeps a performer and the confetti and leaves that column out. Change
 * `position` if a future poster puts its subject elsewhere.
 */
const PORTRAIT = { width: 900, height: 1600, position: 'right' };

const render = (opts) =>
  sharp(readFileSync(SOURCE))
    .resize(opts.width, opts.height, { fit: 'cover', position: opts.position })
    // A touch under full brightness: it sits behind white type in the margins around the card,
    // and the source is lit to be a poster, not a backdrop.
    .modulate({ brightness: 0.86 })
    .jpeg({ quality: 78, mozjpeg: true, progressive: true });

for (const [out, opts] of [
  [OUTPUT, { width: WIDTH, height: HEIGHT, position: 'centre' }],
  [OUTPUT_PORTRAIT, PORTRAIT],
]) {
  const info = await render(opts).toFile(out);
  console.log(`wrote ${out} — ${info.width}x${info.height}, ${Math.round(info.size / 1024)}KB`);
}
