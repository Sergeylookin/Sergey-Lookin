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
import { syncHeadMeta } from '../tools/head-meta.mjs';
import { SCREEN_NAMES, FIXED_SCREENS, ATTR_RULES, ARIA_LABELS, META_LABELS, SIDE_DEFAULTS, TEXT_RULES, labelsFor, fallbackLabel } from './labels.mjs';

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

// Что за картинку принесли. Расширению в имени файла не верим — смотрим
// первые байты: из Фигмы и Скетча файл нередко приезжает с чужим суффиксом.
function imageKind(b) {
  if (b.length < 12) return null;
  if (b[0] === 0x89 && b.slice(1, 4).toString() === 'PNG') return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}

// Приводим к webp: весь сайт на нём, и картинки грузятся через srcset.
// «keep» — файл уже webp, кладём как есть, ни одного пикселя не трогаем.
// «lossless» — пиксель в пиксель, просто другой контейнер.
// «compress» — q90: на глаз неотличимо, вес обычно в 5–10 раз меньше.
async function toWebp(buf, mode) {
  if (mode === 'keep') return buf;
  const s = sharpMod.default(buf);
  return mode === 'lossless' ? s.webp({ lossless: true }).toBuffer() : s.webp({ quality: 90 }).toBuffer();
}

// Разбираем, что делать с присланным файлом, и заодно объясняем ошибку
// человеческим языком, а не «unsupported image format».
async function intake(buf, want) {
  const kind = imageKind(buf);
  if (!kind) return { error: 'Не похоже на картинку. Нужен PNG, JPG или WebP.' };
  let mode = want && ['keep', 'compress', 'lossless'].includes(want) ? want : (kind === 'webp' ? 'keep' : 'compress');
  if (kind !== 'webp' && mode === 'keep') mode = 'compress'; // png/jpg как есть на сайт не кладём
  try { return { buf: await toWebp(buf, mode), kind, mode, was: buf.length }; }
  catch { return { error: 'Не удалось прочитать картинку — файл повреждён или это не изображение.' }; }
}

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
  // Эти ключи живут только в словаре кейса: на его странице их нет, а в сетку
  // портфолио и в таблицу на главной их разносит tools/build-cases.mjs.
  { k: 'card.desc', label: 'Описание на карточке', kind: 'text', hint: 'Одна фраза под названием кейса в сетке портфолио.' },
  { k: 'card.t1',   label: 'Тег 1',           kind: 'line',  hint: 'Мелкие теги над названием карточки в портфолио. Пустое поле — тега нет.', optional: true },
  { k: 'card.t2',   label: 'Тег 2',           kind: 'line',  hint: 'Второй тег карточки. Пустое поле — тега нет.', optional: true },
  { k: 'card.t3',   label: 'Тег 3',           kind: 'line',  hint: 'Третий тег карточки. Пустое поле — тега нет.', optional: true },
  { k: 'works.title', label: 'Название в таблице', kind: 'line', hint: 'Строка кейса в таблице «Проекты» на главной. Пусто — берётся название кейса.', optional: true },
  { k: 'works.role', label: 'Роль в таблице', kind: 'line',  hint: 'Колонка «Роль» в таблице на главной. Пусто — берётся роль из шапки кейса.', optional: true },
  { k: 'works.dir', label: 'Направление',     kind: 'line',  hint: 'Последняя колонка таблицы на главной. Одно слово: Бренд, Веб, Система, Полный цикл.' },
  { k: 'works.year', label: 'Год в таблице',  kind: 'line',  hint: 'Колонка года в таблице узкая, диапазон «2023—2026» в неё не влезает. Пусто — берётся первый год кейса. Год не переводится, поэтому поле одно.', optional: true, neutral: true },
  { k: 'meta.title',       label: 'Заголовок для поиска и превью', kind: 'line', hint: 'Вкладка браузера, строка в выдаче Google и заголовок превью в мессенджере.' },
  { k: 'meta.description', label: 'Описание для поиска и превью',  kind: 'text', hint: 'Подпись под ссылкой в поиске и в превью при отправке в мессенджер.' },
];
const EDITABLE = new Set(FIELDS.map((f) => f.k));
// Ключи, которых нет в разметке кейса: пустое значение у них — это просто пустая
// строка в словаре, удалять ключ и искать элемент на странице незачем.
const DICT_ONLY = /^(card|works)\./;

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
const SHELL = /^(nav\.|ft\.(copy|top)$|skip$|f\.(client|year|role)$|ui\.(all|next|nextTitle)$)/;
// Подпись справа в подвале (ft.tag) своя у главной и у 404 — там её и правят.
// На остальных страницах её ставит сборка каркаса, и правка была бы затёрта.
const OWN_FOOT = new Set(['index.html', '404.html']);
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

// Скрытый экран лежит в файле внутри <template data-off="id">: браузер его не
// рисует, скрипты сайта его не видят, поисковик не читает. Для разбора разметки
// шаблон разворачиваем в обычный блок — иначе cheerio внутрь не заглянет.
const TPL_RE = /<template data-off="([^"]*)">([\s\S]*?)<\/template>/g;
const openTemplates = (html) => html.replace(TPL_RE, '<div data-off="$1">$2</div>');

const decAttr = (s) => String(s ?? '').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const encAttr = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Ширина текстовой рамки — «max-width:42ch!important» в style самой надписи.
// Никакого другого места у неё нет: правило уезжает вместе с элементом и в
// английскую версию, и при перестановке экранов.
const WIDTH_RE = /max-width:\s*(\d{2,3}(?:\.\d)?ch)\s*!important/;
function widthsOf($) {
  const out = {};
  $('[data-i18n][style]').each((_i, el) => {
    const m = String($(el).attr('style') || '').match(WIDTH_RE);
    const k = $(el).attr('data-i18n');
    if (m && !(k in out)) out[k] = m[1];
  });
  return out;
}

// Картинка превью для мессенджеров — одна на главную, «Обо мне» и портфолио.
const OG_FILE = resolve(ROOT, 'assets', 'og', 'og-cover.png');
const OG_PAGES = ['index.html', 'about.html', 'portfolio.html'];
async function ogInfo() {
  if (!existsSync(OG_FILE)) return null;
  try {
    const m = await sharpMod.default(OG_FILE).metadata();
    return { file: 'assets/og/og-cover.png', w: m.width, h: m.height, kb: Math.round(statSync(OG_FILE).size / 1024) };
  } catch { return null; }
}

