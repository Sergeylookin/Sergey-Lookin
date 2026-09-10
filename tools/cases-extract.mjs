// cases-extract.mjs — РАЗОВАЯ миграция: собирает реестр кейсов content/cases.json
// и переносит «карточные» строки из portfolio.html и index.html внутрь самих кейсов.
//
//   node tools/cases-extract.mjs [--dry]
//
// Зачем: сейчас номер кейса это ОДНОВРЕМЕННО адрес страницы, позиция в сетке и звено
// цепочки «следующий проект». Поэтому кейс нельзя ни добавить, ни скрыть, не сломав
// соседние. Реестр разводит их на три независимых поля: id (адрес, навсегда),
// order (позиция, меняется мышью), status (черновик / опубликован / архив).
//
// После миграции сетка портфолио и таблица #works ГЕНЕРИРУЮТСЯ (tools/build-cases.mjs),
// а не правятся руками.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { load } from 'cheerio';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');
const ids = Array.from({ length: 10 }, (_, i) => String(i + 1).padStart(2, '0'));

const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const strip = (s) => s.replace(/^﻿/, '');
const dictOf = (html) => JSON.parse(load(strip(html), { decodeEntities: false })('#i18n-data').html() || '{}');

const pf = strip(read('portfolio.html'));
const ix = strip(read('index.html'));
const $pf = load(pf, { decodeEntities: false });
const $ix = load(ix, { decodeEntities: false });
const pfD = dictOf(pf);
const ixD = dictOf(ix);

const cases = [];
const caseKeys = {};                       // id -> {ru:{...}, en:{...}} новые ключи для словаря кейса

ids.forEach((id, idx) => {
  const n = String(Number(id));            // 1..10 — так пронумерованы ключи cN.* и wk.N.*
  const $card = $pf(`a.case__link[href="projects/${id}.html"]`).closest('article');
  const $row = $ix(`a.wk-a[href="projects/${id}.html"]`);
  if (!$card.length) throw new Error(`нет карточки для ${id}`);
  if (!$row.length) throw new Error(`нет строки #works для ${id}`);

  const $vid = $card.find('video');
  const $img = $card.find('.case__media img');
  const cover = $vid.length
    ? { kind: 'vid', poster: base($vid.attr('poster')), video: ($vid.find('source').attr('src') || '').split('?')[0] }
    : { kind: 'img', poster: base($img.attr('src')) };

  const caseHtml = strip(read(`projects/${id}.html`));
  const cd = dictOf(caseHtml);

  cases.push({
    id,
    slug: $row.attr('data-slug') || '',
    order: idx + 1,
    status: 'published',
    cover,
    shots: $row.attr('data-shots') || '',
    pos: $row.attr('data-pos') || '',
    flip: $card.hasClass('case--flip'),
  });

  const k = { ru: {}, en: {} };
  for (const lang of ['ru', 'en']) {
    const P = lang === 'ru' ? pfD.ru : pfD.en;
    const I = lang === 'ru' ? ixD.ru : ixD.en;
    k[lang]['card.desc'] = P[`c${n}.desc`] ?? '';
    for (const t of [1, 2, 3]) if (P[`c${n}.t${t}`] != null) k[lang][`card.t${t}`] = P[`c${n}.t${t}`];
    k[lang]['works.title'] = I[`wk.${n}.t`] ?? '';
    k[lang]['works.dir'] = I[`wk.${n}.c`] ?? '';
    // год в таблице #works короче года кейса (колонка 4rem). Если он не просто
    // началом диапазона — сохраняем как есть, чтобы миграция ничего не сдвинула.
    if (lang === 'ru') {
      const rowYear = $row.find('.wk-y').text().trim();
      const caseYear = (() => {
        const $$ = load(caseHtml, { decodeEntities: false });
        let y = '';
        $$('.pcase__f').each((_i, el) => { if ($$(el).find('.l').attr('data-i18n') === 'f.year') y = $$(el).find('.v').text().trim(); });
        return y;
      })();
      if (rowYear && rowYear !== String(caseYear).split(/[—–-]/)[0].trim()) k.ru['works.year'] = rowYear;
    }
    // роль в таблице манифеста хранится ОТДЕЛЬНО только если она осознанно отличается
    const rowRole = I[`wk.${n}.r`] ?? '';
    if (rowRole && rowRole !== (cd[lang]['p.role'] ?? '')) k[lang]['works.role'] = rowRole;
  }
  caseKeys[id] = k;
});

function base(src) { return String(src || '').replace(/^.*\//, '').replace(/\.webp$/, ''); }

// вписываем новые ключи в словарь каждого кейса, ничего не удаляя
let touched = 0;
for (const id of ids) {
  const p = resolve(ROOT, 'projects', `${id}.html`);
  const orig = readFileSync(p, 'utf8');
  const bom = orig.charCodeAt(0) === 0xfeff;
  const html = strip(orig);
  const $ = load(html, { decodeEntities: false });
  const d = JSON.parse($('#i18n-data').html() || '{}');
  let changed = false;
  for (const lang of ['ru', 'en']) {
    for (const [key, val] of Object.entries(caseKeys[id][lang])) {
      if (d[lang][key] !== val) { d[lang][key] = val; changed = true; }
    }
  }
  if (!changed) continue;
  // точечная подмена только блока словаря — остальные байты не трогаем
  const m = html.match(/(<script id="i18n-data" type="application\/json">)([\s\S]*?)(<\/script>)/);
  if (!m) throw new Error(`нет блока i18n в ${id}`);
  const next = html.replace(m[0], m[1] + JSON.stringify(d) + m[3]);
  touched++;
  if (!DRY) writeFileSync(p, (bom ? '﻿' : '') + next, 'utf8');
}

const registry = { version: 1, cases };
if (!DRY) {
  mkdirSync(resolve(ROOT, 'content'), { recursive: true });
  writeFileSync(resolve(ROOT, 'content', 'cases.json'), JSON.stringify(registry, null, 2) + '\n', 'utf8');
}

console.log(`${DRY ? '[проба] ' : ''}реестр: ${cases.length} кейсов, ключи вписаны в ${touched} страниц`);
for (const c of cases) console.log(`  ${c.id}  ${String(c.slug).padEnd(12)} order=${c.order} ${c.status} обложка=${c.cover.kind}${c.flip ? ' flip' : ''}`);
