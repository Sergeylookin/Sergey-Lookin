// build-en.mjs — generate static English pages under /en/ from the RU pages + their
// inline i18n dictionaries, so Google can index the English version (it was client-only).
//
//   node tools/build-en.mjs
//
// For each RU page it (1) injects reciprocal hreflang links into the RU file (idempotent),
// and (2) writes an English twin to /en/<path> with English <title>/meta/content baked in,
// html lang="en", canonical+og pointing at the EN url, and asset paths shifted one level up
// (since /en/ is one directory deeper). Run AFTER `npm run build` so ?v= is current.
// Also regenerates sitemap.xml with both language trees + hreflang alternates.

import { load } from 'cheerio';
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://sergeylookin.github.io/Sergey-Lookin/';

// RU file → { ruUrl, enUrl, enFile }. Home uses the clean directory URL.
const PAGES = [
  { file: 'index.html',     ruPath: '',              enFile: 'en/index.html',     enPath: 'en/' },
  { file: 'about.html',     ruPath: 'about.html',    enFile: 'en/about.html',     enPath: 'en/about.html' },
  { file: 'portfolio.html', ruPath: 'portfolio.html',enFile: 'en/portfolio.html', enPath: 'en/portfolio.html' },
  ...Array.from({ length: 10 }, (_, i) => {
    const n = String(i + 1).padStart(2, '0');
    return { file: `projects/${n}.html`, ruPath: `projects/${n}.html`, enFile: `en/projects/${n}.html`, enPath: `en/projects/${n}.html` };
  }),
];

const strip = (s) => (s || '').replace(/<[^>]+>/g, '');
const hreflangBlock = (ruUrl, enUrl) =>
  `<link rel="alternate" hreflang="ru" href="${ruUrl}">` +
  `<link rel="alternate" hreflang="en" href="${enUrl}">` +
  `<link rel="alternate" hreflang="x-default" href="${ruUrl}">`;

