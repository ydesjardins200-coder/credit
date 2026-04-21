// Landing page controller.
// Handles: currency toggle (USD/CAD), FAQ accordion, auth-aware header CTA swap.

(function () {
  'use strict';

  // ----- Currency toggle -----
  // Elements with data-currency="usd" or data-currency="cad" are shown/hidden
  // based on the user's selection. Persisted in localStorage.

  const STORAGE_KEY = 'iboost.currency';

  function getSavedCurrency() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (_) {
      return null;
    }
  }

  function saveCurrency(c) {
    try {
      localStorage.setItem(STORAGE_KEY, c);
    } catch (_) {
      /* storage full or disabled — non-fatal */
    }
  }

  function applyCurrency(currency) {
    document.querySelectorAll('[data-currency]').forEach(function (el) {
      el.hidden = el.getAttribute('data-currency') !== currency;
    });
    document.querySelectorAll('[data-currency-toggle]').forEach(function (btn) {
      const active = btn.getAttribute('data-currency-toggle') === currency;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function guessDefaultCurrency() {
    // Best-effort default. User can override with the toggle anytime.
    // Prefer saved choice; else guess CAD for French pages and fr-CA locale.
    const saved = getSavedCurrency();
    if (saved === 'usd' || saved === 'cad') return saved;
    const htmlLang = (document.documentElement.lang || '').toLowerCase();
    if (htmlLang.startsWith('fr')) return 'cad';
    try {
      const lang = (navigator.language || '').toLowerCase();
      if (lang.includes('ca')) return 'cad';
    } catch (_) { /* ignore */ }
    return 'usd';
  }

  function initCurrency() {
    const toggles = document.querySelectorAll('[data-currency-toggle]');
    if (!toggles.length) return;

    applyCurrency(guessDefaultCurrency());

    toggles.forEach(function (btn) {
      btn.addEventListener('click', function () {
        const c = btn.getAttribute('data-currency-toggle');
        saveCurrency(c);
        applyCurrency(c);
      });
    });
  }

  // ----- FAQ accordion -----
  function initFaq() {
    document.querySelectorAll('.faq-question').forEach(function (btn) {
      btn.setAttribute('aria-expanded', 'false');
      const answer = btn.nextElementSibling;
      if (answer) answer.setAttribute('data-open', 'false');

      btn.addEventListener('click', function () {
        const open = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', open ? 'false' : 'true');
        if (answer) answer.setAttribute('data-open', open ? 'false' : 'true');
      });
    });
  }

  // ----- Header auth-aware CTA swap -----
  // When logged in, swap the "Sign in" link for "Account".
  async function updateHeaderForAuth() {
    if (!window.iboostAuth) return;
    const { session } = await window.iboostAuth.getSession();
    if (!session) return;
    document.querySelectorAll('[data-auth-swap]').forEach(function (el) {
      const to = el.getAttribute('data-auth-to');
      const label = el.getAttribute('data-auth-label');
      if (to) el.setAttribute('href', to);
      if (label) el.textContent = label;
    });
  }

  // ----- Boot -----
  document.addEventListener('DOMContentLoaded', function () {
    initCurrency();
    initFaq();
  });

  // If Supabase is loaded via defer, iboostAuth may not exist yet at DOMContentLoaded.
  // Poll briefly, then give up.
  let tries = 0;
  const t = setInterval(function () {
    if (window.iboostAuth) {
      clearInterval(t);
      updateHeaderForAuth();
    } else if (++tries > 20) {
      clearInterval(t);
    }
  }, 100);
})();
