/* ============================================================
   smooth-scroll.js — Lenis inertia scrolling, loaded on every page after lenis.min.js.
   Lenis scrolls the WINDOW natively, so all existing scroll-driven code keeps working
   off window.scrollY / scroll events (hero exit --hp, 69/31 --bp, WebGL u_scroll,
   side-progress, reveals). Disabled for reduced-motion; touch stays native.
   ============================================================ */
(function(){
  if(typeof Lenis === 'undefined') return;
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  /* On reload the browser restores the old scroll offset, but Lenis starts its own
     position at 0 — the two desync and the page comes back parked mid-document with
     scrolling fighting itself (it looked like the layout had broken). Own the
     restore: every reload starts at the top, which is also what a cover page wants. */
  if('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.scrollTo(0, 0);
  window.addEventListener('load', function(){ window.scrollTo(0, 0); });

  var lenis = new Lenis({
    lerp: 0.085,          /* inertia weight — lower = heavier, longer glide */
    wheelMultiplier: 1,
    smoothWheel: true     /* trackpad/wheel only; touch devices keep native scrolling */
  });
  window.__lenis = lenis;

  function raf(time){ lenis.raf(time); requestAnimationFrame(raf); }
  requestAnimationFrame(raf);

  /* Route in-page anchors and "to top" buttons through Lenis so they glide too.
     Capture phase so we run before any page-specific click handler (e.g. footTop). */
  document.addEventListener('click', function(e){
    if(!e.target || !e.target.closest) return;
    var top = e.target.closest('#footTop, .ft-top, [data-scroll-top]');
    if(top){ e.preventDefault(); e.stopImmediatePropagation(); lenis.scrollTo(0, { duration: 1.1 }); return; }
    var a = e.target.closest('a[href^="#"]');
    if(a){
      var id = a.getAttribute('href');
      if(id && id.length > 1){
        var el = document.querySelector(id);
        if(el){
          e.preventDefault(); e.stopImmediatePropagation();
          lenis.scrollTo(el, { offset: -10 });
          /* preventDefault above kills the anchor's native behaviour, so restore it by hand:
             move focus to the target (keeps skip-links working for keyboard users) and
             reflect the anchor in the URL. preventScroll — Lenis owns the glide. */
          if(!el.hasAttribute('tabindex')) el.setAttribute('tabindex','-1');
          try{ el.focus({ preventScroll: true }); }catch(err){ el.focus(); }
          if(history.replaceState) history.replaceState(null, '', id);
        }
      }
    }
  }, true);
})();
