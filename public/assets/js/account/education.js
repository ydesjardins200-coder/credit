/**
 * Education page — standalone page boot.
 *
 * First per-tab page extracted from account.html (Phase C of the
 * account-architecture refactor; see docs/account-architecture.md).
 *
 * Education was chosen as the proof-of-concept target because it has
 * NO tab-specific JS in the monolith — it's pure HTML/CSS. So this
 * file's job is purely the boot routine: auth gating, populate user
 * info, wire signout. All of which are delegated to shared modules
 * (window.iboostShared, window.iboostAccountShell).
 *
 * If/when Education gets dynamic content in the future (real lesson
 * tracking, search, progress sync), that logic comes here.
 *
 * Why this file is so small:
 *   The shell modules (Phase B) already encapsulate the boot routine.
 *   This file is mostly orchestration — get the user, derive name,
 *   populate, wire signout. No business logic.
 */
(function () {
  'use strict';

  async function boot() {
    // Wait for auth to settle. iboostAuth resolves to a session
    // (or null if unauthenticated). Same pattern as account.js's
    // current init() flow.
    if (!window.iboostAuth || !window.iboostAuth.getSessionSettled) {
      console.error('[education] iboostAuth missing — script load order issue?');
      return;
    }

    var settled;
    try {
      settled = await window.iboostAuth.getSessionSettled();
    } catch (e) {
      console.error('[education] session fetch failed:', e);
      window.location.replace('/login.html');
      return;
    }

    var session = settled && settled.session;
    var user = session && session.user;

    if (!user) {
      // Unauthenticated — bounce to login. Same behavior as account.html.
      window.location.replace('/login.html');
      return;
    }

    // Populate top-bar via shell helpers. These are byte-identical to
    // what account.html does in its init() — using the same shared
    // module guarantees parity.
    var firstName = window.iboostAccountShell.deriveFirstName(user);
    var initials = window.iboostAccountShell.deriveInitials(user);
    window.iboostAccountShell.populateUserInfo(user, firstName, initials);
    window.iboostAccountShell.wireSignout();
  }

  // Run on DOMContentLoaded. The shared shell modules are deferred
  // so they're guaranteed to have run by the time this fires.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
