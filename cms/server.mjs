// cms/server.mjs — локальный движок CMS. Запускается двойным кликом по CMS.bat.
//
// Ничего из этой папки не попадает на сайт: cms/ исключена в .github/workflows/deploy.yml,
// и ни одна страница сайта на неё не ссылается.
//
// Почему сервер, а не просто HTML-файл: браузер не умеет запускать git и не умеет
// жать картинки через sharp. Всё остальное живёт в cms/index.html.

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, extname } from 'node:path';
import { execFile } from 'node:child_process';
import { load } from 'cheerio';

// sharp кэширует открытые файлы, и на Windows из-за этого не удаётся ни
// переименовать, ни перезаписать картинку, которую он недавно читал.
// Кэш выключаем: пара миллисекунд на чтение против сорванной замены файла.
const sharpMod = await import('sharp');
sharpMod.default.cache(false);

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const IMGDIR = resolve(ROOT, 'assets', 'img');
const PORT = 8150;
const VARIANTS = [480, 960, 1440];

// Ключи, которые редактируются в кейсе. Всё остальное (nav.*, ft.*, f.*, ui.all/next, skip)
// принадлежит общему каркасу и переписывается tools/build-pages.mjs — руками не трогаем.
const FIELDS = [
  { k: 'p.title',   label: 'Название',        kind: 'line',  hint: 'Заголовок кейса и первая строка вкладки браузера.' },
  { k: 'p.client',  label: 'Клиент',          kind: 'line',  hint: 'Первая плитка в шапке кейса.' },
  { k: 'p.role',    label: 'Роль',            kind: 'line',  hint: 'Показывается в ТРЁХ местах: шапка кейса, карточка в портфолио, таблица на манифесте. Проверка при сохранении поймает разнобой.' },
  { k: 'p.lead',    label: 'Лид',             kind: 'text',  hint: 'Крупная фраза под шапкой. Одно предложение — о чём проект.' },
  { k: 'p.m1.v',    label: 'Метрика 1 · значение', kind: 'line', hint: 'Крупное число в шапке. Ставь только то, что объяснишь, если спросят «как мерил?». Процент без базы сюда нельзя.' },
  { k: 'p.m1.l',    label: 'Метрика 1 · подпись',  kind: 'line', hint: 'Что именно считаем. Если число чужое — скажи чьё: «аудитория продукта», а не «пользователей».' },
  { k: 'p.m2.v',    label: 'Метрика 2 · значение', kind: 'line', hint: 'То же правило: цифра, за которую ты отвечаешь.' },
  { k: 'p.m2.l',    label: 'Метрика 2 · подпись',  kind: 'line', hint: 'Что считаем и чьё это.' },
  { k: 'p.m3.v',    label: 'Метрика 3 · значение', kind: 'line', hint: 'Если числа нет — лучше короткий факт, чем «1» или пустое слово.' },
  { k: 'p.m3.l',    label: 'Метрика 3 · подпись',  kind: 'line', hint: 'Что считаем и чьё это.' },
  { k: 'p.ov',      label: 'Обзор',           kind: 'text',  hint: 'Первый абзац. Что за проект и какая была твоя роль.' },
  { k: 'p.ta',      label: 'Задача',          kind: 'text',  hint: 'Что было не так. ОТСЮДА растут факты: сколько болей назовёшь — столько исходов от тебя ждут.' },
  { k: 'p.so',      label: 'Решение',         kind: 'text',  hint: 'Что ты сделал. Здесь уместны объёмы работы — они проверяемы.' },
  { k: 'p.re',      label: 'Результат',       kind: 'text',  hint: 'Что изменилось. Если итог принадлежит компании, а не тебе — так и напиши: «компания на этом отрезке…».' },
  { k: 'p.f1',      label: 'Факт 1',          kind: 'text',  hint: 'Список под текстом. Каждый факт закрывает ОДНУ боль из «Задачи». Если ни одну — он лишний. Можно <b>жирным</b>.' },
  { k: 'p.f2',      label: 'Факт 2',          kind: 'text',  hint: 'Не пересказывай «Решение» — здесь исход, а не то же самое другими словами.' },
  { k: 'p.f3',      label: 'Факт 3',          kind: 'text',  hint: 'Не пересказывай «Решение».' },
  { k: 'p.f4',      label: 'Факт 4',          kind: 'text',  hint: 'Чужое достижение подписывай: «компания получила…».' },
  { k: 'p.f5',      label: 'Факт 5',          kind: 'text',  hint: 'Необязательный. Пустое поле — строка исчезнет со страницы.', optional: true },
  { k: 'meta.title',       label: 'SEO · заголовок', kind: 'line', hint: 'Вкладка браузера и строка в выдаче Google.' },
  { k: 'meta.description', label: 'SEO · описание',  kind: 'text', hint: 'Подпись под ссылкой в поиске и в превью при отправке в мессенджер.' },
];
const EDITABLE = new Set(FIELDS.map((f) => f.k));

const casePath = (n) => resolve(ROOT, 'projects', `${n}.html`);
const caseIds = () => readdirSync(resolve(ROOT, 'projects')).filter((f) => /^\d\d\.html$/.test(f)).map((f) => f.slice(0, 2)).sort();

// ── реестр: id (адрес, навсегда) / order (позиция) / status (черновик-опубликован-архив) ──
const REG = resolve(ROOT, 'content', 'cases.json');
const readReg = () => JSON.parse(readFileSync(REG, 'utf8'));
function writeReg(reg) {
  reg.cases.sort((a, b) => a.order - b.order).forEach((c, i) => { c.order = i + 1; });
  const tmp = REG + '.tmp';
  writeFileSync(tmp, JSON.stringify(reg, null, 2) + '\n', 'utf8');
  renameSync(tmp, REG);
}
const STATUSES = ['published', 'hidden'];
const STATUS_RU = { published: 'На сайте', hidden: 'Скрыт' };

// ── остальные страницы сайта ────────────────────────────────────────────────
// Редактируются те же inline-словари. Не даём трогать две группы ключей:
//  · общий каркас (nav.*, ft.*, skip, f.*, ui.all/next) — им владеет build-pages.mjs;
//  · генерируемые cN.* и wk.N.* — их пересобирает build-cases.mjs из самих кейсов,
//    правка здесь просто потеряется при следующей сборке.
const PAGES = [
  { file: 'index.html', label: 'Манифест' },
  { file: 'about.html', label: 'Обо мне' },
  { file: 'portfolio.html', label: 'Портфолио — шапка' },
  { file: '404.html', label: 'Страница 404' },
];
const SHELL = /^(nav\.|ft\.|skip$|f\.(client|year|role)$|ui\.(all|next|nextTitle)$)/;
// Человеческие подписи для шапки и подвала — они одни на все страницы
// и правятся отдельным разделом, а не внутри каждой страницы.
const SHELL_LABELS = {
  'nav.brand': 'Имя и должность в шапке',
  'nav.manifesto': 'Пункт меню: Манифест',
  'nav.about': 'Пункт меню: Обо мне',
  'nav.pf': 'Пункт меню: Портфолио',
  'ft.copy': 'Копирайт в подвале',
  'ft.top': 'Кнопка «Наверх»',
  'skip': 'Ссылка для незрячих: перейти к содержанию',
};
const GENERATED = /^(?:c\d+\.|wk\.\d+\.)/;
const editableKey = (k) => !SHELL.test(k) && !GENERATED.test(k);

