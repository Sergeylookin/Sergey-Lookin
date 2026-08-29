/* manifest.js — interactive layer for index.html (extracted from inline <script>).
   Reads i18n strings from the #i18n-data JSON island in the HTML. */
/* ─────────────── i18n (universal core in assets/i18n.js → window.SLi18n) ─────────────── */
let currentLang = SLi18n.detect();

/* helpers — re-applied whenever language changes */
function wrapWords(el){
  if(el.classList && el.classList.contains('hero-title--corner')) return; /* preview: don't split */
  const html = el.innerHTML;
  const segs = html.split(/<br\s*\/?>/i);
  const isHero = el.classList.contains('hero-title');
  let wi = 0;
  el.innerHTML = segs.map(seg => {
    const toks = (seg.trim().match(/\S+/g) || []);
    return toks.map(t => {
      const cls = isHero ? `word word--h${wi}` : 'word';
      return `<span class="${cls}" style="--w-i:${wi++}">${t}</span>`;
    }).join(' ');
  }).join('<br>');
}
function splitH2(h2){
  if(h2.dataset.split === 'done') return;
  const html = h2.innerHTML;
  const lines = html.split(/<br\s*\/?>/i);
  h2.innerHTML = lines.map((ln,i)=>`<span class="h2-line" style="--li:${i}">${ln}</span>`).join('');
  h2.dataset.split = 'done';
  /* NOTE: do NOT add .h2-in here. The reveal class must be added on a LATER frame
     (double-rAF) so the blurred starting state paints first and the filter transition
     actually plays. Callers (lineRevealIO / language switch) handle that. */
}

/* ─── Pain-list enhance — data-num + char wrap for WOW hover ───
   Desktop: wrap each char in a span (original behavior, untouched).
   Mobile: keep clean text — no spans, no inline-block, so words can never
   break mid-glyph and no risk of unintended layout side-effects. */
/* Magnetic char pull — real-time interactive physics per row */
function inViewport(el){
  const r = el.getBoundingClientRect();
  return r.top < window.innerHeight && r.bottom > 0;
}

function applyLang(lang, announce){
  /* universal work (lang, storage, [data-i18n] swap, meta, buttons, aria, SR announce)
     lives in the shared core; it returns the active table for the page-specific hooks. */
  const dict = SLi18n.applyStrings(lang, announce);
  if(!dict) return;
  currentLang = lang;

  /* hero title — rebuild word spans */
  const ht = document.querySelector('.hero-title');
  if(ht){
    wrapWords(ht);
    ht.classList.remove('in-view');
    requestAnimationFrame(()=>requestAnimationFrame(()=>ht.classList.add('in-view')));
    /* Full headline for AT: the visible h1 holds only the closing word, so screen
       readers would otherwise announce a lone word as the page title. */
    const clean = v => (v || '').replace(/&nbsp;/g, ' ').replace(/<[^>]+>/g, '');
    const staticTxt = clean(dict['hero.title.static']);
    if(staticTxt) ht.setAttribute('aria-label', (staticTxt + ' ' + clean(dict['hero.title.word'])).trim());
  }
  /* applyStrings() just rewrote innerHTML on both display lines, so the
     text-pressure spans are gone — re-split against the new language. */
  hpSetup();

  /* cta title — same trick, only fire reveal if in view */
  const ct = document.querySelector('.cta-title');
  if(ct){
    wrapWords(ct);
    ct.classList.remove('in-view');
    if(inViewport(ct)){
      requestAnimationFrame(()=>requestAnimationFrame(()=>ct.classList.add('in-view')));
    }
  }

  /* intro monument — re-split words after language switch (innerHTML was just restored) */
  try { if(typeof setupIntroMonument === 'function') setupIntroMonument(); }catch(e){}

  /* sec-head h2 — reset and re-split (only if was already split, or is on screen) */
  document.querySelectorAll('.sec-head h2').forEach(h2 => {
    const was = h2.dataset.split === 'done';
    h2.dataset.split = '';
    h2.classList.remove('h2-in');
    if(was || inViewport(h2)){
      splitH2(h2);
      /* replay the blur-in on the next frames (splitH2 no longer self-reveals) */
      requestAnimationFrame(()=>requestAnimationFrame(()=>h2.classList.add('h2-in')));
    }
  });


  /* Re-observe reveal elements that may have lost state during innerHTML replacement.
     Ensures fade-in continues to work after language toggle.
     Wrapped in try-catch: on initial applyLang() call, io may not be declared yet (TDZ). */
  try { if(typeof observeReveals === 'function') observeReveals(); }catch(e){}

  /* (lang buttons + switcher/burger aria-labels are handled by SLi18n.applyStrings) */

  /* Typography hygiene — glue prepositions, fix orphans across all text */
  try { if(typeof clearTypographyFlags === 'function') clearTypographyFlags(); }catch(e){}
  try { if(typeof fixTypographyOrphans === 'function') fixTypographyOrphans(); }catch(e){}
  /* Scroll-hover IO targets text content that may have just been replaced */
  try { if(typeof initScrollHover === 'function') initScrollHover(); }catch(e){}
}

/* wire up the switcher (core attaches to the primary .lang-switch / .lang-btn buttons;
   the burger's .nav-drop__lang clones forward to these via their own handler) */
SLi18n.wire(function(l){ if(l !== currentLang){ applyLang(l, true); } });

/* first paint (no screen-reader announcement) */
applyLang(currentLang, false);

/* ─── Fit the two display statements to the free height of the screen ───
   Each corner now holds a whole sentence that wraps inside its column, so the
   old "measure one line, scale to 70% of the width" pass no longer describes
   the problem: what has to fit is a BLOCK, and what constrains it is the band
   of empty screen between the statement's anchor and the centred caption.

   So: binary-search the largest font-size at which the block neither overflows
   its column nor eats into the caption, do it for both statements, and set the
   smaller of the two on both — matched size reads as one voice, and the longer
   sentence is the one that decides. */
const HERO_FIT_MIN = 20;

/* the hero switches to a linear stacked layout here — same query as the CSS */
function heroIsStacked(){
  return window.matchMedia('(max-width:720px), (max-width:1024px) and (orientation:portrait)').matches;
}

/* Largest size in [HERO_FIT_MIN, hi] that keeps el inside maxH and its column. */
function fitBlock(el, maxH, hi){
  const prev = el.style.fontSize;
  let lo = HERO_FIT_MIN, best = HERO_FIT_MIN;
  if (maxH < 1) { el.style.fontSize = prev; return best; }
  for (let i = 0; i < 16 && hi - lo > 0.5; i++) {
    const mid = (lo + hi) / 2;
    el.style.fontSize = mid + 'px';
    /* scrollWidth catches a single word too long for the column — that word would
       otherwise hang out of the block instead of wrapping. */
    const fits = el.scrollHeight <= maxH + 0.5 && el.scrollWidth <= el.clientWidth + 1;
    if (fits) { best = mid; lo = mid; } else { hi = mid; }
  }
  el.style.fontSize = prev;
  return best;
}

function fitHero(){
  const hero = document.querySelector('.hero');
  if (!hero) return;
  const s = hero.querySelector('.hero-static');
  const t = hero.querySelector('.hero-title--corner');
  if (!s || !t) return;
  /* Stacked layout sizes itself with CSS clamp() in normal flow — JS would oversize */
  if (heroIsStacked()) { s.style.fontSize = ''; t.style.fontSize = ''; return; }
  if (!s.textContent.trim()) return;

  const H = hero.clientHeight;
  const heroTop = hero.getBoundingClientRect().top;
  const cap = hero.querySelector('.hero-sub');
  const gap = Math.max(20, H * 0.032);        /* breathing room around the caption */

  /* Where each statement starts, in hero-local coordinates */
  const topStart = parseFloat(getComputedStyle(s).top) || 0;
  const bottomEnd = H - (parseFloat(getComputedStyle(t).bottom) || 0);

  /* The caption is absolutely centred and sized independently, so measuring it
     here can't feed back into the sizes we are about to set. */
  let capTop = H * 0.5, capBottom = H * 0.5;
  if (cap) {
    const r = cap.getBoundingClientRect();
    capTop = r.top - heroTop;
    capBottom = r.bottom - heroTop;
  }
  const availTop = capTop - gap - topStart;
  const availBottom = bottomEnd - (capBottom + gap);

  /* Ceiling so a short line can never turn into a full-screen letter */
  const hi = H * 0.42;
  const px = Math.min(fitBlock(s, availTop, hi), fitBlock(t, availBottom, hi));
  s.style.fontSize = px + 'px';
  t.style.fontSize = px + 'px';
}

/* ─── Freeze the line breaks ───
   text-pressure widens glyphs near the pointer (wght 300 → 700 is ~5% of width),
   and while the browser owns the wrapping that extra width pushes a word onto the
   next line — the statement visibly jumped between 2 and 3 lines under the cursor.
   So once the size is settled, the wrap the browser chose at rest is baked into
   block lines that no longer re-wrap: the pointer may thicken the letters, it can
   no longer move them. Lines are rebuilt from scratch on every resize / language
   change (hpSetup re-splits first, so this never compounds). */
function freezeHeroLines(){
  document.querySelectorAll(HP_SEL).forEach(el => {
    const words = Array.prototype.slice.call(el.children).filter(n => n.classList && n.classList.contains('tp-w'));
    if(!words.length) return;
    const lines = [];
    let cur = null, lastTop = null;
    words.forEach(w => {
      const top = Math.round(w.getBoundingClientRect().top);
      if(lastTop === null || Math.abs(top - lastTop) > 2){ cur = []; lines.push(cur); lastTop = top; }
      cur.push(w);
    });
    const frag = document.createDocumentFragment();
    lines.forEach((ws, li) => {
      const line = document.createElement('span');
      line.className = 'tp-line';
      ws.forEach((w, i) => { if(i) line.appendChild(document.createTextNode(' ')); line.appendChild(w); });
      frag.appendChild(line);
      /* A space BETWEEN the line blocks: it renders as nothing, but it keeps
         textContent readable — the next rebuild reads the copy back from here,
         and without it the words either side of a break would fuse. */
      if(li < lines.length - 1) frag.appendChild(document.createTextNode(' '));
    });
    el.innerHTML = '';          /* the word nodes already moved into frag */
    el.appendChild(frag);
  });
}

/* ─── Sit the statements on the site's alignment rail — by ink, not by box ───
   The rail is where nav.top, the intro title and the footer start. At display sizes
   the glyph box is not the glyph: italic "Я" carries its ink ~1.6% of the font size
   to the LEFT of the box origin, and a closing "." leaves a gap of several px inside
   its advance. Aligning the boxes therefore looks misaligned. So the boxes are offset
   by the measured side bearings, which lands the visible ink exactly on the rail. */
