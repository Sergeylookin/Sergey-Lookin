// build-pages.mjs — single source of truth for the shared shell of the 13 "site" pages
// (about, portfolio, projects/01–10) plus the asset cache-bust version everywhere.
//
// WHY: the shell (head-links block, <nav>, <footer>, trailing <script> tags) and the
// ?v= version used to be hand-copied into 14 files and drifted (v52 vs v57, missing
// aria-current, etc). This script regenerates ONLY those four regions in place from
// the config + templates below, so they can never diverge again.
//
// WHAT IT DOES NOT TOUch: <!doctype>, <html>, <head>'s title/description/OG/twitter,
// the skip link, the entire <main>, and the i18n <script> — all preserved byte-for-byte.
// index.html and 404.html keep their bespoke shells; this script only unifies their ?v=.
//
// Usage:  node tools/build-pages.mjs          # regenerate + report
//         node tools/build-pages.mjs --check  # verify only, non-zero exit on drift
//
// Editing workflow is unchanged: edit a page's <main>/text directly, then (only if you
// touched the shell or bumped VERSION) run this to re-sync the shared regions.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

// ── Single source of truth ────────────────────────────────────────────────
export const VERSION = 129;

// Shared i18n keys that MUST be identical on every site page. The build validates
// each page's dict against these (values only) and reports drift — it does not rewrite
// the dicts, so page-specific keys stay untouched.
const SHARED_I18N = {
  ru: {
    'nav.brand': 'Сергей Лукин <b>—</b> Head of Design',
    'nav.manifesto': 'Манифест', 'nav.about': 'Обо мне', 'nav.pf': 'Портфолио',
    'ft.copy': '© 2026 Сергей Лукин', 'ft.top': 'Наверх <span class="arr">↑</span>',
  },
  en: {
    'nav.brand': 'Sergey Lukin <b>—</b> Head of Design',
    'nav.manifesto': 'Manifesto', 'nav.about': 'About', 'nav.pf': 'Portfolio',
    'ft.copy': '© 2026 Sergey Lukin', 'ft.top': 'Top <span class="arr">↑</span>',
  },
};

// active: which top-nav link is current. metaKey/metaRu: the small label at nav's right.
// ftRu: the footer's right-hand tag (RU default text; JS swaps it via data-i18n).
const P = (title) => ({ prefix: '../', active: 'portfolio', metaKey: 'p.title', metaRu: title, ftRu: 'Портфолио', dataHome: true });
const PAGES = {
  'about.html':      { prefix: '', active: 'about',     metaKey: 'nav.about', metaRu: 'Обо мне',   ftRu: 'Обо мне',   dataHome: false },
  'portfolio.html':  { prefix: '', active: 'portfolio', metaKey: 'pf.meta',   metaRu: 'Портфолио', ftRu: 'Портфолио', dataHome: false },
  'projects/01.html': P('Руна'),
  'projects/02.html': P('Rocket Work'),
  'projects/03.html': P('Fingular'),
  'projects/04.html': P('Chobies NTO'),
  'projects/05.html': P('Duft: Hookah Flames'),
  'projects/06.html': P('Squad Gaming'),
  'projects/07.html': P('Маркетинг-кит'),
  'projects/08.html': P('POS Credit'),
  'projects/09.html': P('Heatbit'),
  'projects/10.html': P('Choise.com'),
};

// ── Templates for the four shared regions ──────────────────────────────────
const headLinks = (p) =>
  `<link rel="icon" href="${p}assets/favicon-dark.svg" type="image/svg+xml">` +
  `<link rel="icon" href="${p}assets/favicon-light.svg" type="image/svg+xml" media="(prefers-color-scheme: light)">` +
  `<link rel="apple-touch-icon" href="${p}assets/apple-touch-icon.png">` +
  /* Fonts are self-hosted (@font-face in core.css). Preload the two above-the-fold
     Cyrillic faces (RU is default) so hero/body text paints without a swap flash. */
  `<link rel="preload" href="${p}assets/fonts/inter-tight-normal-300_700-cyrillic.woff2" as="font" type="font/woff2" crossorigin>` +
  `<link rel="preload" href="${p}assets/fonts/inter-tight-italic-300_700-cyrillic.woff2" as="font" type="font/woff2" crossorigin>` +
  `<link rel="stylesheet" href="${p}assets/core.min.css?v=${VERSION}">` +
  `<link rel="stylesheet" href="${p}assets/site.min.css?v=${VERSION}">`;

