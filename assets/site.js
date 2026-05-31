/* ============================================================
   site.js — shared behaviour for portfolio / project / 404 pages
   Cursor cross · nav state · i18n language switch · reveal · footer
   All guarded so a page missing any element won't throw.
   ============================================================ */
(function(){
  'use strict';
  var prefersReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

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
    function loop(){
      x+=(tx-x)*0.2; y+=(ty-y)*0.2;
      dot.style.left=x+'px'; dot.style.top=y+'px';
      /* Stop the rAF loop once the dot has caught up to the cursor — no more burning frames while idle. */
      if(Math.abs(tx-x)<0.4 && Math.abs(ty-y)<0.4){ x=tx; y=ty; dot.style.left=x+'px'; dot.style.top=y+'px'; raf=null; return; }
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
      nav.classList.toggle('scrolled', scrollY > 10);
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
      var media = card.querySelector('.case__media');
      var cta = card.querySelector('.case__cta');
      overlay.remove();
      if(media && href){
        var ml = document.createElement('a');
        ml.className = 'case__media-link'; ml.href = href;
        if(label) ml.setAttribute('aria-label', label);
        media.parentNode.insertBefore(ml, media); ml.appendChild(media);
      }
      if(cta && href){
        var cl = document.createElement('a');
        cl.className = 'case__cta-link'; cl.href = href;
        if(label) cl.setAttribute('aria-label', label);
        cta.parentNode.insertBefore(cl, cta); cl.appendChild(cta);
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

  /* ── i18n language switch ───────────────────────── */
  (function(){
    var node = document.getElementById('i18n-data');
    var dict = null;
    try { dict = node ? JSON.parse(node.textContent) : null; } catch(e){ dict = null; }
    var buttons = document.querySelectorAll('.lang-switch button[data-lang]');

    function apply(lang){
      document.documentElement.lang = lang;
      try{ localStorage.setItem('sl-lang', lang); }catch(e){}
      buttons.forEach(function(b){
        var on = b.getAttribute('data-lang')===lang;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true':'false');
      });
      if(!dict || !dict[lang]) return;
      var table = dict[lang];
      document.querySelectorAll('[data-i18n]').forEach(function(el){
        var key = el.getAttribute('data-i18n');
        if(table[key] != null) el.innerHTML = table[key];
      });
      /* re-split the portfolio headline into per-word lines (i18n just reset its innerHTML) */
      var pt = document.querySelector('.page-title[data-i18n]');
      if(pt){
        var ws = pt.textContent.trim().split(/\s+/);
        pt.innerHTML = ws.map(function(w,k){ return '<span class="word" style="--w-i:'+k+'">'+w+'</span>'; }).join(' ');
        pt.classList.add('in-view');
      }
      if(table['meta.title']) document.title = table['meta.title'].replace(/<[^>]+>/g,'');
    }

    var saved = null;
    try{ saved = localStorage.getItem('sl-lang'); }catch(e){}
    var initial = saved || document.documentElement.lang || 'ru';
    apply(initial);

    buttons.forEach(function(b){
      b.addEventListener('click', function(){ apply(b.getAttribute('data-lang')); });
    });
  })();

  /* ── Footer "top" + brand → home ────────────────── */
  (function(){
    var top = document.getElementById('footTop');
    if(top) top.addEventListener('click', function(){ scrollTo({top:0, behavior: prefersReduced ? 'auto':'smooth'}); });
    var brand = document.getElementById('navHome');
    if(brand) brand.addEventListener('click', function(){ location.href = brand.getAttribute('data-home') || 'index.html'; });
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

  /* ── Text-pressure on the 404 headline (letters thicken near the cursor) ── */
  (function(){
    var el = document.querySelector('[data-pressure]');
    if(!el) return;
    var text = (el.textContent || '').trim();
    el.textContent = '';
    var spans = [];
    for(var i=0;i<text.length;i++){
      var s = document.createElement('span'); s.className = 'tp-ch'; s.textContent = text[i];
      el.appendChild(s); spans.push(s);
    }
    if(prefersReduced || matchMedia('(hover:none)').matches){
      spans.forEach(function(s){ s.style.fontVariationSettings = '"wght" 320'; });
      return;
    }
    var R = 460;
    addEventListener('pointermove', function(e){
      for(var i=0;i<spans.length;i++){
        var r = spans[i].getBoundingClientRect();
        var d = Math.hypot(e.clientX - (r.left + r.width/2), e.clientY - (r.top + r.height/2));
        var t = Math.max(0, 1 - d / R);
        spans[i].style.fontVariationSettings = '"wght" ' + Math.round(150 + t * 750);
      }
    }, {passive:true});
  })();

  /* ── Hanging prepositions — glue short RU/EN words to the next word ── */
  (function(){
    var SHORT = /(^|[\s(«])([A-Za-zА-Яа-яЁё]{1,3}|для|что|как|или|при|над|под|без|про|это|уже)\s+/g;
    function glue(s){ var p; do { p=s; s=s.replace(SHORT,'$1$2 '); } while(s!==p); return s; }
    function run(){
      document.querySelectorAll('.pcase__lead, .pcase__cols p, .page-lead, .about__text p').forEach(function(el){
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
    burger.setAttribute('aria-label', 'Меню'); burger.setAttribute('aria-expanded', 'false');
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

  /* ── Portfolio hero — swipeable project-preview slider on mobile (above the title) ── */
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
    var track = document.createElement('div'); track.className = 'hero-slider__track';
    srcs.forEach(function(s){
      var slide = document.createElement('div'); slide.className = 'hero-slide';
      var im = document.createElement('img'); im.src = s; im.alt = ''; im.loading = 'lazy';
      slide.appendChild(im); track.appendChild(slide);
    });
    slider.appendChild(track);
    var dots = document.createElement('div'); dots.className = 'hero-slider__dots';
    srcs.forEach(function(_, i){
      var d = document.createElement('button'); d.type = 'button'; d.className = 'hero-dot';
      d.setAttribute('aria-label', 'Слайд ' + (i + 1)); dots.appendChild(d);
    });
    slider.appendChild(dots);
    head.insertBefore(slider, head.firstChild);

    var n = srcs.length, cur = 0, auto = null;
    function render(){
      track.style.transform = 'translateX(' + (-cur * 100) + '%)';
      Array.prototype.forEach.call(dots.children, function(d, k){ d.classList.toggle('is-active', k === cur); });
    }
    function go(i){ cur = (i + n) % n; render(); }
    function start(){ if(!auto && !prefersReduced) auto = setInterval(function(){ go(cur + 1); }, 2600); }
    function stop(){ if(auto){ clearInterval(auto); auto = null; } }
    Array.prototype.forEach.call(dots.children, function(d, k){ d.addEventListener('click', function(){ go(k); stop(); start(); }); });
    render(); start();

    /* swipe */
    var x0 = 0, dx = 0, drag = false;
    track.addEventListener('touchstart', function(e){ x0 = e.touches[0].clientX; dx = 0; drag = true; stop(); track.style.transition = 'none'; }, { passive: true });
    track.addEventListener('touchmove', function(e){ if(!drag) return; dx = e.touches[0].clientX - x0; track.style.transform = 'translateX(calc(' + (-cur * 100) + '% + ' + dx + 'px))'; }, { passive: true });
    track.addEventListener('touchend', function(){ if(!drag) return; drag = false; track.style.transition = ''; if(Math.abs(dx) > 40) go(cur + (dx < 0 ? 1 : -1)); else render(); start(); }, { passive: true });
  })();

  /* ── About greeting: morph the first word through languages (gooey cross-fade, ported from the manifest hero) ── */
  (function(){
    var el = document.querySelector('.hi-morph');
    if(!el) return;
    var words = (el.getAttribute('data-greetings') || el.textContent || '').split(',').map(function(s){ return s.trim(); }).filter(Boolean);
    if(words.length < 2) return;
    if(prefersReduced){ el.textContent = words[0]; return; }
    ensureGoo();
    var s1 = document.createElement('span'), s2 = document.createElement('span');
    s1.className = 'hm'; s2.className = 'hm';
    el.textContent = ''; el.appendChild(s1); el.appendChild(s2);
    var morphTime = 0.9, cool = 2.1, i = 0;
    s1.textContent = words[0]; s2.textContent = words[1];
    rest();
    function rest(){ el.style.filter = ''; s1.style.filter = ''; s1.style.opacity = 1; s2.style.filter = ''; s2.style.opacity = 0; }
    function setM(f){ s2.style.filter = 'blur(' + Math.min(8/f - 8, 100) + 'px)'; s2.style.opacity = Math.pow(f, 0.4); var g = 1 - f; s1.style.filter = 'blur(' + Math.min(8/g - 8, 100) + 'px)'; s1.style.opacity = Math.pow(g, 0.4); }
    function sched(){ setTimeout(step, cool * 1000); }
    function step(){
      el.style.filter = 'url(#about-goo)';
      var start = null;
      (function fr(now){
        if(start === null) start = now;
        var f = (now - start) / 1000 / morphTime;
        if(f >= 1){ setM(1); i = (i + 1) % words.length; s1.textContent = words[i]; s2.textContent = words[(i + 1) % words.length]; rest(); sched(); return; }
        setM(f); requestAnimationFrame(fr);
      })(performance.now());
    }
    sched();
    function ensureGoo(){
      if(document.getElementById('about-goo')) return;
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('aria-hidden', 'true'); svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
      svg.innerHTML = '<defs><filter id="about-goo" color-interpolation-filters="sRGB"><feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 255 -140" result="goo"/><feGaussianBlur in="goo" stdDeviation="0.55"/></filter></defs>';
      document.body.appendChild(svg);
    }
  })();
})();