// CreativeWork JSON-LD for a project case (localized per language).
const stripName = (t) => strip(t).split('·')[0].split('|')[0].trim();
function creativeWork(dictLang, lang, url) {
  return {
    '@context': 'https://schema.org', '@type': 'CreativeWork',
    name: stripName(dictLang['meta.title'] || ''),
    description: dictLang['meta.description'] || '',
    inLanguage: lang, url,
    creator: { '@type': 'Person', name: 'Сергей Лукин', alternateName: 'Sergey Lukin', url: BASE },
  };
}
const ldScript = (o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;

function getDict(html) {
  const m = html.match(/<script id="i18n-data"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

// Insert reciprocal hreflang into a RU page (idempotent), just before the first favicon link
// (the meta zone build-pages preserves). Leaves the existing canonical (RU self) untouched.
function ensureRuHreflang(html, ruUrl, enUrl) {
  if (/hreflang=/.test(html)) return html; // already done
  return html.replace(/(<link rel="icon")/, hreflangBlock(ruUrl, enUrl) + '$1');
}

// Inject a CreativeWork JSON-LD (RU) into a project page (idempotent), before the first favicon.
function ensureProjectLdRu(html, dict, ruUrl) {
  if (/"CreativeWork"/.test(html)) return html;
  return html.replace(/(<link rel="icon")/, ldScript(creativeWork(dict.ru || {}, 'ru', ruUrl)) + '$1');
}

// Shift every RELATIVE assets/ reference one directory deeper (…/en/ is one level down).
// Absolute URLs (https://…/assets/…) are skipped by the lookbehind.
function bumpAssetDepth(html) {
  return html.replace(/(?<![:/\w.-])((?:\.\.\/)*)assets\//g, '../$1assets/');
}

function makeEn(ruHtml, dict, ruUrl, enUrl, isProject) {
  // Strip a leading BOM — it derails the parser (head content leaks into body, doctype lost).
  const $ = load(ruHtml.replace(/^﻿/, ''));
  const en = dict.en || {};
  const title = strip(en['meta.title']);
  const desc = en['meta.description'] || '';

  $('html').attr('lang', 'en');
  if (title) $('title').text(title);
  if (desc) {
    $('meta[name="description"]').attr('content', desc);
    $('meta[property="og:description"]').attr('content', desc);
    $('meta[name="twitter:description"]').attr('content', desc);
  }
  if (title) {
    $('meta[property="og:title"]').attr('content', title);
    $('meta[name="twitter:title"]').attr('content', title);
  }
  $('meta[property="og:locale"]').attr('content', 'en_US');
  $('meta[property="og:url"]').attr('content', enUrl);
  $('link[rel="canonical"]').attr('href', enUrl);

  $('[data-i18n]').each((_i, el) => {
    const k = $(el).attr('data-i18n');
    if (k in en) $(el).html(en[k]);
  });
  $('[data-i18n-aria]').each((_i, el) => {
    const k = $(el).attr('data-i18n-aria');
    if (k in en) $(el).attr('aria-label', en[k]);
  });

  if (isProject) {
    // swap the copied RU CreativeWork for the EN one
    $('script[type="application/ld+json"]').each((_i, el) => {
      if (($(el).html() || '').includes('"CreativeWork"')) $(el).remove();
    });
    $('head').append(ldScript(creativeWork(en, 'en', enUrl)));
  }

  let out = $.html();
  if (!/^\s*<!doctype/i.test(out)) out = '<!doctype html>\n' + out;  // cheerio drops it; browsers need it (no quirks mode)
  return bumpAssetDepth(out);
}

let ruChanged = 0, enWritten = 0;
mkdirSync(join(ROOT, 'en', 'projects'), { recursive: true });

for (const p of PAGES) {
  const ruUrl = BASE + p.ruPath;
  const enUrl = BASE + p.enPath;
  const ruAbs = join(ROOT, p.file);
  const src = readFileSync(ruAbs, 'utf8');
  const dict = getDict(src);
  if (!dict) { console.log('SKIP (no dict):', p.file); continue; }

  const isProject = p.file.startsWith('projects/');
  // 1) reciprocal hreflang (+ CreativeWork LD for cases) into the RU page
  let ruOut = ensureRuHreflang(src, ruUrl, enUrl);
  if (isProject) ruOut = ensureProjectLdRu(ruOut, dict, ruUrl);
  if (ruOut !== src) { writeFileSync(ruAbs, ruOut); ruChanged++; console.log('ru updated +', p.file); }

  // 2) English twin
  const enHtml = makeEn(ruOut, dict, ruUrl, enUrl, isProject);
  writeFileSync(join(ROOT, p.enFile), enHtml);
  enWritten++;
  console.log('en written ', p.enFile);
}

// 3) sitemap with both trees + hreflang alternates
const sm = ['<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">'];
for (const p of PAGES) {
  const ruUrl = BASE + p.ruPath, enUrl = BASE + p.enPath;
  const lastmod = statSync(join(ROOT, p.file)).mtime.toISOString().slice(0, 10);
  for (const [self, ru, en] of [[ruUrl, ruUrl, enUrl], [enUrl, ruUrl, enUrl]]) {
    sm.push('  <url>');
    sm.push(`    <loc>${self}</loc>`);
    sm.push(`    <lastmod>${lastmod}</lastmod>`);
    sm.push(`    <xhtml:link rel="alternate" hreflang="ru" href="${ru}"/>`);
    sm.push(`    <xhtml:link rel="alternate" hreflang="en" href="${en}"/>`);
    sm.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${ru}"/>`);
    sm.push('  </url>');
  }
}
sm.push('</urlset>', '');
writeFileSync(join(ROOT, 'sitemap.xml'), sm.join('\n'));

console.log(`\n✔ en pages: ${enWritten} written, ${ruChanged} RU pages got hreflang, sitemap regenerated (${PAGES.length * 2} urls)`);