// Понятные имена групп — ключи сгруппированы по префиксу до первой точки.
const GROUPS = {
  meta: 'Поиск и превью в мессенджерах', hero: 'Первый экран', intro: 'Вступление',
  wk: 'Экран «Проекты»', credo: 'Принципы', whisper: 'Реплики на полях',
  ev: 'Оценка работы', bmp: 'Пропорция', tm: 'Команда', mentor: 'Менторство',
  aud: 'Аудитория', ds: 'Дизайн-системы', rs: 'Что получает бизнес',
  co: 'Где работал', cta: 'Контакты', ab: 'Текст «Обо мне»', pf: 'Заголовок портфолио',
  e404: 'Тексты 404', nf: 'Тексты 404',
};

function loadPage(page) {
  const raw = readFileSync(resolve(ROOT, page.file), 'utf8');
  const html = raw.replace(/^﻿/, '');
  const dict = JSON.parse(load(html, { decodeEntities: false })('#i18n-data').html() || '{}');
  const keys = Object.keys(dict.ru || {}).filter(editableKey);
  const groups = {};
  for (const k of keys) {
    const g = k.split('.')[0];
    (groups[g] = groups[g] || []).push(k);
  }
  return {
    file: page.file, label: page.label, dict,
    groups: Object.entries(groups).map(([g, ks]) => ({ id: g, label: GROUPS[g] || g, keys: ks })),
  };
}

