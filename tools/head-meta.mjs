// Превью ссылки — вкладка, выдача поиска, Telegram, соцсети — живёт в нескольких тегах <head>.
// Источник у них один: meta.title и meta.description из словаря страницы. Эта функция
// разносит его по всем тегам сразу, чтобы правка одного поля не расходилась с остальными.
// Английские страницы получают то же самое из en-словаря в tools/build-en.mjs.
//
// Пустое или отсутствующее значение — тег не трогаем (так ведёт себя и CMS).

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

// То же, но значения берутся из ru-словаря самой страницы (<script id="i18n-data">).
export function syncHeadFromDict(html) {
  const m = html.match(/<script id="i18n-data" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return html;
  let ru;
  try { ru = JSON.parse(m[1]).ru || {}; } catch { return html; }
  return syncHeadMeta(html, { title: ru['meta.title'], description: ru['meta.description'] });
}