// Модель страницы для редактора: экраны в том порядке, в каком они идут на сайте,
// внутри — поля в порядке разметки, с человеческими названиями (cms/labels.mjs).
function loadPage(page) {
  const raw = readFileSync(resolve(ROOT, page.file), 'utf8');
  const html = raw.replace(/^﻿/, '');
  const $ = load(openTemplates(html), { decodeEntities: false });
  const dict = JSON.parse($('#i18n-data').html() || '{}');
  const labels = labelsFor($, page.file);
  const attrRules = ATTR_RULES[page.file] || [];

  const screens = [];
  const byId = new Map();
  const screenOf = (id, name, extra = {}) => {
    if (!byId.has(id)) { const s = { id, name, fields: [], ...extra }; byId.set(id, s); screens.push(s); }
    return byId.get(id);
  };
  // экраны заводим заранее и в порядке страницы — даже те, где нет ни одного поля
  $('main section[id]').each((_i, el) => {
    const $s = $(el), id = $s.attr('id');
    screenOf(id, SCREEN_NAMES[id] || id, {
      hidden: $s.closest('[data-off]').length > 0,
      fixed: FIXED_SCREENS.has(id),
      num: ($s.find('.sec-aside--right b').first().text() || '').trim(),
    });
  });
  const hasScreens = screens.length > 0;
  // надпись вне экранов на странице с экранами — это подвал
  const home = (el) => {
    const $sec = $(el).closest('section[id]');
    if (hasScreens && $sec.length) return byId.get($sec.attr('id'));
    return hasScreens ? screenOf('@foot', 'Подвал страницы') : screenOf('@page', page.label);
  };

  const attrs = {};
  const seen = new Set();
  if (!OWN_FOOT.has(page.file)) seen.add('ft.tag');
  // у каждого экрана первым полем — его название в боковом указателе сайта
  if (hasScreens) {
    for (const sc of screens) {
      const $s = $('main section[id="' + sc.id + '"]');
      const id = '@nav:' + sc.id;
      attrs[id] = { ru: decAttr($s.attr('data-nav-ru')) || SIDE_DEFAULTS.ru[sc.id] || '', en: decAttr($s.attr('data-nav-en')) || SIDE_DEFAULTS.en[sc.id] || '' };
      sc.fields.push({ k: id, label: 'Название в боковом указателе', attr: true, short: true,
        hint: 'Одно слово у правого края сайта: оно показывает, в каком разделе сейчас читатель, и стоит в меню разделов. Не обязано совпадать с названием раздела.' });
    }
  }
  $('[data-i18n], [data-i18n-aria]').each((_i, el) => {
    const $el = $(el);
    const k = $el.attr('data-i18n');
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (k && !seen.has(k) && editableKey(k) && k in (dict.ru || {})) {
      seen.add(k);
      // auto — название подобрано по типу тега, а не по правилу: значит, для этой
      // надписи правила в cms/labels.mjs ещё нет (самопроверка это подсветит)
      home(el).fields.push(labels[k] ? { k, label: labels[k] } : { k, label: fallbackLabel(tag), auto: true });
      // поле-атрибут ставим сразу за надписью, к которой оно относится
      for (const r of attrRules) {
        if (!$el.is(r.sel)) continue;
        const sibs = $el.parent().children(r.nOf || r.sel);
        let n = 0; for (let j = 0; j < sibs.length; j++) if (sibs[j] === el) n = j + 1;
        const id = '@' + r.ru + ':' + k;
        attrs[id] = { ru: decAttr($el.attr(r.ru)), en: decAttr($el.attr(r.en)) };
        home(el).fields.push({ k: id, label: r.label.replace('{n}', String(n)), attr: true });
      }
    }
    const a = $el.attr('data-i18n-aria');
    if (a && !seen.has(a) && editableKey(a) && a in (dict.ru || {})) {
      seen.add(a);
      home(el).fields.push({ k: a, label: ARIA_LABELS[a] || 'Подпись для экранных читалок', aria: true });
    }
  });
  if (!screens.length) screenOf('@page', page.label);

  // надписи прямо в разметке (cms/labels.mjs → TEXT_RULES)
  for (const r of TEXT_RULES[page.file] || []) {
    const sc = byId.get(r.screen); if (!sc) continue;
    const pick = (re) => decAttr(((html.match(re) || [])[2]) ?? '');
    const id = '@text:' + r.id;
    attrs[id] = { ru: pick(r.ru.re), en: pick(r.en.re) };
    sc.fields.push({ k: id, label: r.label, attr: true, short: true, hint: r.hint, live: { ru: r.ru.sel, en: r.en.sel } });
  }

  const metaKeys = ['meta.title', 'meta.description'].filter((k) => k in (dict.ru || {}));
  if (metaKeys.length) {
    const s = screenOf('@meta', 'Поиск и превью в мессенджерах');
    for (const k of metaKeys) { seen.add(k); s.fields.push({ k, label: META_LABELS[k][0], hint: META_LABELS[k][1] }); }
  }
  // Ключи-пути (data-i18n-href) — это адреса файлов, а не текст: их меняет загрузка
  // файла, руками править нельзя. Всё прочее, чего нет в разметке, показываем отдельно.
  const sys = new Set(); $('[data-i18n-href]').each((_i, el) => sys.add($(el).attr('data-i18n-href')));
  const rest = Object.keys(dict.ru || {}).filter((k) => editableKey(k) && !seen.has(k) && !sys.has(k));
  if (rest.length) { const s = screenOf('@rest', 'Прочие надписи'); for (const k of rest) s.fields.push({ k, label: 'Надпись' }); }

  // картинки самой страницы: всё в <main>, кроме сетки кейсов — её собирает build-cases
  const images = [];
  $('main img[src]').each((_i, el) => {
    const $im = $(el);
    if ($im.closest('.cases, .case').length) return;
    const name = base($im.attr('src'));
    if (!name || images.some((x) => x.name === name)) return;
    images.push({ name, alt: $im.attr('alt') || '', w: $im.attr('width') || '', h: $im.attr('height') || '', ...fileInfo(name) });
  });

  return {
    file: page.file, label: page.label, dict, screens, attrs, widths: widthsOf($), images,
    canStructure: hasScreens,
    // старое поле для совместимости: группа = экран
    groups: screens.map((s) => ({ id: s.id, label: s.name, keys: s.fields.filter((f) => !f.attr).map((f) => f.k) })),
  };
}

// Подмена ВСЕХ вхождений ключа. Один и тот же ключ бывает на странице дважды:
// надпись карточки «Ремесла» стоит и в свёрнутом, и в раскрытом виде, реплики
// «Аудитории» продублированы для бегущей строки.
function replaceInnerAll(html, key, inner) {
  const mark = `data-i18n="${key}"`;
  let from = 0, hit = false;
  for (;;) {
    const at = html.indexOf(mark, from);
    if (at < 0) break;
    const r = replaceInnerAt(html, at, inner);
    if (!r) break;
    html = r[0]; from = r[1]; hit = true;
  }
  return hit ? html : null;
}

// Открывающий тег элемента с данным ключом: [начало, конец, текст].
function openTagOf(html, key) {
  const at = html.indexOf(`data-i18n="${key}"`);
  if (at < 0) return null;
  const lt = html.lastIndexOf('<', at), gt = html.indexOf('>', at);
  if (lt < 0 || gt < 0) return null;
  return [lt, gt + 1, html.slice(lt, gt + 1)];
}

function setAttrOnKey(html, key, attr, value) {
  const t = openTagOf(html, key);
  if (!t) return null;
  const re = new RegExp('(\\s' + attr + '=")[^"]*(")');
  if (!re.test(t[2])) return null;                       // новых атрибутов не заводим
  return html.slice(0, t[0]) + t[2].replace(re, (_m, a, b) => a + encAttr(value) + b) + html.slice(t[1]);
}

