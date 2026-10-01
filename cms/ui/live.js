/* live.js — связь формы и превью в обе стороны.

   Туда:   печатаешь в поле — надпись на сайте справа меняется сразу, без «Сохранить».
   Обратно: нажал на надпись или картинку на сайте — слева открылось её поле.

   Разметку сайта при этом не трогаем: подсветка — отдельная рамка поверх кадра,
   нарисованная в окне CMS. Так превью остаётся настоящей страницей, и проверка
   вёрстки меряет её, а не следы редактора.

   Что нужно от основной части (index.html):
     LANG                      — язык превью
     cmsResolve(key, el)       — что делать по клику на надпись: {label, act} или null
     cmsResolveMedia(el)       — то же для картинки или видео
     cmsRoute(pathname)        — открыть в CMS страницу сайта по её адресу
     cmsSetLang(lang)          — сменить язык превью
     cmsDirtyValues(lang)      — несохранённые правки: [{key, value, attr?}]
     cmsLiveChanged()          — превью изменилось (повод проверить вёрстку)        */
const Live = (() => {
  const fr = () => document.getElementById('frame');
  const doc = () => { try { return fr().contentDocument; } catch (e) { return null; } };
  const win = () => { try { return fr().contentWindow; } catch (e) { return null; } };
  let EDIT = localStorage.getItem('cms.pmode') !== 'view';

  // На главной тексты ставит сам сайт — тем же кодом, что переключает язык: он
  // заодно пересчитывает кегль первого экрана и разбивку заголовков на строки.
  // На остальных страницах достаточно подменить содержимое элемента.
  const viaSite = () => { const w = win(); return !!(w && typeof w.applyLang === 'function' && w.SLi18n && w.SLi18n.dict); };

  // ── форма → превью ────────────────────────────────────────────────────────
  const queue = new Map();
  let timer = null;
  function push(key, lang, value) {
    if (lang !== LANG) return;                      // превью показывает другой язык
    queue.set(key, value);
    clearTimeout(timer);
    timer = setTimeout(flush, 140);
  }
  function pushAttr(key, attr, lang, value) {
    if (lang !== LANG) return;
    const d = doc(); if (!d) return;
    d.querySelectorAll('[data-i18n="' + CSS.escape(key) + '"]').forEach((el) => el.setAttribute(attr, value));
  }
  function apply(list) {
    const d = doc(), w = win();
    if (!d || !w || !list.length) return;
    if (viaSite()) {
      const table = w.SLi18n.dict[LANG];
      let any = false;
      for (const [k, v] of list) if (table && k in table && table[k] !== v) { table[k] = v; any = true; }
      if (any) { try { w.applyLang(LANG, false); } catch (e) {} }
      return;
    }
    for (const [k, v] of list) {
      const sel = CSS.escape(k);
      d.querySelectorAll('[data-i18n="' + sel + '"]').forEach((el) => { el.innerHTML = v; });
      d.querySelectorAll('[data-i18n-aria="' + sel + '"]').forEach((el) => el.setAttribute('aria-label', String(v).replace(/<[^>]+>/g, '')));
    }
  }
  function flush() {
    const list = [...queue]; queue.clear();
    apply(list);
    hideHot();
    if (window.cmsLiveChanged) cmsLiveChanged();
  }
  // ширина рамки — сразу в превью, без перезагрузки
  function setWidth(key, val) {
    const d = doc(), w = win(); if (!d) return;
    d.querySelectorAll('[data-i18n="' + CSS.escape(key) + '"]').forEach((el) => {
      if (val) el.style.setProperty('max-width', val, 'important'); else el.style.removeProperty('max-width');
    });
    // на главной заголовки разбиты на строки скриптом — просим сайт пересчитать
    if (viaSite()) { try { w.applyLang(LANG, false); } catch (e) {} reapplyWidths(); }
    if (window.cmsLiveChanged) cmsLiveChanged();
  }
  let liveWidths = {};
  function reapplyWidths() {
    const d = doc(); if (!d) return;
    for (const [k, v] of Object.entries(liveWidths)) {
      d.querySelectorAll('[data-i18n="' + CSS.escape(k) + '"]').forEach((el) => {
        if (v) el.style.setProperty('max-width', v, 'important'); else el.style.removeProperty('max-width');
      });
    }
  }

  // элемент превью по ключу — первый видимый
  function find(key) {
    const d = doc(); if (!d) return null;
    const all = d.querySelectorAll('[data-i18n="' + CSS.escape(key) + '"]');
    for (const el of all) if (el.getClientRects().length) return el;
    return all[0] || null;
  }

  // ── рамка подсветки поверх кадра ──────────────────────────────────────────
  let hot = null, hotTimer = null;
  function hotEl() {
    if (hot) return hot;
    hot = document.createElement('div'); hot.className = 'hot';
    hot.innerHTML = '<span class="hot__tag"></span>';
    document.getElementById('stage').appendChild(hot);
    return hot;
  }
  function showHot(el, label, flash) {
    const f = fr(), st = document.getElementById('stage');
    if (!el || !f) return;
    const fb = f.getBoundingClientRect(), sb = st.getBoundingClientRect();
    const k = fb.width / f.offsetWidth;                 // масштаб кадра в колонке
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > f.offsetHeight) return hideHot();
    const h = hotEl();
    h.style.left = (fb.left - sb.left + r.left * k - 4) + 'px';
    h.style.top = (fb.top - sb.top + r.top * k - 4) + 'px';
    h.style.width = (r.width * k + 8) + 'px';
    h.style.height = (r.height * k + 8) + 'px';
    h.firstChild.textContent = label || '';
    h.firstChild.style.display = label ? '' : 'none';
    h.classList.toggle('hot--flash', !!flash);
    h.hidden = false;
    clearTimeout(hotTimer);
    if (flash) hotTimer = setTimeout(hideHot, 1400);
  }
  function hideHot() { if (hot) hot.hidden = true; }

  // прокрутить превью к надписи и подсветить её
  function reveal(key) {
    const el = find(key), w = win();
    if (!el || !w) return;
    const r = el.getBoundingClientRect();
    const inView = r.top > 60 && r.bottom < w.innerHeight - 40;
    const flash = () => showHot(find(key), '', true);
    if (inView) return flash();
    const y = Math.max(0, r.top + w.scrollY - w.innerHeight * 0.35);
    if (w.__lenis && w.__lenis.scrollTo) w.__lenis.scrollTo(y, { duration: 0.45 });
    else w.scrollTo({ top: y, behavior: 'smooth' });
    setTimeout(flash, 560);
  }

  // ── превью → форма ────────────────────────────────────────────────────────
  function hit(t) {
    if (!t || !t.closest) return null;
    const media = t.closest('img, video');
    if (media && window.cmsResolveMedia) { const m = cmsResolveMedia(media); if (m) return { el: media, ...m }; }
    const el = t.closest('[data-i18n]');
    if (el && window.cmsResolve) { const r = cmsResolve(el.getAttribute('data-i18n'), el); if (r) return { el, ...r }; }
    return null;
  }
  function onOver(e) {
    if (!EDIT) return;
    const h = hit(e.target);
    if (h) showHot(h.el, h.label, false); else hideHot();
  }
  function onClick(e) {
    const t = e.target;
    if (!t || !t.closest) return;
    const stop = () => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
    // переключатель языка на самом сайте — меняем язык превью в CMS
    const lb = t.closest('[data-lang]');
    if (lb && window.cmsSetLang) { stop(); cmsSetLang(lb.getAttribute('data-lang')); return; }
    if (EDIT) {
      const h = hit(t);
      if (h && h.act) { stop(); hideHot(); h.act(); return; }
    }
    // Ссылка: по сайту ходим через CMS, чтобы форма слева шла следом за превью.
    const a = t.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href') || '';
    if (href.startsWith('#')) return;                                  // якорь внутри страницы
    stop();
    let u; try { u = new URL(a.href, doc().baseURI); } catch (er) { return; }
    if (u.origin !== location.origin || /^(mailto|tel):/.test(href)) { if (window.toast) toast('Ссылка наружу: ' + href, 2600); return; }
    if (window.cmsRoute) cmsRoute(u.pathname);
  }

  // ── кадр загрузился ───────────────────────────────────────────────────────
  let keepY = null;
  function onLoad() {
    const d = doc(), w = win();
    if (!d || !w) return;
    d.addEventListener('click', onClick, true);
    d.addEventListener('mouseover', onOver, true);
    d.documentElement.addEventListener('mouseleave', hideHot);
    w.addEventListener('scroll', hideHot, { passive: true });
    hideHot();
    // несохранённые правки переживают перезагрузку кадра (смена языка, устройства)
    const settle = () => {
      const dirty = window.cmsDirtyValues ? cmsDirtyValues(LANG) : [];
      apply(dirty.filter((x) => !x.attr).map((x) => [x.key, x.value]));
      for (const x of dirty.filter((x) => x.attr)) pushAttr(x.key, x.attr, LANG, x.value);
      reapplyWidths();
      if (keepY != null) {
        const y = keepY; keepY = null;
        if (w.__lenis && w.__lenis.scrollTo) w.__lenis.scrollTo(y, { immediate: true, force: true }); else w.scrollTo(0, y);
      }
      if (window.cmsFrameReady) cmsFrameReady();
    };
    // скрипты сайта стоят с defer и к событию load уже отработали, но раскладке
    // (шрифты, подгонка первого экрана) нужно ещё мгновение
    setTimeout(settle, 120);
  }

  // Перезагрузить превью. keep — остаться на том же месте страницы.
  function load(url, keep) {
    const w = win();
    keepY = keep && w ? (w.scrollY || 0) : null;
    fr().src = url;
  }

  function init() {
    fr().addEventListener('load', onLoad);
    addEventListener('resize', hideHot);
  }
  function setEdit(on) { EDIT = !!on; localStorage.setItem('cms.pmode', EDIT ? 'edit' : 'view'); hideHot(); }

  return {
    init, load, push, pushAttr, setWidth, find, reveal, showHot, hideHot, doc, win, setEdit,
    get edit() { return EDIT; },
    setWidths(map) { liveWidths = { ...map }; },
  };
})();
