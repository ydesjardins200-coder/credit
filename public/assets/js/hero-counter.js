/* =========================================================================
   hero-counter.js — count-up animation for hero stats
   =========================================================================
   Any element tagged with `data-count-up="N"` will animate its displayed
   number from 0 to N when it first scrolls into view. Uses Intersection-
   Observer so the animation triggers exactly when the user sees the card,
   not on page load (which would be missed if the card is out of viewport)
   and not on a loop (which would be distracting).

   Optional attributes on the same element:
     data-count-prefix   — text before the number   (e.g. '+' or '$')
     data-count-suffix   — text after the number    (e.g. ' pts' or '%')
     data-count-duration — ms, defaults to 1800

   The tag's original text content (e.g. '+92 pts') is the no-JS fallback.
   If JS fails to load or an error happens, the user still sees the full
   value.

   Respects prefers-reduced-motion: skips the animation entirely and just
   writes the final value on first sight. Pauses when the tab is hidden
   so the animation doesn't finish 'offscreen' and miss the user.
   ========================================================================= */

(function () {
  'use strict';

  // Bail early if IntersectionObserver isn't available (very old browsers).
  // In that case the fallback text in the HTML is what gets shown — that's
  // correct and complete, just without the animation flourish.
  if (typeof IntersectionObserver === 'undefined') return;

  var reduceMotion = window.matchMedia &&
                     window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // easeOutCubic — smooth deceleration without being too aggressive at
  // the start. Previously easeOutQuart made low numbers flash by too
  // fast to read; easeOutCubic keeps the progression visible end-to-end.
  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function formatNumber(value, target) {
    // Integer targets stay integer during the animation; no decimals.
    // (We could support decimals via a data attribute in the future, but
    // none of iBoost's hero stats need it today.)
    if (Number.isInteger(target)) {
      return String(Math.round(value));
    }
    // For non-integer targets, match the target's decimal places.
    var decimals = (String(target).split('.')[1] || '').length;
    return value.toFixed(decimals);
  }

  function animateElement(el) {
    var target   = parseFloat(el.getAttribute('data-count-up')) || 0;
    var from     = parseFloat(el.getAttribute('data-count-from')) || 0;
    var duration = parseInt(el.getAttribute('data-count-duration'), 10) || 1800;
    var prefix   = el.getAttribute('data-count-prefix') || '';
    var suffix   = el.getAttribute('data-count-suffix') || '';
    var range    = target - from;

    // Reduced-motion: just write the final value and bail.
    if (reduceMotion) {
      el.textContent = prefix + formatNumber(target, target) + suffix;
      return;
    }

    var startTime = null;
    var pausedAt  = null;

    function step(now) {
      if (startTime === null) startTime = now;
      var elapsed = now - startTime;
      var progress = Math.min(elapsed / duration, 1);
      var eased = easeOutCubic(progress);
      var current = from + (eased * range);

      el.textContent = prefix + formatNumber(current, target) + suffix;

      if (progress < 1) {
        // Pause the animation when the tab isn't visible so we don't
        // finish the count behind a hidden tab and miss the user.
        if (document.hidden) {
          pausedAt = now;
          document.addEventListener('visibilitychange', resume, { once: true });
          return;
        }
        window.requestAnimationFrame(step);
      }
    }

    function resume() {
      if (document.hidden) {
        // Still hidden — register again.
        document.addEventListener('visibilitychange', resume, { once: true });
        return;
      }
      if (pausedAt !== null) {
        // Shift startTime forward by the pause duration so progress
        // picks up exactly where it left off.
        var pauseDuration = performance.now() - pausedAt;
        startTime += pauseDuration;
        pausedAt = null;
        window.requestAnimationFrame(step);
      }
    }

    window.requestAnimationFrame(step);
  }

  function initCountUp() {
    var targets = document.querySelectorAll('[data-count-up]');
    if (!targets.length) return;

    // Track which elements we've animated so the safety timeout doesn't
    // double-fire one that the observer already picked up.
    var animated = new WeakSet();

    function trigger(el, reason) {
      if (animated.has(el)) return;
      animated.add(el);
      animateElement(el);
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          trigger(entry.target, 'IO');
          observer.unobserve(entry.target);
        }
      });
    }, {
      // threshold 0.15 — card only needs 15% visible to trigger. More
      // forgiving than 0.4, especially on short viewports / mobile where
      // the card might be partially below the fold at page load.
      threshold: 0.15
    });

    targets.forEach(function (el) {
      // Store the fallback text in case we need to restore it on error.
      el.setAttribute('data-count-fallback', el.textContent);
      // Reset to the starting value so the animation has somewhere to count from.
      var prefix = el.getAttribute('data-count-prefix') || '';
      var suffix = el.getAttribute('data-count-suffix') || '';
      var from   = el.getAttribute('data-count-from') || '0';
      el.textContent = prefix + from + suffix;
      observer.observe(el);
    });

    // First safety fallback (800ms): if the observer hasn't fired and
    // the card is in the viewport, trigger via manual rect check.
    setTimeout(function () {
      targets.forEach(function (el) {
        if (animated.has(el)) return;
        var rect = el.getBoundingClientRect();
        var vh = window.innerHeight || document.documentElement.clientHeight;
        if (rect.top < vh && rect.bottom > 0) {
          trigger(el, '800ms-fallback');
          observer.unobserve(el);
        }
      });
    }, 800);

    // HARD safety net (2s): if nothing has fired after 2 seconds, just
    // animate. This protects against weird edge cases — headless IO
    // environments, browser bugs, layout timing issues — where the user
    // would otherwise be stuck on '+0 pts' forever. 2s is well past
    // when a legitimate IO callback would have fired.
    setTimeout(function () {
      targets.forEach(function (el) {
        if (animated.has(el)) return;
        trigger(el, '2s-hard-fallback');
        observer.unobserve(el);
      });
    }, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCountUp);
    document.addEventListener('DOMContentLoaded', initJourneyShowcase);
  } else {
    initCountUp();
    initJourneyShowcase();
  }

  /* ------------------------------------------------------------------
     initJourneyShowcase — toggles .is-visible on .reporting-showcase,
     .steps-showcase, .factors-showcase, .monthly-showcase, and
     .score-projection elements when they scroll into view, so their
     scroll-triggered CSS animations fire at the right moment.
     Separate from count-up observer above because the threshold is
     slightly different (showcases are bigger elements and we want to
     fire once ~20% of them is visible).
     ------------------------------------------------------------------ */
  function initJourneyShowcase() {
    var selector = '.reporting-showcase, .steps-showcase, .factors-showcase, .monthly-showcase, .score-projection';
    var showcases = document.querySelectorAll(selector);
    if (!showcases.length) return;

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.2 });

    showcases.forEach(function (el) {
      observer.observe(el);
    });

    // Safety fallback: if for some reason IO never fires, add the class
    // after 2s so the user still sees the animated state.
    setTimeout(function () {
      showcases.forEach(function (el) {
        el.classList.add('is-visible');
      });
    }, 2000);
  }
})();
