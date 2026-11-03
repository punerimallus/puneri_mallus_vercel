// Builds public/og-image.png — the card WhatsApp, Slack, X and Google render when someone
// shares a punerimallus.com link.
//
// Why this exists: the share card used to point straight at public/logo_main.png. That PNG has
// a transparent background and the "puneri" half of the wordmark is WHITE, so every chat app
// composited it onto its own white card and the word disappeared — only the red cap and
// "MALLUS" survived. Same problem the ticket PDF had, same fix: put it on black.
//
// It is also sized properly. 552x472 is nearly square; the platforms want 1.91:1 (1200x630)
// for the large card, and anything else gets shown as a cramped thumbnail.
//
// Run after changing the logo:
//   node scripts/make-og-image.mjs
//
// sharp comes with Next.js, so there is no extra dependency to install.

import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const SOURCE = join(ROOT, 'public', 'logo_main.png');
const OUTPUT = join(ROOT, 'public', 'og-image.png');

/** 1.91:1, the size every platform asks for. */
const WIDTH = 1200;
const HEIGHT = 630;
/** Share of the card's height the logo fills — large, but not crowding the edges. */
const LOGO_HEIGHT_RATIO = 0.62;

// Trim the transparent border off first. logo_main.png carries uneven padding, so centring the
// file as-is leaves the mark visibly off to one side; centring what is actually drawn does not.
const source = await sharp(readFileSync(SOURCE)).trim().png().toBuffer();
const meta = await sharp(source).metadata();
if (!meta.width || !meta.height) throw new Error('Could not read the logo dimensions.');

const logoHeight = Math.round(HEIGHT * LOGO_HEIGHT_RATIO);
const logoWidth = Math.round(logoHeight * (meta.width / meta.height));

const logo = await sharp(source)
  .resize(logoWidth, logoHeight, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .toBuffer();

await sharp({
  create: { width: WIDTH, height: HEIGHT, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
})
  .composite([
    { input: logo, left: Math.round((WIDTH - logoWidth) / 2), top: Math.round((HEIGHT - logoHeight) / 2) },
  ])
  .png({ compressionLevel: 9 })
  .toFile(OUTPUT);

const out = await sharp(OUTPUT).metadata();
console.log(`logo ${meta.width}x${meta.height} -> ${logoWidth}x${logoHeight} centred on ${out.width}x${out.height} black`);
console.log(`wrote ${OUTPUT}`);
