/**
 * Offers page — standalone page boot.
 *
 * Third per-tab page extracted from account.html (Phase D-2b of the
 * account-architecture refactor; see docs/account-architecture.md).
 *
 * Like Education (Phase C), Offers has NO tab-specific JS in the
 * monolith — it's pure HTML/CSS mockup content. So this file's job
 * is purely the boot routine: auth gating, populate user info, wire
 * signout. All of which are delegated to shared modules
 * (window.iboostShared, window.iboostAccountShell).
 *
 * If/when Offers gets dynamic content in the future (real affiliate
 * inventory, profile-based matching, click tracking), that logic
 * comes here.
 *
 * Why this file is small: Phases A and B encapsulated the boot
 * routine. This file is mostly orchestration — get the user, derive
 * name, populate, wire signout. No business logic.
 */
(function () {
  'use strict';

  async function boot() {
    if (!window.iboostAuth || !window.iboostAuth.getSessionSettled) {
      console.error('[offers] iboostAuth missing — script load order issue?');
      return;
    }

    var settled;
    try {
      settled = await window.iboostAuth.getSessionSettled();
    } catch (e) {
      console.error('[offers] session fetch failed:', e);
      window.location.replace('/login.html');
      return;
    }

    var session = settled && settled.session;
    var user = session && session.user;

    if (!user) {
      window.location.replace('/login.html');
      return;
    }

    var firstName = window.iboostAccountShell.deriveFirstName(user);
    var initials = window.iboostAccountShell.deriveInitials(user);
    window.iboostAccountShell.populateUserInfo(user, firstName, initials);
    window.iboostAccountShell.wireSignout();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
