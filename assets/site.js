/* ============================================================
   site.js — shared behaviour for portfolio / project / 404 pages
   Cursor cross · nav state · i18n language switch · reveal · footer
   All guarded so a page missing any element won't throw.
   ============================================================ */
(function(){
  'use strict';
  var prefersReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── Cursor cross ───────────────────────────────── */
  (function(){
    if (matchMedia('(max-width:900px),(hover:none)').matches || prefersReduced) return;
    var dot = document.createElement('div');
    dot.className = 'cursor-dot';
    document.body.appendChild(dot);
    var x=innerWidth/2, y=innerHeight/2, tx=x, ty=y, raf=null;
    function loop(){ x+=(tx-x)*0.2; y+=(ty-y)*0.2; dot.style.left=x+'px'; dot.style.top=y+'px'; raf=requestAnimationFrame(loop); }
    addEventListener('pointermove', function(e){
      tx=e.clientX; ty=e.clientY; dot.classList.add('is-active');
      var t=e.target.closest('a,button,[data-cursor]');
      dot.classList.toggle('is-hovering-link', !!t);
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
    var caseImgs = document.querySelectorAll('.case__media img');
    if(!head || !caseImgs.length) return;
    var srcs = Array.prototype.map.call(caseImgs, function(i){ return i.getAttribute('src'); });
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

  /* ── Magnifier lens on hovering a case photo (Magnifier-style) ── */
  (function(){
    if(prefersReduced || matchMedia('(hover:none)').matches) return;
    var medias = document.querySelectorAll('.case__media');
    if(!medias.length) return;
    var ZOOM = 2;
    Array.prototype.forEach.call(medias, function(m){
      var img = m.querySelector('img'); if(!img) return;
      var lens = document.createElement('div'); lens.className = 'mag-lens'; m.appendChild(lens);
      m.addEventListener('pointerenter', function(){
        lens.style.backgroundImage = 'url("' + (img.currentSrc || img.src) + '")';
        m.classList.add('lens-on');
      });
      m.addEventListener('pointerleave', function(){ m.classList.remove('lens-on'); });
      m.addEventListener('pointermove', function(e){
        var r = m.getBoundingClientRect();
        var x = e.clientX - r.left, y = e.clientY - r.top;
        var half = lens.offsetWidth / 2;
        lens.style.left = x + 'px'; lens.style.top = y + 'px';
        lens.style.backgroundSize = (r.width * ZOOM) + 'px ' + (r.height * ZOOM) + 'px';
        lens.style.backgroundPosition = (-(x * ZOOM - half)) + 'px ' + (-(y * ZOOM - half)) + 'px';
      });
    });
  })();

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

  /* ── Portfolio hero — sequential image slideshow on mobile (above the title) ── */
  (function(){
    if(!matchMedia('(max-width:720px)').matches) return;
    var head = document.querySelector('.page-head');
    var title = head && head.querySelector('.page-title');
    var imgs = document.querySelectorAll('.case__media img');
    if(!head || !title || !imgs.length) return;
    var srcs = Array.prototype.map.call(imgs, function(i){ return i.getAttribute('src'); });
    var box = document.createElement('img'); box.className = 'hero-cycle'; box.alt = ''; box.src = srcs[0];
    head.insertBefore(box, head.firstChild);
    if(prefersReduced) return;
    var idx = 0;
    setInterval(function(){ idx = (idx + 1) % srcs.length; box.src = srcs[idx]; }, 1300);
  })();
})();