const navLink = (href, key, label, on) =>
  `<a href="${href}" class="nav-contact${on ? ' is-active' : ''}"${on ? ' aria-current="page"' : ''} data-i18n="${key}">${label}</a>`;

const nav = (c) => {
  const p = c.prefix;
  return `<nav class="top on-dark" id="nav">` +
    `<a class="brand" href="${p}index.html" id="navHome" data-i18n="nav.brand">Сергей Лукин <b>—</b> Head of Design</a>` +
    `<div class="nav-center">` +
      navLink(`${p}index.html`, 'nav.manifesto', 'Манифест', c.active === 'manifesto') +
      `<span class="nav-sep" aria-hidden="true">·</span>` +
      navLink(`${p}about.html`, 'nav.about', 'Обо мне', c.active === 'about') +
      `<span class="nav-sep" aria-hidden="true">·</span>` +
      navLink(`${p}portfolio.html`, 'nav.pf', 'Портфолио', c.active === 'portfolio') +
    `</div>` +
    `<div class="nav-right">` +
      `<div class="lang-switch" id="langSwitch" role="group" aria-label="Язык" data-aria-ru="Язык" data-aria-en="Language">` +
        `<button type="button" data-lang="ru" class="active" aria-pressed="true">RU</button>` +
        `<span class="sep" aria-hidden="true">·</span>` +
        `<button type="button" data-lang="en" aria-pressed="false">EN</button>` +
      `</div>` +
      `<div class="meta" data-i18n="${c.metaKey}">${c.metaRu}</div>` +
    `</div></nav>`;
};

const footer = (c) =>
  `<footer class="foot"><div data-i18n="ft.copy">© 2026 Сергей Лукин</div>` +
  `<button class="ft-top" type="button" id="footTop" data-i18n="ft.top">Наверх <span class="arr">↑</span></button>` +
  `<div data-i18n="ft.tag">${c.ftRu}</div></footer>`;

const scripts = (p) =>
  `<script defer src="${p}assets/lenis.min.js?v=${VERSION}"></script>` +
  `<script defer src="${p}assets/smooth-scroll.min.js?v=${VERSION}"></script>` +
  `<script defer src="${p}assets/i18n.min.js?v=${VERSION}"></script>` +
  `<script defer src="${p}assets/site.min.js?v=${VERSION}"></script>`;

// Cache-bust <source src="…/assets/vid/foo.mp4">. Unlike css/js it carries no ?v= by
// default, so a changed (or restored) video is served stale to returning visitors who
// cached the old file under the bare URL. Give it the same ?v=VERSION. Idempotent
// (re-runs are no-ops); the `<slug>.mp4` template placeholder is skipped because '<'
// isn't in [\w-].
const VIDEO_RE = /((?:\.\.\/)?assets\/vid\/[\w-]+\.mp4)(?:\?v=\d+)?/g;
const bustVideos = (html) => html.replace(VIDEO_RE, (_m, path) => `${path}?v=${VERSION}`);

// ── Region replacement ─────────────────────────────────────────────────────
// Each region has a unique, unambiguous anchor pair, so a non-greedy match is safe.
function regenerate(html, c) {
  const before = html;
  const warnings = [];

  const sub = (re, replacement, label) => {
    if (!re.test(html)) { warnings.push(`region not found: ${label}`); return; }
    html = html.replace(re, replacement);
  };

  // head links: from the first favicon <link> through </head>
  sub(/<link rel="icon"[\s\S]*?<\/head>/, headLinks(c.prefix) + '</head>', 'head-links');
  // nav
  sub(/<nav class="top[\s\S]*?<\/nav>/, nav(c), 'nav');
  // footer
  sub(/<footer class="foot">[\s\S]*?<\/footer>/, footer(c), 'footer');
  // trailing scripts (lenis → smooth-scroll → site.js), i18n <script> above is preserved
  sub(/<script defer src="[^"]*assets\/lenis\.min\.js[\s\S]*?assets\/site\.min\.js[^<]*><\/script>/, scripts(c.prefix), 'scripts');

  return { html, changed: html !== before, warnings };
}