const _inkCanvas = document.createElement('canvas').getContext('2d');
function inkBearings(el, ch, last){
  const cs = getComputedStyle(el);
  const fs = parseFloat(cs.fontSize) || 0;
  const fam = cs.fontFamily.split(',')[0].trim();
  const ls = parseFloat(cs.letterSpacing) || 0;     /* negative here — tight tracking */
  _inkCanvas.font = `${cs.fontStyle} ${cs.fontWeight} ${fs}px ${fam}`;
  const m = _inkCanvas.measureText(ch);
  return {
    left: m.actualBoundingBoxLeft || 0,                        /* ink starts this far LEFT of the box */
    right: last ? (m.width + ls) - (m.actualBoundingBoxRight || m.width) : 0  /* dead space after the last ink */
  };
}
/* The page's own fields, measured off a real section container rather than guessed:
   left = the gutter, right = gutter + --nav-safe-right (the reserve the side-progress
   indicator sits in). Every section below the cover already lines up on these two. */
function pageFields(){
  const ref = document.querySelector('#intro .container') ||
              document.querySelector('main .container') ||
              document.querySelector('.container');
  const docW = document.documentElement.clientWidth;
  if(!ref) return { left: 16, right: docW - 16 };
  const cs = getComputedStyle(ref), r = ref.getBoundingClientRect();
  return {
    left: r.left + (parseFloat(cs.paddingLeft) || 0),
    right: r.right - (parseFloat(cs.paddingRight) || 0)
  };
}
function alignHeroToRail(){
  const hero = document.querySelector('.hero');
  const s = hero && hero.querySelector('.hero-static');
  const t = hero && hero.querySelector('.hero-title--corner');
  if(!hero || !s || !t || heroIsStacked()) return;
  const F = pageFields();

  /* top-left: the first glyph's ink lands on the left field */
  const firstCh = s.textContent.trim().charAt(0);
  if(firstCh){
    const b = inkBearings(s, firstCh, false);
    const inkX = s.getBoundingClientRect().left - b.left;
    s.style.left = (parseFloat(getComputedStyle(s).left) || 0) + (F.left - inkX) + 'px';
  }

  /* bottom-right: the last glyph's ink lands on the right field */
  const txt = t.textContent.trim();
  const lastCh = txt.charAt(txt.length - 1);
  if(lastCh){
    const b = inkBearings(t, lastCh, true);
    const inkR = t.getBoundingClientRect().right - b.right;
    t.style.right = (parseFloat(getComputedStyle(t).right) || 0) + (inkR - F.right) + 'px';
  }
}

/* Park the caption exactly midway between the two statements — equal air above and
   below — instead of dead-centre in the section, where the two gaps came out 132px
   and 46px. Runs after the statements are final, so it can't feed back into the fit. */
function centerHeroCaption(){
  const hero = document.querySelector('.hero');
  const cap = hero && hero.querySelector('.hero-sub');
  const s = hero && hero.querySelector('.hero-static');
  const t = hero && hero.querySelector('.hero-title--corner');
  if(!cap || !s || !t) return;
  if(heroIsStacked()){ cap.style.top = ''; cap.style.bottom = ''; return; }
  const h = hero.getBoundingClientRect();
  const sBottom = s.getBoundingClientRect().bottom - h.top;
  const tTop = t.getBoundingClientRect().top - h.top;
  const capH = cap.getBoundingClientRect().height;
  cap.style.top = (sBottom + Math.max(0, (tTop - sBottom - capH) / 2)) + 'px';
  cap.style.bottom = 'auto';
}

/* One pass: rebuild the glyph spans → fit the size to the free height → freeze the
   wrap → put the ink on the rail → centre the caption between the two. Order matters:
   fitting needs the text still able to re-wrap, and everything after it needs the
   final size. */
function layoutHero(){
  if(typeof hpSetup === 'function') hpSetup();
  const s = document.querySelector('.hero-static');
  const t = document.querySelector('.hero-title--corner');
  if(s) s.style.left = '';                 /* back to the CSS rail before re-measuring */
  if(t) t.style.right = '';
  const cap = document.querySelector('.hero .hero-sub');
  if(cap){ cap.style.top = ''; cap.style.bottom = ''; }   /* re-measure against the neutral centre */
  fitHero();
  freezeHeroLines();
  alignHeroToRail();
  centerHeroCaption();
}
let _fitRaf = null, _fitTimeout = null;
function scheduleFit(){
  if (_fitTimeout) clearTimeout(_fitTimeout);
  _fitTimeout = setTimeout(() => {
    _fitTimeout = null;
    if (_fitRaf) return;
    _fitRaf = requestAnimationFrame(()=>{ _fitRaf = null; layoutHero(); });
  }, 90);
}
window.addEventListener('resize', scheduleFit, {passive:true});

function fitWhenReady(){
  if (document.fonts && document.fonts.load) {
    /* The hero is set in Inter Tight italic — wait for THAT face, not a leftover
       list of fonts the site no longer loads (Fraunces/Playfair were never fetched,
       so the old Promise resolved instantly and fitHero measured a fallback font). */
    document.fonts.load('italic 500px "Inter Tight"').then(()=>{
      layoutHero();
      requestAnimationFrame(layoutHero);
    }).catch(()=>layoutHero());
  } else {
    layoutHero();
  }
}
fitWhenReady();
window.addEventListener('load', layoutHero);

/* ─── Hero text-pressure — the 404 headline effect on the two display lines ───
   Every glyph becomes its own <span>; the pointer's distance to a glyph rides
   its wght axis from the resting 300 up to 700 — the range the self-hosted
   Inter Tight actually carries (@font-face in core.css declares 300 700, which
   is why the 404's nominal 150…900 lands on the same two ends).

   Spans stay display:inline on purpose. Measured live on the page: inline
   splitting costs 0px of layout width, while display:inline-block added ~11px
   to "Как я строю" by breaking its space runs — and that headline is fitted to
   a fraction of the viewport, so a silent 11px is a silent crop.

   State is `var` + function declarations, not `let`: applyLang() calls
   hpSetup() and runs BEFORE this point in the file, which a `let` would meet
   with a TDZ ReferenceError. */
var HP_SEL = '.hero-static, .hero-title--corner em';
var HP_RADIUS = 460;                 /* px — same falloff radius as the 404 headline */
var HP_MIN = 300, HP_MAX = 700;      /* the font's real wght range */
var _hpChars = [], _hpX = 0, _hpY = 0, _hpRaf = null, _hpBound = false;

