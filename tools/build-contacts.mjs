// tools/build-contacts.mjs — разносит контакты из content/contacts.json по страницам.
//
// Ссылки на Telegram, почту и Behance стоят в двух местах сразу: в блоке
// «Давайте поговорим» на главной и в колонке контактов на «Обо мне». Плюс
// третье, невидимое — разметка sameAs для поисковиков. Поменять ссылку руками
// в одном месте и забыть про два других — вопрос времени, поэтому источник
// один, а страницы собираются отсюда.
//
//   node tools/build-contacts.mjs          — записать
//   node tools/build-contacts.mjs --check  — только сказать, есть ли расхождение
//
// Правим строками, а не разбором DOM: любой сериализатор переписывает весь
// файл целиком и рождает шум в diff, которого никто не заказывал.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const PAGES = ['index.html', 'about.html'];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function contacts() {
  return JSON.parse(readFileSync(resolve(ROOT, 'content', 'contacts.json'), 'utf8'));
}

// Ссылку в атрибуте href нужного <a data-c="id"> — на новую.
function setHref(s, id, url) {
  const re = new RegExp('(<a\\b[^>]*\\bdata-c="' + id + '"[^>]*\\bhref=")[^"]*(")');
  if (!re.test(s)) return { s, hit: false };
  return { s: s.replace(re, '$1' + esc(url).replace(/\$/g, '$$$$') + '$2'), hit: true };
}

// Видимая подпись внутри той же ссылки. На главной это .cta-mega-handle,
// на «Обо мне» — .v. Берём первый подходящий span внутри этого <a>.
function setHandle(s, id, handle) {
  const open = new RegExp('<a\\b[^>]*\\bdata-c="' + id + '"[^>]*>');
  const m = open.exec(s);
  if (!m) return { s, hit: false };
  const start = m.index + m[0].length;
  const end = s.indexOf('</a>', start);
  if (end < 0) return { s, hit: false };
  const inner = s.slice(start, end);
  const re = /(<span class="(?:cta-mega-handle|v)"[^>]*>)([\s\S]*?)(<\/span>)/;
  if (!re.test(inner)) return { s, hit: false };
  const next = inner.replace(re, '$1' + esc(handle).replace(/\$/g, '$$$$') + '$3');
  return { s: s.slice(0, start) + next + s.slice(end), hit: true };
}

// Список профилей для поисковиков. Отступ у главной и у «Обо мне» разный —
// считываем его из файла, чтобы не менять форматирование чужих строк.
function setSameAs(s, urls) {
  const re = /("sameAs":\s*\[)([\s\S]*?)(\])/;
  const m = re.exec(s);
  if (!m) return { s, hit: false };
  // Перевод строки берём тот, что уже в файле: about.html лежит в CRLF,
  // и подмешивать в него одиночные LF нельзя — получится файл вперемешку.
  const eol = s.includes('\r\n') ? '\r\n' : '\n';
  const pad = (/\n(\s*)"/.exec(m[2]) || [, '      '])[1];
  const close = (/\n(\s*)$/.exec(m[2]) || [, pad.slice(0, -2)])[1];
  const body = eol + urls.map((u) => pad + JSON.stringify(u)).join(',' + eol) + eol + close;
  return { s: s.slice(0, m.index) + m[1] + body + m[3] + s.slice(m.index + m[0].length), hit: true };
}

const c = contacts();
const seen = [];
const miss = [];
const drift = [];

for (const file of PAGES) {
  const p = resolve(ROOT, file);
  const was = readFileSync(p, 'utf8');
  let s = was;
  for (const it of c.items) {
    const a = setHref(s, it.id, it.url);
    if (!a.hit) miss.push(`${file}: нет ссылки data-c="${it.id}"`); else s = a.s;
    const b = setHandle(s, it.id, it.handle);
    if (!b.hit) miss.push(`${file}: нет подписи у data-c="${it.id}"`); else s = b.s;
  }
  const same = setSameAs(s, [...c.items.filter((x) => x.public).map((x) => x.url), ...(c.extra || [])]);
  if (same.hit) s = same.s;
  if (s !== was) {
    drift.push(file);
    if (!CHECK) writeFileSync(p, s);
  }
  seen.push(file);
}

if (miss.length) { console.error('Не нашёл в разметке:\n  ' + miss.join('\n  ')); process.exit(1); }
if (CHECK) {
  if (drift.length) { console.error('Контакты на страницах разошлись с content/contacts.json: ' + drift.join(', ')); process.exit(1); }
  console.log('контакты: совпадают');
} else {
  console.log(drift.length ? 'контакты обновлены: ' + drift.join(', ') : 'контакты: менять нечего');
}
