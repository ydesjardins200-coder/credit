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

  // easeOutQuart — fast at first, smooth deceleration.
  // Feels more 'celebratory' than linear: the number races up then
  // gently settles on the target.
  function easeOutQuart(t) {
    return 1 - Math.pow(1 - t, 4);
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
    var duration = parseInt(el.getAttribute('data-count-duration'), 10) || 1800;
    var prefix   = el.getAttribute('data-count-prefix') || '';
    var suffix   = el.getAttribute('data-count-suffix') || '';

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
      var eased = easeOutQuart(progress);
      var current = eased * target;

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

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          animateElement(entry.target);
          // Animate once per page view; stop observing once it starts.
          observer.unobserve(entry.target);
        }
      });
    }, {
      // Trigger when at least 40% of the card is visible. If we used 0%
      // the animation would fire as soon as the card enters the viewport
      // by even one pixel, which can feel abrupt. 40% = the card is
      // comfortably on screen before the count starts.
      threshold: 0.4,
      // Slight negative bottom margin so the card must actually be in
      // the main visible area, not just touching the fold.
      rootMargin: '0px 0px -10% 0px'
    });

    targets.forEach(function (el) {
      // Store the fallback text in case we need to restore it on error.
      el.setAttribute('data-count-fallback', el.textContent);
      // Reset to 0 so the animation has somewhere to count from.
      // (Only after we know IO is available and this will actually run.)
      var prefix = el.getAttribute('data-count-prefix') || '';
      var suffix = el.getAttribute('data-count-suffix') || '';
      el.textContent = prefix + '0' + suffix;
      observer.observe(el);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCountUp);
  } else {
    initCountUp();
  }
})();
