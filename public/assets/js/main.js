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

    // Match both "/login" and "/login.html" because Netlify's Pretty URLs
    // feature strips the .html extension from internal links at deploy time.
    const loginLinks = document.querySelectorAll(
      '.site-nav a[href="/login.html"], .site-nav a[href="/login"]'
    );
    loginLinks.forEach((a) => {
      a.textContent = 'Account';
      a.setAttribute('href', '/account.html');
    });
  })();
})();
