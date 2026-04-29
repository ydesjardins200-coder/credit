/**
 * Shared DOM utilities — Phase A of account-page architecture refactor.
 *
 * This module is the FIRST file in `public/assets/js/shared/`. Functions
 * here are pure (no DOM lookups, no side effects) and meant to be used by
 * any page that builds HTML strings or alert UIs.
 *
 * Why a separate module rather than packing into an existing lib:
 * - `lib/budget.js` is budget-domain. These utilities are domain-agnostic.
 * - `lib/permissions.js` is tier-gating. Same reason.
 * - We want a clear boundary between "shared everywhere" (this dir) and
 *   "feature-specific lib" (lib/).
 *
 * Pattern: same as the existing libs — IIFE, expose via window.iboostShared.
 * Pages opt in by loading this script before their page-specific code.
 *
 * See docs/account-architecture.md for the full refactor plan.
 */
(function () {
  'use strict';

  /**
   * Escape a string for safe insertion into HTML.
   *
   * Used pervasively when building HTML via string concatenation. Replaces
   * the inline copies that previously lived in account.js and checkout.js
   * (byte-identical, classic shared-utility candidate).
   *
   * Behavior:
   *   - null / undefined -> empty string (NOT 'null'/'undefined')
   *   - non-string values are coerced via String()
   *   - escapes all five HTML-significant characters: & < > " '
   *
   * Example:
   *   escapeHtml('<script>')        -> '&lt;script&gt;'
   *   escapeHtml(null)              -> ''
   *   escapeHtml(42)                -> '42'
   *   escapeHtml('"hi"')            -> '&quot;hi&quot;'
   */
  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /**
   * Show a message inside an alert element.
   *
   * Replaces the inline copies in complete-profile.js, login.js, signup.js
   * which were byte-identical (same className toggle, same textContent
   * assignment, same hidden flag).
   *
   * The original copies closed over a top-level `alertEl` ref. The shared
   * version takes the element as the first argument so it works with any
   * page's alert div.
   *
   * @param {HTMLElement} alertEl - the element to show the alert in
   * @param {string} message       - the text to display
   * @param {'success'|'error'} [kind='error'] - which CSS class to apply
   */
  function showAlert(alertEl, message, kind) {
    if (!alertEl) return;
    alertEl.className = 'alert ' + (kind === 'success' ? 'alert-success' : 'alert-error');
    alertEl.textContent = message;
    alertEl.hidden = false;
  }

  /**
   * Hide the alert element. Symmetric with showAlert.
   *
   * @param {HTMLElement} alertEl - the element to clear and hide
   */
  function clearAlert(alertEl) {
    if (!alertEl) return;
    alertEl.hidden = true;
    alertEl.textContent = '';
  }

  // Expose. Pattern matches lib/budget.js (window.iboostBudget),
  // lib/permissions.js (window.iboostPermissions), etc. The "shared"
  // namespace makes the intent obvious vs the feature-specific libs.
  window.iboostShared = {
    escapeHtml: escapeHtml,
    showAlert: showAlert,
    clearAlert: clearAlert,
  };
})();
