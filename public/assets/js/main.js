// iBoost — main entry script
// Keep this file small; feature-specific logic goes in its own module.

(function () {
  'use strict';

  // Set current year in footer
  const yearEl = document.getElementById('year');
  if (yearEl) {
    yearEl.textContent = String(new Date().getFullYear());
  }
})();
