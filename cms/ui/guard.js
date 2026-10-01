/* guard.js — проверка вёрстки.

   Правка текста или ширины рамки может сломать страницу там, куда человек не
   смотрит: на телефоне, на английском, тремя экранами ниже. Здесь страница
   открывается невидимо на трёх ширинах и двух языках и проверяется на четыре вещи:
     · появилась горизонтальная прокрутка;
     · текст вылез за край экрана;
     · текст обрезан — не помещается в свой блок;
     · один текст наехал на другой.

   На сайте есть места, где всё это сделано нарочно: бегущие строки, лента кадров,
   карусель. Поэтому проверка не судит страницу саму по себе, а СРАВНИВАЕТ её с
   опубликованной версией (/__base/…): замечание — только то, чего там не было. */
const Guard = (() => {
  const DEVS = [
    { id: 'web', w: 1440, h: 900, name: 'Десктоп' },
    { id: 'tab', w: 820, h: 1180, name: 'Планшет' },
    { id: 'mob', w: 390, h: 844, name: 'Телефон' },
  ];
  const LANGS = ['ru', 'en'];
  // всё, что движется само, останавливаем: мерить надо покой, а не кадр анимации
  // content-visibility тоже снимаем: с ним браузер не раскладывает экраны, до которых
  // ещё не докрутили, и держит на их месте заглушку — мерить такую страницу бессмысленно.
  const FREEZE = '*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}'
    + '*{content-visibility:visible!important}'
    + '[data-reveal],[data-stagger],[data-reveal-num]{opacity:1!important;transform:none!important;filter:none!important}';

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Кадр ждём не дольше 80 мс: в свёрнутой вкладке браузер кадры не рисует вовсе,
  // и проверка зависла бы навсегда.
  const frame = (win) => new Promise((r) => { let d = false; const ok = () => { if (!d) { d = true; r(); } }; win.requestAnimationFrame(ok); setTimeout(ok, 80); });

  // ── замер одного документа ────────────────────────────────────────────────
  function clipsX(cs) { return /hidden|clip|auto|scroll/.test(cs.overflowX); }
  function clipsY(cs) { return /hidden|clip|auto|scroll/.test(cs.overflowY); }

  // Короткий устойчивый адрес блока: id или классы, без порядковых номеров —
  // номер меняется от длины текста, а адрес должен совпасть с опубликованной версией.
  function blockName(el) {
    if (!el || !el.tagName) return '';
    if (el.id) return '#' + el.id;
    const cls = [...el.classList].filter((c) => !/^(in-view|is-|on$|active$|hot$)/.test(c)).slice(0, 2).join('.');
    const sec = el.closest('section[id]');
    return (sec ? '#' + sec.id + ' ' : '') + el.tagName.toLowerCase() + (cls ? '.' + cls : '');
  }

  function scan(doc) {
    const win = doc.defaultView;
    const vw = win.innerWidth;
    const out = [];
    const root = doc.documentElement;
    if (root.scrollWidth > vw + 1) out.push({ type: 'hscroll', px: root.scrollWidth - vw, sig: 'hscroll' });

    const range = doc.createRange();
    const items = [];
    for (const el of doc.querySelectorAll('[data-i18n]')) {
      if (!el.getClientRects().length) continue;
      const cs = win.getComputedStyle(el);
      if (cs.visibility === 'hidden') continue;
      // прозрачное насквозь (скрытые подсказки, состояния по наведению) не считаем
      let op = 1;
      for (let p = el; p && p.nodeType === 1; p = p.parentElement) { op *= parseFloat(win.getComputedStyle(p).opacity || '1'); if (op < 0.02) break; }
      if (op < 0.02) continue;
      range.selectNodeContents(el);
      const rects = [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
      if (!rects.length) continue;
      const box = { l: Math.min(...rects.map((r) => r.left)), t: Math.min(...rects.map((r) => r.top)),
                    r: Math.max(...rects.map((r) => r.right)), b: Math.max(...rects.map((r) => r.bottom)) };
      const key = el.getAttribute('data-i18n');

      // Ближайший предок, который обрезает содержимое. Обёртки ВНУТРИ самой надписи
      // (маски строк, которые ставят скрипты сайта) не считаются — они часть эффекта.
      // Заодно собираем окно видимости: пересечение всех обрезающих предков.
      let clipX = null, clipY = null;
      const win0 = { l: -1e9, t: -1e9, r: 1e9, b: 1e9 };
      for (let p = el.parentElement; p && p !== doc.body; p = p.parentElement) {
        const pc = win.getComputedStyle(p);
        const cx = clipsX(pc), cy = clipsY(pc);
        if (!cx && !cy) continue;
        const c = p.getBoundingClientRect();
        if (cx) { if (!clipX) clipX = p; win0.l = Math.max(win0.l, c.left); win0.r = Math.min(win0.r, c.right); }
        if (cy) { if (!clipY) clipY = p; win0.t = Math.max(win0.t, c.top); win0.b = Math.min(win0.b, c.bottom); }
      }
      // для наездов важно только то, что видно: текст, срезанный своим блоком,
      // ни на что наехать не может
      const seenRects = rects.map((r) => ({ left: Math.max(r.left, win0.l), top: Math.max(r.top, win0.t),
        right: Math.min(r.right, win0.r), bottom: Math.min(r.bottom, win0.b) }))
        .filter((r) => r.right - r.left > 1 && r.bottom - r.top > 1);
      if (seenRects.length) {
        items.push({ el, key, rects: seenRects, box: {
          l: Math.min(...seenRects.map((r) => r.left)), t: Math.min(...seenRects.map((r) => r.top)),
          r: Math.max(...seenRects.map((r) => r.right)), b: Math.max(...seenRects.map((r) => r.bottom)) } });
      }
      if (clipX) {
        const c = clipX.getBoundingClientRect();
        const over = Math.max(c.left - box.l, box.r - c.right);
        if (over > 2) out.push({ type: 'clip', key, px: Math.round(over), sig: 'clip|x|' + blockName(clipX) });
      } else {
        const over = Math.max(-box.l, box.r - vw);
        if (over > 2) out.push({ type: 'out', key, px: Math.round(over), sig: 'out|' + key });
      }
      if (clipY) {
        const c = clipY.getBoundingClientRect();
        const over = Math.max(c.top - box.t, box.b - c.bottom);
        if (over > 2) out.push({ type: 'clip', key, px: Math.round(over), sig: 'clip|y|' + blockName(clipY) });
      }
      // слово длиннее своей строки: блок шире, чем ему отведено
      if (cs.display !== 'inline' && el.scrollWidth > el.clientWidth + 2 && cs.overflowX === 'visible')
        out.push({ type: 'wide', key, px: el.scrollWidth - el.clientWidth, sig: 'wide|' + key });
    }

    // наезды: пересечение «чернил» двух надписей, не вложенных друг в друга
    for (let i = 0; i < items.length; i++) {
      const a = items[i];
      for (let j = i + 1; j < items.length; j++) {
        const b = items[j];
        if (a.box.r <= b.box.l || b.box.r <= a.box.l || a.box.b <= b.box.t || b.box.b <= a.box.t) continue;
        if (a.key === b.key || a.el.contains(b.el) || b.el.contains(a.el)) continue;
        let hit = 0;
        for (const ra of a.rects) for (const rb of b.rects) {
          const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
          const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
          if (w >= 3 && h >= 3 && w * h > hit) hit = w * h;
        }
        if (hit >= 24) {
          const [k1, k2] = [a.key, b.key].sort();
          out.push({ type: 'overlap', key: a.key, key2: b.key, px: Math.round(Math.sqrt(hit)), sig: 'overlap|' + k1 + '|' + k2 });
        }
      }
    }

    for (const im of doc.querySelectorAll('img')) {
      if (im.complete && im.naturalWidth === 0 && im.getAttribute('src'))
        out.push({ type: 'broken', key: '', src: im.getAttribute('src'), sig: 'broken|' + im.getAttribute('src').replace(/\?.*$/, '') });
    }
    // одна подпись — одно замечание
    const seen = new Set();
    return out.filter((x) => (seen.has(x.sig) ? false : seen.add(x.sig)));
  }

  // ── невидимая загрузка страницы в нужной ширине ───────────────────────────
  // Кадр стоит внутри окна (иначе браузер считает его невидимым и скрипты сайта,
  // которые ждут появления блока на экране, не срабатывают), но прозрачен и
  // уменьшен, чтобы целиком помещаться в окно CMS.
  function loadView(url, dev) {
    return new Promise((done) => {
      const k = Math.min(1, innerWidth / dev.w, innerHeight / dev.h);
      const box = document.createElement('div');
      box.style.cssText = 'position:fixed;left:0;top:0;width:' + dev.w + 'px;height:' + dev.h + 'px;opacity:0;pointer-events:none;z-index:-1;'
        + 'transform-origin:top left;transform:scale(' + k + ');overflow:hidden';
      const fr = document.createElement('iframe');
      fr.style.cssText = 'width:' + dev.w + 'px;height:' + dev.h + 'px;border:0';
      fr.setAttribute('aria-hidden', 'true');
      fr.tabIndex = -1;
      let finished = false;
      const finish = (res) => { if (finished) return; finished = true; clearTimeout(timer); box.remove(); done(res); };
      const timer = setTimeout(() => finish({ error: 'страница не загрузилась за 25 секунд' }), 25000);
      fr.onload = async () => {
        try {
          const doc = fr.contentDocument, win = fr.contentWindow;
          if (!doc || !doc.body || doc.body.textContent.trim() === 'нет такой страницы') return finish({ missing: true });
          const st = doc.createElement('style'); st.textContent = FREEZE; doc.head.appendChild(st);
          try { await doc.fonts.ready; } catch (e) {}
          await sleep(350);
          // прокручиваем страницу до конца: блоки, которые проявляются по мере
          // прокрутки, должны занять своё окончательное место
          const total = doc.documentElement.scrollHeight, step = Math.max(300, win.innerHeight * 0.85);
          const go = (y) => { if (win.__lenis && win.__lenis.scrollTo) win.__lenis.scrollTo(y, { immediate: true, force: true }); else win.scrollTo(0, y); };
          for (let y = 0; y < total; y += step) { go(y); await frame(win); await sleep(25); }
          go(0); await frame(win); await sleep(280);
          finish({ issues: scan(doc) });
        } catch (e) { finish({ error: String(e && e.message || e) }); }
      };
      fr.src = url + (url.includes('?') ? '&' : '?') + 'guard=' + Date.now();
      box.appendChild(fr);
      document.body.appendChild(box);
    });
  }

  // Опубликованную версию меряем один раз на версию сайта: она не меняется,
  // пока не появилась новая публикация.
  const baseCache = new Map();
  let baseSha = '';
  async function baseIssues(path, lang, dev) {
    const head = await fetch('/api/head').then((r) => r.json()).catch(() => ({}));
    if (head.sha !== baseSha) { baseSha = head.sha; baseCache.clear(); }
    const key = path + '|' + lang + '|' + dev.id;
    if (!baseCache.has(key)) baseCache.set(key, loadView('/__base' + (lang === 'en' ? '/en' : '') + path, dev));
    return baseCache.get(key);
  }

  // Очередь: не больше трёх страниц одновременно, иначе машина захлёбывается.
  async function pool(jobs, n) {
    const res = new Array(jobs.length);
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, async () => {
      while (i < jobs.length) { const k = i++; res[k] = await jobs[k](); }
    }));
    return res;
  }

  // check('/projects/03.html') → { views, problems:[{dev, lang, type, key, key2, px}], errors:[…] }
  // path — адрес русской страницы от корня; английская берётся из /en.
  async function check(path, onProgress) {
    const combos = [];
    for (const dev of DEVS) for (const lang of LANGS) combos.push({ dev, lang });
    let doneN = 0;
    const tick = () => { doneN++; if (onProgress) onProgress(doneN, combos.length); };
    const results = await pool(combos.map(({ dev, lang }) => async () => {
      const [base, work] = [await baseIssues(path, lang, dev), await loadView((lang === 'en' ? '/en' : '') + path, dev)];
      tick();
      return { dev, lang, base, work };
    }), 3);

    const problems = [], errors = [];
    let isNew = false;
    for (const r of results) {
      if (r.work.error || r.work.missing) { errors.push(`${r.dev.name} · ${r.lang.toUpperCase()}: ${r.work.error || 'страница не открылась'}`); continue; }
      if (r.base.missing || r.base.error) isNew = true;           // страницы ещё нет в опубликованной версии
      const known = new Set((r.base.issues || []).map((x) => x.sig));
      for (const it of r.work.issues) if (!known.has(it.sig)) problems.push({ ...it, dev: r.dev, lang: r.lang });
    }
    return { views: combos.length, problems, errors, isNew };
  }

  // человеческое описание замечания; name(key) — название поля
  function describe(p, name) {
    const q = (k) => '«' + (name(k) || k) + '»';
    if (p.type === 'hscroll') return 'Появилась горизонтальная прокрутка: страница шире экрана на ' + p.px + ' px.';
    if (p.type === 'out') return 'Текст ' + q(p.key) + ' вылез за край экрана на ' + p.px + ' px.';
    if (p.type === 'clip') return 'Текст ' + q(p.key) + ' обрезан: не помещается в свой блок (' + p.px + ' px).';
    if (p.type === 'wide') return 'В ' + q(p.key) + ' слово не помещается в строку — ' + p.px + ' px лишних.';
    if (p.type === 'overlap') return q(p.key) + ' наезжает на ' + q(p.key2) + '.';
    if (p.type === 'broken') return 'Картинка не загрузилась: ' + p.src;
    return p.type;
  }

  return { DEVS, LANGS, scan, check, describe, view: loadView, clearBase: () => baseCache.clear() };
})();