function hpEnabled(){
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
      && window.matchMedia('(hover:hover)').matches;
}
function hpSplit(el){
  const text = el.textContent || '';
  if(!text.trim()) return;
  /* Keep every axis the CSS set (SOFT/opsz) and drop only wght — the pointer
     owns that one. font-variation-settings is a whole-string property: writing
     just "wght" would silently discard the others. */
  const prefix = (getComputedStyle(el).fontVariationSettings || '')
    .split(',').map(s => s.trim())
    .filter(s => s && !/^["']wght["']/.test(s))
    .join(', ');
  const frag = document.createDocumentFragment();
  const made = [];
  /* Word wrappers, not a flat run of glyph spans: the statements wrap now, and a
     bare per-glyph split would let a line break land inside a word. Only the plain
     spaces between wrappers stay text nodes, so they are the sole break points —
     an &nbsp; sits inside a wrapper and keeps doing its job. */
  text.split(' ').forEach((word, wi) => {
    if(wi) frag.appendChild(document.createTextNode(' '));
    if(!word) return;
    const w = document.createElement('span');
    w.className = 'tp-w';
    for(const ch of word){
      const s = document.createElement('span');
      s.className = 'tp-ch';
      s.textContent = ch;
      w.appendChild(s);
      made.push({ el: s, prefix: prefix ? prefix + ', ' : '' });
    }
    frag.appendChild(w);
  });
  el.textContent = '';
  el.appendChild(frag);
  _hpChars = _hpChars.concat(made);
  /* The h1 carries the whole headline in aria-label; per-glyph spans would make
     screen readers spell the line out letter by letter. */
  el.setAttribute('aria-hidden', 'true');
}
function hpFrame(){
  _hpRaf = null;
  const n = _hpChars.length;
  if(!n) return;
  /* Rects are re-read every frame instead of cached: fitHero() rewrites the
     font-size on load/resize/font-ready and the page scrolls under the hero, so
     a cache would quietly aim at boxes that no longer exist. All reads first,
     then all writes — one layout pass per frame, no thrash. */
  const rects = new Array(n);
  for(let i = 0; i < n; i++) rects[i] = _hpChars[i].el.getBoundingClientRect();
  for(let i = 0; i < n; i++){
    const r = rects[i];
    const d = Math.hypot(_hpX - (r.left + r.width / 2), _hpY - (r.top + r.height / 2));
    const t = Math.max(0, 1 - d / HP_RADIUS);
    _hpChars[i].el.style.fontVariationSettings =
      _hpChars[i].prefix + '"wght" ' + Math.round(HP_MIN + t * (HP_MAX - HP_MIN));
  }
}
function hpSetup(){
  _hpChars = [];
  if(!hpEnabled()) return;            /* touch / reduced-motion: leave the markup alone */
  document.querySelectorAll(HP_SEL).forEach(hpSplit);
  if(!_hpChars.length || _hpBound) return;
  _hpBound = true;
  /* rAF-throttled: pointermove fires far denser than the display refreshes, and
     between moves nothing is scheduled at all — the effect costs zero at rest. */
  window.addEventListener('pointermove', (e) => {
    _hpX = e.clientX; _hpY = e.clientY;
    if(_hpRaf === null) _hpRaf = requestAnimationFrame(hpFrame);
  }, { passive: true });
}
hpSetup();

/* ─── Hero FX ─── */
/* Mouse-driven 3D parallax tilt removed by design — the hero stays flat.
   Only the off-screen optimisation is kept: drop the perspective/3D context
   (.hero--idle) once the hero scrolls out of view. */
(function heroFx(){
  const hero = document.querySelector('.hero');
  if(!hero) return;
  const io = new IntersectionObserver(entries => {
    hero.classList.toggle('hero--idle', !entries[0].isIntersecting);
  }, { threshold: 0 });
  io.observe(hero);
})();

/* ─────────────── nav scroll & dark-section detection ─────────────── */
const nav=document.getElementById('nav');
const darkSections=document.querySelectorAll('section.dark');
function updateNav(){
  nav.classList.toggle('scrolled',window.scrollY>20);
  let onDark=false;
  const navBottom=nav.offsetHeight+8;
  darkSections.forEach(sec=>{
    const r=sec.getBoundingClientRect();
    if(r.top<navBottom&&r.bottom>0)onDark=true;
  });
  nav.classList.toggle('on-dark',onDark);
}
window.__scroll.add(updateNav);
updateNav();

/* ─────────────── dot grid ─────────────── */
const dgWave=document.getElementById('dotgrid');
if(dgWave){
  dgWave.innerHTML='';
  for(let i=0;i<100;i++){
    const d=document.createElement('div');
    d.className='d'+(i<69?' accent':'');
    dgWave.appendChild(d);
  }
}

/* ─────────────── mentor cosmos ─────────────── */
(function setupMentorCosmos(){
  const cosmos = document.querySelector('.mentor-cosmos');
  if(!cosmos) return;
  const core = cosmos.querySelector('.mentor-core');
  const sats = Array.from(cosmos.querySelectorAll('.msat'));
  const svg = cosmos.querySelector('.mentor-lines');
  if(!core || !sats.length || !svg) return;

  // 20 positions — LEFT (7) / RIGHT (7) / TOP (3) / BOTTOM (3)
  // Carefully positioned to stay within bounds and avoid central horizontal band
  const positions = [
    /* LEFT side (10) — mix of outer (nx 0.04-0.07) and inner (nx 0.20-0.22) */
    {nx: 0.06, ny: 0.04},  // 1 1:1 созвоны (outer)
    {nx: 0.22, ny: 0.14},  // 2 Парные сессии (inner)
    {nx: 0.04, ny: 0.24},  // 3 Ревью макетов (outer)
    {nx: 0.20, ny: 0.34},  // 4 Защита решений (inner)
    {nx: 0.07, ny: 0.45},  // 5 Кросс-команды (outer)
    {nx: 0.22, ny: 0.55},  // 6 Обмен референсами (inner)
    {nx: 0.05, ny: 0.66},  // 7 Лекции (outer)
    {nx: 0.06, ny: 0.76},  // 8 Разбор кейсов (OUTER per Sergey — was inner)
    {nx: 0.20, ny: 0.86},  // 9 Брендинг (inner)
    {nx: 0.05, ny: 0.95},  // 10 Похвала и критика (outer)
    /* RIGHT side (10) — DIFFERENT ny values from left for asymmetry, NOT mirror.
       Each row's ny is offset ~0.02-0.04 from the left side. */
    {nx: 0.94, ny: 0.07},  // 11 План развития (outer)         — ny 0.07 vs left 0.04
    {nx: 0.78, ny: 0.17},  // 12 Повышение грейдов (inner)     — ny 0.17 vs left 0.14
    {nx: 0.96, ny: 0.27},  // 13 Аналитика скиллов (outer)     — ny 0.27 vs left 0.24
    {nx: 0.80, ny: 0.38},  // 14 Софт-скиллы (inner)           — ny 0.38 vs left 0.34
    {nx: 0.95, ny: 0.50},  // 15 Карьерные разговоры (outer)   — at central horizontal level
    {nx: 0.94, ny: 0.62},  // 16 Типографика (OUTER per Sergey — was inner) — ny 0.62 (offset from left 0.55)
    {nx: 0.78, ny: 0.72},  // 17 Моушн и 3D (inner)
    {nx: 0.94, ny: 0.83},  // 18 UX-исследования (outer)
    {nx: 0.80, ny: 0.93},  // 19 Психотип дизайнера (inner)
    {nx: 0.96, ny: 0.99},  // 20 Эмпатия (outer)
  ];

  // State per satellite: base position + current shift + per-satellite phase + DEPTH multiplier
  const satState = sats.map((sat, i) => ({
    sat,
    pos: positions[i] || positions[0],
    baseX: 0, baseY: 0,
    shiftX: 0, shiftY: 0,
    line: null,
    // Unique per-satellite drift parameters
    fx: 0.30 + (i * 0.037) % 0.25,   // 0.30 - 0.55 Hz
    fy: 0.22 + (i * 0.053) % 0.22,   // 0.22 - 0.44 Hz
    phaseX: i * 0.713,
    phaseY: i * 1.327,
    ampX: 3.5 + (i % 3) * 0.7,        // 3.5 - 4.9 px
    ampY: 2.8 + (i % 4) * 0.5,        // 2.8 - 4.3 px
    // Per-satellite sensitivity — varies 0.55 to 1.0 — breaks symmetric response between siblings
    depth: 0.55 + ((i * 0.27) % 0.45),
  }));

  /* Entry stagger rhythm — 20 delays in mix of pairs/trios/solos (NOT linear cascade) */
  const entryDelays = [
    0.05, 0.05,           /* pair 1 (sync) */
    0.25,                 /* solo */
    0.40, 0.40, 0.40,     /* trio 1 (sync) */
    0.62,                 /* solo */
    0.78, 0.78,           /* pair 2 */
    0.95,                 /* solo */
    1.10, 1.10,           /* pair 3 */
    1.25,                 /* solo */
    1.40, 1.40, 1.40,     /* trio 2 */
    1.58,                 /* solo */
    1.72, 1.72,           /* pair 4 */
    1.90                  /* solo last */
  ];

  function layout(){
    const r = cosmos.getBoundingClientRect();
    const w = r.width, h = r.height;
    const cx = w / 2;
    const cy = h / 2;

    // Compute base positions + entry vectors for explosion effect
    satState.forEach((s, i) => {
      s.baseX = s.pos.nx * w;
      s.baseY = s.pos.ny * h;
      const rect = s.sat.getBoundingClientRect();
      const halfW = rect.width / 2;
      const halfH = rect.height / 2;
      const margin = 10;
      s.baseX = Math.max(halfW + margin, Math.min(w - halfW - margin, s.baseX));
      s.baseY = Math.max(halfH + margin, Math.min(h - halfH - margin, s.baseY));

      s.sat.style.setProperty('--x', s.baseX + 'px');
      s.sat.style.setProperty('--y', s.baseY + 'px');
      s.sat.style.setProperty('--i', i);

      /* ENTRY ANIMATION — items START at the cosmos center and fly OUTWARD to their resting position.
         The entry translate must therefore offset the item BACK to centre relative to its own (baseX, baseY).
         Direction is the negative of the centre→position vector. */
      const entryDx = cx - s.baseX;   /* moves item from baseX back to cx at t=0 */
      const entryDy = cy - s.baseY;
      s.sat.style.setProperty('--entry-dx', entryDx + 'px');
      s.sat.style.setProperty('--entry-dy', entryDy + 'px');

      /* Staggered delays create wave effect: items explode in sequence, not all at once */
      const delay = entryDelays[i] || 0;  /* Use original pattern for controlled rhythm */
      s.sat.style.setProperty('--entry-delay', delay + 's');
      
      /* Idle drift parameters — subtle floating movement, different per-satellite */
      const driftX = (Math.random() - 0.5) * 8;  /* ±4px max drift */
      const driftY = (Math.random() - 0.5) * 8;  /* ±4px max drift */
      s.sat.style.setProperty('--drift-x', driftX + 'px');
      s.sat.style.setProperty('--drift-y', driftY + 'px');
      
      /* Each item gets its own idle delay offset so they don't all float in sync */
      const idleDelay = 2.5 + (Math.random() * 0.5);
      s.sat.style.setProperty('--idle-delay', idleDelay + 's');
    });

    // Build SVG lines from cosmos center to each satellite
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.innerHTML = '';

    satState.forEach((s, i) => {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', cx);
      line.setAttribute('y1', cy);
      line.setAttribute('x2', s.baseX);
      line.setAttribute('y2', s.baseY);
      /* Line delay = satellite entry delay → line "draws" in sync with its satellite flying out */
      line.style.setProperty('--line-delay', (entryDelays[i] || 0) + 's');
      svg.appendChild(line);
      s.line = line;
    });
  }

  // Motion constants — gentle ATTRACTION toward the cursor (no repulsion / no fleeing).
  // Two zones: a short-range stronger pull and a broad gentle pull, both pointing TOWARD the cursor.
  // SPRING is deliberately low so the motion is slow and deliberate, not snappy or magnetic.
  const PULL_RADIUS   = 460;   // px — overall radius within which the cursor pulls satellites
  const PULL_NEAR     = 38;    // px — max displacement at short range
  const PULL_FAR      = 14;    // px — additional gentle displacement at the outer edge of influence
  const SPRING        = 0.055; // slow lerp — produces an unhurried, viscous "drawn toward" feel

  let raf = null;
  let mxPx = -9999, myPx = -9999;
  let inView = false;

  // Core state for mouse-driven parallax (translate + tilt 3D)
  const coreState = { shiftX: 0, shiftY: 0 };
  const CORE_SPRING = 0.09;

  /* Whisper used to get its own 3D tilt parallax here. Removed:
     it was rewriting the whisper's `transform` every animation frame via CSS vars,
     which prevented the CSS :hover scale transition from ever playing.
     The whisper is now a static-positioned "thought" with a clean scale-on-hover, matching
     every other thought on the site. */

  function tick(){
    raf = null;
    const r = cosmos.getBoundingClientRect();
    const w = r.width, h = r.height;
    const time = performance.now() * 0.001;
    const cursorActive = mxPx > -1000;

    // Lines converge at exact geometric center of cosmos (matches core's absolute centering)
    const ccx = w / 2;
    const ccy = h / 2;

    satState.forEach(s => {
      /* Autonomous slow drift — each satellite has unique frequency + amplitude */
      const autoX = Math.sin(time * s.fx + s.phaseX) * s.ampX;
      const autoY = Math.cos(time * s.fy + s.phaseY) * s.ampY;

      let pushX = 0, pushY = 0;

      if (cursorActive) {
        /* Distance-based gentle ATTRACTION — satellites slowly drift toward the cursor.
           Sign is POSITIVE (toward cursor), not negative (which would repel). */
        const dx = mxPx - s.baseX;
        const dy = myPx - s.baseY;
        const dist = Math.sqrt(dx*dx + dy*dy);

        if (dist > 0.5 && dist < PULL_RADIUS) {
          const nx = dx / dist;
          const ny = dy / dist;

          /* Short-range component — stronger pull as the cursor gets closer, quadratic falloff */
          const kNear   = Math.max(0, 1 - dist / 220);
          const sNear   = kNear * kNear * PULL_NEAR * s.depth;

          /* Outer-zone component — broad, very gentle pull across the whole influence zone */
          const kFar    = 1 - dist / PULL_RADIUS;
          const sFar    = kFar * PULL_FAR * s.depth;

          pushX += nx * (sNear + sFar);
          pushY += ny * (sNear + sFar);
        }
      }

      const targetX = pushX + autoX;
      const targetY = pushY + autoY;

      /* Spring lerp toward target — creates organic chase feel */
      s.shiftX += (targetX - s.shiftX) * SPRING;
      s.shiftY += (targetY - s.shiftY) * SPRING;

      s.sat.style.setProperty('--shift-x', s.shiftX + 'px');
      s.sat.style.setProperty('--shift-y', s.shiftY + 'px');

      if (s.line) {
        s.line.setAttribute('x1', ccx);
        s.line.setAttribute('y1', ccy);
        s.line.setAttribute('x2', s.baseX + s.shiftX);
        s.line.setAttribute('y2', s.baseY + s.shiftY);
      }
    });

    /* Core mouse parallax — subtle translate only. 3D tilt (rotateX/Y) removed by design. */
    let coreTargetX = 0, coreTargetY = 0;
    if (cursorActive) {
      const mxNorm = (mxPx - ccx) / ccx;  // -1 to 1
      const myNorm = (myPx - ccy) / ccy;
      coreTargetX = mxNorm * 14;          // ±14px horizontal
      coreTargetY = myNorm * 8;           // ±8px vertical
    }
    coreState.shiftX += (coreTargetX - coreState.shiftX) * CORE_SPRING;
    coreState.shiftY += (coreTargetY - coreState.shiftY) * CORE_SPRING;
    core.style.setProperty('--core-shift-x', coreState.shiftX + 'px');
    core.style.setProperty('--core-shift-y', coreState.shiftY + 'px');

    if (inView) raf = requestAnimationFrame(tick);
  }

  function startLoop(){
    if (!inView || !isDesktop()) return;
    /* Checked here (not only once at setup) — the IntersectionObserver below restarts
       the loop on every re-entry, which used to bypass the reduced-motion stop. */
    if (window.matchMedia('(prefers-reduced-motion:reduce)').matches) return;
    if (!raf) raf = requestAnimationFrame(tick);
  }
  function stopLoop(){ if (raf) { cancelAnimationFrame(raf); raf = null; } }
  function isDesktop(){ return window.matchMedia('(min-width: 1025px)').matches; }

  function onMove(e){
    if (!isDesktop()) return;
    const r = cosmos.getBoundingClientRect();
    mxPx = e.clientX - r.left;
    myPx = e.clientY - r.top;
  }
  function onLeave(){
    mxPx = -9999; myPx = -9999;
  }
  /* Mouse listener on #mentor section (not just cosmos) — so events fire when cursor is over whisper, which is in DOM-sibling .sec-asides-bar */
  const sectionEl = document.getElementById('mentor');
  sectionEl.addEventListener('mousemove', onMove, {passive: true});
  sectionEl.addEventListener('mouseleave', onLeave);

  // Only animate while section is in viewport AND on desktop
  const vio = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      inView = e.isIntersecting;
      if (inView) startLoop(); else stopLoop();
    });
  }, {threshold: 0.05});
  vio.observe(cosmos);

  /* Entry trigger — fires when visible, resets animation on re-entry */
  const entryIO = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        cosmos.classList.remove('has-entered');  // Reset animation state
        setTimeout(() => {
          cosmos.classList.add('has-entered');  // Trigger animation again
        }, 50);  // Brief delay allows CSS to pick up the state change
      }
    });
  }, {threshold: 0.3, rootMargin: '0px 0px -8% 0px'});
  entryIO.observe(cosmos);

  // Initial layout + resize handler — only on desktop
  requestAnimationFrame(() => {
    if (isDesktop()) { layout(); startLoop(); }
  });
  let resizeRaf = null;
  window.addEventListener('resize', () => {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => {
      if (isDesktop()) {
        layout();
        startLoop();
      } else {
        stopLoop();
        // Reset shifts so satellites are clean if/when desktop layout returns
        satState.forEach(s => { s.shiftX = 0; s.shiftY = 0; });
      }
      resizeRaf = null;
    });
  }, {passive: true});

  // Respect reduced-motion preference
  if (window.matchMedia('(prefers-reduced-motion:reduce)').matches) {
    stopLoop();
  }

  /* ───────────── Tag hover tooltip — fixed at bottom-centre of the viewport ─────────────
     Single shared element with `position: fixed` in CSS — placement is constant and pure CSS.
     This function only swaps the inner text + toggles the visible class.                    */
  const tooltip = cosmos.querySelector('.msat-tooltip');
  if (tooltip){
    let activeSat = null;
    let hideTimer = null;

    function descForCurrentLang(sat){
      const lang = (document.documentElement.lang || 'ru').toLowerCase().startsWith('en') ? 'en' : 'ru';
      return sat.getAttribute('data-desc-' + lang) || sat.getAttribute('data-desc-ru') || '';
    }

    function showTooltip(sat){
      if (!isDesktop()) return;
      if (hideTimer){ clearTimeout(hideTimer); hideTimer = null; }
      if (activeSat && activeSat !== sat) activeSat.classList.remove('is-active');
      activeSat = sat;
      sat.classList.add('is-active');

      const html = descForCurrentLang(sat);
      if (!html) return;
      tooltip.innerHTML = html;
      tooltip.setAttribute('aria-hidden', 'false');
      // One RAF so the new text is laid out before the visible class triggers the transition.
      requestAnimationFrame(() => tooltip.classList.add('is-visible'));
    }

    function hideTooltip(){
      if (activeSat){ activeSat.classList.remove('is-active'); activeSat = null; }
      tooltip.classList.remove('is-visible');
      tooltip.setAttribute('aria-hidden', 'true');
    }

    sats.forEach(sat => {
      sat.addEventListener('mouseenter', () => showTooltip(sat));
      sat.addEventListener('mouseleave', () => {
        // Tiny delay smooths flickers when crossing close-set neighbours.
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(hideTooltip, 80);
      });
      // Keyboard a11y — buttons are focusable natively (no tabindex needed).
      // Focus/blur trigger the same tooltip behaviour as mouseenter/mouseleave.
      sat.addEventListener('focus',  () => showTooltip(sat));
      sat.addEventListener('blur',   () => hideTooltip());
    });
  }
})();

