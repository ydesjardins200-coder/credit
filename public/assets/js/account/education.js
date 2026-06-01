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

    // Fetch the user's lesson progress, then render the curriculum +
    // overview from real data. If the fetch fails, render with no
    // progress (the library still works; just shows everything as
    // not-started).
    var token = session && session.access_token;

    // Load the curriculum from the DB (via the API) before rendering.
    var curriculumHost = document.getElementById('dash-edu-curriculum');
    try {
      await window.iboostEducation.load(token);
    } catch (e) {
      console.error('[education] curriculum load failed:', e);
      if (curriculumHost) {
        curriculumHost.innerHTML = '<div class="dash-edu-curriculum-loading">' +
          'We couldn\u2019t load the lessons right now. Please refresh in a moment.</div>';
      }
      return;
    }

    var progress = {};
    try {
      var cfg = window.IBOOST_CONFIG || {};
      var base = (cfg.API_BASE_URL || '').replace(/\/$/, '');
      var resp = await fetch(base + '/api/education/progress', {
        headers: {
          'Accept': 'application/json',
          'Authorization': token ? ('Bearer ' + token) : ''
        }
      });
      if (resp.ok) {
        var body = await resp.json();
        progress = (body && body.progress) || {};
      }
    } catch (e) {
      console.error('[education] progress fetch failed:', e);
    }

    renderCurriculum(progress);
    renderOverview(progress);
    renderContinue(progress);
  }

  // Update the "N of M complete" header, the bar, and the stat tiles
  // from real progress.
  function renderOverview(progress) {
    var E = window.iboostEducation;
    if (!E) return;
    var all = E.allLessons();
    var total = all.length;
    var done = all.filter(function (l) {
      var p = progress[l.id];
      return p && p.status === 'complete';
    }).length;
    var pct = total ? Math.round((done / total) * 100) : 0;
    // Minutes read = sum of minutes for completed lessons.
    var minsRead = all.reduce(function (sum, l) {
      var p = progress[l.id];
      return (p && p.status === 'complete') ? sum + l.minutes : sum;
    }, 0);

    setText('edu-progress-title', done + ' of ' + total + ' lessons complete');
    var fill = document.getElementById('edu-progress-fill');
    if (fill) fill.style.width = pct + '%';
    var bar = document.getElementById('edu-progress-bar');
    if (bar) bar.setAttribute('aria-valuenow', String(pct));
    setText('edu-stat-minutes', String(minsRead));
    setText('edu-stat-done', String(done));

    var meta;
    if (done === 0) meta = 'Start your first lesson below.';
    else if (done >= total) meta = 'You\u2019ve completed the whole library. Nicely done.';
    else meta = 'Keep going \u2014 you\u2019re building the habit.';
    setText('edu-progress-meta', meta);
  }

  // Show "continue where you left off" if there's an in-progress (not
  // complete) lesson; otherwise hide the card. Picks the most recently
  // updated in-progress lesson.
  function renderContinue(progress) {
    var E = window.iboostEducation;
    var card = document.getElementById('edu-continue');
    if (!E || !card) return;

    var candidate = null;
    E.allLessons().forEach(function (l) {
      var p = progress[l.id];
      if (p && p.status === 'in_progress') {
        if (!candidate || (p.updated_at || '') > (candidate.updated_at || '')) {
          candidate = { lesson: l, percent: p.percent || 0, updated_at: p.updated_at };
        }
      }
    });

    if (!candidate) { card.hidden = true; return; }

    var l = candidate.lesson;
    card.href = E.lessonUrl(l.slug);
    setText('edu-continue-title', l.title);
    setText('edu-continue-meta',
      'Chapter ' + l.chapterNumber + ' · ' + l.chapterTitle + ' · ' + l.minutes + ' min');
    var fill = document.getElementById('edu-continue-fill');
    if (fill) fill.style.width = (candidate.percent || 0) + '%';
    card.hidden = false;
  }

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
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
