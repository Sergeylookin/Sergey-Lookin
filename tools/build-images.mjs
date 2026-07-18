// build-images.mjs — generate responsive WebP variants for large images so mobile
// doesn't download desktop-sized files. Uses sharp (devDependency).
//
//   node tools/build-images.mjs --list          # print each image's dimensions
//   node tools/build-images.mjs --build         # generate <name>-<w>.webp variants
//
// Variants are written next to the source as <name>-<width>.webp. The build only
// downscales (never upscales past the source width) and skips widths >= source.
// After building, add srcset/sizes to the <img> tags (see tools/README.md).

import sharp from 'sharp';
import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const IMGDIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'img');
const WIDTHS = [480, 960, 1440];
const mode = process.argv.includes('--build') ? 'build' : 'list';

// Only originals (skip already-generated -<width>.webp variants).
const isVariant = (f) => /-(?:480|960|1440)\.webp$/.test(f);
const files = readdirSync(IMGDIR).filter((f) => f.endsWith('.webp') && !isVariant(f));

let totalSaved = 0;
for (const f of files) {
  const src = resolve(IMGDIR, f);
  const meta = await sharp(src).metadata();
  const base = f.replace(/\.webp$/, '');
  if (mode === 'list') {
    console.log(String(meta.width).padStart(5), 'x', String(meta.height).padStart(5), ' ', String(statSync(src).size).padStart(7), ' ', f);
    continue;
  }
  for (const w of WIDTHS) {
    if (w >= meta.width) continue; // never upscale
    const out = resolve(IMGDIR, `${base}-${w}.webp`);
    const info = await sharp(src).resize({ width: w }).webp({ quality: 80 }).toFile(out);
    console.log(`  ${base}-${w}.webp  ${info.size} bytes`);
    totalSaved += info.size;
  }
}
if (mode === 'build') console.log(`\n✔ variants generated (${files.length} sources → widths ${WIDTHS.join('/')})`);
