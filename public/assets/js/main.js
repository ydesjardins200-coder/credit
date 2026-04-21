// iBoost — small utility script for legacy pages (auth, legal).
// The landing pages use landing.js which has a superset of functionality.

(function () {
  'use strict';

  const yearEl = document.getElementById('year');
  if (yearEl) {
    yearEl.textContent = String(new Date().getFullYear());
  }
})();
