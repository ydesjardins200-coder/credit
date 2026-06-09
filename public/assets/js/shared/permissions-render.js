/**
 * Permissions render layer — Phase D-1a of account-architecture refactor.
 *
 * lib/permissions.js (window.iboostPermissions) is the LOGIC layer:
 *   - canAccess(featureKey, profile) -> 'allowed' | 'locked-visible' | 'hidden'
 *   - getTier(profile) -> 'free' | 'essential' | 'complete'
 *   - getPitch(featureKey, profile) -> { title, body } | null
 *   - recommendedTier(featureKey, profile) -> 'essential' | 'complete' | null
 *
 * This file is the RENDER layer:
 *   - apply(profile, plansMap) — scan the document for [data-feature]
 *     elements, call canAccess() on each, and apply the appropriate
 *     visual state (hidden, locked-visible with overlay, or allowed).
 *
 * Why split logic from render:
 *   - Logic is testable without a DOM (and IS tested in test-tier-render.js).
 *   - Future per-tab pages (Profile, Offers, Credit, Budget) all need the
 *     render layer. Without this extraction, each page would either
 *     duplicate ~140 lines of permissions-render code OR couple itself
 *     to account.js's IIFE — both of which violate the per-page
 *     architecture goal.
 *
 * Pattern: IIFE, expose window.iboostPermissionsRender. Same convention
 * as window.iboostShared (Phase A), window.iboostAccountShell (Phase B),
 * window.iboostPermissions (the underlying logic module).
 *
 * Phase D-1a (this commit): extract these helpers into the shared layer.
 * The monolith continues to use them — apply() is called once from
 * account.js's init(); the other helpers are internal.
 *
 * Phase D-1b (next session): extract Profile tab into /account/profile.
 * The profile page will call iboostPermissionsRender.apply() in its
 * own boot routine — no monolith dependency.
 *
 * See docs/account-architecture.md for the full refactor plan.
 */