// Validate the shared i18n keys in a page's dict against SHARED_I18N.
function checkSharedI18n(html, file) {
  const m = html.match(/<script id="i18n-data" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return [`${file}: no i18n dict`];
  let dict;
  try { dict = JSON.parse(m[1]); } catch (e) { return [`${file}: i18n dict does not parse (${e.message})`]; }
  const out = [];
  for (const lang of ['ru', 'en']) {
    for (const [k, v] of Object.entries(SHARED_I18N[lang])) {
      if (dict[lang] && dict[lang][k] !== undefined && dict[lang][k] !== v) {
        out.push(`${file}: i18n ${lang}.${k} drifted → "${dict[lang][k]}"`);
      }
    }
  }
  return out;
}

// Every data-i18n / data-i18n-aria key USED in a page's HTML must exist in BOTH ru and en.
// This catches the realistic drift mode (a shell/markup key dropped, renamed or typo'd in a
// page's hand-maintained dict) without false-positiving on shared keys a page simply doesn't use.
function checkI18nCoverage(html, file) {
  const m = html.match(/<script id="i18n-data" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return [];
  let dict;
  try { dict = JSON.parse(m[1]); } catch (e) { return [`${file}: i18n dict does not parse (${e.message})`]; }
  const used = new Set();
  const re = /data-i18n(?:-aria)?="([^"]+)"/g;
  let mm;
  while ((mm = re.exec(html))) used.add(mm[1]);
  const out = [];
  for (const k of used) {
    for (const lang of ['ru', 'en']) {
      if (!dict[lang] || !(k in dict[lang])) out.push(`${file}: i18n ${lang}.${k} MISSING (used in HTML)`);
    }
  }
  return out;
}

// ── Run ────────────────────────────────────────────────────────────────────
let anyChange = false, allWarnings = [];
for (const [file, cfg] of Object.entries(PAGES)) {
  const path = resolve(ROOT, file);
  const src = readFileSync(path, 'utf8');
  const r = regenerate(src, cfg);
  const html = bustVideos(r.html);
  const changed = html !== src;
  const warnings = r.warnings;
  allWarnings.push(...warnings.map((w) => `${file}: ${w}`), ...checkSharedI18n(html, file), ...checkI18nCoverage(html, file));
  if (changed) {
    anyChange = true;
    if (CHECK) console.log('DRIFT   ', file);
    else { writeFileSync(path, html); console.log('written ', file); }
  } else console.log('ok      ', file);
}

// index.html + 404.html: version-only sync (their shells are bespoke).
for (const file of ['index.html', '404.html']) {
  const path = resolve(ROOT, file);
  const src = readFileSync(path, 'utf8');
  const html = bustVideos(src.replace(/\?v=\d+/g, `?v=${VERSION}`));
  allWarnings.push(...checkSharedI18n(html, file).filter((w) => !w.includes('no i18n dict')), ...checkI18nCoverage(html, file));
  if (html !== src) { anyChange = true; if (!CHECK) { writeFileSync(path, html); console.log('written ', file, '(version only)'); } else console.log('DRIFT   ', file); }
  else console.log('ok      ', file);
}

const i18nIssues = allWarnings.filter((w) => w.includes(': i18n '));
if (allWarnings.length) { console.log('\n⚠ warnings:'); allWarnings.forEach((w) => console.log('  -', w)); }
if (CHECK && (anyChange || i18nIssues.length)) {
  console.error(`\n✖ out of sync${i18nIssues.length ? ` — ${i18nIssues.length} i18n issue(s) above` : ''} — run \`node tools/build-pages.mjs\` and fix any i18n gaps`);
  process.exit(1);
}
console.log(`\n✔ done (VERSION=${VERSION})`);
