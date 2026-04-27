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

  // ----- Boot -----
  document.addEventListener('DOMContentLoaded', function () {
    initCurrency();
    initFaq();
    initBackToTop();
    initDynamicPricing();
  });

  // Footer "Back to top" button
  function initBackToTop() {
    const buttons = document.querySelectorAll('[data-footer-totop]');
    buttons.forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
      });
    });
  }

  // ----- Dynamic pricing from public.plans -----
  //
  // Pricing.html cards have static fallback HTML for plan name, tagline,
  // prices (USD + CAD), and perks. This function fetches the live plans
  // from the public.plans table (admin-managed) and replaces those
  // values. The static fallback ensures the page is never blank if the
  // fetch fails — admin can edit prices freely without breaking the
  // page on bad network or DB outage.
  //
  // Why {fresh: true}: pricing-critical surfaces shouldn't show stale
  // data after admin edits. The 24h cache is fine for the dashboard's
  // plan card (returning users), but a visitor on pricing.html arrives
  // to make a decision — seeing yesterday's price is the wrong
  // tradeoff. Worth the extra DB hit.
  //
  // Currency-toggle compat: the existing data-currency="usd|cad"
  // attributes on price spans are preserved. initCurrency() handles
  // hiding the wrong-currency span; this function just replaces
  // textContent on both spans. Both run independently.
  //
  // Perks: replaces the entire <ul data-plan-perks> children with
  // freshly rendered <li> elements from plan.perks array. Each perk
  // can be {text, emphasized, muted} — emphasized wraps in <strong>,
  // muted adds the .pricing-item-muted class. Footnote markers are
  // NOT supported (intentional simplification — see the dropped
  // <sup>4</sup> markers in commit notes).
  async function initDynamicPricing() {
    if (!window.iboostPlans) return; // No loader, fall back to static HTML

    let plansMap;
    try {
      plansMap = await window.iboostPlans.getPlansMap({ fresh: true });
    } catch (e) {
      console.warn('[landing] plans fetch failed, using static fallback:', e);
      return;
    }
    if (!plansMap) return;

    ['free', 'essential', 'complete'].forEach(function (tier) {
      const plan = plansMap[tier];
      if (!plan) return;

      const card = document.querySelector('[data-plan-card="' + tier + '"]');
      if (!card) return;

      const nameEl = card.querySelector('[data-plan-name]');
      if (nameEl && plan.name != null) {
        nameEl.textContent = plan.name;
      }

      const taglineEl = card.querySelector('[data-plan-tagline]');
      if (taglineEl && plan.tagline != null) {
        taglineEl.textContent = plan.tagline;
      }

      const usdEl = card.querySelector('[data-plan-price-usd]');
      if (usdEl && plan.price_usd != null) {
        usdEl.textContent = '$' + plan.price_usd;
      }

      const cadEl = card.querySelector('[data-plan-price-cad]');
      if (cadEl && plan.price_cad != null) {
        cadEl.textContent = '$' + plan.price_cad;
      }

      const perksEl = card.querySelector('[data-plan-perks]');
      if (perksEl && Array.isArray(plan.perks)) {
        renderPerks(perksEl, plan.perks);
      }
    });
  }

  function renderPerks(ul, perks) {
    // Clear existing static fallback
    while (ul.firstChild) ul.removeChild(ul.firstChild);

    perks.forEach(function (perk) {
      const li = document.createElement('li');
      if (perk.muted) li.className = 'pricing-item-muted';

      // Defensive: text is the only required field. emphasized wraps
      // text in <strong>. We use textContent (not innerHTML) to prevent
      // XSS from admin-edited perk text.
      if (perk.emphasized) {
        const strong = document.createElement('strong');
        strong.textContent = perk.text || '';
        li.appendChild(strong);
      } else {
        li.textContent = perk.text || '';
      }
      ul.appendChild(li);
    });
  }
})();
