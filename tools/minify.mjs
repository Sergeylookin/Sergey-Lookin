// minify.mjs — produce minified .min.css / .min.js next to the sources (esbuild).
// The pages reference the .min files (build-pages stamps ?v=). Sources stay readable.
//
//   node tools/minify.mjs           # (re)write the .min files
//   node tools/minify.mjs --check   # verify every .min matches its source; non-zero exit on drift
//
// CSS: full minify. JS: whitespace + syntax + comments only, identifiers PRESERVED —
// these are plain global scripts (IIFEs exposing window.__scroll etc. and referenced by
// index.html's inline scripts), so renaming top-level names could break cross-file calls.

import { transform } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const A = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const CHECK = process.argv.includes('--check');
const CSS = ['core', 'site', 'manifest'];
const JS = ['i18n', 'site', 'manifest', 'smooth-scroll'];

async function minifyOne(name, loader) {
  const ext = loader === 'css' ? '.css' : '.js';
  const src = readFileSync(resolve(A, name + ext), 'utf8');
  const opts = loader === 'css'
    ? { loader: 'css', minify: true }
    : { loader: 'js', minifyWhitespace: true, minifySyntax: true, minifyIdentifiers: false, legalComments: 'none' };
  const out = (await transform(src, opts)).code;
  return { src, out, min: name + (loader === 'css' ? '.min.css' : '.min.js') };
}

let saved = 0, before = 0;
const stale = [];
for (const [list, loader] of [[CSS, 'css'], [JS, 'js']]) {
  for (const name of list) {
    const { src, out, min } = await minifyOne(name, loader);
    const path = resolve(A, min);
    if (CHECK) {
      const current = readFileSync(path, 'utf8');
      if (current !== out) stale.push(min);
    } else {
      writeFileSync(path, out);
      before += src.length; saved += src.length - out.length;
      console.log(`  ${name}.${loader}  ${(src.length / 1024).toFixed(0)}KB → ${(out.length / 1024).toFixed(0)}KB`);
    }
  }
}

if (CHECK) {
  if (stale.length) {
    console.error('\n✖ minified assets are STALE (source changed without re-minifying) — run `node tools/minify.mjs`:');
    stale.forEach((s) => console.error('  - ' + s));
    process.exit(1);
  }
  console.log('✔ all .min assets are in sync with their sources');
} else {
  console.log(`\n✔ minified — ${(before / 1024).toFixed(0)}KB → ${((before - saved) / 1024).toFixed(0)}KB (−${(saved / 1024).toFixed(0)}KB raw, before gzip)`);
}