function savePage(page, payload) {
  const p = resolve(ROOT, page.file);
  const orig = readFileSync(p, 'utf8');
  const bom = orig.charCodeAt(0) === 0xfeff;
  let html = orig.replace(/^﻿/, '');
  const dict = JSON.parse(load(html, { decodeEntities: false })('#i18n-data').html() || '{}');

  // Пишем ТОЛЬКО те ключи, что реально изменились. Иначе наступаем на грабли:
  // на некоторых страницах тело и словарь давно разошлись (в index.html заголовок
  // credo.title в теле один, а в словаре другой), и «переписать всё из словаря»
  // молча меняет текст сайта в местах, которых никто не просил трогать.
  const changed = { ru: [], en: [] };
  for (const lang of ['ru', 'en']) {
    for (const [k, v] of Object.entries(payload.dict[lang] || {})) {
      if (!editableKey(k) || !(k in (dict[lang] || {}))) continue;   // новых ключей не заводим
      if (dict[lang][k] === v) continue;
      dict[lang][k] = v;
      changed[lang].push(k);
    }
  }
  if (!changed.ru.length && !changed.en.length) return { changed: 0 };

  for (const k of changed.ru) {
    const nx = replaceInner(html, k, dict.ru[k]);
    if (nx) html = nx;
    // ключи, которые сидят в aria-label, а не в тексте
    html = html.replace(new RegExp(`(data-i18n-aria="${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*aria-label=")[^"]*(")`),
      (_m, a, b) => a + String(dict.ru[k]).replace(/"/g, '&quot;') + b);
  }
  if (changed.ru.includes('meta.title')) html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${dict.ru['meta.title']}</title>`);
  if (changed.ru.includes('meta.description')) {
    html = html.replace(/(<meta name="description" content=")[^"]*(")/, `$1${String(dict.ru['meta.description']).replace(/"/g, '&quot;')}$2`);
  }
  html = writeDict(html, dict);

  const tmp = p + '.tmp';
  writeFileSync(tmp, (bom ? '﻿' : '') + html, 'utf8');
  renameSync(tmp, p);
  return { changed: changed.ru.length + changed.en.length };
}

// index.html держит словарь с пробелами после двоеточий, кейсы — вплотную.
// Формат исходника сохраняем, иначе одна правка даёт диф на весь словарь.
function writeDict(html, dict) {
  const m = html.match(/(<script id="i18n-data" type="application\/json">)([\s\S]*?)(<\/script>)/);
  if (!m) return html;
  const spaced = m[2].startsWith('{"ru": ');
  const body = Object.entries(dict).map(([lang, kv]) => {
    const pairs = Object.entries(kv).map(([k, v]) => JSON.stringify(k) + (spaced ? ': ' : ':') + JSON.stringify(v));
    return JSON.stringify(lang) + (spaced ? ': {' : ':{') + pairs.join(spaced ? ', ' : ',') + '}';
  }).join(spaced ? ', ' : ',');
  return html.replace(m[0], m[1] + '{' + body + '}' + m[3]);
}

// Запись файла, которая не падает на Windows. Обычный «во временный + переименовать»
// ломается с EPERM, когда файл кто-то держит открытым — его только что читала
// медиатека, показывал браузер или трогал sharp. Сначала пробуем переименовать
// несколько раз, потом пишем поверх напрямую. Временный файл не оставляем в любом случае.
async function writeFileSafe(dst, buf) {
  const tmp = dst + '.tmp';
  writeFileSync(tmp, buf);
  for (let i = 0; i < 6; i++) {
    try { renameSync(tmp, dst); return true; }
    catch { await new Promise((r) => setTimeout(r, 120 * (i + 1))); }
  }
  try { writeFileSync(dst, buf); return true; }
  finally { try { rmSync(tmp, { force: true }); } catch {} }
}

// Windows какое-то время держит файл после записи (и sharp, и просмотрщик),
// поэтому удаление сразу после загрузки падало с EPERM. Пробуем несколько раз.
async function rmRetry(path, tries = 6) {
  for (let i = 0; i < tries; i++) {
    try { rmSync(path, { force: true }); if (!existsSync(path)) return true; }
    catch {}
    await new Promise((r) => setTimeout(r, 120 * (i + 1)));
  }
  return !existsSync(path);
}

// ── «Где работал» + бренды ──────────────────────────────────────────────────
const IDX = () => resolve(ROOT, 'index.html');

function readManifest() {
  const html = readFileSync(IDX(), 'utf8').replace(/^﻿/, '');
  const $ = load(html, { decodeEntities: false });
  const d = JSON.parse($('#i18n-data').html() || '{}');
  const companies = [];
  $('.co-list .co').each((i, el) => {
    const n = i + 1;
    companies.push({
      n,
      yrs: $(el).find('.yrs').html() || '',
      name: $(el).find('.name').html() || '',
      role: { ru: d.ru[`co.${n}.role`] || '', en: d.en[`co.${n}.role`] || '' },
      desc: { ru: d.ru[`co.${n}.desc`] || '', en: d.en[`co.${n}.desc`] || '' },
      aw: { ru: d.ru[`co.${n}.aw`] || '', en: d.en[`co.${n}.aw`] || '' },
    });
  });
  const brands = [];
  $('.brand-list span').each((_i, el) => brands.push($(el).html() || ''));
  return { companies, brands, brandLabel: { ru: d.ru['co.marquee.lbl'] || '', en: d.en['co.marquee.lbl'] || '' } };
}

function saveManifest(payload) {
  const p = IDX();
  const orig = readFileSync(p, 'utf8');
  const bom = orig.charCodeAt(0) === 0xfeff;
  let html = orig.replace(/^﻿/, '');
  const dict = JSON.parse(load(html, { decodeEntities: false })('#i18n-data').html() || '{}');
  const before = readManifest();
  let touched = 0;

  // годы и названия — обычный текст внутри .co-list, меняем точечно
  (payload.companies || []).forEach((c, i) => {
    const was = before.companies[i];
    if (!was) return;
    for (const [field, cls] of [['yrs', 'yrs'], ['name', 'name']]) {
      const next = String(c[field] ?? '');
      if (next === was[field]) continue;
      const re = new RegExp('(<div class="' + cls + '">)' + escRe(was[field]) + '(</div>)');
      if (re.test(html)) { html = html.replace(re, '$1' + next + '$2'); touched++; }
    }
    for (const f of ['role', 'desc', 'aw']) {
      for (const lang of ['ru', 'en']) {
        const key = `co.${c.n}.${f}`;
        const next = String((c[f] || {})[lang] ?? '');
        if (next === (was[f] || {})[lang]) continue;
        dict[lang][key] = next;
        if (lang === 'ru') { const nx = replaceInner(html, key, next); if (nx) html = nx; }
        touched++;
      }
    }
  });

  // бегущая строка брендов — простой список, пересобираем целиком
  if (Array.isArray(payload.brands) && payload.brands.join('|') !== before.brands.join('|')) {
    const inner = payload.brands.filter((b) => String(b).trim()).map((b) => `<span>${b}</span>`).join('');
    const m = html.match(/(<div class="brand-list">)([\s\S]*?)(<\/div>)/);
    if (m) { html = html.replace(m[0], m[1] + inner + m[3]); touched++; }
  }

  if (!touched) return { changed: 0 };
  html = writeDict(html, dict);
  const tmp = p + '.tmp';
  writeFileSync(tmp, (bom ? '﻿' : '') + html, 'utf8');
  renameSync(tmp, p);
  return { changed: touched };
}
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ── Медиатека ───────────────────────────────────────────────────────────────
// Собирает ВСЕ оригиналы из assets/img и для каждого ищет, где он используется.
// Это главное: заменить файл можно везде одинаково, а понять последствия —
// только если видно, в скольких местах он стоит.
function mediaLibrary() {
  const originals = readdirSync(IMGDIR)
    .filter((f) => f.endsWith('.webp') && !/-(480|960|1440)\.webp$/.test(f))
    .map((f) => f.replace(/\.webp$/, ''));

  // где искать: страницы сайта + кейсы + реестр обложек
  const scan = [];
  for (const p of ['index.html', 'about.html', 'portfolio.html', '404.html']) {
    if (existsSync(resolve(ROOT, p))) scan.push({ file: p, where: PAGES.find((x) => x.file === p)?.label || p, html: readFileSync(resolve(ROOT, p), 'utf8') });
  }
  const titles = {};
  for (const id of caseIds()) {
    const html = readFileSync(casePath(id), 'utf8');
    const d = JSON.parse(load(html.replace(/^﻿/, ''), { decodeEntities: false })('#i18n-data').html() || '{}');
    titles[id] = d.ru['p.title'] || id;
    scan.push({ file: `projects/${id}.html`, where: `Кейс ${id} · ${titles[id]}`, html });
  }
  let reg = { cases: [] };
  try { reg = readReg(); } catch {}

  const items = originals.map((name) => {
    const used = [];
    const re = new RegExp('(?:^|/)' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:-(?:480|960|1440))?\\.webp', 'i');
    for (const s of scan) if (re.test(s.html)) used.push({ file: s.file, where: s.where });
    for (const c of reg.cases) {
      if (c.cover && c.cover.poster === name) {
        used.push({ file: 'portfolio.html', where: `Обложка кейса ${c.id} · ${titles[c.id] || ''} — карточка в портфолио и ховер на манифесте` });
      }
    }
    // одна и та же страница могла попасться дважды — схлопываем
    const seen = new Set();
    const uniq = used.filter((u) => (seen.has(u.where) ? false : seen.add(u.where)));
    return { name, ...fileInfo(name), used: uniq };
  });

  items.sort((a, b) => (b.used.length - a.used.length) || a.name.localeCompare(b.name));
  return { items, total: items.length, unused: items.filter((i) => !i.used.length).length };
}

// Пересборка всего, что зависит от состава кейсов. Зовётся после любой операции.
async function rebuild() {
  const a = await node('build-cases.mjs');
  const b = await node('build-en.mjs');
  return { ok: a.code === 0 && b.code === 0, out: (a.out + b.out).slice(-500) };
}

function readDict($) {
  const raw = $('#i18n-data').html() || '{}';
  return JSON.parse(raw);
}

// Медиа-блок кейса: последовательность строк. Каждая — либо одна картинка во всю ширину,
// либо пара в .row. Видео и всё непонятное сохраняем как есть и не даём редактировать,
// чтобы не сломать руками собранную разметку.
// Про каждую картинку отдаём всё, что нужно показать в редакторе: вес, есть ли
// файл на диске, какие уменьшенные копии сделаны.
function fileInfo(name) {
  const f = resolve(IMGDIR, name + '.webp');
  if (!name || !existsSync(f)) return { exists: false, kb: 0, variants: [] };
  return { exists: true, kb: Math.round(statSync(f).size / 1024), variants: variantsOf(name) };
}

function readMedia($) {
  const out = [];
  const pick = ($im) => {
    const src = base($im.attr('src'));
    return { src, alt: $im.attr('alt') || '', w: $im.attr('width') || '', h: $im.attr('height') || '', ...fileInfo(src) };
  };
  $('section.pcase__media').contents().each((_i, el) => {
    if (el.type === 'comment') { out.push({ type: 'comment', html: '<!--' + el.data + '-->' }); return; }
    if (el.type === 'text') return;                       // отступы между блоками — воссоздаём сами
    const $el = $(el);
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (tag === 'img') {
      out.push({ type: 'full', ...pick($el) });
    } else if (tag === 'div' && $el.hasClass('row') && $el.find('video').length === 0) {
      const items = [];
      $el.find('img').each((_j, im) => items.push(pick($(im))));
      items.length ? out.push({ type: 'row', items }) : out.push({ type: 'raw', html: $.html($el) });
    } else {
      out.push({ type: 'raw', html: $.html($el) });
    }
  });
  return out;
}
const base = (src) => String(src || '').replace(/^.*\//, '').replace(/\.webp$/, '');

function variantsOf(name) {
  return VARIANTS.filter((w) => existsSync(resolve(IMGDIR, `${name}-${w}.webp`)));
}
function imgTag(it, kind) {
  const name = it.src;
  const vs = variantsOf(name);
  const sizes = kind === 'row' ? '(max-width: 860px) 100vw, 48vw' : '100vw';
  const wide = kind === 'row' ? 940 : 1920;
  const parts = vs.map((w) => `../assets/img/${name}-${w}.webp ${w}w`).concat([`../assets/img/${name}.webp ${wide}w`]);
  const srcset = vs.length ? ` srcset="${parts.join(', ')}" sizes="${sizes}"` : '';
  const esc = String(it.alt).replace(/"/g, '&quot;');
  // width/height обязательны: без них браузер не знает пропорций и страница дёргается при загрузке
  const dim = (it.w && it.h) ? ` width="${it.w}" height="${it.h}"` : '';
  return `<img src="../assets/img/${name}.webp"${srcset} alt="${esc}"${dim} decoding="async" loading="lazy">`;
}
function renderMedia(media) {
  const lines = media.map((m) => {
    if (m.type === 'raw' || m.type === 'comment') return '    ' + m.html.trim();
    if (m.type === 'full') return '    ' + imgTag(m, 'full');
    return '    <div class="row">' + m.items.map((i) => imgTag(i, 'row')).join('') + '</div>';
  });
  return '\n' + lines.join('\n') + '\n';
}

function loadCase(n) {
  const html = readFileSync(casePath(n), 'utf8').replace(/^﻿/, '');
  const $ = load(html, { decodeEntities: false });
  const dict = readDict($);
  let year = '';
  $('.pcase__f').each((_i, el) => {
    if ($(el).find('.l').attr('data-i18n') === 'f.year') year = $(el).find('.v').text().trim();
  });
  return { n, dict, year, media: readMedia($), nextTitle: dict.ru['ui.nextTitle'] || '' };
}

// ── Точечная запись ────────────────────────────────────────────────────────
// НЕ пересобираем документ целиком: cheerio при сериализации переписывает весь
// файл (сносит "/>", дописывает crossorigin="") и каждое сохранение давало бы
// диф на всю страницу. Поэтому меняем ровно те куски, которыми владеем,
// а остальные байты не трогаем.

// Находит элемент по data-i18n="key" и подменяет его внутренности.
// Идёт от открывающего тега со счётчиком вложенности одноимённых тегов,
// поэтому <b> и <span> внутри факта не сбивают поиск.
function replaceInner(html, key, inner) {
  const at = html.indexOf(`data-i18n="${key}"`);
  if (at < 0) return null;
  const lt = html.lastIndexOf('<', at);
  const tag = (html.slice(lt + 1).match(/^[a-zA-Z][a-zA-Z0-9]*/) || [null])[0];
  if (!tag) return null;
  const openEnd = html.indexOf('>', at);
  if (openEnd < 0) return null;
  const open = new RegExp(`<${tag}\\b`, 'gi');
  const close = new RegExp(`</${tag}\\s*>`, 'gi');
  let depth = 1, i = openEnd + 1;
  while (depth > 0) {
    open.lastIndex = i; close.lastIndex = i;
    const o = open.exec(html), c = close.exec(html);
    if (!c) return null;
    if (o && o.index < c.index) { depth++; i = o.index + 1; }
    else { depth--; i = c.index + (depth === 0 ? 0 : 1); if (depth === 0) return html.slice(0, openEnd + 1) + inner + html.slice(c.index); }
  }
  return null;
}

// Удаляет элемент вместе с его <li>-обёрткой (для пустого факта).
function removeItem(html, key) {
  const at = html.indexOf(`data-i18n="${key}"`);
  if (at < 0) return html;
  const li = html.lastIndexOf('<li', at);
  const end = html.indexOf('</li>', at);
  if (li < 0 || end < 0) return html;
  return html.slice(0, li) + html.slice(end + 5);
}

function replaceRegion(html, startMark, inner) {
  const s = html.indexOf(startMark);
  if (s < 0) return null;
  const openEnd = html.indexOf('>', s);
  const closeAt = html.indexOf('</section>', openEnd);
  if (closeAt < 0) return null;
  return html.slice(0, openEnd + 1) + inner + html.slice(closeAt);
}

function saveCase(n, payload) {
  const p = casePath(n);
  const orig = readFileSync(p, 'utf8');
  const bom = orig.charCodeAt(0) === 0xfeff;
  let html = orig.replace(/^﻿/, '');
  const dict = JSON.parse(load(html, { decodeEntities: false })('#i18n-data').html() || '{}');

  const dropped = [];
  for (const lang of ['ru', 'en']) {
    for (const [k, v] of Object.entries(payload.dict[lang] || {})) {
      if (!EDITABLE.has(k)) continue;
      if (String(v).trim() === '') { delete dict[lang][k]; if (lang === 'ru') dropped.push(k); }
      else dict[lang][k] = v;
    }
  }

  // тело RU из ru-словаря — та же логика, что у build-en.mjs для английских страниц
  for (const k of EDITABLE) {
    if (k.startsWith('meta.')) continue;                 // meta живёт в <head>, ниже отдельно
    if (dropped.includes(k)) { html = removeItem(html, k); continue; }
    if (!(k in dict.ru)) continue;
    const next = replaceInner(html, k, dict.ru[k]);
    if (next) html = next;
  }

  // <title> и <meta name="description"> — из meta.* ru
  if (dict.ru['meta.title']) html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${dict.ru['meta.title']}</title>`);
  if (dict.ru['meta.description']) {
    html = html.replace(/(<meta name="description" content=")[^"]*(")/, `$1${dict.ru['meta.description'].replace(/"/g, '&quot;')}$2`);
  }

  // год — обычный текст, ключа i18n у него нет
  html = html.replace(/(data-i18n="f\.year">[^<]*<\/div><div class="v">)[^<]*(<\/div>)/, `$1${payload.year}$2`);

  if (payload.media) {
    const next = replaceRegion(html, '<section class="pcase__full pcase__media"', renderMedia(payload.media));
    if (next) html = next;
  }

  const nd = replaceInner(html.replace('id="i18n-data"', 'id="i18n-data" data-i18n="__dict__"'), '__dict__', JSON.stringify(dict));
  if (nd) html = nd.replace(' data-i18n="__dict__"', '');

  const tmp = p + '.tmp';
  writeFileSync(tmp, (bom ? '﻿' : '') + html, 'utf8');
  renameSync(tmp, p);
}

// Запускаем строго по абсолютным путям: при старте двойным кликом из Проводника
// в PATH дочернего процесса может не быть ни node, ни git.
const NODE = process.execPath;
const GIT = (() => {
  const guesses = [
    'git',
    'C:\\Program Files\\Git\\cmd\\git.exe',
    'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
    join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'cmd', 'git.exe'),
    join(process.env.LOCALAPPDATA || '', 'GitHubDesktop', 'app-3.4.3', 'resources', 'app', 'git', 'cmd', 'git.exe'),
  ];
  for (const g of guesses.slice(1)) if (existsSync(g)) return g;
  return guesses[0];
})();

const run = (cmd, args) => new Promise((ok) => {
  execFile(cmd, args, { cwd: ROOT, maxBuffer: 1 << 24, windowsHide: true }, (e, so, se) =>
    ok({ code: e ? (e.code ?? 1) : 0, out: String(so || '') + String(se || '') }));
});
const node = (script, ...a) => run(NODE, [resolve(ROOT, 'tools', script), ...a]);
const git = (...a) => run(GIT, a);

// Проверки перед публикацией — ровно те ошибки, что мы вычищали руками.
function validate() {
  const problems = [];
  const roles = {}, years = {};
  for (const n of caseIds()) {
    const c = loadCase(n);
    roles[n] = c.dict.ru['p.role']; years[n] = c.year;
    const ta = String(c.dict.ru['p.ta'] || '');
    const facts = [1, 2, 3, 4, 5].map((i) => c.dict.ru[`p.f${i}`]).filter(Boolean);
    for (const [k, v] of Object.entries(c.dict.ru)) {
      if (!EDITABLE.has(k)) continue;
      const m = String(v).match(/[+−-]?\d+(?:[.,]\d+)?\s*%/);
      if (m && !/\b(из|до|с)\b/.test(String(v))) problems.push({ lvl: 'warn', n, msg: `«${m[0]}» в поле ${k} — процент без базы. Сможешь объяснить, как мерил?` });
    }
    if (!facts.length) problems.push({ lvl: 'warn', n, msg: 'Нет ни одного факта — список под текстом будет пустым.' });
    if (ta && facts.length < 2) problems.push({ lvl: 'info', n, msg: 'Задача описана, а фактов меньше двух — исходы не закрыты.' });
    for (const m of c.media) {
      const items = m.type === 'row' ? m.items : m.type === 'full' ? [m] : [];
      for (const i of items) {
        if (!i.alt.trim()) problems.push({ lvl: 'warn', n, msg: `У картинки ${i.src} пустой alt.` });
        if (!existsSync(resolve(IMGDIR, i.src + '.webp'))) problems.push({ lvl: 'err', n, msg: `Картинки ${i.src}.webp нет на диске.` });
      }
    }
  }
  // роль кейса против карточки в портфолио и таблицы на манифесте
  const pf = load(readFileSync(resolve(ROOT, 'portfolio.html'), 'utf8').replace(/^﻿/, ''), { decodeEntities: false });
  const ix = load(readFileSync(resolve(ROOT, 'index.html'), 'utf8').replace(/^﻿/, ''), { decodeEntities: false });
  for (const n of caseIds()) {
    const i = String(Number(n));
    const card = pf(`[data-i18n="c${i}.role"]`).first().text().trim();
    const row = ix(`[data-i18n="wk.${i}.r"]`).first().text().trim();
    if (card && roles[n] && card !== roles[n]) problems.push({ lvl: 'warn', n, msg: `Роль «${roles[n]}» в кейсе против «${card}» в карточке портфолио.` });
    if (row && roles[n] && row !== roles[n]) problems.push({ lvl: 'info', n, msg: `Роль «${roles[n]}» в кейсе против «${row}» в таблице манифеста.` });
  }
  return problems;
}

const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.xml': 'application/xml', '.ico': 'image/x-icon', '.pdf': 'application/pdf', '.mp4': 'video/mp4' };

const body = (req) => new Promise((ok) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c))); });

const srv = createServer(async (req, res) => {
  // Разбор адреса ВНУТРИ try: кривой запрос (например «//») роняет new URL,
  // а вместе с ним ронял и весь сервер — CMS просто закрывалась.
  let url, path;
  try {
    url = new URL(req.url, 'http://localhost');
    path = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400); return res.end('плохой адрес');
  }
  try {
    // Интерфейс CMS живёт по своему адресу, а не по «/». Иначе главная сайта
    // недостижима, и в превью манифеста открывалась сама же CMS.
    if (path === '/__cms' || path === '/__cms/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(readFileSync(resolve(HERE, 'index.html')));
    }
    if (path === '/' || path === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(readFileSync(resolve(ROOT, 'index.html')));
    }
    if (path === '/api/model') {
      const reg = readReg();
      const byId = Object.fromEntries(reg.cases.map((c) => [c.id, c]));
      const cases = reg.cases.slice().sort((a, b) => a.order - b.order).map((rc) => {
        const c = loadCase(rc.id);
        // сколько заполненных русских полей осталось без английского — чтобы
        // недопереведённый кейс было видно из списка, а не только зайдя внутрь
        let needsEn = 0;
        for (const k of EDITABLE) {
          if (String(c.dict.ru[k] ?? '').trim() && !String(c.dict.en[k] ?? '').trim()) needsEn++;
        }
        return { n: rc.id, title: c.dict.ru['p.title'], year: c.year, role: c.dict.ru['p.role'],
                 status: rc.status, order: rc.order, cover: rc.cover, slug: rc.slug, needsEn };
      });
      return json(res, 200, { fields: FIELDS, cases, statuses: STATUSES, statusRu: STATUS_RU });
    }

    // создать новый кейс: копия шаблона с очищенным содержимым, сразу черновик
    if (path === '/api/case/new' && req.method === 'POST') {
      const { title = 'Новый кейс', slug = '' } = JSON.parse((await body(req)).toString('utf8') || '{}');
      const reg = readReg();
      const ids = caseIds();
      const id = String(Math.max(...ids.map(Number)) + 1).padStart(2, '0');
      const src = readFileSync(casePath(ids[ids.length - 1]), 'utf8');
      const bom = src.charCodeAt(0) === 0xfeff;
      let html = src.replace(/^﻿/, '');
      const d = JSON.parse(load(html, { decodeEntities: false })('#i18n-data').html() || '{}');
      // чистим всё содержательное, каркас и служебные ключи оставляем
      for (const lang of ['ru', 'en']) {
        for (const k of Object.keys(d[lang])) {
          if (EDITABLE.has(k) || k.startsWith('card.') || k.startsWith('works.')) d[lang][k] = '';
        }
        d[lang]['p.title'] = title;
        d[lang]['meta.title'] = title + ' · Сергей Лукин';
      }
      for (const k of EDITABLE) { const nx = replaceInner(html, k, d.ru[k] ?? ''); if (nx) html = nx; }
      html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${d.ru['meta.title']}</title>`);
      html = html.replace(/(data-i18n="f\.year">[^<]*<\/div><div class="v">)[^<]*(<\/div>)/, `$1$2`);
      const md = replaceRegion(html, '<section class="pcase__full pcase__media"', '\n');
      if (md) html = md;
      html = html.replace(/projects\/\d\d\.html/g, `projects/${id}.html`);
      const nd = replaceInner(html.replace('id="i18n-data"', 'id="i18n-data" data-i18n="__dict__"'), '__dict__', JSON.stringify(d));
      if (nd) html = nd.replace(' data-i18n="__dict__"', '');
      writeFileSync(casePath(id), (bom ? '﻿' : '') + html, 'utf8');
      reg.cases.push({ id, slug: slug || 'case-' + id, order: 9999, status: 'hidden',
                       cover: { kind: 'img', poster: '' }, shots: '', pos: '', flip: false });
      writeReg(reg);
      const r = await rebuild();
      return json(res, 200, { ok: r.ok, id, out: r.out });
    }

    if (path === '/api/order' && req.method === 'POST') {
      const { ids } = JSON.parse((await body(req)).toString('utf8'));
      const reg = readReg();
      ids.forEach((id, i) => { const c = reg.cases.find((x) => x.id === id); if (c) c.order = i + 1; });
      writeReg(reg);
      const r = await rebuild();
      return json(res, 200, { ok: r.ok, out: r.out });
    }

    if (path.startsWith('/api/case/') && path.endsWith('/status') && req.method === 'POST') {
      const id = path.split('/')[3];
      const { status } = JSON.parse((await body(req)).toString('utf8'));
      if (!STATUSES.includes(status)) return json(res, 400, { error: 'неизвестный статус' });
      const reg = readReg();
      const c = reg.cases.find((x) => x.id === id);
      if (!c) return json(res, 404, { error: 'нет такого кейса' });
      if (status !== 'published' && reg.cases.filter((x) => x.status === 'published').length <= 1)
        return json(res, 400, { error: 'Это последний кейс на сайте — сетка портфолио опустеет. Сначала опубликуй другой.' });
      c.status = status;
      writeReg(reg);
      const r = await rebuild();
      return json(res, 200, { ok: r.ok, out: r.out });
    }

    if (path.startsWith('/api/case/') && path.endsWith('/duplicate') && req.method === 'POST') {
      const from = path.split('/')[3];
      const reg = readReg();
      const ids = caseIds();
      const id = String(Math.max(...ids.map(Number)) + 1).padStart(2, '0');
      let html = readFileSync(casePath(from), 'utf8');
      const bom = html.charCodeAt(0) === 0xfeff;
      html = html.replace(/^﻿/, '').replace(/projects\/\d\d\.html/g, `projects/${id}.html`);
      const d = JSON.parse(load(html, { decodeEntities: false })('#i18n-data').html() || '{}');
      for (const lang of ['ru', 'en']) d[lang]['p.title'] = (d[lang]['p.title'] || '') + (lang === 'ru' ? ' (копия)' : ' (copy)');
      const t = replaceInner(html, 'p.title', d.ru['p.title']); if (t) html = t;
      const nd = replaceInner(html.replace('id="i18n-data"', 'id="i18n-data" data-i18n="__dict__"'), '__dict__', JSON.stringify(d));
      if (nd) html = nd.replace(' data-i18n="__dict__"', '');
      writeFileSync(casePath(id), (bom ? '﻿' : '') + html, 'utf8');
      const src = reg.cases.find((x) => x.id === from);
      reg.cases.push({ ...JSON.parse(JSON.stringify(src)), id, slug: (src.slug || 'case') + '-copy', order: 9999, status: 'hidden' });
      writeReg(reg);
      const r = await rebuild();
      return json(res, 200, { ok: r.ok, id, out: r.out });
    }

    // удаление навсегда: только по точному совпадению названия, как в GitHub
    if (path.startsWith('/api/case/') && path.endsWith('/delete') && req.method === 'POST') {
      const id = path.split('/')[3];
      const { confirm } = JSON.parse((await body(req)).toString('utf8'));
      const c = loadCase(id);
      if ((confirm || '').trim() !== (c.dict.ru['p.title'] || '').trim())
        return json(res, 400, { error: 'Название не совпало — кейс не тронут.' });
      const reg = readReg();
      reg.cases = reg.cases.filter((x) => x.id !== id);
      writeReg(reg);
      rmSync(casePath(id), { force: true });
      rmSync(resolve(ROOT, 'en', 'projects', `${id}.html`), { force: true });
      const r = await rebuild();
      return json(res, 200, { ok: r.ok, out: r.out });
    }

    if (path.startsWith('/api/case/') && path.endsWith('/cover') && req.method === 'POST') {
      const id = path.split('/')[3];
      const { poster, kind } = JSON.parse((await body(req)).toString('utf8'));
      const reg = readReg();
      const c = reg.cases.find((x) => x.id === id);
      if (!c) return json(res, 404, { error: 'нет такого кейса' });
      c.cover = { ...c.cover, kind: kind || c.cover.kind || 'img', poster: poster || '' };
      writeReg(reg);
      const r = await rebuild();
      return json(res, 200, { ok: r.ok, out: r.out });
    }
    if (path.startsWith('/api/case/')) {
      const n = path.split('/')[3];
      if (req.method === 'GET') return json(res, 200, loadCase(n));
      if (req.method === 'POST') {
        saveCase(n, JSON.parse((await body(req)).toString('utf8')));
        const b = await node('build-en.mjs');
        if (b.code !== 0) console.log('[build-en] код ' + b.code + ' :: ' + b.out.slice(-500));
        return json(res, 200, { ok: true, en: b.code === 0, enOut: b.out.slice(-300), problems: validate() });
      }
    }
    // ── остальные страницы сайта ──────────────────────────────────────────
    if (path === '/api/pages') return json(res, 200, { pages: PAGES.map(({ file, label }) => ({ file, label })) });

    if (path.startsWith('/api/page/')) {
      const file = decodeURIComponent(path.slice('/api/page/'.length));
      const page = PAGES.find((p) => p.file === file);
      if (!page) return json(res, 404, { error: 'нет такой страницы' });
      if (req.method === 'GET') return json(res, 200, loadPage(page));
      if (req.method === 'POST') {
        savePage(page, JSON.parse((await body(req)).toString('utf8')));
        const b = await node('build-en.mjs');
        return json(res, 200, { ok: b.code === 0, out: b.out.slice(-300) });
      }
    }

    // ── CV: два PDF, русский и английский. Имена файлов постоянны, чтобы
    // ссылки в about.html не приходилось трогать при каждой замене.
    if (path === '/api/cv') {
      const info = (lang) => {
        const f = resolve(ROOT, 'assets', 'cv', `sergey-lookin-cv-${lang}.pdf`);
        if (!existsSync(f)) return null;
        const st = statSync(f);
        return { name: `sergey-lookin-cv-${lang}.pdf`, kb: Math.round(st.size / 1024), at: st.mtime.toISOString().slice(0, 10) };
      };
      return json(res, 200, { ru: info('ru'), en: info('en') });
    }
    if (path === '/api/cv/upload' && req.method === 'POST') {
      const lang = url.searchParams.get('lang');
      if (lang !== 'ru' && lang !== 'en') return json(res, 400, { error: 'Нужно указать язык.' });
      const buf = await body(req);
      if (buf.slice(0, 5).toString() !== '%PDF-') return json(res, 400, { error: 'Это не PDF. Нужен файл .pdf.' });
      if (buf.length > 25 * 1024 * 1024) return json(res, 400, { error: 'Файл больше 25 МБ — слишком тяжело для сайта.' });
      mkdirSync(resolve(ROOT, 'assets', 'cv'), { recursive: true });
      const dst = resolve(ROOT, 'assets', 'cv', `sergey-lookin-cv-${lang}.pdf`);
      await writeFileSafe(dst, buf);
      return json(res, 200, { ok: true, lang, kb: Math.round(buf.length / 1024) });
    }

    if (path === '/api/images') return json(res, 200, { images: readdirSync(IMGDIR).filter((f) => f.endsWith('.webp') && !/-(480|960|1440)\.webp$/.test(f)).map((f) => f.replace(/\.webp$/, '')).sort() });
    if (path === '/api/upload' && req.method === 'POST') {
      // Имя подбирает СЕРВЕР, сверяясь с диском: клиент видит только картинки
      // текущего кейса и мог бы затереть чужой файл с тем же номером.
      const stem = url.searchParams.get('stem');
      if (!/^[a-z0-9-]+$/.test(stem || '')) return json(res, 400, { error: 'Основа имени — только латиница, цифры и дефисы.' });
      let k = 1, name;
      do { name = `${stem}-${k++}`; } while (existsSync(resolve(IMGDIR, name + '.webp')));
      const buf = await body(req);
      if (!buf.length) return json(res, 400, { error: 'Пустой файл.' });
      if (buf.slice(8, 12).toString() !== 'WEBP') return json(res, 400, { error: 'Это не webp. Экспортируй из Figma в webp.' });
      writeFileSync(resolve(IMGDIR, name + '.webp'), buf);
      const sharp = sharpMod.default;
      const meta = await sharp(resolve(IMGDIR, name + '.webp')).metadata();
      for (const w of VARIANTS) { if (w >= meta.width) continue; await sharp(resolve(IMGDIR, name + '.webp')).resize({ width: w }).webp({ quality: 82 }).toFile(resolve(IMGDIR, `${name}-${w}.webp`)); }
      return json(res, 200, { ok: true, name, w: meta.width, h: meta.height, variants: variantsOf(name) });
    }
    // ── видео-обложки кейсов ─────────────────────────────────────────────
    if (path === '/api/video' && req.method === 'POST') {
      const slug = url.searchParams.get('slug');
      if (!/^[a-z0-9-]+$/.test(slug || '')) return json(res, 400, { error: 'Неверное имя.' });
      const buf = await body(req);
      if (buf.slice(4, 8).toString() !== 'ftyp') return json(res, 400, { error: 'Это не mp4. Нужен файл .mp4.' });
      if (buf.length > 40 * 1024 * 1024) return json(res, 400, { error: 'Больше 40 МБ — тяжело для сайта.' });
      mkdirSync(resolve(ROOT, 'assets', 'vid'), { recursive: true });
      const dst = resolve(ROOT, 'assets', 'vid', slug + '.mp4');
      await writeFileSafe(dst, buf);
      return json(res, 200, { ok: true, slug, mb: (buf.length / 1048576).toFixed(1) });
    }

    // ── история версий: последние публикации и откат ─────────────────────
    // ── состояние сборки на GitHub после публикации ──────────────────────
    // Кнопка говорит «отправлено», а сайт обновляется ещё пару минут.
    // Спрашиваем GitHub, на каком шаге дело, и показываем это человеку.
    if (path === '/api/deploy') {
      const remote = (await git('remote', 'get-url', 'origin')).out.trim();
      const m = remote.match(/github\.com[/:]([^/]+)\/([^/.\s]+)/);
      if (!m) return json(res, 200, { unknown: true });
      const local = (await git('rev-parse', 'HEAD')).out.trim().slice(0, 7);
      try {
        const r = await fetch(`https://api.github.com/repos/${m[1]}/${m[2]}/actions/runs?per_page=3`,
          { headers: { 'accept': 'application/vnd.github+json' } });
        if (!r.ok) return json(res, 200, { unknown: true, why: 'GitHub ответил ' + r.status });
        const runs = (await r.json()).workflow_runs || [];
        const mine = runs.find((x) => x.head_sha.slice(0, 7) === local) || runs[0];
        if (!mine) return json(res, 200, { unknown: true });
        return json(res, 200, {
          sha: mine.head_sha.slice(0, 7), forThisVersion: mine.head_sha.slice(0, 7) === local,
          status: mine.status, conclusion: mine.conclusion, url: mine.html_url,
          site: `https://${m[1].toLowerCase()}.github.io/${m[2]}/`,
        });
      } catch (e) { return json(res, 200, { unknown: true, why: 'нет связи с GitHub' }); }
    }

    if (path === '/api/history') {
      const g = await git('log', '-25', '--format=%h%ci%s');
      const items = g.out.split('\n').filter(Boolean).map((l) => {
        const [hash, date, subj] = l.split('');
        return { hash, date: (date || '').slice(0, 16), subj };
      });
      const ahead = await git('log', 'origin/main..HEAD', '--format=%h');
      return json(res, 200, { items, unpublished: ahead.out.split('\n').filter(Boolean).length });
    }
    if (path === '/api/history/revert' && req.method === 'POST') {
      const { hash } = JSON.parse((await body(req)).toString('utf8'));
      if (!/^[0-9a-f]{6,40}$/.test(hash || '')) return json(res, 400, { error: 'Неверная версия.' });
      const dirty = await git('status', '--porcelain');
      const pend = dirty.out.split('\n').filter((l) => l.trim() && !l.startsWith('??')).map((l) => l.slice(3).trim());
      if (pend.length)
        return json(res, 400, { error: 'Сначала сохрани или отмени правки в: ' + pend.slice(0, 4).join(', ') + (pend.length > 4 ? ` и ещё ${pend.length - 4}` : '') + '.' });
      const r = await git('revert', '--no-edit', hash);
      if (r.code !== 0) {
        await git('revert', '--abort');
        return json(res, 400, { error: 'Не удалось откатить — правки поверх этой версии мешают. Откатывай с конца, по одной.' });
      }
      const b = await rebuild();
      return json(res, 200, { ok: b.ok, out: r.out.slice(-300) });
    }

    // ── шапка и подвал: одни на все страницы ─────────────────────────────
    // Текст лежит в content/shell.json, оттуда его берёт build-pages.mjs.
    // Раньше он был зашит в скрипте сборки, и правка на странице затиралась.
    if (path === '/api/shell') {
      const F = resolve(ROOT, 'content', 'shell.json');
      if (req.method === 'GET') {
        const d = JSON.parse(readFileSync(F, 'utf8'));
        return json(res, 200, { ru: d.ru, en: d.en, labels: SHELL_LABELS });
      }
      if (req.method === 'POST') {
        const inc = JSON.parse((await body(req)).toString('utf8'));
        const d = JSON.parse(readFileSync(F, 'utf8'));
        let changed = 0;
        for (const lang of ['ru', 'en'])
          for (const k of Object.keys(d[lang]))
            if (inc[lang] && inc[lang][k] != null && inc[lang][k] !== d[lang][k]) { d[lang][k] = inc[lang][k]; changed++; }
        if (changed) {
          await writeFileSafe(F, Buffer.from(JSON.stringify(d, null, 2) + '\n', 'utf8'));
          // build-pages переписывает шапку и подвал во всех страницах,
          // а словари подтягиваем сами — иначе смена языка вернёт старый текст
          for (const f of [...PAGES.map((x) => x.file), ...caseIds().map((n) => `projects/${n}.html`)]) {
            const abs = resolve(ROOT, f);
            if (!existsSync(abs)) continue;
            const orig = readFileSync(abs, 'utf8');
            const bom = orig.charCodeAt(0) === 0xfeff;
            let html = orig.replace(/^﻿/, '');
            const dict = JSON.parse(load(html, { decodeEntities: false })('#i18n-data').html() || '{}');
            let touched = false;
            for (const lang of ['ru', 'en'])
              for (const [k, v] of Object.entries(d[lang]))
                if (k in (dict[lang] || {}) && dict[lang][k] !== v) { dict[lang][k] = v; touched = true; }
            if (!touched) continue;
            html = writeDict(html, dict);
            await writeFileSafe(abs, Buffer.from((bom ? '﻿' : '') + html, 'utf8'));
          }
          await node('build-pages.mjs');
          await node('build-en.mjs');
        }
        return json(res, 200, { ok: true, changed });
      }
    }

    // ── блок «Где работал» и бегущая строка брендов на манифесте ────────
    // Годы и названия компаний лежат обычным текстом, а роль/описание/награда —
    // переводимыми ключами. Правим их вместе, иначе один блок пришлось бы
    // собирать в двух разных местах интерфейса.
    if (path === '/api/manifest') {
      if (req.method === 'GET') return json(res, 200, readManifest());
      if (req.method === 'POST') {
        const r = saveManifest(JSON.parse((await body(req)).toString('utf8')));
        const b = await node('build-en.mjs');
        return json(res, 200, { ok: b.code === 0, ...r });
      }
    }

    // ── медиатека: все картинки сайта и где каждая используется ──────────
    if (path === '/api/media') return json(res, 200, mediaLibrary());

    if (path === '/api/media/delete' && req.method === 'POST') {
      const { name } = JSON.parse((await body(req)).toString('utf8'));
      const lib = mediaLibrary();
      const it = lib.items.find((x) => x.name === name);
      if (!it) return json(res, 404, { error: 'нет такого файла' });
      if (it.used.length) return json(res, 400, { error: 'Файл используется: ' + it.used.map((u) => u.where).join('; ') + '. Сначала убери его оттуда.' });
      const failed = [];
      for (const f of [`${name}.webp`, ...VARIANTS.map((w) => `${name}-${w}.webp`)]) {
        if (!(await rmRetry(resolve(IMGDIR, f)))) failed.push(f);
      }
      if (failed.length) return json(res, 500, { error: 'Не удалось удалить: ' + failed.join(', ') + '. Файл занят другой программой — закрой просмотрщик и попробуй ещё раз.' });
      return json(res, 200, { ok: true });
    }

    // заменить КОНКРЕТНЫЙ файл, имя сохраняется — ссылки на него не рвутся
    if (path === '/api/replace' && req.method === 'POST') {
      const name = url.searchParams.get('name');
      if (!/^[a-z0-9-]+$/.test(name || '')) return json(res, 400, { error: 'Неверное имя файла.' });
      const buf = await body(req);
      if (buf.slice(8, 12).toString() !== 'WEBP') return json(res, 400, { error: 'Это не webp. Экспортируй из Figma в webp.' });
      const dst = resolve(IMGDIR, name + '.webp');
      await writeFileSafe(dst, buf);
      const sharp = sharpMod.default;
      const meta = await sharp(dst).metadata();
      for (const w of VARIANTS) {
        const v = resolve(IMGDIR, `${name}-${w}.webp`);
        if (w >= meta.width) { if (existsSync(v)) rmSync(v, { force: true }); continue; }
        await sharp(dst).resize({ width: w }).webp({ quality: 82 }).toFile(v);
      }
      return json(res, 200, { ok: true, name, w: meta.width, h: meta.height, ...fileInfo(name) });
    }

    if (path === '/api/validate') return json(res, 200, { problems: validate() });
    if (path === '/api/changes') { const g = await git('status', '--short'); return json(res, 200, { files: g.out.split('\n').map((s) => s.trim()).filter(Boolean) }); }
    if (path === '/api/publish' && req.method === 'POST') {
      const steps = [];
      for (const [name, script] of [['Сборка EN', 'build-en.mjs'], ['Каркас', 'build-pages.mjs']]) {
        const r = await node(script); steps.push({ name, ok: r.code === 0, out: r.out.slice(-600) });
        if (r.code !== 0) return json(res, 200, { ok: false, steps });
      }
      const p = validate();
      if (p.some((x) => x.lvl === 'err')) { steps.push({ name: 'Проверка', ok: false, out: p.filter((x) => x.lvl === 'err').map((x) => x.msg).join('\n') }); return json(res, 200, { ok: false, steps, problems: p }); }
      steps.push({ name: 'Проверка', ok: true, out: `замечаний: ${p.length}` });
      // Отправляем ВСЁ, что CMS умеет менять. Раньше здесь не было 404.html,
      // резюме, видео и реестра кейсов — правка этих мест молча не публиковалась,
      // кнопка отвечала «менять нечего».
      const add = await git('add', '--',
        'index.html', 'portfolio.html', 'about.html', '404.html',
        'projects', 'en', 'content',
        'assets/img', 'assets/cv', 'assets/vid',
        'sitemap.xml');
      steps.push({ name: 'Отбор файлов', ok: add.code === 0, out: add.out.slice(-300) });
      const staged = await git('diff', '--cached', '--name-only');
      // Новых правок в файлах может не быть, а неотправленные версии — быть:
      // так бывает после отката, который сам создаёт версию. Её тоже надо
      // довезти до сайта, иначе кнопка молча отвечает «менять нечего».
      if (!staged.out.trim()) {
        const ahead = await git('log', 'origin/main..HEAD', '--format=%h');
        const n = ahead.out.split('\n').filter(Boolean).length;
        if (!n) { steps.push({ name: 'Публикация', ok: true, out: 'Менять нечего — на сайте уже актуальная версия.' }); return json(res, 200, { ok: true, steps, nothing: true }); }
        steps.push({ name: 'Готово к отправке', ok: true, out: `версий без публикации: ${n}` });
        const ps0 = await git('push', 'origin', 'main');
        steps.push({ name: 'Отправка', ok: ps0.code === 0, out: ps0.out.slice(-400) });
        return json(res, 200, { ok: ps0.code === 0, steps, published: ps0.code === 0 });
      }
      const msg = JSON.parse((await body(req)).toString('utf8') || '{}').message || 'Правки через CMS';
      // Сообщение передаём ФАЙЛОМ, а не аргументом: на Windows кириллица
      // в командной строке доезжает до git испорченной, и в истории
      // оставались кракозябры вместо подписи к правке.
      const msgFile = resolve(ROOT, '.git', 'CMS_MSG');
      writeFileSync(msgFile, msg + '\n', 'utf8');
      const ci = await git('-c', 'i18n.commitEncoding=UTF-8', 'commit', '-F', msgFile);
      rmSync(msgFile, { force: true });
      steps.push({ name: 'Коммит', ok: ci.code === 0, out: ci.out.slice(-400) });
      if (ci.code !== 0) return json(res, 200, { ok: false, steps });
      const ps = await git('push', 'origin', 'main');
      steps.push({ name: 'Отправка', ok: ps.code === 0, out: ps.out.slice(-400) });
      return json(res, 200, { ok: ps.code === 0, steps, published: ps.code === 0 });
    }
    // всё остальное — сам сайт, чтобы превью было настоящим.
    // Страницы ссылаются на ассеты абсолютно — /Sergey-Lookin/assets/… — потому что
    // сайт живёт в подпапке GitHub Pages. Локально мы отдаём проект с корня, поэтому
    // этот префикс снимаем: иначе 404-я и часть страниц открывались бы без стилей.
    const localPath = path.startsWith('/Sergey-Lookin/') ? path.slice('/Sergey-Lookin'.length) : path;
    const f = resolve(ROOT, '.' + localPath);
    if (f.startsWith(ROOT) && existsSync(f) && extname(f)) {
      res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
      return res.end(readFileSync(f));
    }
    res.writeHead(404); res.end('нет такой страницы');
  } catch (e) {
    json(res, 500, { error: String(e && e.stack || e) });
  }
});

