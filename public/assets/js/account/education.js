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

    // Render the curriculum from the registry (single source of truth).
    // Progress overlay (per-lesson % + the overview bar) lands in Step 2
    // when DB tracking is wired; for now lessons render with no progress
    // state and the links point to the lesson pages.
    renderCurriculum(null);
  }

  // Build the full curriculum from window.iboostEducation. `progress` is
  // an optional map of { lessonId: { status, percent } } — null until DB
  // tracking exists. A score (for unlocking gated chapters) will likewise
  // come from the bureau integration later; null = gated chapters lock.
  function renderCurriculum(progress) {
    var host = document.getElementById('dash-edu-curriculum');
    var E = window.iboostEducation;
    if (!host || !E) return;
    progress = progress || {};
    var userScore = null; // no bureau score yet -> gated chapters lock

    var arrow =
      '<div class="dash-edu-lesson-arrow">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<polyline points="9 18 15 12 9 6"/>' +
        '</svg>' +
      '</div>';

    var html = E.chapters.map(function (ch) {
      var locked = E.chapterLocked(ch, userScore);
      var count = ch.lessons.length;
      var mins = E.chapterMinutes(ch);
      var head =
        '<div class="dash-edu-chapter-head">' +
          '<div class="dash-edu-chapter-title-row">' +
            '<span class="dash-edu-chapter-num">' + ch.number + '</span>' +
            '<h3>' + escapeHtml(ch.title) + '</h3>' +
          '</div>' +
          '<p class="dash-edu-chapter-tagline">' + escapeHtml(ch.tagline) +
            ' ' + count + ' lesson' + (count === 1 ? '' : 's') + ' · ' + mins + ' min total.</p>' +
        '</div>';

      if (locked) {
        var gateMsg = 'Reach a score of ' + ch.scoreGate +
          ' to unlock this chapter. We\u2019ll show your progress here once your credit file is connected.';
        return '<article class="dash-edu-chapter dash-edu-chapter-locked">' +
          head +
          '<div class="dash-edu-locked-banner">' + escapeHtml(gateMsg) + '</div>' +
        '</article>';
      }

      var lessons = ch.lessons.map(function (ls) {
        var p = progress[ls.id] || null;
        var stateClass = '';
        var progressLabel = 'Not started';
        if (p && p.status === 'complete') { stateClass = ' dash-edu-lesson-done'; progressLabel = '100%'; }
        else if (p && p.percent > 0) { stateClass = ' dash-edu-lesson-current'; progressLabel = p.percent + '%'; }
        return '<a href="' + E.lessonUrl(ls.slug) + '" class="dash-edu-lesson' + stateClass + '">' +
            '<div class="dash-edu-lesson-icon"></div>' +
            '<div class="dash-edu-lesson-body">' +
              '<h4 class="dash-edu-lesson-title">' + escapeHtml(ls.title) + '</h4>' +
              '<div class="dash-edu-lesson-progress">' + progressLabel + '</div>' +
            '</div>' +
            '<div class="dash-edu-lesson-time">' + ls.minutes + ' min</div>' +
            arrow +
          '</a>';
      }).join('');

      return '<article class="dash-edu-chapter">' + head +
        '<div class="dash-edu-lessons">' + lessons + '</div>' +
      '</article>';
    }).join('');

    host.innerHTML = html;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Run on DOMContentLoaded. The shared shell modules are deferred
  // so they're guaranteed to have run by the time this fires.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