/* ─────────────── reveal IO ─────────────── */
/* Bidirectional: adds .in-view on enter, removes on exit so animation
   re-triggers every time the element comes back into viewport. */
const io=new IntersectionObserver((entries)=>{
  entries.forEach(e=>{
    if(e.isIntersecting){
      e.target.classList.add('in-view');
      if(e.target.classList.contains('stagger')){
        const items=e.target.querySelectorAll('[data-stagger]');
        items.forEach((el,i)=>{el.style.transitionDelay=(60+i*80)+'ms';});
      }
    } else {
      /* Reset when element fully leaves viewport — animation re-plays on re-entry */
      e.target.classList.remove('in-view');
    }
  });
},{threshold:0,rootMargin:'0px 0px 10% 0px'});
function observeReveals(){
  document.querySelectorAll('[data-reveal], [data-reveal-num], .stagger').forEach(el=>{
    io.observe(el);
    /* Immediate fallback: if element is ALREADY in viewport at registration time, mark in-view directly.
       Prevents the race condition where IO callback fires too late after page load with restored scroll. */
    const r = el.getBoundingClientRect();
    if(r.top < window.innerHeight && r.bottom > 0){
      requestAnimationFrame(()=>{
        if(!el.classList.contains('in-view')){
          el.classList.add('in-view');
          if(el.classList.contains('stagger')){
            const items=el.querySelectorAll('[data-stagger]');
            items.forEach((it,i)=>{it.style.transitionDelay=(60+i*80)+'ms';});
          }
        }
      });
    }
  });
}
observeReveals();
/* Safety net: after 2.5s, force-show reveal elements that are CURRENTLY in viewport
   but somehow didn't get the .in-view class. Elements outside viewport remain observed
   so they animate naturally when user scrolls to them. */
setTimeout(()=>{
  document.querySelectorAll('[data-reveal]:not(.in-view), [data-reveal-num]:not(.in-view), .stagger:not(.in-view)').forEach(el=>{
    const r = el.getBoundingClientRect();
    /* Only force-reveal if element is already in viewport — preserves scroll-triggered reveals below */
    if(r.top < window.innerHeight && r.bottom > 0){
      el.classList.add('in-view');
      if(el.classList.contains('stagger')){
        const items=el.querySelectorAll('[data-stagger]');
        items.forEach((it,i)=>{it.style.transitionDelay=(60+i*80)+'ms';});
      }
    }
  });
}, 2500);

/* ─────────────── scroll-to-top: nav brand & footer button ─────────────── */
function scrollToTop(e){
  if(e) e.preventDefault();
  const rm=window.matchMedia('(prefers-reduced-motion:reduce)').matches;
  /* prefer Lenis so the glide matches the rest of the page (one scroll system, not two) */
  if(window.__lenis && !rm){ window.__lenis.scrollTo(0); return; }
  window.scrollTo({top:0,behavior:rm?'auto':'smooth'});
}
const navHome=document.getElementById('navHome');
if(navHome) navHome.addEventListener('click',scrollToTop);
const footTop=document.getElementById('footTop');
if(footTop) footTop.addEventListener('click',scrollToTop);

/* ─────────────── hover whispers (big numbers) & TL;DRs (kickers) ─────────────── */
const SECTION_TIPS={
  ru:{
    'credo':{w:'Самый длинный спор, который я выиграл за карьеру.',t:'Дизайн как партнёр, а не как сервис.'},
    'audience':{w:'Не картинки создают впечатление. А дизайн.',t:'Пользователь — это человек, а не сегмент в дашборде.'},
    'evaluation':{w:'Работа считается законченной только тогда, когда начинает работать в реальности.',t:'Четыре уровня, через которые проходит решение.'},
    'ds':{w:'Без системы качество зависит от настроения команды.',t:'Способ держать качество без ручного контроля.'},
    'results':{w:'Сильный дизайн выдерживает не только ревью, но и реальность.',t:'Пять конкретных эффектов для бизнеса.'},
    'companies':{w:'Двенадцать лет в трёх главах.',t:'Три места работы за 12+ лет.'}
  },
  en:{
    'credo':{w:"The longest argument I've won in my career.",t:"Design as partner, not service."},
    'audience':{w:"Pictures don't make the impression. Design does.",t:"A user is a person, not a dashboard segment."},
    'evaluation':{w:"Work counts as finished only when it starts working in reality.",t:"Four levels every solution passes through."},
    'ds':{w:"Without a system, quality depends on the team's mood.",t:"A way to hold quality without manual control."},
    'results':{w:"Strong design holds up under review — and under reality.",t:"Five concrete effects for the business."},
    'companies':{w:"Twelve years, three chapters.",t:"Three companies over 12+ years."}
  }
};
function applyTooltips(){
  const lang=(document.documentElement.lang||'ru').slice(0,2);
  const dict=SECTION_TIPS[lang]||SECTION_TIPS.ru;
  const isTouch=!window.matchMedia('(hover:hover)').matches;
  Object.keys(dict).forEach(id=>{
    const sec=document.getElementById(id);
    if(!sec) return;
    const block=sec.querySelector('.sec-head .num-block');
    if(!block) return;
    block.classList.add('tip-num-block');
    /* (re)bind hover handlers — single tooltip per block, no flicker */
    block._tipBound=block._tipBound||(function(){
      if(isTouch){
        /* touch: tap toggles, auto-hide after 3s, tap elsewhere closes */
        block.style.cursor='pointer';
        block.addEventListener('click',(e)=>{
          e.stopPropagation();
          const wasActive=block.classList.contains('is-active');
          document.querySelectorAll('.tip-num-block.is-active').forEach(b=>b.classList.remove('is-active'));
          if(!wasActive){
            block.dataset.tip=block.dataset.tipText||'';
            block.classList.add('is-active');
            clearTimeout(block._tipHideT);
            block._tipHideT=setTimeout(()=>block.classList.remove('is-active'),3500);
          }
        });
      } else {
        block.addEventListener('mouseenter',()=>{
          block.dataset.tip=block.dataset.tipText||'';
          block.classList.add('is-active');
        });
        block.addEventListener('mouseleave',()=>{
          block.classList.remove('is-active');
        });
      }
      return true;
    })();
    block.dataset.tipText=dict[id].w;
    if(!block.dataset.tip) block.dataset.tip=dict[id].w;
  });
  /* touch: tap outside closes any open tip */
  if(isTouch && !document._tipCloseBound){
    document._tipCloseBound=true;
    document.addEventListener('click',()=>{
      document.querySelectorAll('.tip-num-block.is-active').forEach(b=>b.classList.remove('is-active'));
    });
  }
}

