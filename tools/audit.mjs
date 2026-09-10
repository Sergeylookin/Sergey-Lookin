// audit.mjs — глубокая проверка сайта. Ищет то, что не видно глазом и не ловится
// сборкой: битые ссылки и картинки, потерянные переводы, дыры в срезах для телефона,
// повторяющиеся id, пустые alt, расхождения страницы и словаря, мусор в карте сайта.
//
//   node tools/audit.mjs            вывести отчёт
//   node tools/audit.mjs --strict   выйти с ошибкой, если есть находки уровня «плохо»

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { load } from 'cheerio';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STRICT = process.argv.includes('--strict');
const rd = (p) => readFileSync(resolve(ROOT, p), 'utf8').replace(/^﻿/, '');
const has = (p) => existsSync(resolve(ROOT, p));

const RU = ['index.html', 'about.html', 'portfolio.html', '404.html',
  ...readdirSync(resolve(ROOT, 'projects')).filter((f) => /^\d\d\.html$/.test(f)).map((f) => 'projects/' + f)];
const EN = RU.map((f) => 'en/' + f);
const ALL = [...RU, ...EN.filter(has)];

const found = [];
const bad = (file, what, detail = '') => found.push({ lvl: 'плохо', file, what, detail });
const warn = (file, what, detail = '') => found.push({ lvl: 'стоит', file, what, detail });

const norm = (s) => String(s ?? '').replace(/&nbsp;| /g, ' ').replace(/\s+/g, ' ').trim();
const dictOf = ($) => { try { return JSON.parse($('#i18n-data').html() || '{}'); } catch { return null; } };

for (const f of ALL) {
  const html = rd(f);
  const $ = load(html, { decodeEntities: false });
  const dir = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '';
  const rel = (u) => {
    let p = String(u).split('?')[0].split('#')[0];
    if (/^(https?:|mailto:|tel:|data:)/i.test(p) || !p) return null;
    if (p.startsWith('/Sergey-Lookin/')) return p.slice('/Sergey-Lookin/'.length);
    if (p.startsWith('/')) return p.slice(1);
    return join(dir, p).replace(/\\/g, '/');
  };

  // ── словарь ──────────────────────────────────────────────────────────
  const d = dictOf($);
  if (!d) { bad(f, 'словарь не читается — страница потеряет все тексты при смене языка'); continue; }
  if (!d.ru || !d.en) bad(f, 'в словаре нет одного из языков');

  const usedKeys = new Set();
  $('[data-i18n]').each((_i, el) => usedKeys.add($(el).attr('data-i18n')));
  $('[data-i18n-aria]').each((_i, el) => usedKeys.add($(el).attr('data-i18n-aria')));
  $('[data-i18n-href]').each((_i, el) => usedKeys.add($(el).attr('data-i18n-href')));

  for (const k of usedKeys) {
    if (!(k in (d.ru || {}))) bad(f, 'на странице есть ключ, которого нет в словаре', k + ' — при смене языка надпись опустеет');
    else if (!(k in (d.en || {}))) warn(f, 'нет английского перевода', k);
    else if (norm(d.ru[k]) === norm(d.en[k]) && norm(d.ru[k]).length > 12 && /[а-яё]/i.test(norm(d.ru[k])))
      warn(f, 'английский совпал с русским', k);
  }
  // расхождение «страница ↔ словарь» (видно при переключении языка туда-обратно)
  if (!f.startsWith('en/')) {
    const seen = new Set();
    $('[data-i18n]').each((_i, el) => {
      const k = $(el).attr('data-i18n');
      if (seen.has(k) || !(k in (d.ru || {}))) return;
      seen.add(k);
      if (norm($(el).html()) !== norm(d.ru[k])) bad(f, 'текст на странице не совпадает со словарём', k);
    });
  }

  // ── картинки ─────────────────────────────────────────────────────────
  $('img').each((_i, el) => {
    const src = $(el).attr('src');
    const p = rel(src);
    if (p && !has(p)) bad(f, 'картинки нет на диске', src);
    if (!($(el).attr('alt') || '').trim()) warn(f, 'пустой alt у картинки', src || '');
    if (!$(el).attr('width') || !$(el).attr('height')) warn(f, 'нет размеров — страница дёргается при загрузке', src || '');
    for (const part of String($(el).attr('srcset') || '').split(',')) {
      const u = part.trim().split(/\s+/)[0];
      if (!u) continue;
      const q = rel(u);
      if (q && !has(q)) bad(f, 'в srcset указан несуществующий файл', u);
    }
  });
  $('video').each((_i, el) => {
    const poster = rel($(el).attr('poster'));
    if (poster && !has(poster)) bad(f, 'нет постера у видео', $(el).attr('poster'));
    $(el).find('source').each((_j, s) => {
      const v = rel($(s).attr('src'));
      if (v && !has(v)) bad(f, 'нет видеофайла', $(s).attr('src'));
    });
  });

  // ── ссылки ───────────────────────────────────────────────────────────
  $('a[href]').each((_i, el) => {
    const href = $(el).attr('href');
    const p = rel(href);
    if (!p) return;
    if (!has(p) && !has(p.replace(/\/$/, '/index.html'))) bad(f, 'ссылка ведёт в никуда', href);
  });
  for (const [sel, attr] of [['link[rel="stylesheet"]', 'href'], ['script[src]', 'src'], ['link[rel="icon"]', 'href']]) {
    $(sel).each((_i, el) => {
      const p = rel($(el).attr(attr));
      if (p && !has(p)) bad(f, 'подключён несуществующий файл', $(el).attr(attr));
    });
  }

  // ── разметка ─────────────────────────────────────────────────────────
  const ids = {};
  $('[id]').each((_i, el) => { const id = $(el).attr('id'); ids[id] = (ids[id] || 0) + 1; });
  for (const [id, n] of Object.entries(ids)) if (n > 1) bad(f, 'повторяющийся id — скрипты будут цепляться не туда', `#${id} × ${n}`);
  if ($('h1').length === 0) warn(f, 'нет заголовка H1');
  if ($('h1').length > 1) warn(f, 'больше одного H1', String($('h1').length));
  if (!norm($('title').text())) bad(f, 'пустой заголовок вкладки');
  if (!$('meta[name="description"]').attr('content')) warn(f, 'нет описания для поиска');
  const lang = $('html').attr('lang');
  if (f.startsWith('en/') ? lang !== 'en' : lang !== 'ru') bad(f, 'неверный язык страницы', String(lang));
}

