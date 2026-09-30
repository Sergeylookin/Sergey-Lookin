// Превью ссылки — вкладка, выдача поиска, Telegram, соцсети — живёт в нескольких тегах <head>.
// Источник у них один: meta.title и meta.description из словаря страницы. Эта функция
// разносит его по всем тегам сразу, чтобы правка одного поля не расходилась с остальными.
// Английские страницы получают то же самое из en-словаря в tools/build-en.mjs.
//
// Пустое или отсутствующее значение — тег не трогаем (так ведёт себя и CMS).

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const attr = (v) => String(v).replace(/"/g, '&quot;');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const TITLE_TAGS = ['property="og:title"', 'name="twitter:title"', 'property="og:image:alt"', 'name="twitter:image:alt"'];
const DESC_TAGS = ['name="description"', 'property="og:description"', 'name="twitter:description"'];

function setContent(html, sel, value) {
  return html.replace(new RegExp(`(<meta ${esc(sel)} content=")[^"]*(")`), (_m, a, b) => a + attr(value) + b);
}

export function syncHeadMeta(html, { title, description } = {}) {
  if (title) {
    html = html.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${title}</title>`);
    for (const sel of TITLE_TAGS) html = setContent(html, sel, title);
  }
  if (description) {
    for (const sel of DESC_TAGS) html = setContent(html, sel, description);
  }
  return html;
}

// Картинка превью. Telegram и соцсети кэшируют её по адресу: замени файл под тем же
// именем, и старая картинка будет висеть в превью неделями. Поэтому к адресу дописывается
// отпечаток содержимого (?v=<8 hex sha1>): новая картинка = новый адрес, старая = тот же.
// Внешние адреса и файлы, которых нет на диске, не трогаем.
const IMG_RE = /(<meta (?:property="og:image"|name="twitter:image") content="[^"]*?\/?(assets\/[^"?]+))(?:\?v=[^"]*)?(")/g;

export function bustPreviewImages(html, root) {
  return html.replace(IMG_RE, (m, head, rel, tail) => {
    const file = resolve(root, rel);
    if (!existsSync(file)) return m;
    const v = createHash('sha1').update(readFileSync(file)).digest('hex').slice(0, 8);
    return `${head}?v=${v}${tail}`;
  });
}

// То же, но значения берутся из ru-словаря самой страницы (<script id="i18n-data">).
export function syncHeadFromDict(html) {
  const m = html.match(/<script id="i18n-data" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return html;
  let ru;
  try { ru = JSON.parse(m[1]).ru || {}; } catch { return html; }
  return syncHeadMeta(html, { title: ru['meta.title'], description: ru['meta.description'] });
}
