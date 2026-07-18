// inject-srcset.mjs — add srcset/sizes to <img> tags that have generated variants.
// Run AFTER `node tools/build-images.mjs --build`. Idempotent: skips imgs that
// already carry a srcset. Only touches <img>; <video> posters are left alone.
//
//   node tools/inject-srcset.mjs
//
// sizes are inferred from the source's pixel width so a full-width detail image,
// a two-up "row" image, a grid preview and the portrait each get an honest hint.

import sharp from 'sharp';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IMGDIR = resolve(ROOT, 'assets', 'img');
const WIDTHS = [480, 960, 1440];
const PAGES = ['portfolio.html', 'about.html', ...Array.from({ length: 10 }, (_, i) => `projects/${String(i + 1).padStart(2, '0')}.html`)];

const SIZES = {
  preview:  '(max-width: 860px) 92vw, 56vw',   // portfolio grid card media
  full:     '100vw',                            // full-bleed detail image
  row:      '(max-width: 860px) 100vw, 48vw',   // two-up .row detail image
  portrait: '(max-width: 980px) 88vw, 40vw',    // about.webp
};

const metaCache = new Map();
async function classify(name) {
  const src = resolve(IMGDIR, name + '.webp');
  if (!existsSync(src)) return null;
  let w = metaCache.get(name);
  if (w === undefined) { w = (await sharp(src).metadata()).width; metaCache.set(name, w); }
  let kind = 'row';
  if (name === 'about') kind = 'portrait';
  else if (name.endsWith('-preview')) kind = 'preview';
  else if (w >= 1600) kind = 'full';
  return { w, kind };
}

function srcsetFor(prefix, name, srcW) {
  const parts = [];
  for (const v of WIDTHS) {
    if (v >= srcW) continue;
    if (existsSync(resolve(IMGDIR, `${name}-${v}.webp`))) parts.push(`${prefix}assets/img/${name}-${v}.webp ${v}w`);
  }
  parts.push(`${prefix}assets/img/${name}.webp ${srcW}w`); // original as the top stop
  return parts.join(', ');
}

let totalImgs = 0, totalTouched = 0;
for (const page of PAGES) {
  const path = resolve(ROOT, page);
  let html = readFileSync(path, 'utf8');
  const prefix = page.startsWith('projects/') ? '../' : '';
  const imgRe = /<img\b[^>]*?>/g;
  const out = [];
  let last = 0, m;
  while ((m = imgRe.exec(html))) {
    out.push(html.slice(last, m.index));
    let tag = m[0];
    last = m.index + m[0].length;
    totalImgs++;
    const srcM = tag.match(/\bsrc="([^"]*assets\/img\/([^"/]+)\.webp)"/);
    if (srcM && !/\bsrcset=/.test(tag)) {
      const name = srcM[2];
      const info = await classify(name);
      if (info) {
        const srcset = srcsetFor(prefix, name, info.w);
        // only add if there is at least one downscaled variant (otherwise pointless)
        if (srcset.split(',').length > 1) {
          const inject = ` srcset="${srcset}" sizes="${SIZES[info.kind]}"`;
          tag = tag.replace(/\bsrc="[^"]*"/, (s) => s + inject);
          totalTouched++;
        }
      }
    }
    out.push(tag);
  }
  out.push(html.slice(last));
  const next = out.join('');
  if (next !== html) { writeFileSync(path, next); console.log('updated', page); }
  else console.log('ok     ', page);
}
console.log(`\n✔ ${totalTouched}/${totalImgs} <img> tags given srcset/sizes`);
