/* ============================================================
   site.js — shared behaviour for portfolio / project / 404 pages
   Cursor cross · nav state · i18n language switch · reveal · footer
   All guarded so a page missing any element won't throw.
   ============================================================ */
(function(){
  'use strict';
  var prefersReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Image deterrents — block right-click "Save image" and drag-to-save on media,
     scoped to images/video + their containers so links and text stay normal.
     Friction only: the file is still reachable via the network tab. */
  ['contextmenu','dragstart'].forEach(function(type){
    document.addEventListener(type, function(e){
      var t = e.target;
      if (t && t.closest && t.closest('img,video,picture,.case__media,.pcase__media,.about__photo,.trail-img,.hero-slide')) {
        e.preventDefault();
      }
    });
  });

  /* Lazy case-preview videos — they're preload="none" + no autoplay in the HTML, so nothing
     downloads until a case is near the viewport. Play/pause by visibility (quality unchanged,
     just deferred). Reduced-motion: leave the poster, never load the video. */
  (function lazyCaseVideos(){
    var vids = document.querySelectorAll('.case__media video');
    if (!vids.length || prefersReduced) return;
    function start(v){ if (v.preload === 'none') v.preload = 'auto'; var p = v.play(); if (p && p.catch) p.catch(function(){}); }
    if (!('IntersectionObserver' in window)) { vids.forEach(start); return; }
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(en){
        if (en.isIntersecting) start(en.target);
        else en.target.pause();
      });
    }, { rootMargin: '200px 0px', threshold: 0.01 });
    vids.forEach(function(v){ io.observe(v); });
  })();

  /* Preview thumbnail for any case media element — <img> uses its src, <video> uses its
     poster (or data-thumb). Lets previews / trails / slideshows accept video, not just images. */
  function thumbSrc(el){
    if(!el) return '';
    return el.tagName === 'VIDEO' ? (el.getAttribute('poster') || el.getAttribute('data-thumb') || '') : el.getAttribute('src');
  }

  /* ── Cursor cross ───────────────────────────────── */
  (function(){
    if (matchMedia('(max-width:900px),(hover:none)').matches || prefersReduced) return;
    var dot = document.createElement('div');
    dot.className = 'cursor-dot';
    var label = document.createElement('span'); label.className = 'cursor-label';
    dot.appendChild(label);
    document.body.appendChild(dot);
    var x=innerWidth/2, y=innerHeight/2, tx=x, ty=y, raf=null;
    /* transform, not left/top: keeps the dot off the layout path (composited only).
       Trailing translate(-50%,-50%) preserves the CSS centering. */
    function place(){ dot.style.transform='translate3d('+x+'px,'+y+'px,0) translate(-50%,-50%)'; }
    function loop(){
      x+=(tx-x)*0.2; y+=(ty-y)*0.2;
      place();
      /* Stop the rAF loop once the dot has caught up to the cursor — no more burning frames while idle. */
      if(Math.abs(tx-x)<0.4 && Math.abs(ty-y)<0.4){ x=tx; y=ty; place(); raf=null; return; }
      raf=requestAnimationFrame(loop);
    }
    addEventListener('pointermove', function(e){
      tx=e.clientX; ty=e.clientY; dot.classList.add('is-active');
      var media=e.target.closest('.case__media');
      if(media){
        label.textContent = (document.documentElement.lang||'ru').slice(0,2)==='en' ? 'View' : 'Смотреть';
        dot.classList.add('cursor-view');
        dot.classList.remove('is-hovering-link');
      } else {
        dot.classList.remove('cursor-view');
        dot.classList.toggle('is-hovering-link', !!e.target.closest('a,button,[data-cursor]'));
      }
      if(raf===null) raf=requestAnimationFrame(loop);
    }, {passive:true});
    addEventListener('pointerleave', function(){ dot.classList.remove('is-active'); });
  })();

  /* ── Nav: scrolled + on-dark over dark sections ─── */
  (function(){
    var nav = document.querySelector('nav.top');
    if(!nav) return;
    var darks = Array.prototype.slice.call(document.querySelectorAll('[data-dark],.dark,.next-proj,footer.foot'));
    function update(){
      /* порог тот же, что на манифесте (manifest.js) — иначе полоса на подстраницах
         наливалась раньше */
      nav.classList.toggle('scrolled', scrollY > 20);
      if(document.body.classList.contains('theme-dark')){ nav.classList.add('on-dark'); return; }
      var navMid = nav.getBoundingClientRect().bottom * 0.5;
      var onDark = false;
      for (var i=0;i<darks.length;i++){
        var r = darks[i].getBoundingClientRect();
        if (r.top <= navMid && r.bottom >= navMid){ onDark = true; break; }
      }
      nav.classList.toggle('on-dark', onDark);
    }
    var ticking=false;
    addEventListener('scroll', function(){ if(!ticking){ requestAnimationFrame(function(){update();ticking=false;}); ticking=true; } }, {passive:true});
    addEventListener('resize', update, {passive:true});
    update();
  })();

  /* ── Reveal on scroll ───────────────────────────── */
  (function(){
    var els = document.querySelectorAll('[data-reveal]');
    if(!els.length) return;
    if(prefersReduced || !('IntersectionObserver' in window)){
      els.forEach(function(e){ e.classList.add('in-view'); }); return;
    }
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(en){ if(en.isIntersecting){ en.target.classList.add('in-view'); io.unobserve(en.target); } });
    }, {threshold:0.12, rootMargin:'0px 0px -8% 0px'});
    els.forEach(function(e){ io.observe(e); });
    /* Safety net: if IntersectionObserver never fires (some embedded/headless contexts),
       reveal anything already in the viewport so content can't stay stuck at opacity:0.
       Below-the-fold elements still wait for the observer on scroll. */
    setTimeout(function(){
      els.forEach(function(e){
        if(e.classList.contains('in-view')) return;
        var r = e.getBoundingClientRect();
        if(r.top < innerHeight && r.bottom > 0){ e.classList.add('in-view'); io.unobserve(e); }
      });
    }, 700);
    /* Scroll fallback — reveals elements as they enter the viewport even if the observer is
       unreliable; self-removes once everything is shown. Guarantees nothing stays hidden. */
    function revealOnScroll(){
      var pending=false;
      els.forEach(function(e){
        if(e.classList.contains('in-view')) return;
        var r=e.getBoundingClientRect();
        if(r.top < innerHeight*0.92 && r.bottom > 0){ e.classList.add('in-view'); io.unobserve(e); }
        else pending=true;
      });
      if(!pending) removeEventListener('scroll', revealOnScroll);
    }
    addEventListener('scroll', revealOnScroll, {passive:true});
  })();

  /* ── Portfolio cases: scope hover/click to the image and the CTA, not the whole card ──
     The old markup put one full-card <a> overlay over each .case, so the whole 8-col block
     was a single hover/click zone (and the overlay blocked the image magnifier). We replace it
     with two display:contents links — one around the image, one around the "Смотреть →" CTA —
     which carry zero layout impact (the image stays the grid item, the CTA stays the flex item). */
  (function(){
    var cases = document.querySelectorAll('.case');
    if(!cases.length) return;
    Array.prototype.forEach.call(cases, function(card){
      var overlay = card.querySelector('.case__link');
      if(!overlay) return;
      var href = overlay.getAttribute('href');
      var label = overlay.getAttribute('aria-label') || '';
      var ariaKey = overlay.getAttribute('data-i18n-aria') || '';   /* localized-aria hook, carried onto the rebuilt links */
      var media = card.querySelector('.case__media');
      var cta = card.querySelector('.case__cta');
      overlay.remove();
      if(media && href){
        var ml = document.createElement('a');
        ml.className = 'case__media-link'; ml.href = href;
        if(label) ml.setAttribute('aria-label', label);
        if(ariaKey) ml.setAttribute('data-i18n-aria', ariaKey);
        media.parentNode.insertBefore(ml, media); ml.appendChild(media);
      }
      if(cta && href){
        var cl = document.createElement('a');
        cl.className = 'case__cta-link'; cl.href = href;
        cta.parentNode.insertBefore(cl, cta); cl.appendChild(cta);
        /* Раньше здесь стоял aria-label с названием проекта — и доступное имя ссылки
           («Руна») не содержало её видимый текст («Смотреть →»). Это нарушение
           WCAG 2.5.3: по голосовой команде «нажми смотреть» такая ссылка не находится.
           Теперь имя складывается из видимого текста и скрытого названия проекта:
           и уникально, и содержит написанное на экране. Ключ i18n на скрытой части —
           название переводится вместе со страницей. */
        if(label){
          var srp = document.createElement('span');
          srp.className = 'vh';
          srp.textContent = ' ' + label;
          if(ariaKey) srp.setAttribute('data-i18n', ariaKey);
          cl.appendChild(srp);
        }
        /* Bottom row: project number (left) opposite the CTA (right).
           The number is relocated out of the image overlay into this footer. */
        var body = card.querySelector('.case__body');
        var num = card.querySelector('.case__num');
        if(body){
          var foot = document.createElement('div');
          foot.className = 'case__foot';
          if(num) foot.appendChild(num);   /* moved from .case__media */
          foot.appendChild(cl);
          body.appendChild(foot);
        }
      }
    });
  })();

  /* ── i18n language switch (universal core in assets/i18n.js → window.SLi18n) ── */
  (function(){
    if(!window.SLi18n) return;
    function applyLang(lang, announce){
      /* core swaps [data-i18n]/title/desc/buttons/aria + announces; then the one
         sub-page extra: re-split the portfolio headline into per-word lines. */
      if(!SLi18n.applyStrings(lang, announce)) return;
      var pt = document.querySelector('.page-title[data-i18n]');
      if(pt){
        var ws = pt.textContent.trim().split(/\s+/);
        pt.innerHTML = ws.map(function(w,k){
          w = w.replace(/\.$/, '<span class="dot">.</span>');
          return '<span class="word" style="--w-i:'+k+'">'+w+'</span>';
        }).join(' ');
        pt.classList.add('in-view');
      }
    }
    SLi18n.wire(function(l){ applyLang(l, true); });
    applyLang(SLi18n.detect(), false);   /* first paint, no SR announcement */
  })();

  /* ── Footer "top" button (brand is now a real <a href> — native nav, no JS needed) ── */
  (function(){
    var top = document.getElementById('footTop');
    if(top) top.addEventListener('click', function(){ scrollTo({top:0, behavior: prefersReduced ? 'auto':'smooth'}); });
  })();

  /* ── Image trail on the portfolio header (ImagePathEffect-style) ── */
  (function(){
    if(prefersReduced || matchMedia('(hover:none)').matches) return;
    var head = document.querySelector('.page-head');
    var caseImgs = document.querySelectorAll('.case__media img, .case__media video');
    if(!head || !caseImgs.length) return;
    var srcs = Array.prototype.map.call(caseImgs, thumbSrc).filter(Boolean);
    if(!srcs.length) return;
    var last = null, acc = 0, idx = 0;
    head.addEventListener('pointermove', function(e){
      var r = head.getBoundingClientRect();
      var x = e.clientX - r.left, y = e.clientY - r.top;
      if(last) acc += Math.hypot(x - last.x, y - last.y);
      last = {x:x, y:y};
      if(acc < 95) return;
      acc = 0;
      var im = document.createElement('img');
      im.src = srcs[idx % srcs.length]; idx++;
      im.className = 'trail-img'; im.alt = '';
      im.style.left = x + 'px'; im.style.top = y + 'px';
      im.style.setProperty('--r', (((idx * 53) % 16) - 8) + 'deg');
      head.appendChild(im);
      requestAnimationFrame(function(){ requestAnimationFrame(function(){ im.classList.add('show'); }); });
      setTimeout(function(){ im.classList.remove('show'); setTimeout(function(){ im.remove(); }, 700); }, 460);
    }, {passive:true});
  })();

  /* ── Portfolio hero — split title into words + WOW entrance ── */
  (function(){
    var head = document.querySelector('.page-head');
    var title = head && head.querySelector('.page-title');
    if(!title) return;
    var words = title.textContent.trim().split(/\s+/);
    title.innerHTML = words.map(function(w, i){
      w = w.replace(/\.$/, '<span class="dot">.</span>');
      return '<span class="word" style="--w-i:' + i + '">' + w + '</span>';
    }).join(' ');
    requestAnimationFrame(function(){ requestAnimationFrame(function(){
      title.classList.add('in-view');
      head.classList.add('revealed');
    }); });
  })();

  /* Case image hover is intentionally CSS-only now: a simple scale-up on hover
     (.case__media:hover img in site.css). No JS distortion/ripple/loupe. */

  /* ── Text-pressure: letters thicken as the pointer approaches ──
     Works on every [data-pressure] element (the 404 numeral, the About greeting).
     Same behaviour as the manifest cover: wght rides 300 → 700, which is the range
     the self-hosted Inter Tight actually carries (@font-face in core.css).

     Glyph spans stay display:inline and each word gets its own nowrap wrapper —
     a flat per-glyph split makes every gap between letters a legal line break, and
     inline-block spans quietly widen the line by breaking the space runs. */
  var pressureChars = [];
  (function(){
    var targets = document.querySelectorAll('[data-pressure]');
    if(!targets.length) return;
    var live = !prefersReduced && matchMedia('(hover:hover)').matches;

    Array.prototype.forEach.call(targets, function(el){
      var text = (el.textContent || '');
      if(!text.trim()) return;
      /* Keep whatever other axes the CSS set; the pointer owns wght alone.
         Only real «"axis" value» pairs survive the filter — where the CSS sets no
         variations at all the computed value is the keyword `normal`, and pasting
         that in front of "wght" produced an invalid declaration that the browser
         dropped whole. That is why the effect did nothing outside the cover. */
      var prefix = (getComputedStyle(el).fontVariationSettings || '')
        .split(',').map(function(s){ return s.trim(); })
        .filter(function(s){ return /^["'][A-Za-z]{4}["']\s+[-\d.]+$/.test(s) && !/^["']wght["']/.test(s); })
        .join(', ');
      if(prefix) prefix += ', ';
      var frag = document.createDocumentFragment();
      text.split(' ').forEach(function(word, wi){
        if(wi) frag.appendChild(document.createTextNode(' '));
        if(!word) return;
        var w = document.createElement('span');
        w.className = 'tp-w';
        for(var i = 0; i < word.length; i++){
          var s = document.createElement('span');
          s.className = 'tp-ch';
          s.textContent = word[i];
          if(!live) s.style.fontVariationSettings = prefix + '"wght" 320';
          w.appendChild(s);
          pressureChars.push({ el: s, prefix: prefix });
        }
        frag.appendChild(w);
      });
      el.textContent = '';
      el.appendChild(frag);
      /* the heading carries the whole line in aria-label — spans would be spelled out */
      el.setAttribute('aria-hidden', 'true');
    });

    if(!live || !pressureChars.length) return;
    var R = 460, px = 0, py = 0, raf = null;
    function frame(){
      raf = null;
      var n = pressureChars.length, rects = new Array(n), i;
      for(i = 0; i < n; i++) rects[i] = pressureChars[i].el.getBoundingClientRect();
      for(i = 0; i < n; i++){
        var r = rects[i];
        var d = Math.hypot(px - (r.left + r.width / 2), py - (r.top + r.height / 2));
        var t = Math.max(0, 1 - d / R);
        pressureChars[i].el.style.fontVariationSettings =
          pressureChars[i].prefix + '"wght" ' + Math.round(300 + t * 400);
      }
    }
    addEventListener('pointermove', function(e){
      px = e.clientX; py = e.clientY;
      if(raf === null) raf = requestAnimationFrame(frame);
    }, { passive: true });
  })();

  /* ── About headline: fit the greeting into exactly two full lines ──
     The greeting used to sit on a forced line of its own, which left most of the
     first line empty; now the phrase flows, and the size is shrunk until it lands
     in two lines that both fill the column. Nothing overflows into the portrait,
     and it holds in either language — the English line is a character longer. */
  (function(){
    var t = document.querySelector('.about__title');
    if(!t) return;
    function lineCount(){
      var lh = parseFloat(getComputedStyle(t).lineHeight) || 1;
      return Math.round(t.scrollHeight / lh);
    }
    function fit(){
      t.classList.add('is-fitting');   // мерим при максимальном весе букв
      t.style.fontSize = '';
      /* Runs at every width: on a phone the clamp's floor is still wide enough to push
         "я Сергей Лукин" onto a third line, and only shrinking fixes that. */
      var max = parseFloat(getComputedStyle(t).fontSize) || 0;
      if(!max) return;
      var lo = 24, hi = max, best = lo;
      for(var i = 0; i < 16 && hi - lo > 0.5; i++){
        var mid = (lo + hi) / 2;
        t.style.fontSize = mid + 'px';
        if(lineCount() <= 2 && t.scrollWidth <= t.clientWidth + 1){ best = mid; lo = mid; }
        else hi = mid;
      }
      /* Ещё процент запаса: замер идёт в дробных пикселях, а межбуквенный
         интервал и кернинг округляются при отрисовке. */
      t.style.fontSize = (best * 0.99) + 'px';
      t.classList.remove('is-fitting');
    }
    fit();
    if(document.fonts && document.fonts.ready) document.fonts.ready.then(fit).catch(function(){});
    addEventListener('load', fit);
    var rt = null;
    addEventListener('resize', function(){ clearTimeout(rt); rt = setTimeout(fit, 120); }, { passive: true });
    document.addEventListener('click', function(e){
      if(e.target.closest && e.target.closest('[data-lang]')) setTimeout(fit, 120);
    }, true);
  })();

  /* ── Hanging prepositions — glue short RU/EN words to the next word ── */
  (function(){
    var SHORT = /(^|[\s(«])([A-Za-zА-Яа-яЁё]{1,3}|для|что|как|или|при|над|под|без|про|это|уже)\s+/g;
    function glue(s){ var p; do { p=s; s=s.replace(SHORT,'$1$2 '); } while(s!==p); return s; }
    function run(){
      /* Английский текст «Обо мне» — без склейки: неразрывный пробел после
         «the / and / to / by» это правило РУССКОЙ типографики, в английском он
         делает пару нерушимой и рвёт строку при полупустом правом поле.
         Остальные блоки и весь русский — как было. */
      var ru = (document.documentElement.lang || 'ru').slice(0,2) === 'ru';
      document.querySelectorAll('.pcase__lead, .pcase__cols p, .page-lead, .about__text p').forEach(function(el){
        if(!ru && el.closest('.about__text')) return;
        if(el.children.length) return;            // plain-text only, never touch markup
        var t=el.textContent; var g=glue(t);
        if(g!==t) el.textContent=g;
      });
    }
    run();
    // re-run shortly after (covers i18n applying innerHTML on load)
    setTimeout(run, 400);
    document.querySelectorAll('.lang-switch button[data-lang]').forEach(function(b){
      b.addEventListener('click', function(){ setTimeout(run, 60); });
    });
  })();

  /* ── Mobile burger menu — pages + language in the top-right corner ── */
  (function(){
    var nav = document.querySelector('nav.top'); if(!nav) return;
    var center = nav.querySelector('.nav-center');
    var lang = nav.querySelector('.lang-switch');
    var right = nav.querySelector('.nav-right') || nav;
    var burger = document.createElement('button');
    burger.className = 'nav-burger'; burger.type = 'button';
    burger.setAttribute('aria-label', (document.documentElement.lang||'ru').slice(0,2)==='en' ? 'Menu' : 'Меню');
    burger.setAttribute('aria-expanded', 'false');
    burger.innerHTML = '<span></span><span></span>';
    right.appendChild(burger);
    var drop = document.createElement('div'); drop.className = 'nav-drop';
    if(center) Array.prototype.forEach.call(center.querySelectorAll('a'), function(a){
      var l = document.createElement('a'); l.href = a.getAttribute('href'); l.textContent = a.textContent;
      var k = a.getAttribute('data-i18n'); if(k) l.setAttribute('data-i18n', k);
      if(a.classList.contains('is-active')) l.classList.add('is-active');
      drop.appendChild(l);
    });
    if(lang){
      var lr = document.createElement('div'); lr.className = 'nav-drop__lang';
      Array.prototype.forEach.call(lang.querySelectorAll('button[data-lang]'), function(b){
        var nb = document.createElement('button'); nb.type = 'button'; nb.textContent = b.textContent;
        nb.setAttribute('data-lang', b.getAttribute('data-lang'));
        if(b.classList.contains('active')) nb.classList.add('active');
        nb.addEventListener('click', function(){
          b.click();
          Array.prototype.forEach.call(lr.children, function(x){ x.classList.toggle('active', x === nb); });
          close();
        });
        lr.appendChild(nb);
      });
      drop.appendChild(lr);
    }
    nav.appendChild(drop);
    function close(){ nav.classList.remove('menu-open'); burger.setAttribute('aria-expanded','false'); }
    burger.addEventListener('click', function(){ var o = nav.classList.toggle('menu-open'); burger.setAttribute('aria-expanded', o?'true':'false'); });
    Array.prototype.forEach.call(drop.querySelectorAll('a'), function(a){ a.addEventListener('click', close); });
    addEventListener('keydown', function(e){ if(e.key === 'Escape') close(); });
  })();

  /* ── Portfolio hero — auto-running project-preview strip on mobile (above the title).
       No swipe, no dots: it is a showreel, not a control. One image every 0.5s. ── */
  (function(){
    if(!matchMedia('(max-width:720px)').matches) return;
    var head = document.querySelector('.page-head');
    var title = head && head.querySelector('.page-title');
    var cases = document.querySelectorAll('.case');
    if(!head || !title || !cases.length) return;
    var srcs = [];
    Array.prototype.forEach.call(cases, function(c){
      var m = c.querySelector('.case__media img, .case__media video');
      var s = m ? thumbSrc(m) : '';
      if(s) srcs.push(s);
    });
    if(!srcs.length) return;

    var slider = document.createElement('div'); slider.className = 'hero-slider';
    /* Системное «уменьшить движение» больше не глушит показ целиком, только смягчает:
       на айфоне этот же флаг поднимает обычный режим энергосбережения, и герой портфолио
       замирал на первом кадре — со стороны это читалось как поломка страницы, а не как
       уважение к настройке. Теперь в этом режиме кадры меняются встык, без кросс-фейда,
       и вдвое спокойнее по темпу. */
    if(prefersReduced) slider.classList.add('is-cut');
    var track = document.createElement('div'); track.className = 'hero-slider__track';
    srcs.forEach(function(s){
      var slide = document.createElement('div'); slide.className = 'hero-slide';
      var im = document.createElement('img'); im.src = s; im.alt = ''; im.loading = 'lazy';
      slide.appendChild(im); track.appendChild(slide);
    });
    slider.appendChild(track);
    head.insertBefore(slider, head.firstChild);

    var n = srcs.length, cur = 0, auto = null;
    /* Frames are stacked and cross-faded, not slid: a translated flex track lands on
       fractional pixels and leaves a hairline seam between slides. */
    function render(){
      Array.prototype.forEach.call(track.children, function(s, k){ s.classList.toggle('is-on', k === cur); });
    }
    function go(i){ cur = (i + n) % n; render(); }
    /* 850ms per frame — «почти секунда»; кросс-фейд в site.css вдвое короче шага,
       иначе кадр не успевал бы устояться до следующего тика. При «уменьшить движение» —
       спокойнее и встык (см. is-cut выше). */
    var STEP = prefersReduced ? 1800 : 850;
    function start(){ if(!auto) auto = setInterval(function(){ go(cur + 1); }, STEP); }
    function stop(){ if(auto){ clearInterval(auto); auto = null; } }
    render(); start();
    /* pause while the strip is scrolled off-screen or the tab is hidden */
    /* Наблюдатель только ПРИОСТАНАВЛИВАЕТ показ, когда полоса уехала с экрана. Раньше
       первый же вызов мог прийти с isIntersecting:false (мобильный Safari успевает
       отдать его до укладки) и погасить слайдшоу насовсем — стартуем мы всё равно сами. */
    if('IntersectionObserver' in window){
      new IntersectionObserver(function(es){ es[0].isIntersecting ? start() : stop(); }, { threshold: 0.01 }).observe(slider);
    }
    document.addEventListener('visibilitychange', function(){ document.hidden ? stop() : start(); });
  })();

  /* ── Медиа кейса горизонтальной лентой ──
     Секция .pcase__media превращается в «пин»: липкая сцена высотой с экран, внутри
     лента кадров, которая едет по X ровно на столько, на сколько страница прокручена
     внутри секции. Высота секции = экран + длина ленты, поэтому вертикаль сверху и
     снизу остаётся обычной, а колесо нигде не перехватывается.
     Разметку десяти страниц кейсов менять не нужно — обёртки строит скрипт, поэтому
     на узком экране (и при prefers-reduced-motion) он просто их не создаёт. */
  (function(){
    var sec = document.querySelector('.pcase__media');
    if(!sec || prefersReduced) return;
    var mq = matchMedia('(min-width:861px)');

    /* Темп: во сколько раз вертикальный путь короче горизонтального. 1 = пиксель в
       пиксель (лента едет ровно на столько, на сколько прокручена страница) — на пяти
       кадрах это выходило слишком много оборотов колеса. 0.55 = лента идёт почти вдвое
       бодрее, при этом скролл остаётся нативным: меняется только высота секции. */
    var PACE = 0.55;
    /* Торможение в конце. Простая пауза в конце была слишком грубой: лента шла ровно и
       вставала колом, а следом так же резко начиналась вертикаль. Поэтому последняя треть
       пути идёт с равномерным замедлением до нуля — на стыке скорость нулевая с обеих
       сторон, и последний кадр успевает «дойти» и устояться, а не мигнуть.
       TAIL — доля прокрутки под замедление; M — скорость на ровном участке, подобрана
       так, чтобы путь сошёлся ровно в конце (площадь под графиком скорости = 1).
       HOLD — короткая доля экрана уже на нулевой скорости, чтобы кадр постоял. */
    var TAIL = 0.26, A = 1 - TAIL, M = 1 / (A + TAIL / 2), HOLD = 0.3;
    var stage = null, rail = null, dist = 0, travel = 0, hold = 0, built = false, ticking = false, primed = false;

    function build(){
      if(built) return;
      stage = document.createElement('div'); stage.className = 'pcase__rail-stage';
      rail  = document.createElement('div'); rail.className  = 'pcase__rail';
      while(sec.firstChild) rail.appendChild(sec.firstChild);
      stage.appendChild(rail); sec.appendChild(stage);
      sec.classList.add('is-rail');
      built = true;
    }
    function teardown(){
      if(!built) return;
      while(rail.firstChild) sec.appendChild(rail.firstChild);
      sec.removeChild(stage);
      sec.classList.remove('is-rail'); sec.style.height = '';
      stage = rail = null; built = false;
    }
    /* Кадры уезжают за край сцены, а она с overflow:hidden — нативный loading="lazy"
       считает их невидимыми и тянет картинку только в момент выезда, отчего кадр
       мигал бы пустотой. Поэтому за два экрана до ленты грузим её целиком. */
    function prime(){
      if(primed || !built) return;
      if(sec.getBoundingClientRect().top > innerHeight * 2) return;
      primed = true;
      rail.querySelectorAll('img[loading="lazy"]').forEach(function(im){ im.loading = 'eager'; });
    }
    function measure(){
      if(!built) return;
      rail.style.transform = 'translate3d(0,0,0)';
      dist = Math.max(0, rail.scrollWidth - stage.clientWidth);
      travel = Math.round(dist * PACE * M);
      hold = travel ? Math.round(stage.offsetHeight * HOLD) : 0;
      sec.style.height = travel ? (stage.offsetHeight + travel + hold) + 'px' : '';
      frame();
    }
    function frame(){
      ticking = false;
      if(!built) return;
      prime();
      if(travel <= 0) return;
      /* Пока секция прилипшая, её top уходит в минус — это и есть пройденный путь. */
      var u = Math.min(1, Math.max(0, -sec.getBoundingClientRect().top / travel));
      /* Ровный участок — постоянная скорость M; хвост — та же скорость, линейно гаснущая
         до нуля. Дальше идёт HOLD: лента уже стоит, пин ещё держит. */
      var t, p;
      if(u <= A) p = M * u;
      else { t = (u - A) / TAIL; p = M * A + M * TAIL * (t - t * t / 2); }
      p = Math.min(1, p);
      rail.style.transform = 'translate3d(' + (-p * dist).toFixed(2) + 'px,0,0)';
    }
    function onScroll(){ if(!ticking){ ticking = true; requestAnimationFrame(frame); } }

    function sync(){
      if(mq.matches){ build(); measure(); } else teardown();
    }
    sync();
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('load', measure);
    if(document.fonts && document.fonts.ready) document.fonts.ready.then(measure).catch(function(){});
    var rt = null;
    addEventListener('resize', function(){ clearTimeout(rt); rt = setTimeout(sync, 120); }, { passive: true });
    (mq.addEventListener ? mq.addEventListener.bind(mq, 'change') : mq.addListener.bind(mq))(sync);
  })();


})();