// val: '' — убрать рамку, '42ch' — поставить. Остальные правила в style не трогаем.
function setMaxWidth(html, key, val) {
  const t = openTagOf(html, key);
  if (!t) return null;
  let tag = t[2];
  const cur = (tag.match(/\sstyle="([^"]*)"/) || [])[1];
  const decls = (cur || '').split(';').map((s) => s.trim()).filter((d) => d && !/^max-width\s*:/.test(d));
  if (val) decls.push(`max-width:${val}!important`);
  const style = decls.join(';');
  if (cur != null) tag = style ? tag.replace(/\sstyle="[^"]*"/, ` style="${style}"`) : tag.replace(/\sstyle="[^"]*"/, '');
  else if (style) tag = tag.replace(/\s*\/?>$/, (end) => ` style="${style}"` + (end.includes('/') ? ' />' : '>'));
  return html.slice(0, t[0]) + tag + html.slice(t[1]);
}
// Текст внутри элемента: кавычки остаются как есть, опасны только & и угловые скобки.
const encText = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Название экрана для бокового указателя сайта. Совпало с тем, что зашито в скрипте
// сайта, — атрибут не нужен и убирается: так «поменял и вернул» даёт исходный файл.
function setSectionNav(html, sid, lang, value) {
  const re = new RegExp('<section\\b[^>]*\\bid="' + sid.replace(/[^a-z0-9_-]/gi, '') + '"[^>]*>');
  const m = html.match(re);
  if (!m) return null;
  const attr = 'data-nav-' + lang;
  const def = (SIDE_DEFAULTS[lang] || {})[sid] || '';
  let tag = m[0];
  const has = new RegExp('\\s' + attr + '="[^"]*"');
  if (!value || value === def) tag = tag.replace(has, '');
  else if (has.test(tag)) tag = tag.replace(has, ` ${attr}="${encAttr(value)}"`);
  else tag = tag.replace(/>$/, ` ${attr}="${encAttr(value)}">`);
  return tag === m[0] ? html : html.slice(0, m.index) + tag + html.slice(m.index + m[0].length);
}

const okWidth = (v) => v === '' || (/^\d{2,3}(\.\d)?ch$/.test(v) && parseFloat(v) >= 12 && parseFloat(v) <= 140);

// Применяет к разметке ширины рамок и поля-атрибуты, пришедшие из редактора.
// Возвращает [html, сколько изменено]. Пишет только то, что реально отличается.
function applyExtras(html, payload, file) {
  let n = 0;
  if (payload.widths) {
    const now = widthsOf(load(openTemplates(html), { decodeEntities: false }));
    for (const [k, v] of Object.entries(payload.widths)) {
      const val = String(v || '');
      if (!okWidth(val) || (now[k] || '') === val) continue;
      const nx = setMaxWidth(html, k, val);
      if (nx) { html = nx; n++; }
    }
  }
  if (payload.attrs) {
    // название экрана в боковом указателе: атрибут на самом <section>
    for (const [id, v] of Object.entries(payload.attrs)) {
      if (!id.startsWith('@nav:')) continue;
      const sid = id.slice(5);
      for (const lang of ['ru', 'en']) {
        if (v[lang] == null) continue;
        const nx = setSectionNav(html, sid, lang, String(v[lang]).trim());
        if (nx && nx !== html) { html = nx; n++; }
      }
    }
    // надписи в разметке
    for (const r of TEXT_RULES[file] || []) {
      const v = payload.attrs['@text:' + r.id];
      if (!v) continue;
      for (const lang of ['ru', 'en']) {
        if (v[lang] == null) continue;
        const m = html.match(r[lang].re);
        if (!m || decAttr(m[2]) === String(v[lang])) continue;
        html = html.replace(r[lang].re, (_m, a, _b, c) => a + encText(v[lang]) + c);
        n++;
      }
    }
    for (const r of ATTR_RULES[file] || []) {
      for (const [id, v] of Object.entries(payload.attrs)) {
        if (!id.startsWith('@' + r.ru + ':')) continue;   // @nav: и @text: разобраны выше
        const key = id.slice(r.ru.length + 2);
        const t = openTagOf(html, key);
        if (!t) continue;
        for (const [lang, attr] of [['ru', r.ru], ['en', r.en]]) {
          if (v[lang] == null) continue;
          const was = decAttr((t[2].match(new RegExp('\\s' + attr + '="([^"]*)"')) || [])[1]);
          if (was === String(v[lang])) continue;
          const nx = setAttrOnKey(html, key, attr, String(v[lang]));
          if (nx) { html = nx; n++; }
        }
      }
    }
  }
  return [html, n];
}

