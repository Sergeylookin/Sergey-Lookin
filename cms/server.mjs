// cms/server.mjs — локальный движок CMS. Запускается двойным кликом по CMS.bat.
//
// Ничего из этой папки не попадает на сайт: cms/ исключена в .github/workflows/deploy.yml,
// и ни одна страница сайта на неё не ссылается.
//
// Почему сервер, а не просто HTML-файл: браузер не умеет запускать git и не умеет
// жать картинки через sharp. Всё остальное живёт в cms/index.html.

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, extname } from 'node:path';
import { execFile } from 'node:child_process';
import { load } from 'cheerio';

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

function readDict($) {
  const raw = $('#i18n-data').html() || '{}';
  return JSON.parse(raw);
}

// Медиа-блок кейса: последовательность строк. Каждая — либо одна картинка во всю ширину,
// либо пара в .row. Видео и всё непонятное сохраняем как есть и не даём редактировать,
// чтобы не сломать руками собранную разметку.
function readMedia($) {
  const out = [];
  const pick = ($im) => ({ src: base($im.attr('src')), alt: $im.attr('alt') || '', w: $im.attr('width') || '', h: $im.attr('height') || '' });
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
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.xml': 'application/xml', '.ico': 'image/x-icon' };

const body = (req) => new Promise((ok) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c))); });

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = decodeURIComponent(url.pathname);
  try {
    if (path === '/' || path === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(readFileSync(resolve(HERE, 'index.html')));
    }
    if (path === '/api/model') return json(res, 200, { fields: FIELDS, cases: caseIds().map((n) => { const c = loadCase(n); return { n, title: c.dict.ru['p.title'], year: c.year, role: c.dict.ru['p.role'] }; }) });
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
    if (path === '/api/images') return json(res, 200, { images: readdirSync(IMGDIR).filter((f) => f.endsWith('.webp') && !/-(480|960|1440)\.webp$/.test(f)).map((f) => f.replace(/\.webp$/, '')).sort() });
    if (path === '/api/upload' && req.method === 'POST') {
      const name = url.searchParams.get('name');
      if (!/^[a-z0-9-]+$/.test(name || '')) return json(res, 400, { error: 'Имя только из латиницы, цифр и дефисов.' });
      const buf = await body(req);
      writeFileSync(resolve(IMGDIR, name + '.webp'), buf);
      const sharp = (await import('sharp')).default;
      const meta = await sharp(resolve(IMGDIR, name + '.webp')).metadata();
      for (const w of VARIANTS) { if (w >= meta.width) continue; await sharp(resolve(IMGDIR, name + '.webp')).resize({ width: w }).webp({ quality: 82 }).toFile(resolve(IMGDIR, `${name}-${w}.webp`)); }
      return json(res, 200, { ok: true, name, w: meta.width, h: meta.height, variants: variantsOf(name) });
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
      const add = await git('add', '--', 'index.html', 'portfolio.html', 'about.html', 'projects', 'en', 'assets/img', 'sitemap.xml');
      steps.push({ name: 'Отбор файлов', ok: add.code === 0, out: add.out.slice(-300) });
      const staged = await git('diff', '--cached', '--name-only');
      if (!staged.out.trim()) { steps.push({ name: 'Публикация', ok: true, out: 'Менять нечего — на сайте уже актуальная версия.' }); return json(res, 200, { ok: true, steps, nothing: true }); }
      const msg = JSON.parse((await body(req)).toString('utf8') || '{}').message || 'Правки через CMS';
      const ci = await git('commit', '-m', msg);
      steps.push({ name: 'Коммит', ok: ci.code === 0, out: ci.out.slice(-400) });
      if (ci.code !== 0) return json(res, 200, { ok: false, steps });
      const ps = await git('push', 'origin', 'main');
      steps.push({ name: 'Отправка', ok: ps.code === 0, out: ps.out.slice(-400) });
      return json(res, 200, { ok: ps.code === 0, steps, published: ps.code === 0 });
    }
    // всё остальное — сам сайт, чтобы превью было настоящим
    const f = resolve(ROOT, '.' + path);
    if (f.startsWith(ROOT) && existsSync(f) && extname(f)) {
      res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
      return res.end(readFileSync(f));
    }
    res.writeHead(404); res.end('нет такой страницы');
  } catch (e) {
    json(res, 500, { error: String(e && e.stack || e) });
  }
}).listen(PORT, () => {
  console.log(`\n  CMS открыта:  http://localhost:${PORT}\n  Проект:       ${ROOT}\n\n  Закрыть — просто закрой это окно.\n`);
});
