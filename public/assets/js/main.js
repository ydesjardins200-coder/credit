// iBoost — small utility script for legacy pages (auth, legal).
// The landing pages use landing.js which has a superset of functionality.

(function () {
  'use strict';

  // Footer year auto-update
  const yearEl = document.getElementById('year');
  if (yearEl) {
    yearEl.textContent = String(new Date().getFullYear());
  }

  // Footer "Back to top" button — scroll to top (smoothly, respecting
  // the user's reduced-motion preference which CSS handles globally
  // via html { scroll-behavior: smooth } + the reduced-motion override).
  const totopButtons = document.querySelectorAll('[data-footer-totop]');
  totopButtons.forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
    });
  });
})();
