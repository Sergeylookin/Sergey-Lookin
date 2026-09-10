// build-cases.mjs — собирает всё, что зависит от СОСТАВА и ПОРЯДКА кейсов:
//   · сетку карточек в portfolio.html
//   · таблицу #works в index.html
//   · ссылки «следующий проект» в кейсах (цепочка по порядку)
//   · ключи словарей cN.* и wk.N.* — из данных самих кейсов
//   · noindex для черновиков и архива
//
//   node tools/build-cases.mjs           пересобрать
//   node tools/build-cases.mjs --check   только проверить (exit 1 при рассинхроне)
//
// Источник истины — content/cases.json (id / order / status) плюс словарь каждого кейса.
// Править сетку и таблицу руками больше нельзя: перезапишется.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { load } from 'cheerio';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const VARIANTS = [480, 960, 1440];

const strip = (s) => s.replace(/^﻿/, '');
const rd = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const hasBom = (p) => readFileSync(resolve(ROOT, p)).slice(0, 3).toString('hex') === 'efbbbf';
const dictOf = (html) => JSON.parse(load(strip(html), { decodeEntities: false })('#i18n-data').html() || '{}');
const esc = (s) => String(s == null ? '' : s).replace(/&(?!#?\w+;)/g, '&amp;').replace(/"/g, '&quot;');

export const registry = () => JSON.parse(rd('content/cases.json'));
export const liveCases = () => registry().cases
  .filter((c) => c.status === 'published')
  .sort((a, b) => a.order - b.order);
export const allCases = () => registry().cases.slice().sort((a, b) => a.order - b.order);

// ── подмена одного региона внутри файла, остальные байты не трогаем ──────────
function replaceInside(html, openMark, closeTag) {
  const s = html.indexOf(openMark);
  if (s < 0) throw new Error('не найден маркер: ' + openMark);
  const openEnd = html.indexOf('>', s);
  const open = new RegExp('<' + closeTag + '\\b', 'gi');
  const close = new RegExp('</' + closeTag + '\\s*>', 'gi');
  let depth = 1, i = openEnd + 1;
  for (;;) {
    open.lastIndex = i; close.lastIndex = i;
    const o = open.exec(html), c = close.exec(html);
    if (!c) throw new Error('не закрыт ' + closeTag);
    if (o && o.index < c.index) { depth++; i = o.index + 1; continue; }
    depth--;
    if (depth === 0) return { pre: html.slice(0, openEnd + 1), post: html.slice(c.index) };
    i = c.index + 1;
  }
}
const putInside = (html, openMark, closeTag, inner) => {
  const { pre, post } = replaceInside(html, openMark, closeTag);
  return pre + inner + post;
};
// Порядок ключей делаем ПОСТОЯННЫМ, а не «как найдено»: генерируемые ключи
// (cN.* и wk.N.*) появляются и исчезают вместе со скрытием кейса, и если класть
// их «куда придётся», каждое скрытие давало бы лишний диф на весь словарь.
// Правило: сначала ручные ключи в исходном порядке, затем генерируемые — по номеру.
const GENERATED = /^(?:c(\d+)\.|wk\.(\d+)\.)/;
function keepOrder(orig, next) {
  const out = {};
  for (const k of Object.keys(orig)) if (k in next && !GENERATED.test(k)) out[k] = next[k];
  for (const k of Object.keys(next)) if (!(k in out) && !GENERATED.test(k)) out[k] = next[k];
  const gen = Object.keys(next).filter((k) => GENERATED.test(k)).sort((a, b) => {
    const na = Number(RegExp('^(?:c(\\d+)\\.|wk\\.(\\d+)\\.)').exec(a).slice(1).find(Boolean));
    const nb = Number(RegExp('^(?:c(\\d+)\\.|wk\\.(\\d+)\\.)').exec(b).slice(1).find(Boolean));
    return na - nb || a.localeCompare(b);
  });
  for (const k of gen) out[k] = next[k];
  return out;
}

function putDict(html, dict) {
  const m = html.match(/(<script id="i18n-data" type="application\/json">)([\s\S]*?)(<\/script>)/);
  if (!m) throw new Error('нет блока i18n-data');
  const before = JSON.parse(m[2]);
  for (const lang of Object.keys(dict)) if (before[lang]) dict[lang] = keepOrder(before[lang], dict[lang]);
  // index.html держит словарь с пробелами после двоеточий, кейсы — вплотную.
  // Формат файла сохраняем: иначе каждая пересборка даёт диф на весь словарь.
  const spaced = m[2].startsWith('{"ru": ');
  const body = Object.entries(dict).map(([lang, kv]) => {
    const pairs = Object.entries(kv).map(([k, v]) => JSON.stringify(k) + (spaced ? ': ' : ':') + JSON.stringify(v));
    return JSON.stringify(lang) + (spaced ? ': {' : ':{') + pairs.join(spaced ? ', ' : ',') + '}';
  }).join(spaced ? ', ' : ',');
  return html.replace(m[0], m[1] + '{' + body + '}' + m[3]);
}

function srcset(name, wide, sizes) {
  const vs = VARIANTS.filter((w) => existsSync(resolve(ROOT, 'assets', 'img', `${name}-${w}.webp`)));
  if (!vs.length) return '';
  const parts = vs.map((w) => `assets/img/${name}-${w}.webp ${w}w`).concat([`assets/img/${name}.webp ${wide}w`]);
  return ` srcset="${parts.join(', ')}" sizes="${sizes}"`;
}

// ── карточка в сетке портфолио ──────────────────────────────────────────────
function card(c, pos, d) {
  const n = String(pos);
  const num = String(pos).padStart(2, '0');
  const title = d.ru['p.title'] || '';
  const flip = pos % 2 === 0 ? ' case--flip' : '';
  // Обложки может ещё не быть — у только что созданного кейса. Тогда вместо битой
  // картинки ставим пустую плашку: карточка остаётся целой, а проверка это подсветит.
  const hasCover = c.cover.poster && existsSync(resolve(ROOT, 'assets', 'img', `${c.cover.poster}.webp`));
  const media = !hasCover
    ? `<div class="case__ph" aria-hidden="true"></div>`
    : c.cover.kind === 'vid'
      ? `<video poster="assets/img/${c.cover.poster}.webp" muted loop playsinline preload="none" aria-label="${esc(title)}"><source src="${c.cover.video}?v=VERSION" type="video/mp4"></video>`
      : `<img src="assets/img/${c.cover.poster}.webp"${srcset(c.cover.poster, 1400, '(max-width: 860px) 92vw, 56vw')} alt="${esc(title)}" decoding="async" loading="lazy">`;
  const tags = [1, 2, 3]
    .filter((t) => d.ru[`card.t${t}`])
    .map((t) => `<span data-i18n="c${n}.t${t}">${d.ru[`card.t${t}`]}</span>`).join('');
  return `<article class="case${flip}" data-reveal>`
    + `<a class="case__link" href="projects/${c.id}.html" data-i18n-aria="c${n}.title" aria-label="${esc(title)}"></a>`
    + `<div class="case__media"><span class="case__num">${num}</span>${media}</div>`
    + `<div class="case__body"><div class="case__tags">${tags}</div>`
    + `<h2 class="case__title" data-i18n="c${n}.title">${title}</h2>`
    + `<p class="case__desc" data-i18n="c${n}.desc">${d.ru['card.desc'] || ''}</p>`
    + `<div class="case__meta"><span data-i18n="c${n}.role">${d.ru['p.role'] || ''}</span><span>${d.year}</span></div>`
    + `<span class="case__cta" data-i18n="pf.cta">Смотреть →</span></div></article>`;
}

// ── строка в таблице #works на манифесте ────────────────────────────────────
function workRow(c, pos, d) {
  const n = String(pos);
  const attrs = [`class="wk-a"`, `href="projects/${c.id}.html"`, `data-slug="${esc(c.slug)}"`,
    `data-cover="${c.cover.kind}"`, `data-shots="${esc(d.shots || c.shots)}"`];
  if (c.pos) attrs.push(`data-pos="${esc(c.pos)}"`);
  return `<li class="wk-row"><a ${attrs.join(' ')}>`
    + `<span class="wk-n">${String(pos).padStart(2, '0')}</span>`
    + `<span class="wk-y">${d.ru['works.year'] || shortYear(d.year)}</span>`
    + `<span class="wk-t" data-i18n="wk.${n}.t">${d.ru['works.title'] || d.ru['p.title'] || ''}</span>`
    + `<span class="wk-r" data-i18n="wk.${n}.r">${d.ru['works.role'] || d.ru['p.role'] || ''}</span>`
    + `<span class="wk-c" data-i18n="wk.${n}.c">${d.ru['works.dir'] || ''}</span>`
    + `</a></li>`;
}

// Колонка года в #works шириной 4rem: диапазон «2023—2026» туда не влезает.
const shortYear = (y) => String(y).split(/[—–-]/)[0].trim();

// data-shots — раскладка кадров для мобильной ленты и ховер-трейла на манифесте
// (assets/manifest.js собирает из неё <slug>-<n>-960.webp и пары -480).
// Выводим её ИЗ САМОГО МЕДИА-БЛОКА кейса: иначе добавил картинку — а на телефоне
// её нет, и никто об этом не узнает.
function deriveShots($) {
  const num = (src) => (String(src || '').match(/-(\d+)\.webp$/) || [])[1];
  const out = [];
  $('section.pcase__media').children().each((_i, el) => {
    const $el = $(el);
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (tag === 'img') { const n = num($el.attr('src')); if (n) out.push(n); }
    else if (tag === 'div' && $el.hasClass('row')) {
      const ns = [];
      $el.find('img').each((_j, im) => { const n = num($(im).attr('src')); if (n) ns.push(n); });
      if (ns.length) out.push(ns.join('+'));
    }
  });
  return out.join(',');
}

// ── чтение данных кейса ─────────────────────────────────────────────────────
function caseData(id) {
  const html = strip(rd(`projects/${id}.html`));
  const $ = load(html, { decodeEntities: false });
  const d = dictOf(html);
  let year = '';
  $('.pcase__f').each((_i, el) => {
    if ($(el).find('.l').attr('data-i18n') === 'f.year') year = $(el).find('.v').text().trim();
  });
  return { ru: d.ru, en: d.en, year, html, shots: deriveShots($) };
}

// ─────────────────────────────────────────────────────────────────────────────
const live = liveCases();
const data = {};
for (const c of allCases()) data[c.id] = caseData(c.id);

const problems = [];
const writes = [];
// Сравниваем без оглядки на переносы строк: в рабочей папке они могут быть
// CRLF (так их выгружает git), а генератор всегда пишет LF — иначе страж
// сообщал бы о рассинхроне на файле, который на самом деле совпадает.
const eol = (t) => String(t).split('\r\n').join('\n');
const queue = (rel, next) => {
  const cur = rd(rel);
  if (eol(strip(cur)) === eol(strip(next))) return;
  problems.push(rel);
  if (!CHECK) writes.push([rel, (hasBom(rel) ? '﻿' : '') + strip(next)]);
};

// ── portfolio.html: сетка + ключи cN.* ──────────────────────────────────────
{
  let html = strip(rd('portfolio.html'));
  const version = (html.match(/\?v=(\d+)/) || [, '188'])[1];
  const grid = '\n  ' + live.map((c, i) => card(c, i + 1, data[c.id]).replace('?v=VERSION', '?v=' + version)).join('\n  ') + '\n';
  // комментарий-инструкцию в начале сетки сохраняем: он объясняет, как поставить видео
  const lead = (html.match(/<main class="cases wrap">\s*(<!--[\s\S]*?-->)/) || [])[1];
  html = putInside(html, '<main class="cases wrap"', 'main', (lead ? '\n  ' + lead : '') + grid);
  const d = dictOf(html);
  for (const lang of ['ru', 'en']) {
    for (const k of Object.keys(d[lang])) if (/^c\d+\.(title|desc|role|t\d)$/.test(k)) delete d[lang][k];
    live.forEach((c, i) => {
      const n = i + 1, cd = data[c.id][lang];
      d[lang][`c${n}.title`] = cd['p.title'] || '';
      d[lang][`c${n}.desc`] = cd['card.desc'] || '';
      d[lang][`c${n}.role`] = cd['p.role'] || '';
      for (const t of [1, 2, 3]) if (cd[`card.t${t}`]) d[lang][`c${n}.t${t}`] = cd[`card.t${t}`];
    });
  }
  queue('portfolio.html', putDict(html, d));
}

// ── index.html: таблица #works + ключи wk.N.* ───────────────────────────────
{
  let html = strip(rd('index.html'));
  const rows = '\n' + live.map((c, i) => workRow(c, i + 1, data[c.id])).join('\n') + '\n';
  html = putInside(html, '<ul class="wk-list"', 'ul', rows);
  const d = dictOf(html);
  for (const lang of ['ru', 'en']) {
    for (const k of Object.keys(d[lang])) if (/^wk\.\d+\.[trc]$/.test(k)) delete d[lang][k];
    live.forEach((c, i) => {
      const n = i + 1, cd = data[c.id][lang];
      d[lang][`wk.${n}.t`] = cd['works.title'] || cd['p.title'] || '';
      d[lang][`wk.${n}.r`] = cd['works.role'] || cd['p.role'] || '';
      d[lang][`wk.${n}.c`] = cd['works.dir'] || '';
    });
  }
  queue('index.html', putDict(html, d));
}

// ── кейсы: «следующий проект» по цепочке + noindex у скрытых ────────────────
for (const c of allCases()) {
  let html = data[c.id].html;
  const i = live.findIndex((x) => x.id === c.id);
  const nxt = i < 0 ? live[0] : live[(i + 1) % live.length];
  if (nxt) {
    const npos = live.findIndex((x) => x.id === nxt.id) + 1;
    const d = dictOf(html);
    const inner = `<div class="pcase__full"><span class="eyebrow"><span data-i18n="ui.next">${d.ru['ui.next'] || 'Следующий проект'}</span> · ${String(npos).padStart(2, '0')}</span>`
      + `<div class="nt"><span data-i18n="ui.nextTitle">${data[nxt.id].ru['p.title'] || ''}</span></div></div>`;
    const m = html.match(/<a class="next-proj" href="[^"]*">/);
    if (m) {
      html = html.replace(m[0], `<a class="next-proj" href="${nxt.id}.html">`);
      html = putInside(html, '<a class="next-proj"', 'a', inner);
    }
    for (const lang of ['ru', 'en']) d[lang]['ui.nextTitle'] = data[nxt.id][lang]['p.title'] || '';
    html = putDict(html, d);
  }
  // черновик и архив прячем от поиска
  const hide = c.status !== 'published';
  const tag = '<meta name="robots" content="noindex, nofollow">';
  const has = html.includes(tag);
  if (hide && !has) html = html.replace('</head>', tag + '</head>');
  if (!hide && has) html = html.replace(tag, '');
  queue(`projects/${c.id}.html`, html);
}

// реестр держим в согласии с фактическим медиа кейса
if (!CHECK) {
  const reg = registry();
  let regChanged = false;
  for (const c of reg.cases) {
    const real = data[c.id] && data[c.id].shots;
    if (real != null && c.shots !== real) { c.shots = real; regChanged = true; }
  }
  if (regChanged) writeFileSync(resolve(ROOT, 'content/cases.json'), JSON.stringify(reg, null, 2) + '\n', 'utf8');
}

if (CHECK) {
  if (problems.length) { console.log('РАССИНХРОН: ' + problems.join(', ')); process.exit(1); }
  console.log('✔ сетка, таблица и ссылки соответствуют реестру');
} else {
  for (const [rel, body] of writes) writeFileSync(resolve(ROOT, rel), body, 'utf8');
  console.log(`✔ пересобрано: ${writes.length ? writes.map(([r]) => r).join(', ') : 'изменений нет'}`);
  console.log(`  на сайте ${live.length} из ${allCases().length} кейсов`);
}
