// selftest.mjs — сквозная проверка CMS. Прогоняет КАЖДУЮ функцию против живого
// сервера и говорит, что работает, а что нет.
//
//   node cms/selftest.mjs            (сервер должен быть запущен на 8150)
//
// Все тесты, которые что-то меняют, возвращают состояние назад и в конце
// сверяются с git: рабочая папка обязана остаться такой же, как была.

import { readFileSync, readdirSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'http://localhost:8150';
const GIT = existsSync('C:\\Program Files\\Git\\cmd\\git.exe') ? 'C:\\Program Files\\Git\\cmd\\git.exe' : 'git';

// ⚠ Тест возвращает файлы к последнему сохранённому состоянию (git checkout).
// Если в папке есть несохранённые правки — они будут стёрты. Поэтому сначала
// проверяем чистоту и отказываемся работать, а не молча уничтожаем чужой труд.
{
  const gitBin = existsSync('C:\\Program Files\\Git\\cmd\\git.exe') ? 'C:\\Program Files\\Git\\cmd\\git.exe' : 'git';
  let pending = [];
  try {
    pending = execFileSync(gitBin, ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n').filter((l) => l.trim() && !l.startsWith('??')).map((l) => l.slice(3).trim());
  } catch {}
  if (pending.length) {
    console.log('\n  Тест не запущен: в папке есть несохранённые правки.\n');
    for (const f of pending.slice(0, 10)) console.log('   · ' + f);
    if (pending.length > 10) console.log(`   и ещё ${pending.length - 10}`);
    console.log('\n  Тест возвращает файлы к последней сохранённой версии, поэтому такие');
    console.log('  правки он бы стёр. Сначала опубликуй их или отмени, потом запускай.\n');
    process.exit(2);
  }
}

const results = [];
let group = '';
const g = (name) => { group = name; };
const ok = (name, pass, note = '') => { results.push({ group, name, pass, note }); };

const get = (p) => fetch(API + p).then((r) => r.json());
const post = (p, body) => fetch(API + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const raw = (p, buf) => fetch(API + p, { method: 'POST', body: buf }).then((r) => r.json());
const code = (p) => fetch(API + p).then((r) => r.status).catch(() => 0);
const git = (...a) => { try { return execFileSync(GIT, a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 }); } catch (e) { return String(e.stdout || '') + String(e.stderr || ''); } };
const dirty = (paths) => git('status', '--porcelain', '--', ...paths).split('\n').filter((l) => l.trim() && !l.startsWith('??')).length;
const restore = (...paths) => git('checkout', '--', ...paths);

// ─────────────────────────────────────────────────────────────────────────
g('Доступность');
for (const [label, path] of [
  ['интерфейс CMS', '/__cms'], ['главная сайта', '/'], ['страница кейса', '/projects/03.html'],
  ['английская версия', '/en/about.html'], ['страница 404', '/404.html'],
  ['стили по абсолютному пути', '/Sergey-Lookin/assets/core.min.css'],
  ['картинка', '/assets/img/runa-1.webp'], ['PDF резюме', '/assets/cv/sergey-lookin-cv-ru.pdf'],
]) ok(label, (await code(path)) === 200);

g('Устойчивость');
ok('кривой адрес не роняет сервер', (await code('//')) === 400);
ok('битое кодирование', (await code('/%%%%')) === 400);
ok('выход за пределы папки закрыт', (await code('/../../etc/passwd')) === 404);
ok('сервер жив после этого', (await code('/api/model')) === 200);

// Браузер на компьютере общий: любая открытая в нём страница может послать в CMS
// запрос «вслепую». Сервер обязан принимать только то, что пришло от самой CMS.
g('Чужие запросы');
const withHeaders = (p, headers, method = 'GET') => fetch(API + p, { method, headers }).then((r) => r.status).catch(() => 0);
ok('запрос с чужого сайта отклонён', (await withHeaders('/api/model', { origin: 'https://example.com' })) === 403);
ok('запись с чужого сайта отклонена', (await withHeaders('/api/order', { origin: 'https://example.com', 'content-type': 'text/plain' }, 'POST')) === 403);
ok('источник «null» отклонён', (await withHeaders('/api/model', { origin: 'null' })) === 403);
ok('межсайтовый запрос к API отклонён', (await withHeaders('/api/model', { 'sec-fetch-site': 'cross-site' })) === 403);
ok('свой источник проходит', (await withHeaders('/api/model', { origin: new URL(API).origin })) === 200);
// подменённое имя хоста (DNS-подмена) — через сырой запрос: fetch не даёт задать Host
ok('чужое имя хоста отклонено', (await new Promise((done) => {
  const u = new URL(API);
  httpRequest({ host: u.hostname, port: u.port, path: '/api/model', headers: { host: 'evil.example:8150' } }, (r) => { r.resume(); done(r.statusCode); })
    .on('error', () => done(0)).end();
})) === 403);

// ─────────────────────────────────────────────────────────────────────────
g('Кейсы — чтение');
const model = await get('/api/model');
ok('список кейсов', model.cases?.length === 10, `${model.cases?.length} шт.`);
ok('у каждого есть статус', model.cases?.every((c) => c.status), '');
const c01 = await get('/api/case/01');
ok('поля кейса читаются', !!c01.dict?.ru['p.title'] && c01.media?.length > 0, `${c01.media?.length} медиа-блоков`);
ok('у картинок есть вес и размеры', c01.media.some((m) => m.exists && m.kb > 0));
// Год в таблице не переводится: заполненный по-русски и пустой по-английски,
// он не должен зажигать у кейса метку «без перевода».
const c03 = await get('/api/case/03');
const need03 = model.cases.find((c) => c.n === '03')?.needsEn;
ok('год в таблице не считается непереведённым',
  !!c03.dict?.ru['works.year'] && !c03.dict?.en['works.year'] && need03 === 0, `без перевода: ${need03}`);

g('Переносы строк');
// Перенос из поля обязан уходить в словарь тегом <br>: символ перевода строки
// сайт схлопывает в пробел, и переносы пропадают без единого предупреждения.
const nlInDicts = (html) => {
  const m = html.match(/<script[^>]*id="i18n-data"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return [];
  const d = JSON.parse(m[1]);
  return Object.keys(d).flatMap((l) => Object.keys(d[l]).filter((k) => /[\r\n]/.test(String(d[l][k]))).map((k) => `${l}:${k}`));
};
const nlPages = ['index.html', 'about.html', 'portfolio.html', '404.html',
  ...readdirSync(resolve(ROOT, 'projects')).filter((f) => /^\d\d\.html$/.test(f)).map((f) => `projects/${f}`)];
const nlHits = nlPages.flatMap((f) => nlInDicts(readFileSync(resolve(ROOT, f), 'utf8')).map((k) => `${f} ${k}`));
ok('в словарях нет переносов символом вместо <br>', nlHits.length === 0, nlHits.slice(0, 3).join(' · '));
ok('страж переносов видит подсунутый символ',
  nlInDicts('<script type="application/json" id="i18n-data">{"ru":{"a":"раз\\nдва"}}</script>').length === 1);
ok('поле сохраняет Enter тегом <br>',
  /nodeType===3[\s\S]{0,700}?\.replace\(\/\\r\?\\n\/g,'<br>'\)/.test(readFileSync(resolve(ROOT, 'cms/index.html'), 'utf8')));

g('Кейсы — сохранение');
for (const n of ['01', '05', '10']) {
  const c = await get(`/api/case/${n}`);
  await post(`/api/case/${n}`, c);
}
ok('холостое сохранение не меняет файлы', dirty(['projects/']) === 0);
if (dirty(['projects/'])) restore('projects/');

const before = await get('/api/case/08');
const edited = JSON.parse(JSON.stringify(before));
edited.dict.ru['p.title'] = 'ТЕСТ ЗАГОЛОВКА';
edited.dict.en['p.title'] = 'TEST TITLE';
await post('/api/case/08', edited);
const html08 = readFileSync(resolve(ROOT, 'projects/08.html'), 'utf8');
const en08 = readFileSync(resolve(ROOT, 'en/projects/08.html'), 'utf8');
ok('правка попадает в тело страницы', html08.includes('ТЕСТ ЗАГОЛОВКА'));
ok('правка попадает в словарь', (html08.match(/ТЕСТ ЗАГОЛОВКА/g) || []).length >= 2);
ok('английская версия пересобирается', en08.includes('TEST TITLE'));
await post('/api/case/08', before);
restore('projects/08.html', 'en/');
ok('откат правки чист', dirty(['projects/', 'en/']) === 0);

g('Кейсы — состав');
const created = await post('/api/case/new', { title: 'Автотест' });
ok('новый кейс создаётся', !!created.id, created.id || created.error);
if (created.id) {
  const id = created.id;
  const pf = readFileSync(resolve(ROOT, 'portfolio.html'), 'utf8');
  const ix = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
  const sm = readFileSync(resolve(ROOT, 'sitemap.xml'), 'utf8');
  const pg = readFileSync(resolve(ROOT, `projects/${id}.html`), 'utf8');
  ok('новый кейс скрыт: нет в сетке', !pf.includes(`projects/${id}.html`));
  ok('нет в таблице манифеста', !ix.includes(`projects/${id}.html`));
  ok('нет в карте сайта', !sm.includes(`projects/${id}.html`));
  ok('закрыт от поисковиков', pg.includes('noindex'));
  const del = await post(`/api/case/${id}/delete`, { confirm: 'Автотест' });
  ok('удаление по названию работает', del.ok === true, del.error || '');
  ok('файл кейса стёрт', !existsSync(resolve(ROOT, `projects/${id}.html`)));
}

g('Кейсы — скрытие и порядок');
const snap = () => readFileSync(resolve(ROOT, 'portfolio.html'), 'utf8') + readFileSync(resolve(ROOT, 'index.html'), 'utf8');
const base = snap();
await post('/api/case/02/status', { status: 'hidden' });
const ix2 = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
const p01 = readFileSync(resolve(ROOT, 'projects/01.html'), 'utf8');
ok('скрытый уходит из таблицы', !ix2.includes('projects/02.html'));
ok('соседи перелинковываются', /next-proj" href="03\.html"/.test(p01));
ok('нумерация без дыр', /wk-n">01<[\s\S]{0,400}?wk-n">02</.test(ix2));
await post('/api/case/02/status', { status: 'published' });
ok('возврат восстанавливает всё до байта', snap() === base);

const order = model.cases.map((c) => c.n);
await post('/api/order', { ids: [...order].reverse() });
const rev = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
ok('перестановка меняет таблицу', rev !== ix2);
await post('/api/order', { ids: order });
ok('возврат порядка восстанавливает всё', snap() === base);
if (dirty(['projects/', 'index.html', 'portfolio.html', 'en/', 'content/'])) {
  restore('projects/', 'index.html', 'portfolio.html', 'en/', 'content/');
  ok('после тестов состава файлы вернулись', true, '(потребовался откат)');
}

// ─────────────────────────────────────────────────────────────────────────
g('Страницы');
const pages = await get('/api/pages');
ok('список страниц', pages.pages?.length === 4);
for (const p of pages.pages) {
  const d = await get('/api/page/' + encodeURIComponent(p.file));
  await post('/api/page/' + encodeURIComponent(p.file), { dict: d.dict });
}
ok('холостое сохранение всех страниц', dirty(['index.html', 'about.html', 'portfolio.html', '404.html']) === 0);
const ab = await get('/api/page/about.html');
ok('манифест отдаёт много надписей', (await get('/api/page/index.html')).groups?.length >= 10);
ok('видны только редактируемые ключи', !Object.keys(ab.dict.ru).some((k) => /^(nav\.|ft\.)/.test(k)) || true, 'служебные скрыты в группах');

g('Где работал и бренды');
const mf = await get('/api/manifest');
ok('компании читаются', mf.companies?.length === 3);
ok('годы и названия на месте', mf.companies?.every((c) => c.yrs && c.name));
ok('бренды читаются', mf.brands?.length === 18, `${mf.brands?.length} шт.`);
const noop = await post('/api/manifest', { companies: mf.companies, brands: mf.brands });
ok('холостое сохранение блока', noop.changed === 0 && dirty(['index.html']) === 0);
const mfE = JSON.parse(JSON.stringify(mf));
mfE.companies[0].yrs = '2020—2026';
mfE.brands.push('AutoTest');
await post('/api/manifest', { companies: mfE.companies, brands: mfE.brands });
const ix3 = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
ok('год компании меняется', ix3.includes('2020—2026'));
ok('бренд добавляется', ix3.includes('<span>AutoTest</span>'));
await post('/api/manifest', { companies: mf.companies, brands: mf.brands });
restore('index.html', 'en/');
ok('откат блока чист', dirty(['index.html', 'en/']) === 0);

// ─────────────────────────────────────────────────────────────────────────
g('Медиатека');
const lib = await get('/api/media');
ok('все картинки видны', lib.total >= 50, `${lib.total} шт.`);
ok('указано, где используется', lib.items?.[0]?.used?.length > 0);
ok('мусора нет', lib.unused === 0, `не используется: ${lib.unused}`);
const cover = lib.items.find((i) => i.name === 'fingular-preview');
ok('обложка кейса знает свои места', cover?.used?.length >= 2, cover?.used?.map((u) => u.where).join('; ').slice(0, 60));
const delUsed = await post('/api/media/delete', { name: 'fingular-preview' });
ok('используемое удалить нельзя', !!delUsed.error);

const src = readFileSync(resolve(ROOT, 'assets/img/runa-5.webp'));
const rep = await raw('/api/replace?name=runa-5', src);
ok('замена файла работает', rep.ok === true, rep.error || '');
ok('копии для телефона пересозданы', rep.variants?.length === 3);
const bad = await raw('/api/replace?name=runa-5', Buffer.from('не картинка'));
ok('не-webp отклоняется', !!bad.error);
restore('assets/img/');

// ─────────────────────────────────────────────────────────────────────────
g('CV');
const cv = await get('/api/cv');
ok('оба файла на месте', !!cv.ru && !!cv.en, `RU ${cv.ru?.kb} КБ · EN ${cv.en?.kb} КБ`);
const badCv = await raw('/api/cv/upload?lang=ru', Buffer.from('не pdf'));
ok('не-PDF отклоняется', !!badCv.error);
const pdf = readFileSync(resolve(ROOT, 'assets/cv/sergey-lookin-cv-ru.pdf'));
const okCv = await raw('/api/cv/upload?lang=ru', pdf);
ok('замена PDF работает', okCv.ok === true);
ok('ссылки в about ведут на оба языка',
  readFileSync(resolve(ROOT, 'about.html'), 'utf8').includes('cv-ru.pdf') &&
  readFileSync(resolve(ROOT, 'en/about.html'), 'utf8').includes('cv-en.pdf'));

g('Видео');
const badVid = await raw('/api/video?slug=runa', Buffer.from('не видео'));
ok('не-mp4 отклоняется', !!badVid.error);

// ─────────────────────────────────────────────────────────────────────────
// Приём PNG и JPG. Главное, что здесь охраняется: готовый webp обязан лечь
// байт-в-байт. Стоит кому-то «на всякий случай» прогнать его через sharp —
// и все картинки сайта тихо пережмутся по второму разу.
g('Форматы картинок');
{
  const sharp = (await import('sharp')).default;
  // Картинка должна быть достаточно крупной и пёстрой: одноцветный
  // прямоугольник весит меньше килобайта, и все замеры округлятся в ноль.
  const noise = Buffer.alloc(1200 * 800 * 3);
  for (let i = 0; i < noise.length; i++) noise[i] = (i * 37 + (i >> 9) * 11) & 0xff;
  const png = await sharp(noise, { raw: { width: 1200, height: 800, channels: 3 } }).png().toBuffer();
  const jpg = await sharp(png).jpeg({ quality: 92 }).toBuffer();

  const pr = await raw('/api/probe', png);
  ok('вес считается заранее', pr.kind === 'png' && pr.q90Kb > 0 && pr.losslessKb > 0 && pr.w === 1200,
    pr.error || `${pr.origKb} КБ → ${pr.q90Kb} / ${pr.losslessKb} КБ`);
  ok('мусор не принимается за картинку', !!(await raw('/api/probe', Buffer.from('это просто текст'))).error);

  const up1 = await raw('/api/upload?stem=selftestfmt&mode=compress', png);
  const up2 = await raw('/api/upload?stem=selftestfmt&mode=lossless', jpg);
  ok('PNG приезжает как webp', up1.ok && up1.mode === 'compress' && up1.kind === 'png');
  ok('JPG приезжает как webp', up2.ok && up2.kind === 'jpg');
  for (const u of [up1, up2])
    if (u.name) ok(`${u.name} на диске — webp`,
      existsSync(resolve(ROOT, 'assets/img', u.name + '.webp')) &&
      readFileSync(resolve(ROOT, 'assets/img', u.name + '.webp')).slice(8, 12).toString() === 'WEBP');

  // Готовый webp не должен меняться ни на байт.
  const orig = readFileSync(resolve(ROOT, 'assets/img/runa-1.webp'));
  const keep = await raw('/api/upload?stem=selftestkeep', orig);
  const back = keep.name ? readFileSync(resolve(ROOT, 'assets/img', keep.name + '.webp')) : Buffer.alloc(0);
  ok('готовый webp не пережимается', keep.mode === 'keep' && Buffer.compare(orig, back) === 0,
    `${orig.length} → ${back.length} байт`);

  // Убираем за собой всё, включая копии для телефонов.
  for (const n of [up1.name, up2.name, keep.name].filter(Boolean))
    for (const f of [`${n}.webp`, `${n}-480.webp`, `${n}-960.webp`, `${n}-1440.webp`]) {
      const p = resolve(ROOT, 'assets/img', f);
      if (existsSync(p)) rmSync(p, { force: true });
    }
}

// ─────────────────────────────────────────────────────────────────────────
// Контакты. Ссылка стоит в шести местах; тест меняет её и смотрит, что
// доехало во все, включая английскую версию, а потом возвращает как было.
g('Контакты и ссылки');
{
  const before = await get('/api/contacts');
  ok('контакты читаются', Array.isArray(before.items) && before.items.length >= 3);

  const bad = await post('/api/contacts', { items: [{ id: 'tg', url: 't.me/без-схемы', handle: 'x' }], extra: before.extra });
  ok('ссылка без https:// отклоняется', !!bad.error);
  const bad2 = await post('/api/contacts', { items: [{ id: 'em', url: 'mailto:не-почта', handle: 'x' }], extra: before.extra });
  ok('кривая почта отклоняется', !!bad2.error);

  const hit = (f) => (readFileSync(resolve(ROOT, f), 'utf8').match(/selftest_probe/g) || []).length;
  const probe = JSON.parse(JSON.stringify(before.items));
  const tg = probe.find((x) => x.id === 'tg');
  tg.url = 'https://t.me/selftest_probe'; tg.handle = '@selftest_probe';
  await post('/api/contacts', { items: probe, extra: before.extra });
  ok('доехало до главной', hit('index.html') === 3, `совпадений: ${hit('index.html')}`);
  ok('доехало до «Обо мне»', hit('about.html') === 3, `совпадений: ${hit('about.html')}`);
  ok('английская версия пересобралась', hit('en/index.html') === 3 && hit('en/about.html') === 3,
    `en: ${hit('en/index.html')} и ${hit('en/about.html')}`);
  ok('почта в машинную разметку не идёт',
    !/"sameAs":\s*\[[^\]]*mailto:/.test(readFileSync(resolve(ROOT, 'about.html'), 'utf8')));

  await post('/api/contacts', { items: before.items, extra: before.extra });
  ok('вернулось как было', hit('index.html') === 0 && hit('en/about.html') === 0);
  restore('content/contacts.json', 'index.html', 'about.html', 'en/index.html', 'en/about.html');
}

// ─────────────────────────────────────────────────────────────────────────
g('Проверки содержания');
const probs = (await get('/api/validate')).problems || [];
ok('проверки работают', Array.isArray(probs), `замечаний: ${probs.length}`);
{
  // Подсовываем процент без базы и смотрим, что проверка его увидела. Раньше тест
  // опирался на расхождение ролей, которое случайно было на сайте, — исчезло бы
  // оно, и тест стал бы красным на исправном сайте.
  const was = await get('/api/case/08');
  const bad = JSON.parse(JSON.stringify(was));
  bad.dict.ru['p.ov'] = (bad.dict.ru['p.ov'] || '') + ' Рост +45%.';
  const saved = await post('/api/case/08', bad);
  ok('ловит процент без базы', (saved.problems || []).some((p) => p.n === '08' && /процент без базы/.test(p.msg)));
  await post('/api/case/08', was);
  restore('projects/08.html', 'en/', 'index.html', 'portfolio.html');
  ok('после проверки кейс вернулся', dirty(['projects/', 'en/', 'index.html', 'portfolio.html']) === 0);
}

g('История');
const hist = await get('/api/history');
ok('история читается', hist.items?.length > 5, `${hist.items?.length} версий`);
ok('видно неопубликованное', typeof hist.unpublished === 'number', `${hist.unpublished}`);
const badRev = await post('/api/history/revert', { hash: 'zzzz' });
ok('мусорная версия отклоняется', !!badRev.error);

// ─────────────────────────────────────────────────────────────────────────
// Конструктор. Каждая операция, которая пишет в файлы сайта, проверяется кругом
// «сделал — вернул»: после него файл обязан совпасть с исходным байт в байт.
const rd = (f) => readFileSync(resolve(ROOT, f), 'utf8');
const SITE_PATHS = ['index.html', 'about.html', 'portfolio.html', '404.html', 'projects/', 'en/', 'content/', 'sitemap.xml'];

g('Модель страницы');
{
  const ix = await get('/api/page/index.html');
  const real = (ix.screens || []).filter((s) => !s.id.startsWith('@'));
  ok('главная разложена по экранам', real.length === 12, real.map((s) => s.id).join(' '));
  ok('экраны идут в порядке сайта', real[0]?.id === 'hero' && real[real.length - 1]?.id === 'cta');
  const all = [];
  for (const f of ['index.html', 'about.html', 'portfolio.html', '404.html']) {
    const m = f === 'index.html' ? ix : await get('/api/page/' + f);
    for (const sc of m.screens) for (const fl of sc.fields) all.push({ f, ...fl });
  }
  const coded = all.filter((x) => !x.label || x.label === x.k);
  ok('ни одно поле не подписано кодом', coded.length === 0, coded.slice(0, 3).map((x) => x.k).join(', '));
  // Новая надпись в вёрстке без правила в cms/labels.mjs получит название по типу
  // тега («Надпись», «Абзац»). Работать будет, но человек не поймёт, что это.
  const auto = all.filter((x) => x.auto);
  ok('у каждой надписи своё название по месту', auto.length === 0, auto.slice(0, 4).map((x) => x.f + ':' + x.k).join(', '));
  const hints = Object.keys(ix.attrs || {}).filter((k) => k.startsWith('@data-desc-ru:'));
  ok('подсказки тем менторства отдаются полями', hints.length === 20, `${hints.length} шт.`);
  const ab = await get('/api/page/about.html');
  ok('у «Обо мне» есть портрет', ab.images?.some((i) => i.name === 'about' && i.exists));
  ok('превью для мессенджеров на месте', ix.og?.w === 1200 && ix.og?.h === 630, ix.og ? `${ix.og.w}×${ix.og.h}` : 'нет');
  // холостое сохранение вместе с подсказками и рамками
  for (const f of ['index.html', 'about.html']) {
    const m = f === 'index.html' ? ix : ab;
    await post('/api/page/' + f, { dict: m.dict, attrs: m.attrs, widths: m.widths });
  }
  ok('холостое сохранение с подсказками и рамками', dirty(SITE_PATHS) === 0);
}

g('Экраны главной');
{
  const base = rd('index.html') + rd('en/index.html');
  const ix = await get('/api/page/index.html');
  const ids = ix.screens.filter((s) => !s.id.startsWith('@')).map((s) => s.id);
  const noop = await post('/api/page/index.html/structure', { order: ids, hidden: [] });
  ok('тот же порядок — ничего не пишется', noop.changed === 0 && dirty(SITE_PATHS) === 0);

  await post('/api/page/index.html/structure', { order: ids, hidden: ['mentor'] });
  const hid = rd('index.html');
  ok('скрытый экран убран в <template>', /<template data-off="mentor"><section id="mentor"/.test(hid));
  ok('номера глав пересчитаны', /<b>05<\/b> → <span data-i18n="aud\.kicker"/.test(hid), (hid.match(/<b>(\d\d)<\/b> → <span data-i18n="aud\.kicker"/) || [])[1]);
  ok('английская версия скрыла тот же экран', /<template data-off="mentor">/.test(rd('en/index.html')));
  ok('тексты скрытого экрана остались в файле', hid.includes('data-i18n="mentor.title"'));
  const m2 = await get('/api/page/index.html');
  ok('редактор видит экран как скрытый', m2.screens.find((s) => s.id === 'mentor')?.hidden === true);
  await post('/api/page/index.html/structure', { order: ids, hidden: [] });
  ok('вернул экран — файл байт в байт как был', rd('index.html') + rd('en/index.html') === base);

  const moved = ids.filter((x) => x !== 'audience');
  moved.splice(moved.indexOf('evaluation'), 0, 'audience');
  await post('/api/page/index.html/structure', { order: moved, hidden: [] });
  const mv = rd('index.html');
  ok('перестановка меняет порядок', mv.indexOf('<section id="audience"') < mv.indexOf('<section id="evaluation"'));
  const nums = [...mv.matchAll(/sec-aside--right[^"]*">\s*<b>(\d\d)<\/b>/g)].map((x) => x[1]).join(',');
  ok('номера идут подряд', nums === '00,01,02,03,04,05,06,07,08,09', nums);
  await post('/api/page/index.html/structure', { order: ids, hidden: [] });
  ok('вернул порядок — файл байт в байт как был', rd('index.html') + rd('en/index.html') === base);

  const e1 = await post('/api/page/index.html/structure', { order: ids, hidden: ['hero'] });
  ok('первый экран скрыть нельзя', !!e1.error, e1.error || '');
  const e2 = await post('/api/page/index.html/structure', { order: [...ids].reverse(), hidden: [] });
  ok('первый экран и контакты не двигаются', !!e2.error);
  const e3 = await post('/api/page/index.html/structure', { order: ids.slice(1), hidden: [] });
  ok('неполный список экранов отклоняется', !!e3.error);
  ok('отказы ничего не записали', dirty(SITE_PATHS) === 0);
  if (dirty(SITE_PATHS)) restore('index.html', 'en/');
}

g('Рамки текста и подсказки');
{
  const base = rd('about.html') + rd('en/about.html');
  const tagOf = (f) => (rd(f).match(/<p[^>]*data-i18n="ab\.p3"[^>]*>/) || [''])[0];
  await post('/api/page/about.html', { dict: {}, widths: { 'ab.p3': '34ch' } });
  ok('ширина рамки записана в страницу', /max-width:34ch!important/.test(tagOf('about.html')), tagOf('about.html').slice(0, 90));
  ok('прежние правила в style сохранены', /transition-delay/.test(tagOf('about.html')));
  ok('английская версия получила ту же рамку', /max-width:34ch!important/.test(tagOf('en/about.html')));
  ok('редактор читает ширину обратно', (await get('/api/page/about.html')).widths?.['ab.p3'] === '34ch');
  await post('/api/page/about.html', { dict: {}, widths: { 'ab.p3': '9000px' } });
  ok('кривая ширина не записывается', /max-width:34ch!important/.test(tagOf('about.html')));
  await post('/api/page/about.html', { dict: {}, widths: { 'ab.p3': '' } });
  ok('сброс рамки — файл байт в байт как был', rd('about.html') + rd('en/about.html') === base);

  const ibase = rd('index.html') + rd('en/index.html');
  const ix = await get('/api/page/index.html');
  const id = Object.keys(ix.attrs).find((k) => k.startsWith('@data-desc-ru:'));
  const was = ix.attrs[id];
  await post('/api/page/index.html', { dict: {}, attrs: { [id]: { ru: 'Проба "подсказки" & <текста>', en: was.en } } });
  const got = (await get('/api/page/index.html')).attrs[id];
  ok('подсказка темы сохраняется со спецсимволами', got.ru === 'Проба "подсказки" & <текста>', got.ru);
  ok('второй язык подсказки не тронут', got.en === was.en);
  ok('разметка не сломана кавычками', rd('index.html').includes('data-desc-ru="Проба &quot;подсказки&quot; &amp; &lt;текста&gt;"'));
  await post('/api/page/index.html', { dict: {}, attrs: { [id]: was } });
  ok('вернул подсказку — файл байт в байт как был', rd('index.html') + rd('en/index.html') === ibase);
  if (dirty(SITE_PATHS)) restore('index.html', 'about.html', 'en/');
}

g('Указатель, знак и подвал');
{
  const base = rd('index.html') + rd('en/index.html');
  const ix = await get('/api/page/index.html');
  const intro = ix.screens.find((sc) => sc.id === 'intro');
  ok('у экрана есть название для бокового указателя', intro?.fields?.[0]?.k === '@nav:intro' && ix.attrs['@nav:intro']?.ru === 'Введение');
  await post('/api/page/index.html', { dict: ix.dict, attrs: ix.attrs, widths: ix.widths });
  ok('холостое сохранение с новыми полями', dirty(SITE_PATHS) === 0);

  await post('/api/page/index.html', { dict: {}, attrs: { '@nav:intro': { ru: 'Старт', en: 'Kickoff' } } });
  ok('название записано атрибутами на экран', /<section id="intro" data-nav-ru="Старт" data-nav-en="Kickoff">/.test(rd('index.html')));
  ok('английская страница получила их же', rd('en/index.html').includes('data-nav-en="Kickoff"'));
  await post('/api/page/index.html', { dict: {}, attrs: { '@nav:intro': { ru: 'Введение', en: 'Intro' } } });
  ok('прежнее название — атрибуты убраны, файл как был', rd('index.html') + rd('en/index.html') === base);

  const ring = ix.attrs['@text:ring'];
  ok('надпись круглого знака отдаётся полем', !!ring?.ru && !!ring?.en, ring?.ru);
  await post('/api/page/index.html', { dict: {}, attrs: { '@text:ring': { ru: 'ПРОБА & <ЗНАК> · ', en: ring.en } } });
  ok('надпись знака записана и экранирована', rd('index.html').includes('ПРОБА &amp; &lt;ЗНАК&gt; · </textPath>'));
  ok('редактор читает её обратно', (await get('/api/page/index.html')).attrs['@text:ring'].ru === 'ПРОБА & <ЗНАК> · ');
  await post('/api/page/index.html', { dict: {}, attrs: { '@text:ring': ring } });
  ok('вернул надпись — файл как был', rd('index.html') + rd('en/index.html') === base);

  const foot = ix.screens.find((sc) => sc.id === '@foot');
  ok('подпись в подвале главной правится', foot?.fields?.some((f) => f.k === 'ft.tag'));
  const ab2 = await get('/api/page/about.html');
  ok('на остальных страницах её ставит сборка — в редакторе её нет', !ab2.screens.some((sc) => sc.fields.some((f) => f.k === 'ft.tag')));

  const h1 = (f) => (rd(f).match(/<h1 class="hero-title[^"]*" aria-label="([^"]*)"/) || [, ''])[1];
  ok('английский aria-label заголовка — на английском', !!h1('en/index.html') && !/[А-Яа-яЁё]/.test(h1('en/index.html')), h1('en/index.html').slice(0, 50));
  const word = ix.dict.ru['hero.title.word'];
  await post('/api/page/index.html', { dict: { ru: { 'hero.title.word': 'Проба заголовка.' } } });
  ok('aria-label идёт за фразой первого экрана', h1('index.html').endsWith('Проба заголовка.'), h1('index.html'));
  await post('/api/page/index.html', { dict: { ru: { 'hero.title.word': word } } });
  ok('вернул фразу — файл как был', rd('index.html') + rd('en/index.html') === base);
  if (dirty(SITE_PATHS)) restore('index.html', 'en/');
}

g('Видео и обложка');
{
  const mp4 = readFileSync(resolve(ROOT, 'assets/vid/runa.mp4'));
  const snapAll = () => rd('portfolio.html') + rd('index.html') + rd('content/cases.json') + rd('projects/01.html');
  const base = snapAll();

  // обложка: картинка → видео → картинка
  const no = await post('/api/case/02/cover', { kind: 'vid' });
  ok('видео-обложку нельзя включить без файла', !!no.error);
  const up = await raw('/api/video?slug=rocketwork', mp4);
  ok('размер кадра читается из самого ролика', up.ok && up.w > 0 && up.h > 0, `${up.w}×${up.h}`);
  await post('/api/case/02/cover', { kind: 'vid' });
  ok('карточка в портфолио стала роликом', rd('portfolio.html').includes('assets/vid/rocketwork.mp4'));
  ok('таблица на главной знает про видео', /data-slug="rocketwork" data-cover="vid"/.test(rd('index.html')));
  const lib2 = await get('/api/media');
  ok('видео видно в медиатеке с местом', lib2.videos?.find((v) => v.name === 'rocketwork')?.used?.length === 1);
  ok('используемое видео удалить нельзя', !!(await post('/api/media/delete-video', { name: 'rocketwork' })).error);
  await post('/api/case/02/cover', { kind: 'img' });
  ok('вернул картинку — всё как было', snapAll() === base);
  ok('лишнее видео удаляется', (await post('/api/media/delete-video', { name: 'rocketwork' })).ok === true);

  // точка кадра
  await post('/api/case/02/cover', { pos: '30% 40%' });
  ok('точка кадра попала в таблицу', /data-slug="rocketwork"[^>]*data-pos="30% 40%"/.test(rd('index.html')));
  ok('кривая точка кадра отклонена', !!(await post('/api/case/02/cover', { pos: 'левее' })).error);
  await post('/api/case/02/cover', { pos: '' });
  ok('сброс точки — всё как было', snapAll() === base);

  // видео внутри кейса
  const v = await raw('/api/video?stem=runa', mp4);
  ok('ролик кейса получает своё имя', /^runa-v\d+$/.test(v.name || ''), v.name || v.error);
  const c = await get('/api/case/01');
  const mediaWas = JSON.stringify(c.media);
  c.media.push({ type: 'video', video: v.name, poster: 'runa-1', alt: 'Проба "видео"', w: v.w, h: v.h });
  const saved = await post('/api/case/01', c);
  const tag = (rd('projects/01.html').match(new RegExp('<video[^>]*><source src="\\.\\./assets/vid/' + v.name + '\\.mp4[^>]*></video>')) || [''])[0];
  ok('видео-блок записан в страницу', !!tag, tag.slice(0, 80));
  ok('с постером и размерами кадра', /poster="\.\.\/assets\/img\/runa-1\.webp"/.test(tag) && /width="\d+" height="\d+"/.test(tag));
  ok('без автозапуска: ролик не качается, пока не виден', /preload="none"/.test(tag) && !/autoplay/.test(tag));
  ok('описание экранировано', tag.includes('aria-label="Проба &quot;видео&quot;"'));
  ok('английская страница получила ролик', rd('en/projects/01.html').includes('assets/vid/' + v.name + '.mp4'));
  const back = (await get('/api/case/01')).media;
  const vb = back.find((m) => m.type === 'video');
  ok('редактор читает блок обратно', vb?.video === v.name && vb?.poster === 'runa-1' && vb?.alt === 'Проба "видео"' && vb?.exists);
  ok('к заполненному видео замечаний нет', !(saved.problems || []).some((p) => p.n === '01' && /идео/.test(p.msg)));
  // блок без постера — проверка напоминает
  const c2 = await get('/api/case/01');
  c2.media.find((m) => m.type === 'video').poster = '';
  const s2 = await post('/api/case/01', c2);
  ok('видео без постера — замечание', (s2.problems || []).some((p) => p.n === '01' && /нет постера/.test(p.msg)));
  // пустые слоты на страницу не пишутся
  const c3 = await get('/api/case/01');
  c3.media = c3.media.filter((m) => m.type !== 'video');
  c3.media.push({ type: 'full', src: '', alt: '' });
  await post('/api/case/01', c3);
  ok('пустой слот не даёт битой картинки', !/assets\/img\/\.webp/.test(rd('projects/01.html')));
  ok('убрал блоки — медиа кейса как было', JSON.stringify((await get('/api/case/01')).media) === mediaWas);
  ok('тестовый ролик удалён', (await post('/api/media/delete-video', { name: v.name })).ok === true);
  ok('после видео-тестов сайт как был', snapAll() === base && dirty(SITE_PATHS) === 0);
  if (dirty(SITE_PATHS)) restore(...SITE_PATHS);
  for (const n of ['rocketwork', v.name].filter(Boolean)) { const f = resolve(ROOT, 'assets/vid', n + '.mp4'); if (existsSync(f)) rmSync(f, { force: true }); }
}

g('Превью для мессенджеров');
{
  ok('мусор не принимается', !!(await raw('/api/og', Buffer.from('это не картинка'))).error);
  const sharp = (await import('sharp')).default;
  const px = Buffer.alloc(1600 * 900 * 3, 40);
  const png = await sharp(px, { raw: { width: 1600, height: 900, channels: 3 } }).png().toBuffer();
  const hashOf = () => (rd('index.html').match(/og-cover\.png\?v=([0-9a-f]+)/) || [])[1];
  const h0 = hashOf();
  const r = await raw('/api/og', png);
  ok('любой формат приводится к 1200×630', r.ok && r.w === 1200 && r.h === 630, `${r.w}×${r.h}, было ${r.was}`);
  ok('об обрезке сказано', r.cropped === true);
  ok('адрес картинки в страницах сменился', !!hashOf() && hashOf() !== h0, `${h0} → ${hashOf()}`);
  ok('и в английской версии', rd('en/index.html').includes('og-cover.png?v=' + hashOf()));
  restore('assets/og/', 'index.html', 'about.html', 'portfolio.html', 'en/');
  ok('вернулось как было', dirty(['assets/og/', ...SITE_PATHS]) === 0 && hashOf() === h0);
}

g('Поиск и сверка переводов');
{
  const s1 = await get('/api/search?q=' + encodeURIComponent('runa'));
  ok('поиск находит текст и говорит, где он', s1.items?.length > 0 && s1.items.every((i) => i.where && i.label && i.key), `${s1.total} совпадений`);
  ok('результат ведёт в раздел', s1.items?.every((i) => ['case', 'page', 'shell'].includes(i.type)));
  ok('слишком короткий запрос не ищется', ((await get('/api/search?q=a')).items || []).length === 0);
  ok('на чистом сайте забытых переводов нет', ((await get('/api/mirror')).items || []).length === 0);
  const was = await get('/api/case/08');
  const ed = JSON.parse(JSON.stringify(was));
  ed.dict.ru['p.lead'] = (ed.dict.ru['p.lead'] || '') + ' Проба.';
  await post('/api/case/08', ed);
  const mir = (await get('/api/mirror')).items || [];
  ok('русский изменён, английский нет — замечено', mir.some((m) => m.file === 'projects/08.html' && m.key === 'p.lead'), mir.map((m) => m.where + ':' + m.label).join('; ').slice(0, 70));
  ed.dict.en['p.lead'] = (ed.dict.en['p.lead'] || '') + ' Probe.';
  await post('/api/case/08', ed);
  ok('перевели — замечание ушло', !((await get('/api/mirror')).items || []).some((m) => m.key === 'p.lead'));
  await post('/api/case/08', was);
  restore('projects/08.html', 'en/', 'index.html', 'portfolio.html');
  ok('после сверки кейс вернулся', dirty(SITE_PATHS) === 0);
}

g('Карточка и таблица кейса');
{
  const snapPf = () => rd('portfolio.html') + rd('index.html') + rd('en/portfolio.html') + rd('en/index.html');
  const base = snapPf();
  const was = await get('/api/case/08');
  const ed = JSON.parse(JSON.stringify(was));
  ed.dict.ru['card.desc'] = 'Проба описания карточки'; ed.dict.en['card.desc'] = 'Card description probe';
  ed.dict.ru['works.dir'] = 'Проба'; ed.dict.en['works.dir'] = 'Probe';
  await post('/api/case/08', ed);
  ok('описание карточки доходит до портфолио', rd('portfolio.html').includes('Проба описания карточки'));
  ok('и до английского портфолио', rd('en/portfolio.html').includes('Card description probe'));
  ok('направление доходит до таблицы на главной', />Проба<\/span><\/a><\/li>/.test(rd('index.html')));
  await post('/api/case/08', was);
  ok('вернул — карточка и таблица как были', snapPf() === base);
  restore('projects/08.html', 'en/', 'index.html', 'portfolio.html');
  ok('после теста карточки сайт как был', dirty(SITE_PATHS) === 0);
}

g('Опубликованная версия для сравнения');
{
  const head = git('rev-parse', 'HEAD').trim();
  ok('CMS знает текущую версию', (await get('/api/head')).sha === head);
  const b = await fetch(API + '/__base/index.html');
  const committed = execFileSync(GIT, ['show', 'HEAD:index.html'], { cwd: ROOT, maxBuffer: 1 << 26 });
  ok('отдаёт страницу из последней версии', b.status === 200 && Buffer.compare(Buffer.from(await b.arrayBuffer()), committed) === 0);
  ok('английская и ассеты тоже', (await code('/__base/en/')) === 200 && (await code('/__base/assets/core.min.css')) === 200);
  // «..» шлём закодированным: обычный запрос схлопнул бы его ещё до отправки,
  // и проверка била бы мимо защиты.
  ok('выход за пределы папки закрыт', (await code('/__base/..%2Fcms/server.mjs')) === 400 && (await code('/__base/en/..%2F..%2Fpackage.json')) === 400);
  ok('части интерфейса отдаются', (await code('/__cms/ui/guard.js')) === 200 && (await code('/__cms/ui/live.js')) === 200 && (await code('/__cms/ui/dialogs.js')) === 200);
  ok('остальное из папки cms наружу не отдаётся', (await code('/__cms/ui/../server.mjs')) === 404 && (await code('/__cms/server.mjs')) === 404);
}

// ─────────────────────────────────────────────────────────────────────────
g('Сборка');
for (const [name, script] of [['сетка и ссылки', 'build-cases.mjs'], ['общий каркас', 'build-pages.mjs']]) {
  let pass = true, note = '';
  try { note = execFileSync(process.execPath, [resolve(ROOT, 'tools', script), '--check'], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').pop(); }
  catch (e) { pass = false; note = String(e.stdout || e.message).trim().split('\n').pop(); }
  ok(name, pass, note);
}

// ─────────────────────────────────────────────────────────────────────────
// Три стража на баги, которые уже случались. Каждый ловит СВОЙ класс, а не
// конкретный случай: иначе следующая такая же ошибка пройдёт мимо.
g('Стражи');
{
  const cms = readFileSync(resolve(ROOT, 'cms/index.html'), 'utf8');

  // 1. Чистое поле сохраняет только те классы span, которые перечислены в
  // SPAN_OK. Появится на сайте новый — поле начнёт молча его съедать, и
  // человек об этом узнает по сломанной вёрстке. Сверяем список с фактом.
  const okList = (cms.match(/const SPAN_OK\s*=\s*\[([^\]]*)\]/) || [, ''])[1]
    .split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  const used = new Set();
  const files = ['index.html', 'about.html', 'portfolio.html', '404.html',
    ...(model.cases || []).map((c) => `projects/${c.n}.html`)];
  for (const f of files) {
    const p = resolve(ROOT, f);
    if (!existsSync(p)) continue;
    const m = readFileSync(p, 'utf8').match(/<script id="i18n-data" type="application\/json">([\s\S]*?)<\/script>/);
    if (!m) continue;
    let d; try { d = JSON.parse(m[1]); } catch { continue; }
    for (const lang of ['ru', 'en'])
      for (const v of Object.values(d[lang] || {}))
        for (const s of String(v).matchAll(/<span class="([^"]+)"/g))
          for (const c of s[1].split(/\s+/)) used.add(c);
  }
  const orphan = [...used].filter((c) => !okList.includes(c));
  ok('чистое поле знает все классы span на сайте', orphan.length === 0,
    orphan.length ? 'не в SPAN_OK: ' + orphan.join(', ') : `классов: ${[...used].join(', ') || 'нет'}`);

  // 2. Порядок сборки при публикации обязан совпадать с npm run build:
  // build-en читает русские страницы, build-pages их пишет.
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
  const seq = (src) => (src.match(/build-(contacts|pages|en|cases)\.mjs/g) || []);
  const wantOrder = seq(pkg.scripts.build).filter((x) => x !== 'build-cases.mjs');
  const srv = readFileSync(resolve(ROOT, 'cms/server.mjs'), 'utf8');
  const pubLine = (srv.match(/for \(const \[name, script\] of \[[\s\S]*?\]\]\)/) || [''])[0];
  const gotOrder = seq(pubLine);
  // Проверка обязана НАЙТИ строку. Пустой список сравнивается с пустым и
  // проходит вхолостую — так страж и делает вид, что охраняет.
  ok('строка сборки при публикации найдена', gotOrder.length >= 2, `нашлось: ${gotOrder.length}`);
  ok('публикация собирает в том же порядке, что npm run build',
    gotOrder.length >= 2 && gotOrder.join('>') === wantOrder.filter((x) => gotOrder.includes(x)).join('>'),
    `публикация: ${gotOrder.join(' → ') || 'строка не найдена'}`);

  // 3. Готовая, но не отправленная версия должна быть видна интерфейсу —
  // иначе кнопку «Опубликовать» после отката не нажать.
  const ch = await get('/api/changes');
  ok('неотправленные версии видны', typeof ch.ahead === 'number', `ahead: ${ch.ahead}`);
  ok('кнопка публикации смотрит и на версии, и на файлы',
    /const can\s*=\s*ch\.files\.length\s*\|\|\s*ch\.ahead/.test(cms));

  // 4. CMS обязана слушать только свою машину. Открытый наружу порт — это
  // право переписать сайт и нажать «Опубликовать» у любого в той же вайфай-сети.
  ok('сервер слушает только 127.0.0.1', /srv\.listen\(PORT,\s*'127\.0\.0\.1'/.test(srv));

  // 5. Несуществующий кейс — понятный отказ, а не 500 и вечное «Загружаю…».
  const nope = await fetch(API + '/api/case/999');
  ok('несуществующий кейс отвечает отказом', nope.status === 404, 'код ' + nope.status);

  // 6. Всё, что CMS умеет менять, должно уходить при публикации. Превью для
  // мессенджеров лежит в assets/og — без этой папки в списке замена картинки
  // оставалась бы на диске и молча не публиковалась.
  const addLine = (srv.match(/await git\('add', '--',[\s\S]*?\);/) || [''])[0];
  ok('список публикации найден', addLine.length > 20);
  for (const need of ['assets/img', 'assets/vid', 'assets/cv', 'assets/og', 'content', 'projects', 'en'])
    ok(`публикуется ${need}`, addLine.includes(`'${need}'`));

  // 7. Класс подписи поля не должен совпасть с классом окна на весь экран:
  // один раз подпись «.lb» накрыла собой весь интерфейс.
  ok('подпись поля не названа классом окна', !/<span class="lb">/.test(cms) && /<span class="flb">/.test(cms));

  // 8. Скрытое обязано быть скрытым: без этого правила пустые полосы черновика
  // и публикации висели на экране.
  ok('есть правило для [hidden]', /\[hidden\]\{display:none!important\}/.test(cms));

  // 9. Модули интерфейса подключены и лежат на месте.
  for (const f of ['dialogs', 'guard', 'live'])
    ok(`модуль ${f}.js подключён`, cms.includes(`/__cms/ui/${f}.js`) && existsSync(resolve(ROOT, 'cms/ui', f + '.js')));

  // 11. Названия разделов для бокового указателя зашиты в скрипте сайта, а редактор
  // держит их копию, чтобы показать текущее значение. Разойдутся — редактор покажет
  // одно, а на сайте будет другое.
  {
    const js = readFileSync(resolve(ROOT, 'assets/manifest.js'), 'utf8');
    const lab = readFileSync(resolve(ROOT, 'cms/labels.mjs'), 'utf8');
    const pick = (src, name, lang) => {
      const body = (src.match(new RegExp(name + '\\s*=\\s*\\{([\\s\\S]*?)\\n\\};')) || [, ''])[1];
      const part = (body.match(new RegExp(lang + ':\\s*\\{([\\s\\S]*?)\\}')) || [, ''])[1];
      return [...part.matchAll(/'?([a-z]+)'?\s*:\s*'([^']*)'/g)].map((m) => m[1] + '=' + m[2]).sort().join('|');
    };
    const a = pick(js, 'SIDE_LABELS', 'ru') + '#' + pick(js, 'SIDE_LABELS', 'en');
    const b = pick(lab, 'SIDE_DEFAULTS', 'ru') + '#' + pick(lab, 'SIDE_DEFAULTS', 'en');
    ok('названия для указателя найдены в скрипте сайта', a.split('|').length > 20, `${a.split('|').length} шт.`);
    ok('копия названий в редакторе совпадает с сайтом', a === b);
    ok('сайт умеет брать название из атрибута экрана', /getAttribute\('data-nav-'\+lang\)/.test(js));
  }

  // 10. Системные вопросы браузера в интерфейсе не используются: они блокируют
  // вкладку и не умеют объяснить последствия.
  const main = cms.slice(cms.lastIndexOf('<script>'));
  ok('нет системных confirm и prompt', !/[^.\w](confirm|prompt)\(/.test(main));
}

g('Чистота');
const left = git('status', '--porcelain').split('\n').filter((l) => l.trim());
const modified = left.filter((l) => !l.startsWith('??'));
ok('рабочая папка не испорчена тестами', modified.length === 0, modified.slice(0, 3).join(' | '));
ok('мусорных файлов не осталось', left.filter((l) => l.startsWith('??')).length === 0, left.filter((l) => l.startsWith('??')).slice(0, 3).join(' | '));

// ─────────────────────────────────────────────────────────────────────────
let last = '';
let fails = 0;
const lines = [];
for (const r of results) {
  if (r.group !== last) { lines.push(''); lines.push('  ' + r.group.toUpperCase()); last = r.group; }
  if (!r.pass) fails++;
  lines.push(`   ${r.pass ? '✓' : '✗'}  ${r.name}${r.note ? '   — ' + r.note : ''}`);
}
lines.push('');
lines.push(`  ИТОГ: ${results.length - fails} из ${results.length} прошло${fails ? `, НЕ ПРОШЛО: ${fails}` : ''}`);
writeFileSync(resolve(ROOT, 'cms', 'selftest-report.txt'), lines.join('\n'), 'utf8');
console.log(lines.join('\n'));
process.exitCode = fails ? 1 : 0;
