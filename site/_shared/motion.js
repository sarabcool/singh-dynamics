/* Singh Dynamics shared motion. Vanilla, no dependencies, ~2KB.

   Rules this file follows:
   - Nothing here is required for the page to make sense. Content renders and
     reads with JS disabled. This script only adds timing.
   - prefers-reduced-motion short-circuits everything except the class flip
     that reveals content, so reduced-motion users get the page instantly.
   - No work on the scroll event. Scroll-linked values are read in rAF.
*/
(function () {
  var root = document.documentElement;
  root.classList.add('js');

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* --- Reveal on entry -------------------------------------------------- */

  var revealTargets = document.querySelectorAll('[data-rise], [data-wipe]');

  if (reduce || !('IntersectionObserver' in window)) {
    revealTargets.forEach(function (el) { el.classList.add('in'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('in');
        io.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });

    revealTargets.forEach(function (el) { io.observe(el); });
  }

  /* --- Family switcher conveniences --------------------------------------
     The panel is a <details>, so it already opens, closes and takes keyboard
     input on its own. This only adds Escape and click-outside, plus locking
     the page behind it. Nothing here is required for it to work. */

  var sw = document.querySelector('details.switch');

  if (sw) {
    var body = document.body;

    sw.addEventListener('toggle', function () {
      body.style.overflow = sw.open ? 'hidden' : '';
      if (sw.open) {
        var first = sw.querySelector('.sheet-list a');
        if (first) first.focus();
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && sw.open) {
        sw.open = false;
        var summary = sw.querySelector('summary');
        if (summary) summary.focus();
      }
    });

    sw.addEventListener('click', function (e) {
      if (e.target.classList.contains('scrim') || e.target.closest('.sheet-close')) {
        e.preventDefault();
        sw.open = false;
      }
    });
  }

  /* --- Scroll-linked progress -------------------------------------------
     Any element with [data-progress] gets --p set from 0 to 1 as it crosses
     the viewport. Read once per frame, only while something is on screen. */

  var progressEls = Array.prototype.slice.call(document.querySelectorAll('[data-progress]'));

  if (progressEls.length && !reduce) {
    var live = [];
    var ticking = false;

    var pio = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var i = live.indexOf(e.target);
        if (e.isIntersecting && i === -1) live.push(e.target);
        if (!e.isIntersecting && i !== -1) live.splice(i, 1);
      });
      if (live.length) queue();
    }, { rootMargin: '20% 0px 20% 0px' });

    progressEls.forEach(function (el) { pio.observe(el); });

    function queue() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(frame);
    }

    function frame() {
      ticking = false;
      var vh = window.innerHeight;
      for (var i = 0; i < live.length; i++) {
        var el = live[i];
        var r = el.getBoundingClientRect();
        var span = r.height + vh;
        var p = span > 0 ? (vh - r.top) / span : 0;
        el.style.setProperty('--p', Math.max(0, Math.min(1, p)).toFixed(4));
      }
      if (live.length) queue();
    }

    window.addEventListener('scroll', queue, { passive: true });
    window.addEventListener('resize', queue, { passive: true });
    queue();
  } else {
    /* Reduced motion: pin every progress element to its resolved end state so
       diagrams read as finished rather than half-drawn. */
    progressEls.forEach(function (el) { el.style.setProperty('--p', '1'); });
  }
})();
