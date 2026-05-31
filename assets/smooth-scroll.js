/* ============================================================
   smooth-scroll.js — Lenis inertia scrolling, loaded on every page after lenis.min.js.
   Lenis scrolls the WINDOW natively, so all existing scroll-driven code keeps working
   off window.scrollY / scroll events (hero exit --hp, 69/31 --bp, WebGL u_scroll,
   side-progress, reveals). Disabled for reduced-motion; touch stays native.
   ============================================================ */
(function(){
  if(typeof Lenis === 'undefined') return;
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

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
        if(el){ e.preventDefault(); e.stopImmediatePropagation(); lenis.scrollTo(el, { offset: -10 }); }
      }
    }
  }, true);
})();
