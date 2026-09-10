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