// ── карта сайта против файлов ──────────────────────────────────────────
if (has('sitemap.xml')) {
  const sm = rd('sitemap.xml');
  const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const BASE = 'https://sergeylookin.github.io/Sergey-Lookin/';
  for (const u of locs) {
    let p = u.startsWith(BASE) ? u.slice(BASE.length) : u;
    if (p === '' || p.endsWith('/')) p += 'index.html';
    if (!has(p)) bad('sitemap.xml', 'в карте сайта страница, которой нет', u);
  }
  let hidden = [];
  try { hidden = JSON.parse(rd('content/cases.json')).cases.filter((c) => c.status !== 'published').map((c) => c.id); } catch {}
  for (const id of hidden) if (locs.some((u) => u.includes(`projects/${id}.html`)))
    bad('sitemap.xml', 'скрытый кейс попал в карту сайта', id);
}

// ── картинки без применения ────────────────────────────────────────────
const IMG = resolve(ROOT, 'assets', 'img');
const originals = readdirSync(IMG).filter((f) => f.endsWith('.webp') && !/-(480|960|1440)\.webp$/.test(f)).map((f) => f.replace(/\.webp$/, ''));
const allHtml = ALL.map(rd).join('\n') + (has('content/cases.json') ? rd('content/cases.json') : '');
for (const n of originals) if (!new RegExp('(?:^|/|")' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:-(?:480|960|1440))?\\.webp').test(allHtml)
  && !allHtml.includes(`"${n}"`)) warn('assets/img', 'картинка нигде не используется', n + '.webp');

// ── вывод ──────────────────────────────────────────────────────────────
const byFile = {};
for (const x of found) (byFile[x.file] = byFile[x.file] || []).push(x);
const lines = [];
const nBad = found.filter((x) => x.lvl === 'плохо').length;
lines.push(`Проверено страниц: ${ALL.length}. Находок: ${found.length} (плохо: ${nBad}, стоит поправить: ${found.length - nBad})`);
for (const [file, list] of Object.entries(byFile)) {
  lines.push('');
  lines.push('  ' + file);
  const grouped = {};
  for (const x of list) (grouped[x.lvl + '|' + x.what] = grouped[x.lvl + '|' + x.what] || []).push(x.detail);
  for (const [key, details] of Object.entries(grouped)) {
    const [lvl, what] = key.split('|');
    const d = details.filter(Boolean);
    lines.push(`   ${lvl === 'плохо' ? '✗' : '·'} ${what}${d.length ? ` (${d.length}): ` + d.slice(0, 3).join(', ') + (d.length > 3 ? '…' : '') : ''}`);
  }
}
if (!found.length) lines.push('\n  Чисто.');
console.log(lines.join('\n'));
if (STRICT && nBad) process.exitCode = 1;
