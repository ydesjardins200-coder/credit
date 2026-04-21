// iBoost — main entry script
// Keep this file small; feature-specific logic goes in its own module.

(function () {
  'use strict';

  // Set current year in footer
  const yearEl = document.getElementById('year');
  if (yearEl) {
    yearEl.textContent = String(new Date().getFullYear());
  }

  // If the user is already signed in, swap the "Sign in" link for "Account"
  (async function updateNav() {
    if (!window.iboostAuth) return;
    const { session } = await window.iboostAuth.getSession();
    if (!session) return;

    document.querySelectorAll('.site-nav a[href="/login.html"]').forEach((a) => {
      a.textContent = 'Account';
      a.setAttribute('href', '/account.html');
    });
  })();
})();
