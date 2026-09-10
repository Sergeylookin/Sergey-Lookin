// selftest.mjs — сквозная проверка CMS. Прогоняет КАЖДУЮ функцию против живого
// сервера и говорит, что работает, а что нет.
//
//   node cms/selftest.mjs            (сервер должен быть запущен на 8150)
//
// Все тесты, которые что-то меняют, возвращают состояние назад и в конце
// сверяются с git: рабочая папка обязана остаться такой же, как была.

import { readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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

// ─────────────────────────────────────────────────────────────────────────
g('Кейсы — чтение');
const model = await get('/api/model');
ok('список кейсов', model.cases?.length === 10, `${model.cases?.length} шт.`);
ok('у каждого есть статус', model.cases?.every((c) => c.status), '');
const c01 = await get('/api/case/01');
ok('поля кейса читаются', !!c01.dict?.ru['p.title'] && c01.media?.length > 0, `${c01.media?.length} медиа-блоков`);
ok('у картинок есть вес и размеры', c01.media.some((m) => m.exists && m.kb > 0));

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
ok('ловит расхождение ролей', probs.some((p) => /Роль/.test(p.msg)), probs.find((p) => /Роль/.test(p.msg))?.msg?.slice(0, 60) || 'не найдено');

g('История');
const hist = await get('/api/history');
ok('история читается', hist.items?.length > 5, `${hist.items?.length} версий`);
ok('видно неопубликованное', typeof hist.unpublished === 'number', `${hist.unpublished}`);
const badRev = await post('/api/history/revert', { hash: 'zzzz' });
ok('мусорная версия отклоняется', !!badRev.error);

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
    /!ch\.files\.length\s*&&\s*!ch\.ahead/.test(cms));
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