// Сеть безопасности: что бы ни случилось в одном запросе, окно CMS не должно
// закрываться. Иначе человек теряет несохранённые правки и не понимает почему.
process.on('uncaughtException', (e) => console.log('\n  Сбой в запросе (CMS продолжает работать):\n  ' + (e && e.stack || e) + '\n'));
process.on('unhandledRejection', (e) => console.log('\n  Сбой в запросе (CMS продолжает работать):\n  ' + (e && e.stack || e) + '\n'));

const URL_LOCAL = `http://localhost:${PORT}/__cms`;

srv.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log(`\n  Порт ${PORT} уже занят — похоже, CMS уже запущена.\n  Открой ${URL_LOCAL} или закрой прошлое окно и запусти снова.\n`);
    openBrowser(URL_LOCAL);
  } else {
    console.log('\n  Не удалось запустить: ' + e.message + '\n');
  }
  process.exitCode = 1;
});

srv.listen(PORT, () => {
  console.log(`\n  CMS открыта:  ${URL_LOCAL}\n  Проект:       ${ROOT}\n\n  Закрыть — просто закрой это окно.\n`);
  // Браузер открываем САМИ и только когда порт уже слушает: иначе он успевает
  // постучаться раньше и показывает «не удаётся получить доступ к сайту».
  if (!process.argv.includes('--no-open')) openBrowser(URL_LOCAL);
});

function openBrowser(url) {
  execFile('rundll32', ['url.dll,FileProtocolHandler', url], () => {});
}
