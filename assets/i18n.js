/* i18n.js — shared language-switch CORE for every page (index + sub-pages).
   Loaded (defer) BEFORE manifest.js / site.js; exposes window.SLi18n.

   Owns ONLY the universal work that used to be copy-pasted into both manifest.js and
   site.js (and drifted, causing bugs): parse the #i18n-data dict, detect first-visit
   language, set <html lang>, persist choice, swap every [data-i18n], update title +
   meta description, sync the language buttons (incl. the burger's .nav-drop__lang
   clones), the switcher/burger aria-labels, and the screen-reader announcement.

   Page-specific work (index: hero morph / h2 split / pain-list / monument / tooltips;
   sub-pages: portfolio title split) stays in each page's own thin applyLang wrapper,
   which calls SLi18n.applyStrings() and then does its extras. */
(function () {
  'use strict';
  var LANG_KEY = 'sl-lang';
  var SUPPORTED = ['ru', 'en'];
  var dict = null;
  try {
    var node = document.getElementById('i18n-data');
    dict = node ? JSON.parse(node.textContent) : null;
  } catch (e) { dict = null; }

  /* Static per-language site: the page's own <html lang> is authoritative (URL decides the
     language; the switcher navigates between the RU tree and /en/). Fall back to saved
     choice → browser language only if the page somehow has no lang. */
  function detect() {
    var pageLang = (document.documentElement.getAttribute('lang') || '').slice(0, 2);
    if (SUPPORTED.indexOf(pageLang) !== -1) return pageLang;
    var saved = null;
    try { saved = localStorage.getItem(LANG_KEY); } catch (e) {}
    if (saved && SUPPORTED.indexOf(saved) !== -1) return saved;
    return (navigator.language || 'ru').toLowerCase().indexOf('en') === 0 ? 'en' : 'ru';
  }

  /* polite live-region announcement — user-action only (never on first paint) */
  function announce(lang) {
    var live = document.getElementById('langLive');
    if (!live) {
      live = document.createElement('span');
      live.id = 'langLive';
      live.setAttribute('aria-live', 'polite');
      live.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;';
      document.body.appendChild(live);
    }
    live.textContent = lang === 'en' ? 'Language: English' : 'Язык: русский';
  }

  /* Universal DOM update. Returns the active table (dict[lang]) so a page's wrapper can
     read page-specific strings from it, or null if the language is unavailable. */
  function applyStrings(lang, doAnnounce) {
    if (!dict || !dict[lang]) return null;
    var table = dict[lang];
    document.documentElement.lang = lang;
    try { localStorage.setItem(LANG_KEY, lang); } catch (e) {}

    if (table['meta.title']) document.title = table['meta.title'].replace(/<[^>]+>/g, '');
    if (table['meta.description']) {
      var md = document.querySelector('meta[name="description"]');
      if (md) md.setAttribute('content', table['meta.description']);
    }
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      if (key in table) el.innerHTML = table[key];
    });
    /* localized aria-label — for elements whose accessible name must differ per language
       (e.g. portfolio card overlay links whose title transliterates: Руна → Runa) */
    document.querySelectorAll('[data-i18n-aria]').forEach(function (el) {
      var akey = el.getAttribute('data-i18n-aria');
      if (akey in table) el.setAttribute('aria-label', table[akey]);
    });
    /* queried live: the burger clones the switch into .nav-drop__lang after page JS runs */
    document.querySelectorAll('.lang-switch button[data-lang], .nav-drop__lang button[data-lang], .lang-btn[data-lang]').forEach(function (b) {
      var on = b.getAttribute('data-lang') === lang;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    var sw = document.getElementById('langSwitch');
    if (sw) { var aria = sw.getAttribute('data-aria-' + lang); if (aria) sw.setAttribute('aria-label', aria); }
    var burger = document.querySelector('.nav-burger');
    if (burger) burger.setAttribute('aria-label', lang === 'en' ? 'Menu' : 'Меню');

    if (doAnnounce) announce(lang);
    return table;
  }

  /* Attach click handlers to the PRIMARY switch buttons (the .nav-drop__lang clones
     forward to these via their own handler). onPick(lang) is the page's wrapper. */
  function wire(onPick) {
    document.querySelectorAll('.lang-switch button[data-lang], .lang-btn[data-lang]').forEach(function (b) {
      b.addEventListener('click', function () { onPick(b.getAttribute('data-lang')); });
    });
  }

  /* Same-origin counterpart of the current page, derived from the page's own relative
     asset path instead of the baked hreflang URL. The hreflang links are absolute and
     point at the production host, so following them literally teleports a local preview
     (or any staging copy) to the live site — which reads as "my changes rolled back".
     The math below works at any site root: '/' locally, '/Sergey-Lookin/' on Pages,
     '/' again on a future custom domain. Returns null when it can't be derived. */
  function sameOriginCounterpart(lang) {
    var css = document.querySelector('link[rel="stylesheet"][href*="core."]');
    var href = css && css.getAttribute('href');
    /* 404.html links assets root-absolutely (it is served for arbitrary URLs) — no
       relative anchor to measure from, and it has no counterpart anyway. */
    if (!href || href.charAt(0) === '/' || /^[a-z]+:/i.test(href)) return null;
    var i = href.indexOf('assets/');
    if (i < 0) return null;
    var rootPath = new URL(href.slice(0, i) || './', location.href).pathname;
    var here = location.pathname;
    if (here.indexOf(rootPath) !== 0) return null;
    var rel = here.slice(rootPath.length);
    var isEn = rel === 'en' || rel.indexOf('en/') === 0;
    var target = lang === 'en'
      ? (isEn ? rel : 'en/' + rel)
      : (isEn ? rel.replace(/^en\/?/, '') : rel);
    return location.origin + rootPath + target + location.search + location.hash;
  }

  /* Language switch = NAVIGATION between the RU tree and /en/ (static per-language site).
     Capture-phase + stopImmediatePropagation so this preempts the pages' old in-place-swap
     handlers. The baked hreflang alternate is the signal that a counterpart EXISTS; the
     URL we actually go to is the same-origin one (see above), falling back to the baked
     href if it can't be derived. Falls through (no preventDefault) when there's no
     counterpart at all (e.g. 404) so the old in-place swap still works. */
  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-lang]') : null;
    if (!b) return;
    var lang = b.getAttribute('data-lang');
    if (!lang) return;
    var cur = (document.documentElement.getAttribute('lang') || 'ru').slice(0, 2);
    if (lang === cur) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    var alt = document.querySelector('link[rel="alternate"][hreflang="' + lang + '"]');
    var href = alt && alt.getAttribute('href');
    if (href) {
      e.preventDefault(); e.stopImmediatePropagation();
      window.location.href = sameOriginCounterpart(lang) || href;
    }
  }, true);

  window.SLi18n = { dict: dict, detect: detect, applyStrings: applyStrings, wire: wire, announce: announce };
})();
