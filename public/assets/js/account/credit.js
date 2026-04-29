/**
 * Credit page — standalone page boot.
 *
 * Fifth per-tab page extracted from account.html (Phase D-4 of the
 * account-architecture refactor; see docs/account-architecture.md).
 *
 * Like Education and Offers, Credit has NO tab-specific JS in the
 * monolith — the panel is pure HTML/CSS mockup content (mock score
 * data, mock action items, etc.). What makes Credit different from
 * Education/Offers is the data-feature="credit.tab" attribute on
 * the panel root: Free users see the entire page covered by the
 * lock overlay with an "Upgrade to Essential" CTA.
 *
 * For the lock overlay to render, this page MUST load:
 *   - lib/permissions.js (window.iboostPermissions logic layer)
 *   - shared/permissions-render.js (window.iboostPermissionsRender)
 *   - plans-loader.js (window.iboostPlans for the price+name in CTA)
 *
 * After auth resolves, we fetch the profile + plans map (same pattern
 * as the monolith's init()), then call iboostPermissionsRender.apply()
 * which scans for [data-feature] elements and applies the overlay
 * to whichever access state the user has:
 *   - 'allowed' (paid users): leave the panel alone, full Credit
 *     dashboard visible
 *   - 'locked-visible' (free users): wrap the panel in the lock
 *     overlay with the Upgrade CTA
 *
 * The permissions-render module is the same one used (currently
 * unused) by the monolith — Phase D-1a promoted it to shared so
 * future per-tab pages could use it. Credit is the first such page.
 */
(function () {
  'use strict';

  async function boot() {
    if (!window.iboostAuth || !window.iboostAuth.getSessionSettled) {
      console.error('[credit] iboostAuth missing — script load order issue?');
      return;
    }

    var settled;
    try {
      settled = await window.iboostAuth.getSessionSettled();
    } catch (e) {
      console.error('[credit] session fetch failed:', e);
      window.location.replace('/login.html');
      return;
    }

    var session = settled && settled.session;
    var user = session && session.user;

    if (!user) {
      window.location.replace('/login.html');
      return;
    }

    // Top-bar via shell helpers (same pattern as Education / Profile / Offers)
    var firstName = window.iboostAccountShell.deriveFirstName(user);
    var initials = window.iboostAccountShell.deriveInitials(user);
    window.iboostAccountShell.populateUserInfo(user, firstName, initials);
    window.iboostAccountShell.wireSignout();

    // Fetch profile + plansMap to drive the lock overlay. Same pattern
    // as the monolith's init() — profile determines access, plansMap
    // feeds the upgrade CTA's price + plan name. Both fetches are
    // best-effort: if profile fails, treat as Free (locks). If plansMap
    // fails, the CTA falls back to "Upgrade to Essential" without a
    // price — degraded but not broken.
    var profile = null;
    try {
      profile = await window.iboostAuth.getProfile();
    } catch (e) {
      console.error('[credit] profile fetch failed (treating as free):', e);
    }
    var plansMap = null;
    try {
      if (window.iboostPlans) {
        plansMap = await window.iboostPlans.getPlansMap({ fresh: true });
      }
    } catch (e) {
      console.error('[credit] plansMap fetch failed:', e);
    }

    // Apply permissions — scans for [data-feature] elements and applies
    // the lock overlay to the panel for Free users. For paid users,
    // this is a no-op (panel stays unwrapped).
    if (window.iboostPermissionsRender) {
      window.iboostPermissionsRender.apply(profile, plansMap);
    } else {
      console.warn('[credit] iboostPermissionsRender missing — gating disabled');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