/* ─── Typography hygiene: glue short prepositions to next word with NBSP.
   Runs on mobile only — desktop already has wider columns and many manual
   &nbsp;'s baked into the source. This is a defensive pass over visible
   text nodes in prose blocks. Idempotent (NBSPs left alone on re-runs). */
const RU_PREPS = ['в','на','с','к','о','об','от','до','по','за','у','и','а','но','или','же','ли','бы','не','ни','для','из','со','во','об','обо','перед','через','между','над','под','при','про'];
const EN_PREPS = ['a','an','the','of','in','on','at','to','for','by','as','is','it','or','and','but','if','not','no'];
const NBSP = '\u00A0';

/* Elements where authored <br>s look bad on narrow mobile and should
   become plain whitespace so the text flows naturally with our wrap rules. */
const BR_TO_SPACE_SEL = [
  '.sec-sub','.aud-quote','.ds-quote','.credo-line',
  
  /* Team manifesto — flatten <br>s so the words don't merge / orphan */
  '.team-manifesto .tm-text'
].join(',');

function convertBrToSpace(root){
  if(window.innerWidth > 720) return;
  (root||document).querySelectorAll(BR_TO_SPACE_SEL).forEach(el=>{
    if(el.dataset.brFlattened === '1') return;
    el.querySelectorAll('br').forEach(br=>{
      const space = document.createTextNode(' ');
      br.parentNode.replaceChild(space, br);
    });
    el.dataset.brFlattened = '1';
  });
}

function fixTypographyOrphans(root){
  if(window.innerWidth > 720) return;
  /* Step 1 — flatten <br>s in target elements first */
  convertBrToSpace(root);
  /* Step 2 — glue prepositions */
  const lang = (document.documentElement.lang||'ru').slice(0,2);
  const preps = (lang==='en' ? EN_PREPS : RU_PREPS);
  const selectors = [
    '.sec-sub','.sec-title',
    '.credo-title','.credo-line',
    
    '.intro-p','.intro-title',
    '.aud-quote','.ds-quote',
    
    
    '.bmp-split .label',
    '.hero-sub','.hero-static','.hero-title',
    '.hero-bottom .item .value',
    '.team-manifesto .tm-text',
    '.tblock .tn','.tblock .td',
    '.cta-eyebrow','.cta-title','.cta-lead'
  ];
  const escaped = preps.map(p=>p.replace(/[-/\\^$*+?.()|[\]{}]/g,'\\$&'));
  /* (^|space) + prep + space + (word-start) → (^|space) + prep + NBSP + (word) */
  const re = new RegExp('(^|[\\s\u00A0])(' + escaped.join('|') + ')([\\s]+)(?=\\S)','giu');
  (root||document).querySelectorAll(selectors.join(',')).forEach(el=>{
    if(el.dataset.typoFixed === '1') return;
    /* Skip elements that already have nested .char/.word spans (pain-list desktop) */
    if(el.querySelector('.char, .word')) return;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    let n; while((n = walker.nextNode())) nodes.push(n);
    nodes.forEach(tn=>{
      if(!tn.nodeValue || !tn.nodeValue.trim()) return;
      const fixed = tn.nodeValue.replace(re, (m, pre, prep, sp)=>{
        return pre + prep + NBSP;
      });
      if(fixed !== tn.nodeValue) tn.nodeValue = fixed;
    });
    el.dataset.typoFixed = '1';
  });
}
function clearTypographyFlags(root){
  (root||document).querySelectorAll('[data-typo-fixed]').forEach(el=>{
    delete el.dataset.typoFixed;
  });
  (root||document).querySelectorAll('[data-br-flattened]').forEach(el=>{
    delete el.dataset.brFlattened;
  });
}

/* ─── Scroll-hover (mobile only): mirror desktop hover state on rows
   that enter the middle of the viewport. Lets narrative sections like
   Principles / Audience / Services breathe the accent shift while
   scrolling, since there's no real :hover on touch. ─── */
const SCROLL_HOVER_SEL = '.principle, .pain-list li';
let _scrollHoverIO = null;
function initScrollHover(){
  /* tear down any prior observer first (e.g. after resize) */
  if(_scrollHoverIO){
    _scrollHoverIO.disconnect();
    _scrollHoverIO = null;
    document.querySelectorAll('.scroll-active').forEach(el=>el.classList.remove('scroll-active'));
  }
  if(window.innerWidth > 720) return;
  if(window.matchMedia('(hover:hover)').matches) return; /* desktop with mouse — real hover works */
  const els = document.querySelectorAll(SCROLL_HOVER_SEL);
  if(!els.length) return;
  _scrollHoverIO = new IntersectionObserver((entries)=>{
    entries.forEach(e=>{
      if(e.isIntersecting) e.target.classList.add('scroll-active');
      else e.target.classList.remove('scroll-active');
    });
  }, {
    threshold: 0,
    /* "Trigger band" = middle ~25% of viewport. Negative top + bottom
       crops the observation area to roughly the center, so the active
       row is always the one the user is reading. */
    rootMargin: '-38% 0px -38% 0px'
  });
  els.forEach(el => _scrollHoverIO.observe(el));
}

/* ─────────────── scroll progress bar ─────────────── */
const progressBar=document.createElement('div');
progressBar.className='scroll-progress';
document.body.appendChild(progressBar);

/* side progress indicator (right edge) */
const sideProgress=document.createElement('div');
sideProgress.className='side-progress';
sideProgress.innerHTML='<div class="side-progress__label"><span class="side-progress__label-inner"></span></div><div class="side-progress__track"><div class="side-progress__fill"></div><nav class="side-progress__menu" aria-label="Sections"></nav></div><div class="side-progress__percent"><span class="side-progress__percent-inner">0%</span></div>';
document.body.appendChild(sideProgress);
const sideFill=sideProgress.querySelector('.side-progress__fill');
const sideLabel=sideProgress.querySelector('.side-progress__label');
const sideLabelInner=sideProgress.querySelector('.side-progress__label-inner');
const sidePercent=sideProgress.querySelector('.side-progress__percent-inner');

/* one-word labels per section (full dictionary, ignores .kicker) */
const SIDE_LABELS={
  ru:{
    'hero':'Начало',
    'intro':'Введение',
    'credo':'Принципы',
    'audience':'Люди',
    'brand':'Бренд',
    'evaluation':'Оценка',
    'team':'Команда',
    'mentor':'Менторство',
    'ds':'Ремесло',
    'results':'Результаты',
    'companies':'Опыт',
    'cta':'Контакт'
  },
  en:{
    'hero':'Start',
    'intro':'Intro',
    'credo':'Principles',
    'audience':'People',
    'brand':'Brand',
    'evaluation':'Evaluation',
    'team':'Team',
    'mentor':'Mentorship',
    'ds':'Craft',
    'results':'Results',
    'companies':'Experience',
    'cta':'Contact'
  }
};
const sectionsAll=Array.from(document.querySelectorAll('section'));

function getActiveSection(){
  const probe=window.innerHeight*0.35;
  let active=sectionsAll[0];
  for(const s of sectionsAll){
    const r=s.getBoundingClientRect();
    if(r.top<=probe) active=s;
  }
  return active;
}
function getSectionLabel(sec){
  if(!sec) return '';
  const lang=(document.documentElement.lang||'ru').slice(0,2);
  const dict=SIDE_LABELS[lang]||SIDE_LABELS.ru;
  return dict[sec.id]||'';
}

/* build clickable ticks on track + expandable menu */
const sideTrack=sideProgress.querySelector('.side-progress__track');
const sideMenu=sideProgress.querySelector('.side-progress__menu');

function buildSideNavigation(){
  /* clear existing ticks + menu items */
  sideTrack.querySelectorAll('.side-progress__tick').forEach(el=>el.remove());
  sideMenu.innerHTML='';
  /* собираем только секции с подписями — они становятся тиками */
  const labeledSections=sectionsAll.filter(sec=>getSectionLabel(sec));
  if(labeledSections.length<2) return;
  const denom=labeledSections.length-1;
  labeledSections.forEach((sec,i)=>{
    const label=getSectionLabel(sec);
    /* равномерное распределение: тик на индекс N / (всего-1) */
    const pct=(i/denom)*100;
    /* tick on the track */
    const tick=document.createElement('button');
    tick.type='button';
    tick.className='side-progress__tick';
    tick.style.top=pct+'%';
    tick.dataset.target=sec.id;
    tick.dataset.pct=pct;
    /* Точка 26x14 меньше минимальной цели 24x24, а раздвинуть их нельзя — рейка
       120px на 11 разделов. Поэтому точки перестают быть самостоятельным элементом
       управления: их роль дублирует меню, которое открывается по наведению и
       состоит из нормальных кнопок с подписями. Мышью точки по-прежнему работают. */
    tick.setAttribute('aria-hidden','true');
    tick.tabIndex = -1;
    sideTrack.appendChild(tick);
    /* menu item */
    const item=document.createElement('button');
    item.type='button';
    item.className='side-progress__menu-item';
    item.dataset.target=sec.id;
    item.textContent=label;
    sideMenu.appendChild(item);
  });
}

/* highlight current section on ticks + menu */
let _lastCurrentId=null;
function setCurrentSection(id){
  if(id===_lastCurrentId) return;
  _lastCurrentId=id;
  sideProgress.querySelectorAll('.is-current').forEach(el=>el.classList.remove('is-current'));
  if(!id) return;
  sideProgress.querySelectorAll('[data-target="'+id+'"]').forEach(el=>el.classList.add('is-current'));
}

/* click delegation: jump to section */
sideProgress.addEventListener('click',(e)=>{
  const btn=e.target.closest('[data-target]');
  if(!btn) return;
  const sec=document.getElementById(btn.dataset.target);
  if(!sec) return;
  e.preventDefault();
  const rm=window.matchMedia('(prefers-reduced-motion:reduce)').matches;
  if(window.__lenis && !rm){ window.__lenis.scrollTo(sec.offsetTop); }
  else window.scrollTo({top:sec.offsetTop,behavior:rm?'auto':'smooth'});
  sideProgress.classList.remove('is-open');
});

/* hover: open/close menu with small grace period */
let menuCloseTimer=null;
sideProgress.addEventListener('mouseenter',()=>{
  clearTimeout(menuCloseTimer);
  sideProgress.classList.add('is-open');
});
sideProgress.addEventListener('mouseleave',()=>{
  menuCloseTimer=setTimeout(()=>sideProgress.classList.remove('is-open'),150);
});
/* Esc closes menu */
document.addEventListener('keydown',(e)=>{
  if(e.key==='Escape') sideProgress.classList.remove('is-open');
});

let currentSideLabel='';
let labelSwitchTimer=null;
function setSideLabel(next){
  if(next===currentSideLabel) return;
  currentSideLabel=next;
  sideLabel.classList.add('is-switching');
  clearTimeout(labelSwitchTimer);
  labelSwitchTimer=setTimeout(()=>{
    sideLabelInner.textContent=next;
    sideLabel.classList.remove('is-switching');
  },200);
}

