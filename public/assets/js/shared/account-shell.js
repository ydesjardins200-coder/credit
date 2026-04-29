/**
 * Account shell — Phase B of account-page architecture refactor.
 *
 * This module provides the shared infrastructure that's identical across
 * every account-page tab:
 *   - User-name and initial derivation from Supabase session metadata
 *   - Top-bar population (name, email, avatar)
 *   - Sign-out button wiring + cross-tab SIGNED_OUT handler
 *
 * Phase B (this commit): extract this code into the shared layer and
 * have account.js use the shared versions. The monolith continues to
 * work; we now have one source of truth.
 *
 * Phase C+ (future): when individual tabs become standalone pages
 * (/account/profile, /account/budget, etc.), each page imports this
 * module and calls the same boot routines. No code duplication across
 * pages.
 *
 * What's NOT in this module (deliberately):
 *   - Tab navigation (initTabs, activateTab, etc.) — these are
 *     specific to the multi-tab monolith and will be REPLACED by real
 *     URL navigation when we go per-page. Extracting them now would
 *     create a shared module that becomes obsolete in Phase D.
 *   - Welcome-tab-specific features (day counter, KYC form). They
 *     touch tab-specific DOM IDs and belong with the Welcome tab.
 *   - Permission gating (applyPermissions). Lives in lib/permissions.js
 *     already.
 *
 * Pattern: IIFE, expose via window.iboostAccountShell. Same convention
 * as window.iboostShared (Phase A) and window.iboostBudget,
 * window.iboostPermissions, etc.
 *
 * See docs/account-architecture.md for the full refactor plan.
 */
(function () {
  'use strict';

  /**
   * Derive a display name from a Supabase session user.
   *
   * Used for greetings, top-bar name, etc. Falls back through several
   * fields with deterministic priority so behavior is stable across
   * sessions:
   *   1. user_metadata.first_name (set during signup form)
   *   2. user_metadata.full_name (Google OAuth provides this)
   *   3. user_metadata.name (some other OAuth providers)
   *   4. email prefix (everything before the @)
   *   5. literal 'there' (last resort, shows in 'Welcome there.' format
   *      which is awkward but not broken)
   *
   * @param {object|null} user - Supabase user object (session.user)
   * @returns {string} a non-empty display name
   */
  function deriveFirstName(user) {
    if (!user) return 'there';
    var m = user.user_metadata || {};
    if (m.first_name) return m.first_name;
    if (m.full_name) return m.full_name.split(' ')[0];
    if (m.name) return m.name.split(' ')[0];
    if (user.email) return user.email.split('@')[0];
    return 'there';
  }

  /**
   * Derive 1-2 letter initials for the avatar circle.
   *
   * Priority (matches deriveFirstName):
   *   - full_name -> first letter of first word + first letter of last word
   *   - name -> same logic
   *   - first_name + last_name (concatenated) -> same
   *   - email (treated as a single word) -> first 2 chars
   *   - empty -> '·' (U+00B7 middle dot, visually neutral)
   *
   * Always uppercase. Always returns at least one character.
   *
   * @param {object|null} user
   * @returns {string} 1-2 character initials
   */
  function deriveInitials(user) {
    if (!user) return '·';
    var m = user.user_metadata || {};
    var source =
      m.full_name ||
      m.name ||
      ((m.first_name || '') + ' ' + (m.last_name || '')).trim() ||
      user.email ||
      '';
    var parts = source.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    if (parts.length === 1 && parts[0].length >= 2) {
      return parts[0].substring(0, 2).toUpperCase();
    }
    if (parts.length === 1) {
      return parts[0][0].toUpperCase();
    }
    return '·';
  }

  /**
   * Populate the top-bar user info elements (name, email, avatar).
   *
   * Looks up the standard element IDs and writes display values. Each
   * lookup is defensive — missing elements are silently skipped, so
   * future per-tab pages that omit one of these (e.g. a minimal page
   * without an avatar) won't crash.
   *
   * @param {object} user - Supabase user object
   * @param {string} firstName - pre-computed display name
   * @param {string} initials - pre-computed avatar initials
   */
  function populateUserInfo(user, firstName, initials) {
    var emailEl = document.getElementById('user-email');
    if (emailEl) emailEl.textContent = (user && user.email) || '(no email)';

    var nameEl = document.getElementById('user-name');
    if (nameEl) nameEl.textContent = firstName;

    var avatarEl = document.getElementById('user-avatar');
    if (avatarEl) avatarEl.textContent = initials;
  }

  /**
   * Wire the sign-out button + cross-tab SIGNED_OUT handler.
   *
   * Behavior:
   *   - Click signout-btn → disable button, sign out via iboostAuth,
   *     redirect to /login.html
   *   - Listen for SIGNED_OUT events from other tabs (user clicks
   *     sign out in tab A → tab B should also redirect to login)
   *   - Deliberately does NOT redirect on INITIAL_SESSION-with-null
   *     events — Supabase fires INITIAL_SESSION with session=null
   *     during OAuth hash processing, and bouncing on that would
   *     break OAuth returns. SIGNED_OUT is the only signal that
   *     means 'user deliberately ended their session'.
   *
   * Idempotent: safe to call multiple times. The button-click
   * listener uses a one-shot disabled flag so accidental double-clicks
   * don't double-sign-out.
   */
  function wireSignout() {
    var signoutBtn = document.getElementById('signout-btn');
    if (signoutBtn && !signoutBtn.dataset.shellWired) {
      signoutBtn.dataset.shellWired = '1';
      signoutBtn.addEventListener('click', async function () {
        signoutBtn.disabled = true;
        if (window.iboostAuth && window.iboostAuth.signOut) {
          await window.iboostAuth.signOut();
        }
        window.location.replace('/login.html');
      });
    }

    if (window.iboostAuth && window.iboostAuth.onAuthChange) {
      window.iboostAuth.onAuthChange(function (event) {
        if (event === 'SIGNED_OUT') {
          window.location.replace('/login.html');
        }
      });
    }
  }

  // Expose. Pattern matches window.iboostShared (Phase A),
  // window.iboostBudget, window.iboostPermissions, etc.
  window.iboostAccountShell = {
    deriveFirstName: deriveFirstName,
    deriveInitials: deriveInitials,
    populateUserInfo: populateUserInfo,
    wireSignout: wireSignout,
  };
})();