(function () {
  'use strict';

  // Shorthand for the shared escape function. Module-level reference
  // taken inside the IIFE so it's resolved once at load time. Falls
  // back to a no-op String coercion if iboostShared isn't loaded
  // (defensive — should never happen in practice since the load
  // order in account.html guarantees dom-utils.js loads first).
  function esc(s) {
    if (window.iboostShared && window.iboostShared.escapeHtml) {
      return window.iboostShared.escapeHtml(s);
    }
    // Fallback: at least coerce to string. Won't HTML-escape but
    // won't crash. The pages that load this module are expected to
    // also load shared/dom-utils.js, so this branch should be
    // unreachable in practice.
    return s == null ? '' : String(s);
  }

  /**
   * Walk the document, find every [data-feature] element, and apply
   * the right visual state based on the user's plan via
   * window.iboostPermissions.
   *
   * Three states:
   *   - 'allowed'         -> leave element alone (and unwrap any prior lock)
   *   - 'locked-visible'  -> wrap children in lock-host structure,
   *                          inject overlay with upgrade pitch
   *   - 'hidden'          -> set element.hidden = true
   *
   * Lock pattern (matches dash-iblock-locked-* CSS in account.css):
   *
   *   <element data-feature="...">                    <-- becomes lock-host
   *     <div class="dash-iblock-locked-content">      <-- wraps children
   *       ...original children, blurred...
   *     </div>
   *     <div class="dash-iblock-locked-overlay">      <-- injected
   *       <div class="dash-iblock-locked-card">
   *         icon + title + body + CTA
   *       </div>
   *     </div>
   *   </element>
   *
   * Idempotent: safe to call multiple times. Does NOT re-wrap an
   * element that's already wrapped.
   *
   * @param {object|null} profile - user's profile row (with plan, etc.)
   * @param {object|null} plansMap - plans data for CTA pricing
   */
  function apply(profile, plansMap) {
    if (!window.iboostPermissions) {
      console.warn('[permissions-render] iboostPermissions missing — gating disabled');
      return;
    }
    var els = document.querySelectorAll('[data-feature]');
    els.forEach(function (el) {
      var key = el.getAttribute('data-feature');
      if (!key) return;
      var access = window.iboostPermissions.canAccess(key, profile);
      applyAccessToElement(el, key, access, profile, plansMap);
    });
  }

  function applyAccessToElement(el, featureKey, access, profile, plansMap) {
    if (access === 'allowed') {
      // Make sure no leftover lock state from a previous render
      removeLockOverlay(el);
      el.removeAttribute('data-locked');
      return;
    }

    if (access === 'hidden') {
      removeLockOverlay(el);
      el.hidden = true;
      el.setAttribute('data-locked', 'hidden');
      return;
    }

    if (access === 'locked-visible') {
      // Don't double-wrap if we've already locked this element.
      if (el.getAttribute('data-locked') === 'visible') return;

      var pitch = window.iboostPermissions.getPitch(featureKey, profile);
      if (!pitch) {
        // No pitch defined (e.g. score-gated feature). Caller should
        // handle these cases with custom rendering. For now, log and
        // skip — better than rendering an empty overlay.
        console.warn('[permissions-render] locked-visible but no pitch for:', featureKey);
        return;
      }
      wrapWithLockOverlay(el, featureKey, pitch, profile, plansMap);
      el.setAttribute('data-locked', 'visible');
    }
  }

  function wrapWithLockOverlay(el, featureKey, pitch, profile, plansMap) {
    // Move existing children into a content wrapper.
    var content = document.createElement('div');
    content.className = 'dash-iblock-locked-content';
    while (el.firstChild) {
      content.appendChild(el.firstChild);
    }

    // Compose the CTA dynamically from plansMap so admin price / name
    // changes flow through. The pitch only carries title + body —
    // price + plan name are NEVER hardcoded in copy. See permissions.js
    // LOCK_PITCHES comment for the contract.
    var recommendedTier = window.iboostPermissions.recommendedTier(featureKey, profile);
    var ctaText = composeCtaText(recommendedTier, profile, plansMap);

    var overlay = document.createElement('div');
    overlay.className = 'dash-iblock-locked-overlay';
    if (recommendedTier) overlay.setAttribute('data-recommended-tier', recommendedTier);

    overlay.innerHTML =
      '<div class="dash-iblock-locked-card">' +
        '<div class="dash-iblock-locked-icon" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
                'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
            '<rect x="3" y="11" width="18" height="11" rx="2"/>' +
            '<path d="M7 11V7a5 5 0 0 1 10 0v4"/>' +
          '</svg>' +
        '</div>' +
        '<h3 class="dash-iblock-locked-title">' + esc(pitch.title) + '</h3>' +
        '<p class="dash-iblock-locked-pitch">' + esc(pitch.body) + '</p>' +
        '<a href="/checkout.html?plan=' + encodeURIComponent(recommendedTier || 'essential') +
            '" class="btn btn-primary dash-iblock-locked-cta">' +
          esc(ctaText) +
        '</a>' +
        '<a href="/pricing.html" class="dash-iblock-locked-secondary">' +
          'See what\'s included' +
        '</a>' +
      '</div>';

    el.classList.add('dash-iblock-locked-host');
    el.appendChild(content);
    el.appendChild(overlay);
  }

  // Builds the CTA button text from the recommended tier's plan data,
  // respecting the user's billing currency. Falls back gracefully when
  // plans data isn't available (network failure, plans-loader disabled).
  //
  // Currency selection:
  //   - Use profile.plan_currency if set ('cad' | 'usd')
  //   - Otherwise default to 'usd' (matches checkout.js fallback)
  //
  // Output format: "Upgrade to {plan.name} — ${price}/mo"
  // Fallback (no plans data): "Upgrade to {Tier name}" (no price shown)
  function composeCtaText(recommendedTier, profile, plansMap) {
    if (!recommendedTier) return 'Upgrade';

    // Capitalized tier name as a final fallback ("essential" -> "Essential")
    var tierLabel = recommendedTier.charAt(0).toUpperCase() + recommendedTier.slice(1);

    if (!plansMap || !plansMap[recommendedTier]) {
      return 'Upgrade to ' + tierLabel;
    }

    var plan = plansMap[recommendedTier];
    // Canada-only launch: default to CAD; honor an explicit 'usd' only
    // (dormant — no live USD plans today).
    var currency = (profile && profile.plan_currency === 'usd') ? 'usd' : 'cad';
    var price = currency === 'cad' ? plan.price_cad : plan.price_usd;

    // If price is missing/null/zero, skip the price portion. Free plan
    // has price_usd: 0 — would produce weird "Upgrade for $0/mo" copy
    // but that's not a real case (lock overlays never recommend Free).
    if (price == null) {
      return 'Upgrade to ' + (plan.name || tierLabel);
    }

    return 'Upgrade to ' + (plan.name || tierLabel) + ' — $' + price + '/mo';
  }

  function removeLockOverlay(el) {
    if (!el.classList.contains('dash-iblock-locked-host')) return;
    // Unwrap: move content children back up, remove overlay
    var content = el.querySelector(':scope > .dash-iblock-locked-content');
    var overlay = el.querySelector(':scope > .dash-iblock-locked-overlay');
    if (content) {
      while (content.firstChild) {
        el.insertBefore(content.firstChild, content);
      }
      content.remove();
    }
    if (overlay) overlay.remove();
    el.classList.remove('dash-iblock-locked-host');
  }

  // Public API. Only `apply` is exposed — the other four functions are
  // implementation details. If a future caller needs finer-grained
  // access (e.g. lock a specific element), we'll add to the API at
  // that point. Keep the surface small until proven otherwise.
  window.iboostPermissionsRender = {
    apply: apply,
  };
})();