function updateProgress(){
  const h=document.documentElement;
  const max=h.scrollHeight-h.clientHeight;
  const pct=max>0?(h.scrollTop/max)*100:0;
  progressBar.style.width=pct+'%';
  sideFill.style.height=pct+'%';
  sidePercent.textContent=Math.round(pct)+'%';

  /* current section + label */
  const sec=getActiveSection();
  if(sec){
    setSideLabel(getSectionLabel(sec));
    setCurrentSection(sec.id);
  }

  /* mark passed ticks: по индексу активной секции, не по % скролла
     (тики равномерные, скролл — нет, они бы рассинхронизировались) */
  const ticks=Array.from(sideProgress.querySelectorAll('.side-progress__tick'));
  let activeIdx=-1;
  if(sec){
    activeIdx=ticks.findIndex(t=>t.dataset.target===sec.id);
  }
  ticks.forEach((t,i)=>{
    t.classList.toggle('is-passed',activeIdx>=0 && i<=activeIdx);
  });

  /* dark-section recolor: check if the indicator's vertical band overlaps a dark section.
     darkSections is the NodeList cached at load — no querySelectorAll per scroll frame. */
  const rect=sideProgress.getBoundingClientRect();
  const midY=rect.top+rect.height/2;
  let onDark=false;
  for(const ds of darkSections){
    const r=ds.getBoundingClientRect();
    if(r.top<=midY && r.bottom>=midY){onDark=true;break}
  }
  sideProgress.classList.toggle('on-dark',onDark);
}
window.__scroll.add(updateProgress);
buildSideNavigation();
updateProgress();
applyTooltips();
fixTypographyOrphans();
initScrollHover();
/* Re-run typography fix on viewport resize (e.g. mobile rotation, desktop resize) */
let _typoResizeRaf = null;
let _lastTypoWidth = window.innerWidth;
window.addEventListener('resize', ()=>{
  /* Only re-run when crossing the 720 boundary, not on every keyboard pop */
  const w = window.innerWidth;
  const wasMobile = _lastTypoWidth <= 720;
  const isMobile = w <= 720;
  _lastTypoWidth = w;
  if(wasMobile === isMobile) return;
  if(_typoResizeRaf) cancelAnimationFrame(_typoResizeRaf);
  _typoResizeRaf = requestAnimationFrame(()=>{
    clearTypographyFlags();
    fixTypographyOrphans();
    if(typeof enhancePainList==='function')
    initScrollHover();
  });
}, {passive:true});
requestAnimationFrame(()=>sideProgress.classList.add('is-ready'));

/* ─── Scroll-driven Hero Exit — words diverge as you scroll ─── */

/* ─── Scroll-driven BMP — numbers grow with section progress ─── */
(function bmpScrollScale(){
  if(window.matchMedia('(prefers-reduced-motion:reduce)').matches)return;
  if(window.innerWidth<=720)return;
  const bmp=document.getElementById('evaluation');
  if(!bmp)return;
  let raf=null;
  let lastP=-1;
  function update(){
    raf=null;
    const r=bmp.getBoundingClientRect();
    const vh=window.innerHeight;
    /* Early exit — секция полностью вне viewport (+ небольшой буфер) */
    if(r.bottom<-300 || r.top>vh+300){
      if(lastP!==0){bmp.style.setProperty('--bp','0');lastP=0;}
      return;
    }
    const sectionCenter=r.top+r.height/2;
    const dist=Math.abs(sectionCenter-vh/2);
    const maxDist=vh/2+r.height/2;
    let p=1-Math.min(1,dist/maxDist);
    p=p*p*(3-2*p);
    const pStr=p.toFixed(4);
    if(pStr!==lastP){bmp.style.setProperty('--bp',pStr);lastP=pStr;}
  }
  window.__scroll.add(update);
  window.addEventListener('resize',()=>{if(!raf)raf=requestAnimationFrame(update)},{passive:true});
  update();
})();

/* ─── Mobile: 69/31 plays automatically — on desktop --bp is scroll-linked (above), but on
   mobile that's disabled, so here we auto-run --bp 0→1 once when the section enters view.
   setProperty(..., 'important') so it beats the `#evaluation{--bp:0 !important}` mobile rule. ─── */
