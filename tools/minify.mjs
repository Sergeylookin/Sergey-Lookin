// minify.mjs — produce minified .min.css / .min.js next to the sources (esbuild).
// The pages reference the .min files (build-pages stamps ?v=). Sources stay readable.
//
//   node tools/minify.mjs
//
// CSS: full minify. JS: whitespace + syntax + comments only, identifiers PRESERVED —
// these are plain global scripts (IIFEs exposing window.__scroll etc. and referenced by
// index.html's inline scripts), so renaming top-level names could break cross-file calls.

import { build, transform } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const A = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const CSS = ['core', 'site', 'manifest'];
const JS = ['i18n', 'site', 'manifest', 'smooth-scroll'];

let saved = 0, before = 0;
for (const name of CSS) {
  const src = readFileSync(resolve(A, name + '.css'), 'utf8');
  const out = (await transform(src, { loader: 'css', minify: true })).code;
  writeFileSync(resolve(A, name + '.min.css'), out);
  before += src.length; saved += src.length - out.length;
  console.log(`  ${name}.css  ${(src.length/1024).toFixed(0)}KB → ${(out.length/1024).toFixed(0)}KB`);
}
for (const name of JS) {
  const src = readFileSync(resolve(A, name + '.js'), 'utf8');
  const out = (await transform(src, { loader: 'js', minifyWhitespace: true, minifySyntax: true, minifyIdentifiers: false, legalComments: 'none' })).code;
  writeFileSync(resolve(A, name + '.min.js'), out);
  before += src.length; saved += src.length - out.length;
  console.log(`  ${name}.js  ${(src.length/1024).toFixed(0)}KB → ${(out.length/1024).toFixed(0)}KB`);
}
console.log(`\n✔ minified — ${(before/1024).toFixed(0)}KB → ${((before-saved)/1024).toFixed(0)}KB (−${(saved/1024).toFixed(0)}KB raw, before gzip)`);