// ── экраны страницы: порядок и видимость ────────────────────────────────────
// Страница — это цепочка <section id> внутри <main>. Скрытый экран обёрнут в
// <template data-off>. Разбираем <main> на блоки; если между экранами нашлось
// что-то кроме пробелов, разметка не та, на которую мы рассчитываем, — не трогаем.
function readStructure(html) {
  const open = html.indexOf('<main');
  const close = html.lastIndexOf('</main>');
  if (open < 0 || close < 0) return null;
  const openEnd = html.indexOf('>', open) + 1;
  const inner = html.slice(openEnd, close);
  const re = /(<template data-off="[^"]*">\s*)?(<section\b[^>]*\bid="([^"]+)"[^>]*>[\s\S]*?<\/section>)(\s*<\/template>)?/g;
  const blocks = [];
  let last = 0, lead = '', m;
  while ((m = re.exec(inner))) {
    const gap = inner.slice(last, m.index);
    if (gap.trim()) return null;
    // Пробелы после экрана принадлежат ему и ездят вместе с ним. Тогда «скрыл и
    // вернул» или «переставил и вернул» даёт файл байт в байт как был.
    if (blocks.length) blocks[blocks.length - 1].sep = gap; else lead = gap;
    blocks.push({ id: m[3], hidden: !!m[1], html: m[2], sep: '' });
    last = re.lastIndex;
  }
  const tail = inner.slice(last);
  if (!blocks.length || tail.trim()) return null;
  blocks[blocks.length - 1].sep = tail;
  return { pre: html.slice(0, openEnd) + lead, post: html.slice(close), blocks };
}

// Номер главы стоит в разметке цифрами (<b>03</b>). После перестановки или
// скрытия пересчитываем видимые экраны подряд, с нуля — как было в макете.
const NUM_RE = /(<div class="sec-aside sec-aside--right[^"]*">\s*<b>)\d\d(<\/b>)/;
function saveStructure(page, payload) {
  const p = resolve(ROOT, page.file);
  const orig = readFileSync(p, 'utf8');
  const bom = orig.charCodeAt(0) === 0xfeff;
  const html = orig.replace(/^﻿/, '');
  const st = readStructure(html);
  if (!st) return { error: 'У этой страницы нет экранов, которые можно переставлять.' };

  const ids = st.blocks.map((b) => b.id);
  const order = Array.isArray(payload.order) ? payload.order.map(String) : ids;
  if (order.length !== ids.length || [...order].sort().join() !== [...ids].sort().join())
    return { error: 'Список экранов не совпал со страницей — обнови окно CMS.' };
  const hidden = new Set((payload.hidden || []).map(String));
  for (let i = 0; i < ids.length; i++) {
    if (!FIXED_SCREENS.has(ids[i])) continue;
    if (order[i] !== ids[i]) return { error: `Экран «${SCREEN_NAMES[ids[i]] || ids[i]}» стоит на своём месте — его нельзя двигать.` };
    if (hidden.has(ids[i])) return { error: `Экран «${SCREEN_NAMES[ids[i]] || ids[i]}» нельзя скрыть.` };
  }
  const same = order.join() === ids.join() && st.blocks.every((b) => b.hidden === hidden.has(b.id));
  if (same) return { changed: 0 };

  const byId = Object.fromEntries(st.blocks.map((b) => [b.id, b]));
  let n = 0;
  const parts = order.map((id) => {
    const b = byId[id];
    if (hidden.has(id)) return `<template data-off="${id}">${b.html}</template>` + b.sep;
    return b.html.replace(NUM_RE, (_m, a, z) => a + String(n++).padStart(2, '0') + z) + b.sep;
  });
  const next = st.pre + parts.join('') + st.post;
  const tmp = p + '.tmp';
  writeFileSync(tmp, (bom ? '﻿' : '') + next, 'utf8');
  renameSync(tmp, p);
  return { changed: 1 };
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
    for (const [k, v] of Object.entries((payload.dict || {})[lang] || {})) {
      if (!editableKey(k) || !(k in (dict[lang] || {}))) continue;   // новых ключей не заводим
      if (dict[lang][k] === v) continue;
      dict[lang][k] = v;
      changed[lang].push(k);
    }
  }
  // ширины рамок и поля-атрибуты живут в разметке, а не в словаре
  const [withExtras, extras] = applyExtras(html, payload, page.file);
  html = withExtras;
  if (!changed.ru.length && !changed.en.length && !extras) return { changed: 0 };

  for (const k of changed.ru) {
    const nx = replaceInnerAll(html, k, dict.ru[k]);
    if (nx) html = nx;
    // ключи, которые сидят в aria-label, а не в тексте
    html = html.replace(new RegExp(`(data-i18n-aria="${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*aria-label=")[^"]*(")`),
      (_m, a, b) => a + String(dict.ru[k]).replace(/"/g, '&quot;') + b);
  }
  // Заголовок первого экрана разбит скриптом на буквы, поэтому целиком он лежит в
  // aria-label. Поменяли фразы — обновляем и его, иначе читалка скажет старое.
  if (changed.ru.includes('hero.title.static') || changed.ru.includes('hero.title.word')) {
    const flat = (v) => String(v ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    html = html.replace(/(<h1 class="hero-title[^"]*" aria-label=")[^"]*(")/,
      (_m, a, b) => a + encAttr((flat(dict.ru['hero.title.static']) + ' ' + flat(dict.ru['hero.title.word'])).trim()) + b);
  }
  // превью ссылки: <title>, description, og:*, twitter:* — одним текстом (tools/head-meta.mjs)
  html = syncHeadMeta(html, {
    title: changed.ru.includes('meta.title') ? dict.ru['meta.title'] : null,
    description: changed.ru.includes('meta.description') ? dict.ru['meta.description'] : null,
  });
  if (changed.ru.length || changed.en.length) html = writeDict(html, dict);

  const tmp = p + '.tmp';
  writeFileSync(tmp, (bom ? '﻿' : '') + html, 'utf8');
  renameSync(tmp, p);
  return { changed: changed.ru.length + changed.en.length + extras };
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
  return { items, total: items.length, unused: items.filter((i) => !i.used.length).length, videos: videoLibrary(titles) };
}

// Видео сайта: обложки карточек и ролики внутри кейсов. Где стоит — так же, как у картинок.
function videoLibrary(titles = {}) {
  if (!existsSync(VIDDIR)) return [];
  const names = readdirSync(VIDDIR).filter((f) => f.endsWith('.mp4')).map((f) => f.replace(/\.mp4$/, ''));
  let reg = { cases: [] };
  try { reg = readReg(); } catch {}
  const pages = caseIds().map((id) => ({ id, html: readFileSync(casePath(id), 'utf8') }));
  return names.map((name) => {
    const used = [];
    const re = new RegExp('assets/vid/' + escRe(name) + '\\.mp4');
    for (const c of reg.cases) {
      if (c.cover && c.cover.kind === 'vid' && c.cover.video === `assets/vid/${name}.mp4`)
        used.push({ where: `Видео-обложка кейса ${c.id} · ${titles[c.id] || ''} — карточка в портфолио` });
    }
    for (const pg of pages) {
      // закомментированный пример в разметке — не использование
      if (re.test(pg.html.replace(/<!--[\s\S]*?-->/g, ''))) used.push({ where: `Кейс ${pg.id} · ${titles[pg.id] || ''} — ролик внутри кейса` });
    }
    return { name, ...videoInfo(name), used };
  }).sort((a, b) => (b.used.length - a.used.length) || a.name.localeCompare(b.name));
}

// После замены файла под тем же именем размеры в разметке врут: width/height
// остались от старой картинки, и страница резервирует под неё не то место.
// Правим их везде, где картинка стоит. Возвращает число изменённых файлов.
async function syncImageDims(name) {
  const f = resolve(IMGDIR, name + '.webp');
  if (!existsSync(f)) return 0;
  const meta = await sharpMod.default(f).metadata();
  const files = [...PAGES.map((x) => x.file), ...caseIds().map((n) => `projects/${n}.html`)];
  let touched = 0;
  for (const rel of files) {
    const abs = resolve(ROOT, rel);
    if (!existsSync(abs)) continue;
    const before = readFileSync(abs, 'utf8');
    // Последняя запись srcset — настоящая ширина оригинала только у картинок,
    // вписанных в страницу руками. В кейсах и в сетке портфолио там условные
    // 1920/940/1400 под раскладку, их ставит сборка — не трогаем.
    const ownSrcset = rel === 'about.html' || rel === 'index.html' || rel === '404.html';
    const re = new RegExp('<img\\b[^>]*\\bsrc="(?:\\.\\./)?assets/img/' + escRe(name) + '\\.webp"[^>]*>', 'g');
    const after = before.replace(re, (tag) => {
      let t = tag.replace(/\bwidth="\d+"/, `width="${meta.width}"`).replace(/\bheight="\d+"/, `height="${meta.height}"`);
      if (ownSrcset) t = t.replace(new RegExp('(assets/img/' + escRe(name) + '\\.webp )\\d+w'), `$1${meta.width}w`);
      return t;
    });
    if (after !== before) { await writeFileSafe(abs, Buffer.from(after, 'utf8')); touched++; }
  }
  return touched;
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
    } else if (tag === 'video' && $el.find('source[src*="assets/vid/"]').length) {
      const video = String($el.find('source').attr('src') || '').replace(/^.*\//, '').replace(/\.mp4.*$/, '');
      out.push({ type: 'video', video, poster: base($el.attr('poster')), alt: $el.attr('aria-label') || '',
                 w: $el.attr('width') || '', h: $el.attr('height') || '', ...videoInfo(video) });
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
// Видео в кейсе размечаем так же, как видео-обложки карточек: без autoplay и с
// preload="none". Запуск и паузу по видимости делает assets/site.js — ролик не
// качается, пока до него не докрутили. width/height берём из самого файла, чтобы
// страница не дёргалась, пока видео грузится.
const VIDDIR = resolve(ROOT, 'assets', 'vid');
function videoInfo(name) {
  const f = resolve(VIDDIR, name + '.mp4');
  if (!name || !existsSync(f)) return { exists: false, mb: 0 };
  return { exists: true, mb: +(statSync(f).size / 1048576).toFixed(1) };
}
// Размер кадра из mp4: атом tkhd видеодорожки кончается шириной и высотой в формате
// 16.16. У звуковой дорожки там нули — её пропускаем.
function mp4Size(buf) {
  let i = 0;
  while ((i = buf.indexOf('tkhd', i)) !== -1) {
    const start = i - 4;
    const size = start >= 0 ? buf.readUInt32BE(start) : 0;
    if (size >= 84 && start + size <= buf.length) {
      const w = buf.readUInt32BE(start + size - 8) >>> 16, h = buf.readUInt32BE(start + size - 4) >>> 16;
      if (w && h) return { w, h };
    }
    i += 4;
  }
  return null;
}
function videoTag(m, ver) {
  const poster = m.poster ? ` poster="../assets/img/${m.poster}.webp"` : '';
  const dim = (m.w && m.h) ? ` width="${m.w}" height="${m.h}"` : '';
  const label = String(m.alt || '').trim() ? ` aria-label="${encAttr(m.alt)}"` : '';
  return `<video${poster}${dim} muted loop playsinline preload="none"${label}><source src="../assets/vid/${m.video}.mp4?v=${ver}" type="video/mp4"></video>`;
}
function renderMedia(media, ver = '1') {
  // Пустые слоты на страницу не пишем: тег без файла — это битая картинка на сайте.
  // Пара, в которой заполнена одна половина, встаёт во всю ширину.
  const lines = media.map((m) => {
    if (m.type === 'raw' || m.type === 'comment') return '    ' + m.html.trim();
    if (m.type === 'video') return m.video ? '    ' + videoTag(m, ver) : null;
    if (m.type === 'full') return m.src ? '    ' + imgTag(m, 'full') : null;
    const items = (m.items || []).filter((i) => i.src);
    if (!items.length) return null;
    if (items.length === 1) return '    ' + imgTag(items[0], 'full');
    return '    <div class="row">' + items.map((i) => imgTag(i, 'row')).join('') + '</div>';
  }).filter(Boolean);
  return '\n' + lines.join('\n') + (lines.length ? '\n' : '');
}

function loadCase(n) {
  const html = readFileSync(casePath(n), 'utf8').replace(/^﻿/, '');
  const $ = load(html, { decodeEntities: false });
  const dict = readDict($);
  let year = '';
  $('.pcase__f').each((_i, el) => {
    if ($(el).find('.l').attr('data-i18n') === 'f.year') year = $(el).find('.v').text().trim();
  });
  return { n, dict, year, media: readMedia($), widths: widthsOf($), nextTitle: dict.ru['ui.nextTitle'] || '' };
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
  const r = replaceInnerAt(html, at, inner);
  return r ? r[0] : null;
}
// То же по позиции атрибута. Возвращает [новый html, позиция сразу за вставкой] —
// вторая нужна, чтобы пройти по всем вхождениям одного ключа.
function replaceInnerAt(html, at, inner) {
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
    else { depth--; i = c.index + (depth === 0 ? 0 : 1); if (depth === 0) return [html.slice(0, openEnd + 1) + inner + html.slice(c.index), openEnd + 1 + inner.length]; }
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
      if (DICT_ONLY.test(k)) {
        // пустое остаётся пустой строкой, если ключ уже был, и не заводится, если не было
        if (String(v).trim() !== '') dict[lang][k] = v;
        else if (k in dict[lang]) dict[lang][k] = '';
        continue;
      }
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

  // превью ссылки: <title>, description, og:*, twitter:* — из meta.* ru (tools/head-meta.mjs)
  html = syncHeadMeta(html, { title: dict.ru['meta.title'], description: dict.ru['meta.description'] });

  // год — обычный текст, ключа i18n у него нет
  html = html.replace(/(data-i18n="f\.year">[^<]*<\/div><div class="v">)[^<]*(<\/div>)/, `$1${payload.year}$2`);

  if (payload.media) {
    const ver = (html.match(/\.min\.css\?v=(\d+)/) || [, '1'])[1];
    const next = replaceRegion(html, '<section class="pcase__full pcase__media"', renderMedia(payload.media, ver));
    if (next) html = next;
  }

  // ширины текстовых рамок — в style самих надписей
  html = applyExtras(html, { widths: payload.widths }, '')[0];

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

// Файл из последней сохранённой версии сайта (HEAD), побайтно. По нему CMS
// сравнивает «как опубликовано» с «как после правки»: и вёрстку, и тексты.
// Кэш живёт, пока версия та же, — страница тянет десяток файлов разом.
const BASE = { sha: '', at: 0, files: new Map() };
async function gitBlob(rel) {
  if (Date.now() - BASE.at > 3000) {
    const sha = (await git('rev-parse', 'HEAD')).out.trim();
    if (sha !== BASE.sha) { BASE.sha = sha; BASE.files.clear(); }
    BASE.at = Date.now();
  }
  const key = rel.replace(/\\/g, '/');
  if (BASE.files.has(key)) return BASE.files.get(key);
  const buf = await new Promise((ok) => {
    execFile(GIT, ['show', 'HEAD:' + key], { cwd: ROOT, maxBuffer: 1 << 28, encoding: 'buffer', windowsHide: true },
      (e, so) => ok(e ? null : so));
  });
  BASE.files.set(key, buf);
  return buf;
}

// Проверки перед публикацией — ровно те ошибки, что мы вычищали руками.
function validate() {
  const problems = [];
  const roles = {}, years = {}, tableRoles = {};
  for (const n of caseIds()) {
    const c = loadCase(n);
    roles[n] = c.dict.ru['p.role']; years[n] = c.year;
    // у строки таблицы может быть своя, более короткая роль — это не разнобой
    tableRoles[n] = c.dict.ru['works.role'] || c.dict.ru['p.role'];
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
      if (m.type === 'video') {
        if (!m.exists) problems.push({ lvl: 'err', n, msg: `Видео ${m.video}.mp4 нет на диске.` });
        if (!m.poster) problems.push({ lvl: 'warn', n, msg: `У видео ${m.video} нет постера — пока ролик грузится, на его месте будет пустой прямоугольник.` });
        else if (!existsSync(resolve(IMGDIR, m.poster + '.webp'))) problems.push({ lvl: 'err', n, msg: `Постера ${m.poster}.webp нет на диске.` });
        if (!String(m.alt || '').trim()) problems.push({ lvl: 'warn', n, msg: `У видео ${m.video} нет описания — что на нём, одной фразой.` });
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
    if (row && tableRoles[n] && row !== tableRoles[n]) problems.push({ lvl: 'info', n, msg: `Роль «${tableRoles[n]}» в кейсе против «${row}» в таблице манифеста.` });
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
    // части интерфейса: cms/ui/*.js. Кроме них из папки cms наружу ничего не отдаём.
    if (path.startsWith('/__cms/ui/')) {
      const name = path.slice('/__cms/ui/'.length);
      const f = resolve(HERE, 'ui', name);
      if (!/^[a-z0-9-]+\.(js|css)$/.test(name) || !existsSync(f)) { res.writeHead(404); return res.end('нет такого файла'); }
      res.writeHead(200, { 'content-type': MIME[extname(f)], 'cache-control': 'no-store' });
      return res.end(readFileSync(f));
    }
    // Сайт «как опубликован»: те же адреса под /__base/, но файлы берутся из
    // последней версии в git. Проверка вёрстки грузит обе копии и сравнивает.
    if (path === '/__base' || path.startsWith('/__base/')) {
      let rel = path.slice('/__base/'.length).replace(/^Sergey-Lookin\//, '');
      if (!rel || rel.endsWith('/')) rel += 'index.html';
      if (rel.includes('..')) { res.writeHead(400); return res.end('плохой адрес'); }
      const ext = extname(rel);
      const work = resolve(ROOT, rel);
      // видео тяжёлые и на раскладку не влияют — отдаём текущие; того, чего в
      // опубликованной версии ещё нет (новая картинка), тоже берём с диска
      let buf = ext === '.mp4' ? null : await gitBlob(rel);
      if (!buf && work.startsWith(ROOT) && existsSync(work) && ext) buf = readFileSync(work);
      if (!buf) { res.writeHead(404); return res.end('нет такой страницы'); }
      res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': 'no-store' });
      return res.end(buf);
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
        // Поля без перевода (год в таблице) не считаем: у них английского нет по замыслу.
        let needsEn = 0;
        for (const f of FIELDS) {
          if (f.neutral) continue;
          if (String(c.dict.ru[f.k] ?? '').trim() && !String(c.dict.en[f.k] ?? '').trim()) needsEn++;
        }
        return { n: rc.id, title: c.dict.ru['p.title'], year: c.year, role: c.dict.ru['p.role'],
                 status: rc.status, order: rc.order, cover: rc.cover, slug: rc.slug, needsEn,
                 pos: rc.pos || '', video: videoInfo(rc.slug) };
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
      html = syncHeadMeta(html, { title: d.ru['meta.title'] });
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
      // Меняем только то, что прислали: постер, вид обложки (картинка или видео)
      // и точку кадра — каждое по отдельности, остальное остаётся как было.
      const inc = JSON.parse((await body(req)).toString('utf8'));
      const reg = readReg();
      const c = reg.cases.find((x) => x.id === id);
      if (!c) return json(res, 404, { error: 'нет такого кейса' });
      const cover = { ...c.cover };
      if ('poster' in inc) cover.poster = String(inc.poster || '');
      if (inc.kind) {
        if (!['img', 'vid'].includes(inc.kind)) return json(res, 400, { error: 'Обложка бывает картинкой или видео.' });
        if (inc.kind === 'vid') {
          if (!videoInfo(c.slug).exists) return json(res, 400, { error: 'Сначала загрузи видео — файла assets/vid/' + c.slug + '.mp4 пока нет.' });
          cover.video = `assets/vid/${c.slug}.mp4`;
        } else delete cover.video;
        cover.kind = inc.kind;
      }
      cover.kind = cover.kind || 'img';
      c.cover = cover;
      if ('pos' in inc) {
        const pos = String(inc.pos || '').trim();
        if (pos && !/^\d{1,3}% \d{1,3}%$/.test(pos)) return json(res, 400, { error: 'Точка кадра — два процента: «50% 42%».' });
        c.pos = pos;
      }
      writeReg(reg);
      const r = await rebuild();
      return json(res, 200, { ok: r.ok, out: r.out });
    }
    if (path.startsWith('/api/case/')) {
      const n = path.split('/')[3];
      // Кейс должен существовать на диске. Иначе loadCase падал, и вместо
      // «нет такого кейса» интерфейс получал 500 и висел на «Загружаю…».
      if (!/^[a-z0-9-]+$/i.test(n || '') || !existsSync(resolve(ROOT, 'projects', n + '.html')))
        return json(res, 404, { error: 'Нет такого кейса: ' + (n || '—') });
      if (req.method === 'GET') return json(res, 200, loadCase(n));
      if (req.method === 'POST') {
        saveCase(n, JSON.parse((await body(req)).toString('utf8')));
        // Название, роль, год, описание карточки и направление стоят ещё и в сетке
        // портфолио и в таблице на главной. Пересобираем их сразу: раньше они
        // обновлялись только при смене порядка, и карточка расходилась с кейсом.
        const b = await rebuild();
        if (!b.ok) console.log('[пересборка] ' + b.out);
        return json(res, 200, { ok: true, en: b.ok, enOut: b.out.slice(-300), problems: validate(), data: loadCase(n) });
      }
    }
    // ── остальные страницы сайта ──────────────────────────────────────────
    if (path === '/api/pages') return json(res, 200, { pages: PAGES.map(({ file, label }) => ({ file, label })) });

    // порядок и видимость экранов страницы
    if (path.startsWith('/api/page/') && path.endsWith('/structure') && req.method === 'POST') {
      const file = decodeURIComponent(path.slice('/api/page/'.length, -'/structure'.length));
      const page = PAGES.find((p) => p.file === file);
      if (!page) return json(res, 404, { error: 'нет такой страницы' });
      const r = saveStructure(page, JSON.parse((await body(req)).toString('utf8') || '{}'));
      if (r.error) return json(res, 400, r);
      if (r.changed) { const b = await node('build-en.mjs'); if (b.code !== 0) return json(res, 500, { error: 'Английская версия не собралась:\n' + b.out.slice(-300) }); }
      return json(res, 200, { ok: true, changed: r.changed, screens: loadPage(page).screens });
    }

    if (path.startsWith('/api/page/')) {
      const file = decodeURIComponent(path.slice('/api/page/'.length));
      const page = PAGES.find((p) => p.file === file);
      if (!page) return json(res, 404, { error: 'нет такой страницы' });
      if (req.method === 'GET') {
        const m = loadPage(page);
        m.og = OG_PAGES.includes(file) ? await ogInfo() : null;
        return json(res, 200, m);
      }
      if (req.method === 'POST') {
        const r = savePage(page, JSON.parse((await body(req)).toString('utf8')));
        const b = await node('build-en.mjs');
        return json(res, 200, { ok: b.code === 0, out: b.out.slice(-300), changed: r.changed });
      }
    }

    // ── картинка превью для мессенджеров ─────────────────────────────────
    // Любой формат и размер приводим к 1200×630 PNG: это размер, который ждут
    // Telegram, WhatsApp и соцсети. Лишнее обрезается по центру. Адрес картинки
    // в <head> получает новый отпечаток — без него мессенджеры держат старую.
    if (path === '/api/og' && req.method === 'POST') {
      const buf = await body(req);
      if (!imageKind(buf)) return json(res, 400, { error: 'Не похоже на картинку. Нужен PNG, JPG или WebP.' });
      let out, meta;
      try {
        meta = await sharpMod.default(buf).metadata();
        out = await sharpMod.default(buf).resize(1200, 630, { fit: 'cover', position: 'centre' }).png({ compressionLevel: 9 }).toBuffer();
      } catch { return json(res, 400, { error: 'Не удалось прочитать картинку.' }); }
      mkdirSync(dirname(OG_FILE), { recursive: true });
      await writeFileSafe(OG_FILE, out);
      const a = await node('build-pages.mjs');
      const b = await node('build-en.mjs');
      const ratio = meta.width / meta.height;
      return json(res, 200, { ok: a.code === 0 && b.code === 0, ...(await ogInfo()),
        cropped: Math.abs(ratio - 1200 / 630) > 0.02, was: `${meta.width}×${meta.height}` });
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
      // ?name= — точное имя (обложка кейса обязана зваться <слаг>-preview: по этому
      // имени главная собирает кадр для окна при наведении). Занятое имя не затираем.
      const stem = url.searchParams.get('stem');
      const exact = url.searchParams.get('name');
      let k = 1, name;
      if (exact) {
        if (!/^[a-z0-9-]+$/.test(exact)) return json(res, 400, { error: 'Имя файла — только латиница, цифры и дефисы.' });
        if (existsSync(resolve(IMGDIR, exact + '.webp'))) return json(res, 400, { error: 'Файл с таким именем уже есть — его нужно заменить, а не загружать заново.' });
        name = exact;
      } else {
        if (!/^[a-z0-9-]+$/.test(stem || '')) return json(res, 400, { error: 'Основа имени — только латиница, цифры и дефисы.' });
        do { name = `${stem}-${k++}`; } while (existsSync(resolve(IMGDIR, name + '.webp')));
      }
      const raw = await body(req);
      if (!raw.length) return json(res, 400, { error: 'Пустой файл.' });
      const got = await intake(raw, url.searchParams.get('mode'));
      if (got.error) return json(res, 400, { error: got.error });
      const buf = got.buf;
      await writeFileSafe(resolve(IMGDIR, name + '.webp'), buf);
      const sharp = sharpMod.default;
      const meta = await sharp(resolve(IMGDIR, name + '.webp')).metadata();
      for (const w of VARIANTS) { if (w >= meta.width) continue; await sharp(resolve(IMGDIR, name + '.webp')).resize({ width: w }).webp({ quality: 82 }).toFile(resolve(IMGDIR, `${name}-${w}.webp`)); }
      return json(res, 200, { ok: true, name, w: meta.width, h: meta.height, variants: variantsOf(name),
        kind: got.kind, mode: got.mode, wasKb: Math.round(got.was / 1024), kb: Math.round(buf.length / 1024) });
    }
    // ── видео-обложки кейсов ─────────────────────────────────────────────
    // ?slug=имя — записать ровно в этот файл (замена: ссылки не рвутся);
    // ?stem=основа — новый файл, свободный номер подбирает сервер: runa-v1, runa-v2…
    if (path === '/api/video' && req.method === 'POST') {
      let slug = url.searchParams.get('slug');
      const stem = url.searchParams.get('stem');
      if (!slug && stem) {
        if (!/^[a-z0-9-]+$/.test(stem)) return json(res, 400, { error: 'Основа имени — только латиница, цифры и дефисы.' });
        let k = 1;
        do { slug = `${stem}-v${k++}`; } while (existsSync(resolve(VIDDIR, slug + '.mp4')));
      }
      if (!/^[a-z0-9-]+$/.test(slug || '')) return json(res, 400, { error: 'Неверное имя.' });
      const buf = await body(req);
      if (buf.slice(4, 8).toString() !== 'ftyp') return json(res, 400, { error: 'Это не mp4. Нужен файл .mp4.' });
      if (buf.length > 40 * 1024 * 1024) return json(res, 400, { error: 'Больше 40 МБ — тяжело для сайта.' });
      mkdirSync(VIDDIR, { recursive: true });
      await writeFileSafe(resolve(VIDDIR, slug + '.mp4'), buf);
      const size = mp4Size(buf) || {};
      return json(res, 200, { ok: true, slug, name: slug, mb: (buf.length / 1048576).toFixed(1), w: size.w || '', h: size.h || '' });
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

    // ── контакты: Telegram, почта, Behance ──────────────────────────────
    // Одна и та же ссылка стоит в блоке «Давайте поговорим» на главной, в
    // колонке контактов на «Обо мне» и в невидимой разметке для поисковиков.
    // Держим их в content/contacts.json и разносим одной командой.
    if (path === '/api/contacts') {
      const F = resolve(ROOT, 'content', 'contacts.json');
      if (req.method === 'GET') return json(res, 200, JSON.parse(readFileSync(F, 'utf8')));
      if (req.method === 'POST') {
        const inc = JSON.parse((await body(req)).toString('utf8'));
        const d = JSON.parse(readFileSync(F, 'utf8'));
        const bad = [];
        for (const it of d.items) {
          const g = (inc.items || []).find((x) => x.id === it.id);
          if (!g) continue;
          const url = String(g.url || '').trim();
          const handle = String(g.handle || '').trim();
          if (!url) { bad.push(`${it.name}: пустая ссылка`); continue; }
          if (!/^(https?:\/\/|mailto:|tel:)/i.test(url)) { bad.push(`${it.name}: ссылка должна начинаться с https://, mailto: или tel:`); continue; }
          if (/\s/.test(url)) { bad.push(`${it.name}: в ссылке пробел`); continue; }
          if (/^mailto:/i.test(url) && !/^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/i.test(url)) { bad.push(`${it.name}: почта не похожа на адрес`); continue; }
          it.url = url;
          it.handle = handle || url.replace(/^https?:\/\/(www\.)?|^mailto:|\/$/g, '');
          if (typeof g.public === 'boolean') it.public = g.public;
        }
        if (bad.length) return json(res, 400, { error: bad.join('\n') });
        await writeFileSafe(F, Buffer.from(JSON.stringify(d, null, 2) + '\n', 'utf8'));
        const b = await node('build-contacts.mjs');
        if (b.code !== 0) return json(res, 500, { error: 'Не удалось разнести по страницам:\n' + b.out.slice(-400) });
        await node('build-en.mjs');
        return json(res, 200, { ok: true, changed: !/менять нечего/.test(b.out) });
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

    // ── что будет, если сконвертировать: считаем ДО загрузки ─────────────
    // Человек кидает PNG из Figma и должен видеть, во что это обойдётся,
    // а не узнавать постфактум. Считаем оба варианта и отдаём числа.
    if (path === '/api/probe' && req.method === 'POST') {
      const buf = await body(req);
      const kind = imageKind(buf);
      if (!kind) return json(res, 400, { error: 'Не похоже на картинку. Нужен PNG, JPG или WebP.' });
      try {
        const meta = await sharpMod.default(buf).metadata();
        const [q90, lossless] = await Promise.all([
          sharpMod.default(buf).webp({ quality: 90 }).toBuffer(),
          sharpMod.default(buf).webp({ lossless: true }).toBuffer(),
        ]);
        return json(res, 200, {
          kind, w: meta.width, h: meta.height, hasAlpha: !!meta.hasAlpha,
          origKb: Math.round(buf.length / 1024),
          q90Kb: Math.round(q90.length / 1024),
          losslessKb: Math.round(lossless.length / 1024),
        });
      } catch (e) { return json(res, 400, { error: 'Не удалось прочитать картинку.' }); }
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

    if (path === '/api/media/delete-video' && req.method === 'POST') {
      const { name } = JSON.parse((await body(req)).toString('utf8'));
      const it = videoLibrary().find((x) => x.name === name);
      if (!it) return json(res, 404, { error: 'нет такого файла' });
      if (it.used.length) return json(res, 400, { error: 'Видео используется: ' + it.used.map((u) => u.where).join('; ') + '. Сначала убери его оттуда.' });
      if (!(await rmRetry(resolve(VIDDIR, name + '.mp4')))) return json(res, 500, { error: 'Не удалось удалить — файл занят другой программой.' });
      return json(res, 200, { ok: true });
    }

    // ── поиск по всем текстам сайта ──────────────────────────────────────
    // Находит надпись на любой странице и в любом кейсе, на русском и английском,
    // и говорит, где она лежит: клик по результату открывает нужное поле.
    if (path === '/api/search') {
      const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
      if (q.length < 2) return json(res, 200, { items: [] });
      const plain = (v) => String(v ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
      const items = [];
      const scan = (target, where, key, label, ru, en) => {
        for (const [lang, v] of [['ru', ru], ['en', en]]) {
          const t = plain(v), at = t.toLowerCase().indexOf(q);
          if (at < 0) continue;
          const from = Math.max(0, at - 28);
          items.push({ ...target, where, key, label, lang, snippet: (from ? '…' : '') + t.slice(from, at + q.length + 44) + (at + q.length + 44 < t.length ? '…' : '') });
          return;
        }
      };
      for (const pg of PAGES) {
        const m = loadPage(pg);
        for (const s of m.screens) for (const f of s.fields) {
          const where = pg.label + (s.id.startsWith('@') ? '' : ' → ' + s.name);
          if (f.attr) scan({ type: 'page', file: pg.file }, where, f.k, f.label, m.attrs[f.k].ru, m.attrs[f.k].en);
          else scan({ type: 'page', file: pg.file }, where, f.k, f.label, m.dict.ru[f.k], m.dict.en[f.k]);
        }
      }
      for (const id of caseIds()) {
        const c = loadCase(id);
        for (const f of FIELDS) scan({ type: 'case', n: id }, `Кейс ${id} · ${plain(c.dict.ru['p.title'])}`, f.k, f.label, c.dict.ru[f.k], c.dict.en[f.k]);
      }
      const sh = JSON.parse(readFileSync(resolve(ROOT, 'content', 'shell.json'), 'utf8'));
      for (const k of Object.keys(sh.ru)) scan({ type: 'shell' }, 'Шапка и подвал', k, SHELL_LABELS[k] || k, sh.ru[k], sh.en[k]);
      return json(res, 200, { items: items.slice(0, 60), total: items.length });
    }

    // ── русский изменён, английский нет ──────────────────────────────────
    // Сравниваем словари с последней опубликованной версией. Поле, где русский
    // текст поменяли, а английский остался прежним, — почти всегда забытый перевод.
    if (path === '/api/mirror') {
      const files = [...PAGES.map((x) => x.file), ...caseIds().map((n) => `projects/${n}.html`)];
      const dictOf = (html) => { try { return JSON.parse((html.match(/<script id="i18n-data" type="application\/json">([\s\S]*?)<\/script>/) || [, '{}'])[1]); } catch { return {}; } };
      const out = [];
      for (const rel of files) {
        const abs = resolve(ROOT, rel);
        if (!existsSync(abs)) continue;
        const was = await gitBlob(rel);
        if (!was) continue;                                  // новой страницы в опубликованной версии нет
        const a = dictOf(was.toString('utf8')), b = dictOf(readFileSync(abs, 'utf8'));
        const isCase = rel.startsWith('projects/');
        const pg = PAGES.find((x) => x.file === rel);
        let labels = null;
        for (const k of Object.keys(b.ru || {})) {
          if (isCase ? !EDITABLE.has(k) : !editableKey(k)) continue;
          if (isCase && (FIELDS.find((f) => f.k === k) || {}).neutral) continue;
          const ruWas = (a.ru || {})[k], ruNow = b.ru[k], enWas = (a.en || {})[k], enNow = (b.en || {})[k];
          if (ruWas === undefined || ruWas === ruNow) continue;
          if (enWas !== enNow || !String(enNow ?? '').trim()) continue;   // перевод тронут или его нет вовсе — это другая проверка
          if (!isCase && !labels) { labels = {}; for (const s of loadPage(pg).screens) for (const f of s.fields) labels[f.k] = f.label; }
          out.push({ file: rel, key: k,
            where: isCase ? `Кейс ${rel.slice(9, 11)}` : pg.label,
            label: isCase ? (FIELDS.find((f) => f.k === k) || {}).label || k : labels[k] || k,
            target: isCase ? { type: 'case', n: rel.slice(9, 11) } : { type: 'page', file: rel } });
        }
      }
      return json(res, 200, { items: out });
    }

    // заменить КОНКРЕТНЫЙ файл, имя сохраняется — ссылки на него не рвутся
    if (path === '/api/replace' && req.method === 'POST') {
      const name = url.searchParams.get('name');
      if (!/^[a-z0-9-]+$/.test(name || '')) return json(res, 400, { error: 'Неверное имя файла.' });
      const raw = await body(req);
      if (!raw.length) return json(res, 400, { error: 'Пустой файл.' });
      const got = await intake(raw, url.searchParams.get('mode'));
      if (got.error) return json(res, 400, { error: got.error });
      const buf = got.buf;
      const dst = resolve(IMGDIR, name + '.webp');
      await writeFileSafe(dst, buf);
      const sharp = sharpMod.default;
      const meta = await sharp(dst).metadata();
      for (const w of VARIANTS) {
        const v = resolve(IMGDIR, `${name}-${w}.webp`);
        if (w >= meta.width) { if (existsSync(v)) rmSync(v, { force: true }); continue; }
        await sharp(dst).resize({ width: w }).webp({ quality: 82 }).toFile(v);
      }
      // новая картинка может быть других пропорций — правим размеры в разметке
      // и пересобираем сетку портфолио и английскую версию
      if (await syncImageDims(name)) await rebuild();
      return json(res, 200, { ok: true, name, w: meta.width, h: meta.height, ...fileInfo(name),
        kind: got.kind, mode: got.mode, wasKb: Math.round(got.was / 1024), kb: Math.round(buf.length / 1024) });
    }

    if (path === '/api/validate') return json(res, 200, { problems: validate() });
    // текущая сохранённая версия сайта — по ней проверка вёрстки понимает,
    // что эталон для сравнения сменился
    if (path === '/api/head') return json(res, 200, { sha: (await git('rev-parse', 'HEAD')).out.trim() });
    // Что ждёт публикации. Кроме правок в файлах бывают ГОТОВЫЕ версии, которые
    // ещё не уехали: откат сам создаёт версию и оставляет папку чистой. Без этой
    // цифры кнопка «Опубликовать» гасла, и откат было невозможно довезти до сайта.
    if (path === '/api/changes') {
      const g = await git('status', '--short');
      let ahead = 0;
      const a = await git('log', 'origin/main..HEAD', '--format=%h');
      if (a.code === 0) ahead = a.out.split('\n').filter(Boolean).length;
      return json(res, 200, { files: g.out.split('\n').map((s) => s.trim()).filter(Boolean), ahead });
    }
    if (path === '/api/publish' && req.method === 'POST') {
      const steps = [];
      // Порядок важен и он ровно такой же, как в npm run build: build-en ЧИТАЕТ
      // русские страницы, а build-pages их ПИШЕТ. Если собрать EN раньше каркаса,
      // английская версия уедет собранной из предыдущего состояния.
      for (const [name, script] of [['Контакты', 'build-contacts.mjs'], ['Каркас', 'build-pages.mjs'], ['Сборка EN', 'build-en.mjs']]) {
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
        'assets/img', 'assets/cv', 'assets/vid', 'assets/og',
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
    let localPath = path.startsWith('/Sergey-Lookin/') ? path.slice('/Sergey-Lookin'.length) : path;
    if (localPath.endsWith('/')) localPath += 'index.html';       // /en/ — это /en/index.html
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

// Слушаем ТОЛЬКО себя. Без второго аргумента Node открывает порт на всех
// сетевых картах — и тогда любой в той же вайфай-сети (кафе, коворкинг,
// отель) может открыть эту CMS, переписать тексты сайта и нажать
// «Опубликовать». CMS работает на одной машине, наружу ей смотреть незачем.
srv.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  CMS открыта:  ${URL_LOCAL}\n  Проект:       ${ROOT}\n\n  Закрыть — просто закрой это окно.\n`);
  // Браузер открываем САМИ и только когда порт уже слушает: иначе он успевает
  // постучаться раньше и показывает «не удаётся получить доступ к сайту».
  if (!process.argv.includes('--no-open')) openBrowser(URL_LOCAL);
});

function openBrowser(url) {
  execFile('rundll32', ['url.dll,FileProtocolHandler', url], () => {});
}