(function bmpMobileAuto(){
  if(window.innerWidth > 720) return;
  if(window.matchMedia('(prefers-reduced-motion:reduce)').matches) return;
  const bmp = document.getElementById('evaluation');
  if(!bmp) return;
  let played = false;
  function play(){
    if(played) return; played = true;
    let start = null; const dur = 1500;
    function step(now){
      if(start === null) start = now;
      const t = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - t, 3);   /* ease-out cubic */
      bmp.style.setProperty('--bp', e.toFixed(4), 'important');
      if(t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  function maybePlay(){
    const r = bmp.getBoundingClientRect();
    if(r.top < window.innerHeight * 0.82 && r.bottom > 0){ play(); window.removeEventListener('scroll', maybePlay); }
  }
  if('IntersectionObserver' in window){
    const io = new IntersectionObserver(es => { if(es[0].isIntersecting){ play(); io.disconnect(); window.removeEventListener('scroll', maybePlay); } }, { threshold: 0.35 });
    io.observe(bmp);
  }
  window.addEventListener('scroll', maybePlay, { passive: true });
  maybePlay();   /* in case the section is already in view on load */
})();

/* ─── Scroll-driven Section Title em scaling — italic accents scale on viewport pass ─── */
(function sectionTitleScale(){
  if(window.matchMedia('(prefers-reduced-motion:reduce)').matches)return;
  if(window.innerWidth<=720)return;
  const sections=Array.from(document.querySelectorAll('section')).filter(s=>{
    if(s.id==='evaluation')return false; /* evaluation use its own --bp (carries 69/31 split) */
    if(s.classList.contains('hero'))return false; /* hero use --hp */
    return s.querySelector('.sec-title em');
  });
  if(!sections.length)return;
  /* Per-section last value cache to avoid redundant setProperty */
  const lastVal=new WeakMap();
  let raf=null;
  function update(){
    raf=null;
    const vh=window.innerHeight;
    for(const sec of sections){
      const r=sec.getBoundingClientRect();
      if(r.bottom<-200||r.top>vh+200){
        if(lastVal.get(sec)!=='0'){
          sec.style.setProperty('--tp','0');
          lastVal.set(sec,'0');
        }
        continue;
      }
      const center=r.top+r.height/2;
      const dist=Math.abs(center-vh/2);
      const maxDist=vh/2+r.height/2;
      let p=1-Math.min(1,dist/maxDist);
      p=p*p*(3-2*p);
      const pStr=p.toFixed(3);
      if(lastVal.get(sec)!==pStr){
        sec.style.setProperty('--tp',pStr);
        lastVal.set(sec,pStr);
      }
    }
  }
  window.__scroll.add(update);
  window.addEventListener('resize',()=>{if(!raf)raf=requestAnimationFrame(update)},{passive:true});
  update();
})();

/* ─── Cursor Dot — small accent point with smooth lerp follow ─── */
(function cursorDot(){
  if(window.matchMedia('(prefers-reduced-motion:reduce)').matches)return;
  if(window.matchMedia('(hover:none)').matches)return;
  if(window.innerWidth<=1024)return;
  const dot=document.querySelector('.cursor-dot');
  if(!dot)return;
  let tx=window.innerWidth/2, ty=window.innerHeight/2;
  let cx=tx, cy=ty;
  let visible=false;
  let rafId=null;
  let lastMoveT=performance.now();
  document.addEventListener('pointermove',e=>{
    tx=e.clientX;ty=e.clientY;
    lastMoveT=performance.now();
    if(!visible){visible=true;dot.classList.add('is-active')}
    if(rafId===null) rafId=requestAnimationFrame(tick);
  },{passive:true});
  document.addEventListener('mouseleave',()=>{visible=false;dot.classList.remove('is-active')});
  document.addEventListener('mouseenter',()=>{visible=true;dot.classList.add('is-active')});
  const interactiveSel='a,button,[role="button"],.cta-mega-item,.side-progress__menu-item,.side-progress__tick';
  document.addEventListener('pointerover',e=>{
    if(e.target.closest(interactiveSel))dot.classList.add('is-hovering-link');
  },{passive:true});
  document.addEventListener('pointerout',e=>{
    if(e.target.closest(interactiveSel) && !e.relatedTarget?.closest(interactiveSel))
      dot.classList.remove('is-hovering-link');
  },{passive:true});
  function tick(){
    cx+=(tx-cx)*0.22;
    cy+=(ty-cy)*0.22;
    /* transform, not left/top: keeps the dot off the layout path (composited only).
       The trailing translate(-50%,-50%) preserves the CSS centering. */
    dot.style.transform='translate3d('+cx.toFixed(1)+'px,'+cy.toFixed(1)+'px,0) translate(-50%,-50%)';
    /* Stop RAF when cursor settled and idle for >120ms — saves CPU on still hover */
    const dist=Math.abs(tx-cx)+Math.abs(ty-cy);
    const idle=performance.now()-lastMoveT;
    if(dist<0.4 && idle>120){rafId=null;return;}
    rafId=requestAnimationFrame(tick);
  }
  tick();
})();

/* recompute tick positions after web fonts load (heights can shift slightly) */
if(document.fonts&&document.fonts.ready){
  document.fonts.ready.then(()=>{
    buildSideNavigation();
    _lastCurrentId=null;
    updateProgress();
  });
}

/* recompute tick positions on resize (section heights may change) */
let _resizeTimer=null;
window.addEventListener('resize',()=>{
  clearTimeout(_resizeTimer);
  _resizeTimer=setTimeout(()=>{buildSideNavigation();_lastCurrentId=null;updateProgress();},150);
});

/* re-read labels when language switches (kickers get new text).
   Guarded so clicking the ALREADY-active language doesn't rebuild the navigation
   for nothing. */
let _lastUiLang = currentLang;
document.addEventListener('click',(e)=>{
  const langBtn = e.target.closest('[data-lang]');
  if(langBtn){
    const clicked = langBtn.dataset.lang;
    if(clicked === _lastUiLang) return;
    _lastUiLang = clicked;
    setTimeout(()=>{
      currentSideLabel='';buildSideNavigation();_lastCurrentId=null;updateProgress();applyTooltips();
      clearTypographyFlags();fixTypographyOrphans();
      /* Wait for the language-specific font to load before re-fitting */
      if(typeof fitWhenReady==='function') fitWhenReady();
    },80);
  }
});

/* ─────────────── brand marquee (built once, brands are universal) ─────────────── */
const oldBrandList=document.querySelector('.brand-marquee .brand-list');
if(oldBrandList){
  const items=Array.from(oldBrandList.querySelectorAll('span')).map(s=>s.textContent.trim());
  const itemHTML=items.map(t=>`<span class="brand-item">${t}</span>`).join('');
  const track=document.createElement('div');
  track.className='brand-marquee-track';
  track.innerHTML=`<div class="brand-marquee-row">${itemHTML}${itemHTML}</div>`;
  oldBrandList.replaceWith(track);
}

/* Numbers 69% / 31% are STATIC (18.07, Sergey) — no count-up animation.
   The values live directly in index.html; there is no stat-counter JS anymore. */

/* ─────────────── cta title reveal trigger ─────────────── */
const wordIO=new IntersectionObserver(entries=>{
  entries.forEach(e=>{
    if(e.isIntersecting){
      e.target.classList.add('in-view');
      wordIO.unobserve(e.target);
    }
  });
},{threshold:0.4});
const ctaTitleEl=document.querySelector('.cta-title');
if(ctaTitleEl) wordIO.observe(ctaTitleEl);

/* ─────────────── giant section number parallax ─────────────── */
const giantNums=document.querySelectorAll('.sec-head .num-block .num');
const giantLastY=new WeakMap();
function updateParallax(){
  const vh=window.innerHeight;
  giantNums.forEach(n=>{
    const r=n.getBoundingClientRect();
    /* Early-exit if not near viewport */
    if(r.bottom<-100||r.top>vh+100)return;
    const center=r.top+r.height/2;
    const dist=(center-vh/2)/vh;
    if(Math.abs(dist)<1.2){
      const y=(dist*-10).toFixed(1);
      if(giantLastY.get(n)!==y){
        n.style.transform=`translateY(${y}px)`;
        giantLastY.set(n,y);
      }
    }
  });
}
window.__scroll.add(updateParallax);
updateParallax();

/* magnetic section numbers — removed 18.07: wrote --mx/--my that no CSS ever consumed
   (dead effect + per-frame getBoundingClientRect on hover for zero visual output). */

/* ─────────────── line-by-line slide reveal for big h2s ─────────────── */
/* Split happens once (DOM-heavy); h2-in class toggles bidirectionally
   so the blur+slide animation re-plays every time the h2 re-enters viewport. */
const lineRevealIO=new IntersectionObserver(entries=>{
  entries.forEach(e=>{
    if(e.isIntersecting){
      splitH2(e.target);
      /* double-rAF: let the blur(6px) starting state paint before adding .h2-in,
         otherwise the filter transition is skipped and the heading just snaps sharp. */
      const el=e.target;
      requestAnimationFrame(()=>requestAnimationFrame(()=>el.classList.add('h2-in')));
    } else {
      e.target.classList.remove('h2-in');
    }
  });
},{threshold:0,rootMargin:'0px 0px -22% 0px'});
document.querySelectorAll('.sec-head h2, .intro-title').forEach(h=>lineRevealIO.observe(h));

/* ─────────────── subtle hover lift for content cards ─────────────── */
if(window.matchMedia('(hover:hover)').matches){
  const cards = document.querySelectorAll('.principle, .ds-layer, .bstep');
  cards.forEach(card=>{
    /* comma separator — bare concat would silently corrupt a pre-existing transition */
    card.style.transition = (card.style.transition ? card.style.transition + ', ' : '') + 'transform 0.5s var(--ease-out)';
    card.addEventListener('mouseenter', ()=>{ card.style.transform = 'translateY(-3px)'; });
    card.addEventListener('mouseleave', ()=>{ card.style.transform = 'translateY(0)'; });
  });
}

/* ─────────────── magnetic CTA buttons ─────────────── */
if(window.matchMedia('(hover:hover)').matches){
  document.querySelectorAll('.cta-btn').forEach(btn=>{
    let rafId=null;let lastE=null;
    btn.style.transition = 'transform 0.4s var(--ease-out), background 0.3s var(--ease-out), color 0.3s var(--ease-out), box-shadow 0.3s var(--ease-out)';
    btn.addEventListener('mousemove',(e)=>{
      lastE=e;
      if(rafId) return;
      rafId=requestAnimationFrame(()=>{
        const rect=btn.getBoundingClientRect();
        const x=(lastE.clientX-rect.left-rect.width/2)/rect.width;
        const y=(lastE.clientY-rect.top-rect.height/2)/rect.height;
        btn.style.transform=`translate(${x*5}px, ${y*4}px)`;
        rafId=null;
      });
    });
    btn.addEventListener('mouseleave',()=>{
      if(rafId){cancelAnimationFrame(rafId);rafId=null}
      btn.style.transform='translate(0, 0)';
    });
  });
}

/* ─────────────── kicker reveal — fade-in from left ─────────────── */
const kickerIO=new IntersectionObserver(entries=>{
  entries.forEach(e=>{
    if(e.isIntersecting){
      e.target.classList.add('kicker-in');
      kickerIO.unobserve(e.target);
    }
  });
},{threshold:0.5});
document.querySelectorAll('.sec-asides-bar .sec-aside').forEach(k=>kickerIO.observe(k));

/* ─────────────── PAUSE HEAVY ANIMATIONS WHEN OFFSCREEN ─────────────── */
(function pauseHeavyAnimsOffscreen(){
  if(window.matchMedia('(prefers-reduced-motion:reduce)').matches)return;
  /* Targets: marquee in #companies */
  const map=new Map();
  document.querySelectorAll('#companies').forEach(sec=>{
    map.set(sec,sec.querySelectorAll('.brand-marquee-row'));
  });
  if(!map.size)return;
  const io=new IntersectionObserver(entries=>{
    entries.forEach(e=>{
      const state=e.isIntersecting?'running':'paused';
      const els=map.get(e.target);
      if(!els)return;
      els.forEach(el=>{el.style.animationPlayState=state});
    });
  },{rootMargin:'200px 0px 200px 0px'});
  map.forEach((els,sec)=>io.observe(sec));
})();

/* ─────────────── RS HORIZONTAL CINEMA — "Что получает бизнес" ─────────────── */
(function rsHorizontalCinema(){
  if(window.matchMedia('(prefers-reduced-motion:reduce)').matches)return;
  if(window.innerWidth<=1024)return;
  const pinOuter=document.querySelector('#results .rs-pin-outer');
  const track=document.getElementById('rsTrack');
  if(!pinOuter||!track)return;
  const panels=Array.from(track.querySelectorAll('.rs-panel'));
  const steps=Array.from(document.querySelectorAll('#rsSteps .rs-step'));
  const PANELS=panels.length;
  if(!PANELS)return;

  const PANEL_STEP=50;
  const LERP=0.16;
  const MIN_SCALE=0.55;
  const MAX_SCALE=1.08;
  /* Дальние панели больше НЕ гасятся: при любой прозрачности их текст не дотягивал
     до контраста 4.5 (на 0.22 было 1.27, на 0.5 — 2.13). Глубина в этой секции и так
     задана масштабом (MIN_SCALE), а читаемость теперь полная на всех панелях. */
  const MIN_OPACITY=1;

  let targetX=0;
  let currentX=0;
  let smoothRaf=null;
  let scrollRaf=null;
  let lastActive=-1;
  /* Per-panel last-state cache → skip redundant style writes */
  const panelCache=panels.map(()=>({transform:'',opacity:'',prox:''}));
  const maxX=-(PANELS-1)*PANEL_STEP;

  function smoothLoop(){
    smoothRaf=null;
    const delta=targetX-currentX;
    currentX+=delta*LERP;
    track.style.transform='translate3d('+currentX.toFixed(2)+'vw, 0, 0)';
    const viewportTrackX=-currentX;
    for(let i=0;i<PANELS;i++){
      const panelTrackX=i*PANEL_STEP;
      const dist=Math.abs(panelTrackX-viewportTrackX)/PANEL_STEP;
      /* Dead zone 0.15 — center stays at MAX_SCALE; smooth roll-off beyond */
      const adjDist=Math.max(0,(dist-0.15)/0.85);
      const proximity=Math.max(0,1-Math.min(adjDist,1.3));
      const scale=MIN_SCALE+(MAX_SCALE-MIN_SCALE)*proximity;
      const opacity=(MIN_OPACITY+(1-MIN_OPACITY)*proximity).toFixed(3);
      /* Clean uniform scale — no 3D rotation to avoid horizontal distortion */
      const transform='scale3d('+scale.toFixed(3)+','+scale.toFixed(3)+',1)';
      const proxStr=proximity.toFixed(3);
      const cache=panelCache[i];
      if(cache.transform!==transform){
        panels[i].style.transform=transform;
        cache.transform=transform;
      }
      if(cache.opacity!==opacity){
        panels[i].style.opacity=opacity;
        cache.opacity=opacity;
      }
      if(cache.prox!==proxStr){
        panels[i].style.setProperty('--p-prox',proxStr);
        cache.prox=proxStr;
      }
    }
    /* Active step indicator */
    const active=Math.round(Math.abs(currentX)/PANEL_STEP);
    const clamped=Math.max(0,Math.min(PANELS-1,active));
    if(clamped!==lastActive){
      for(let i=0;i<steps.length;i++){
        steps[i].classList.remove('is-active','is-past');
        if(i<clamped)steps[i].classList.add('is-past');
        else if(i===clamped)steps[i].classList.add('is-active');
      }
      lastActive=clamped;
    }
    if(Math.abs(delta)>0.02){
      smoothRaf=requestAnimationFrame(smoothLoop);
    }
  }

  function recomputeTarget(){
    scrollRaf=null;
    const r=pinOuter.getBoundingClientRect();
    const vh=window.innerHeight;
    if(r.bottom<0){
      targetX=maxX;
      currentX=maxX;
      track.style.transform='translate3d('+maxX.toFixed(2)+'vw, 0, 0)';
      smoothLoop();
      return;
    }
    if(r.top>vh){
      targetX=0;
      currentX=0;
      track.style.transform='translate3d(0vw, 0, 0)';
      smoothLoop();
      return;
    }
    const total=Math.max(1,pinOuter.offsetHeight-vh);
    const progress=Math.max(0,Math.min(0.9999,-r.top/total));
    targetX=progress*maxX;
    if(!smoothRaf)smoothRaf=requestAnimationFrame(smoothLoop);
  }

  window.__scroll.add(recomputeTarget);
  window.addEventListener('resize',()=>{
    if(!scrollRaf)scrollRaf=requestAnimationFrame(recomputeTarget);
  },{passive:true});
  recomputeTarget();
})();

// ═══ INTRO MONUMENT — split words into double-spans (iw + iw__in), measure natural positions, animate edge→center on scroll ═══
function splitWordsForMonument(node){
  const kids = Array.from(node.childNodes);
  kids.forEach(child => {
    if(child.nodeType === Node.TEXT_NODE){
      const parts = child.textContent.split(/(\s+)/);
      const fragment = document.createDocumentFragment();
      parts.forEach(part => {
        if(part.trim()){
          const outer = document.createElement('span');
          outer.className = 'iw';
          const inner = document.createElement('span');
          inner.className = 'iw__in';
          inner.textContent = part;
          outer.appendChild(inner);
          fragment.appendChild(outer);
        } else if(part){
          fragment.appendChild(document.createTextNode(part));
        }
      });
      node.replaceChild(fragment, child);
    } else if(child.nodeType === Node.ELEMENT_NODE && !child.classList.contains('iw')){
      // Recurse into <strong>, <em>, etc. — skip already-wrapped iw
      splitWordsForMonument(child);
    }
  });
}
/* p at which a word has faded to nothing. CSS owns the rate (--iw-fade-rate on
   .intro-spread); read it back so the travel budget below can never disagree with
   the fade. Past this point the word is invisible, so its position stops mattering. */
function monumentFadeEnd(){
  const spread = document.querySelector('.intro-spread');
  const raw = spread ? parseFloat(getComputedStyle(spread).getPropertyValue('--iw-fade-rate')) : NaN;
  const rate = (isFinite(raw) && raw > 0) ? raw : 1.75;
  return Math.min(1, 1 / rate);
}
function measureMonumentOffsets(container, factor, sharedFactor){
  if(!container) return factor;
  const rect = container.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const words = Array.from(container.querySelectorAll('.iw'));
  if(!words.length) return factor;
  const measured = words.map(word => {
    const r = word.getBoundingClientRect();
    return { word, r, distance: (r.left + r.width / 2) - cx };
  });
  /* Travel budget. Unbounded, distance*1.2 threw the outer words 500-700px past the
     window (at 1600px the word "Design" landed at x=1766) and they were cropped
     mid-glyph — that reads as broken layout, not as an effect.
     Clamping each word on its own is WORSE: an outer word hits the wall while its
     inner neighbour keeps travelling and rams into it ("Head ofDesign."). The travel
     order must stay monotonic, so the whole paragraph shares ONE factor — the largest
     that still keeps every word inside the frame for as long as it is visible.
     Self-scaling: a wider window has more room and gets more travel, up to the
     authored `factor`. Nothing is guessed, everything is measured. */
  const gutter = 12;
  const minX = gutter, maxX = window.innerWidth - gutter;
  const visibleUntil = monumentFadeEnd();
  let f = factor;
  for(const { r, distance } of measured){
    if(distance > 0){
      const cap = Math.max(0, maxX - r.right) / (distance * visibleUntil);
      if(cap < f) f = cap;
    } else if(distance < 0){
      const cap = Math.max(0, r.left - minX) / (-distance * visibleUntil);
      if(cap < f) f = cap;
    }
  }
  // Pass 1 (no sharedFactor): just report this paragraph's cap so the caller can take
  // the tightest one — both bio paragraphs must disperse at the SAME rate, otherwise
  // the shorter one visibly flies apart faster than the one above it.
  if(sharedFactor === undefined) return f;
  // Pass 2: words left of center get a negative offset, right of center positive. One
  // shared factor keeps the spacing monotonic, so words spread apart and never collide.
  measured.forEach(({ word, distance }) => {
    word.style.setProperty('--offset', `${(distance * sharedFactor).toFixed(0)}px`);
  });
  return sharedFactor;
}
/* Always measure from the RESTING layout: getBoundingClientRect() includes the live
   translateX, so re-measuring mid-dispersion (resize while scrolled into the section)
   would compound offsets — and the new clamp would be computed against displaced
   boxes. Zero --scroll-p for the read, restore after; both writes land in the same
   task, so nothing paints in between. */
function remeasureMonument(){
  const spread = document.querySelector('.intro-spread');
  const paragraphs = document.querySelectorAll('.intro-spread .intro-p');
  if(!paragraphs.length) return;
  const held = spread ? spread.style.getPropertyValue('--scroll-p') : '';
  if(spread) spread.style.setProperty('--scroll-p', '0');
  let shared = 1.2;
  paragraphs.forEach(p => { shared = Math.min(shared, measureMonumentOffsets(p, 1.2)); });
  paragraphs.forEach(p => measureMonumentOffsets(p, 1.2, shared));
  if(spread){
    if(held) spread.style.setProperty('--scroll-p', held);
    else spread.style.removeProperty('--scroll-p');
  }
}
function setupIntroMonument(){
  // Word-level animation applies ONLY to bio paragraphs (intro-p), NOT to hero/title
  const paragraphs = document.querySelectorAll('.intro-spread .intro-p');
  paragraphs.forEach(p => splitWordsForMonument(p));
  requestAnimationFrame(remeasureMonument);
}
setupIntroMonument();

(function(){
  const spread = document.querySelector('.intro-spread');
  if(!spread) return;
  const paragraphs = document.querySelectorAll('.intro-spread .intro-p');
  let raf = null, lastP = -1;
  function update(){
    /* Anchor on the BIO PARAGRAPHS, not on .intro-spread. The spread includes the
       display title, so `spread.top` reached the old trigger (vh*0.08) while the bio
       was still sitting mid-screen, fully readable — the text came apart under the
       reader's eyes. Anchoring on the paragraphs makes the trigger self-scaling
       (their offset inside the block changes with width: 286px @1440 → 367px @1920)
       and keeps the bio intact for roughly a full screen of scroll before it exits. */
    const vh = window.innerHeight;
    const first = paragraphs.length ? paragraphs[0].getBoundingClientRect() : spread.getBoundingClientRect();
    const last  = paragraphs.length ? paragraphs[paragraphs.length - 1].getBoundingClientRect() : first;
    // EXIT-ONLY: hold at rest until the FIRST bio line is leaving the top of the
    // viewport, then finish exactly as the LAST line clears it.
    const startExit = vh * 0.10;
    const span = Math.max(1, (last.bottom - first.top) + startExit);
    let p;
    if(first.top >= startExit){
      p = 0;
    } else {
      p = (startExit - first.top) / span;
    }
    p = Math.max(0, Math.min(1, p));
    /* dead-band: ignore sub-pixel scroll jitter (Lenis) — the large per-word offsets
       amplify it into a full-text shimmer/flicker. Only update on a meaningful change. */
    if(lastP < 0 || p === 0 || p === 1 || Math.abs(p - lastP) >= 0.004){
      spread.style.setProperty('--scroll-p', p.toFixed(3));
      lastP = p;
    }
    raf = null;
  }
  function onScroll(){
    if(raf) return;
    raf = requestAnimationFrame(update);
  }
  window.__scroll.add(update);
  window.addEventListener('resize', () => {
    // Offsets are viewport-clamped, so a width change must re-measure them.
    remeasureMonument();
    onScroll();
  }, {passive:true});
  update();
})();

/* ─── Craft accordion: tap-to-open для тач, fallback без :has() ─── */
(function craftAccordion(){
  const stack = document.querySelector('.craft-stack');
  if(!stack) return;
  const cards = stack.querySelectorAll('.craft-card');
  if(!cards.length) return;

  /* Открыть первую по умолчанию (страховка) */
  cards[0].classList.add('is-open');

  /* Hover-режим: для устройств с pointer:fine отслеживаем mouseenter */
  const hasHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  if(hasHover){
    cards.forEach((card) => {
      card.addEventListener('mouseenter', () => {
        cards.forEach(c => c.classList.remove('is-open'));
        card.classList.add('is-open');
      });
    });
  } else {
    /* Touch: auto-cycle the open card (like the 69/31 infographic — no tap required).
       A tap jumps to that card; the cycle keeps going. Paused while off-screen / tab hidden. */
    let i = 0, timer = null, stackInView = true;
    function openCard(n){
      cards.forEach(c => c.classList.remove('is-open'));
      i = (n + cards.length) % cards.length;
      cards[i].classList.add('is-open');
    }
    function start(){ if(!timer && !window.matchMedia('(prefers-reduced-motion:reduce)').matches) timer = setInterval(() => openCard(i + 1), 2800); }
    function stop(){ if(timer){ clearInterval(timer); timer = null; } }
    cards.forEach((card, idx) => card.addEventListener('click', () => openCard(idx)));
    start();
    if('IntersectionObserver' in window){
      new IntersectionObserver(es => { stackInView = es[0].isIntersecting; stackInView ? start() : stop(); }, { threshold: 0.2 }).observe(stack);
    }
    /* tab returns to foreground → resume only if the stack is actually on screen */
    document.addEventListener('visibilitychange', () => { document.hidden ? stop() : (stackInView && start()); });
  }
})();

/* ─── Mobile mentorship: tap a row to reveal its description (+/− indicator) ─── */
(function mentorMobile(){
  if(window.innerWidth > 1024) return;
  const sats = document.querySelectorAll('#mentor .msat');
  if(!sats.length) return;
  function descFor(s){
    const l = (document.documentElement.lang || 'ru').slice(0,2);
    return s.getAttribute('data-desc-' + (l === 'en' ? 'en' : 'ru')) || s.getAttribute('data-desc-ru') || '';
  }
  sats.forEach((s) => {
    if(s.parentNode && s.parentNode.classList && s.parentNode.classList.contains('msat-row')) return;
    /* wrap the button + a sibling description in a row, so the description sits OUTSIDE the button */
    const row = document.createElement('div'); row.className = 'msat-row';
    s.parentNode.insertBefore(row, s); row.appendChild(s);
    const ind = document.createElement('span');
    ind.className = 'msat-ind'; ind.setAttribute('aria-hidden', 'true');
    s.appendChild(ind);
    const d = document.createElement('div');
    d.className = 'msat-desc'; d.textContent = descFor(s);
    row.appendChild(d);
    s.setAttribute('aria-expanded', 'false');
    s.addEventListener('click', () => {
      const open = row.classList.toggle('is-open');
      s.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  });
  /* keep descriptions in sync with the RU/EN toggle */
  document.querySelectorAll('.lang-switch button[data-lang]').forEach((b) => {
    b.addEventListener('click', () => {
      setTimeout(() => { sats.forEach((s) => { const d = s.parentNode.querySelector('.msat-desc'); if(d) d.textContent = descFor(s); }); }, 60);
    });
  });
})();

/* ─── Кредо: фокус следует за скроллом ───
   Фразы сильные поодиночке, но вместе слипаются в список. Подсвечиваем ту, что
   сейчас в центре экрана, остальные приглушаем — читатель получает их по одной.
   Значение пишем в --p, вся отрисовка живёт в CSS. */
(function credoFocus(){
  const lines = Array.from(document.querySelectorAll('.credo-line'));
  if(!lines.length) return;
  if(window.matchMedia('(prefers-reduced-motion:reduce)').matches) return;
  const last = new WeakMap();
  function update(){
    const vh = window.innerHeight;
    const focusY  = vh * 0.46;     /* точка чтения чуть выше геометрического центра */
    const plateau = vh * 0.15;     /* пока строка примерно в центре — полный цвет */
    const reach   = vh * 0.75;     /* на этом удалении строка гаснет полностью */
    for(const el of lines){
      const r = el.getBoundingClientRect();
      /* Раньше пик был иглой: полный цвет только при |Δ|≈35px, и строка,
         занимающая полэкрана, всё ещё читалась приглушённой. Плато держит её
         зажжённой, пока она реально в центре, а гаснет она уже на уходе. */
      const d = Math.abs((r.top + r.height / 2) - focusY);
      let p = d <= plateau ? 1 : 1 - (d - plateau) / (reach - plateau);
      p = p < 0 ? 0 : (p > 1 ? 1 : p);
      p = p * p * (3 - 2 * p);     /* smoothstep — без рывка на границе */
      const prev = last.get(el);
      if(prev === undefined || Math.abs(p - prev) >= 0.01){
        el.style.setProperty('--p', p.toFixed(3));
        last.set(el, p);
      }
    }
  }
  window.__scroll.add(update);
  window.addEventListener('resize', update, {passive:true});
  update();
})();
