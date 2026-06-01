/**
 * Lesson page runtime.
 *
 * Drives the single lesson template (lesson.html). Reads ?slug= from the
 * URL, looks up the lesson in the curriculum registry + its prose in the
 * content module, renders the article, and runs the progress loop:
 *
 *   - On open: mark the lesson 'in_progress' (so it shows under "Continue
 *     where you left off" on the library) — unless it's already complete.
 *   - "Mark complete": POST status=complete, then reflect it + reveal the
 *     "next lesson" path.
 *   - Prev / next navigation from the registry order.
 *
 * Auth + topbar are delegated to the shared shell modules, same as the
 * library page.
 */
(function () {
  'use strict';

  function apiBase() {
    var cfg = window.IBOOST_CONFIG || {};
    return (cfg.API_BASE_URL || '').replace(/\/$/, '');
  }

  function getSlug() {
    var params = new URLSearchParams(window.location.search);
    return (params.get('slug') || '').trim();
  }

  async function getToken() {
    try {
      if (window.iboostAuth && window.iboostAuth.getSessionSettled) {
        var s = await window.iboostAuth.getSessionSettled();
        return s && s.session && s.session.access_token;
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  async function fetchProgressFor(lessonId, token) {
    try {
      var resp = await fetch(apiBase() + '/api/education/progress', {
        headers: { 'Accept': 'application/json', 'Authorization': token ? ('Bearer ' + token) : '' }
      });
      if (!resp.ok) return null;
      var body = await resp.json();
      return (body && body.progress && body.progress[lessonId]) || null;
    } catch (e) { return null; }
  }

  async function postProgress(lessonId, payload, token) {
    var resp = await fetch(apiBase() + '/api/education/progress', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': token ? ('Bearer ' + token) : ''
      },
      body: JSON.stringify(Object.assign({ lesson_id: lessonId }, payload))
    });
    if (!resp.ok) {
      var e = await resp.json().catch(function () { return {}; });
      throw new Error(e.error || ('HTTP ' + resp.status));
    }
    return resp.json();
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Render a content body (array of blocks) to HTML. Block strings in
  // p/list/steps are trusted authored content (may contain inline tags),
  // so they are NOT escaped; headings ARE escaped for safety.
  function renderBody(blocks) {
    return (blocks || []).map(function (b) {
      if (b.h) return '<h2 class="lesson-h">' + esc(b.h) + '</h2>';
      if (b.p) return '<p class="lesson-p">' + b.p + '</p>';
      if (b.callout) return '<div class="lesson-callout">' + b.callout + '</div>';
      if (b.list) return '<ul class="lesson-list">' + b.list.map(function (i) { return '<li>' + i + '</li>'; }).join('') + '</ul>';
      if (b.steps) return '<ol class="lesson-steps">' + b.steps.map(function (i) { return '<li>' + i + '</li>'; }).join('') + '</ol>';
      return '';
    }).join('');
  }

  async function boot() {
    if (!window.iboostAuth || !window.iboostAuth.getSessionSettled) {
      console.error('[lesson] iboostAuth missing — script load order issue?');
      return;
    }
    var settled;
    try { settled = await window.iboostAuth.getSessionSettled(); }
    catch (e) { window.location.replace('/login.html'); return; }
    var session = settled && settled.session;
    var user = session && session.user;
    if (!user) { window.location.replace('/login.html'); return; }

    // Topbar (shared shell).
    var firstName = window.iboostAccountShell.deriveFirstName(user);
    var initials = window.iboostAccountShell.deriveInitials(user);
    window.iboostAccountShell.populateUserInfo(user, firstName, initials);
    window.iboostAccountShell.wireSignout();

    var E = window.iboostEducation;
    var slug = getSlug();
    var root = document.getElementById('lesson-root');
    if (!root) return;

    var token = await getToken();

    // Load the curriculum (lessons now live in the DB, fetched via API).
    try {
      await E.load(token);
    } catch (e) {
      console.error('[lesson] curriculum load failed:', e);
      root.innerHTML = '<div class="lesson-missing">' +
        '<h1>Couldn\u2019t load this lesson</h1>' +
        '<p>Please refresh in a moment.</p>' +
        '<a class="lesson-back-link" href="/account/education">\u2190 Back to the library</a>' +
        '</div>';
      return;
    }

    var lesson = E.lessonBySlug(slug);

    if (!lesson) {
      root.innerHTML = '<div class="lesson-missing">' +
        '<h1>Lesson not found</h1>' +
        '<p>We couldn\u2019t find that lesson. It may have moved.</p>' +
        '<a class="lesson-back-link" href="/account/education">\u2190 Back to the library</a>' +
        '</div>';
      return;
    }

    document.title = lesson.title + ' — iBoost';

    // Content now arrives with the lesson (body + intro from the DB).
    var content = (lesson.body && lesson.body.length) ? { intro: lesson.intro, body: lesson.body } : null;
    var neighbors = E.neighbors(slug);

    // Existing progress (to reflect completed state on load).
    var existing = await fetchProgressFor(lesson.id, token);
    var alreadyComplete = existing && existing.status === 'complete';

    // Mark in_progress on open (unless already complete). Fire-and-forget;
    // failure just means "continue where you left off" won't update.
    if (!alreadyComplete) {
      postProgress(lesson.id, { status: 'in_progress', percent: existing ? existing.percent : 5 }, token)
        .catch(function (e) { console.error('[lesson] mark in_progress failed:', e); });
    }

    renderLesson(root, lesson, content, neighbors, alreadyComplete, token);
  }

  function renderLesson(root, lesson, content, neighbors, alreadyComplete, token) {
    var E = window.iboostEducation;

    var bodyHtml = content
      ? (content.intro ? '<p class="lesson-intro">' + content.intro + '</p>' : '') + renderBody(content.body)
      : '<div class="lesson-soon">' +
          '<p>This lesson is being written and will be available shortly.</p>' +
          '<p>In the meantime, explore the other lessons in the library.</p>' +
        '</div>';

    var nextHtml = '';
    if (neighbors.next) {
      nextHtml =
        '<a class="lesson-next-card" href="' + E.lessonUrl(neighbors.next.slug) + '">' +
          '<span class="lesson-next-eye">Next lesson</span>' +
          '<span class="lesson-next-title">' + esc(neighbors.next.title) + '</span>' +
          '<span class="lesson-next-meta">' + neighbors.next.minutes + ' min · Chapter ' + neighbors.next.chapterNumber + '</span>' +
        '</a>';
    } else {
      nextHtml = '<div class="lesson-next-card lesson-next-end">' +
        '<span class="lesson-next-eye">That\u2019s the last lesson</span>' +
        '<span class="lesson-next-title">You\u2019ve reached the end of the library.</span>' +
        '</div>';
    }

    var prevHtml = neighbors.prev
      ? '<a class="lesson-prev-link" href="' + E.lessonUrl(neighbors.prev.slug) + '">\u2190 ' + esc(neighbors.prev.title) + '</a>'
      : '<span></span>';

    root.innerHTML =
      '<a class="lesson-back-link" href="/account/education">\u2190 Back to the library</a>' +
      '<div class="lesson-eyebrow">Chapter ' + lesson.chapterNumber + ' · ' + esc(lesson.chapterTitle) +
        ' · ' + lesson.minutes + ' min read</div>' +
      '<h1 class="lesson-title">' + esc(lesson.title) + '</h1>' +
      '<article class="lesson-article">' + bodyHtml + '</article>' +
      '<div class="lesson-complete-row">' +
        '<button type="button" class="lesson-complete-btn" id="lesson-complete-btn"' +
          (alreadyComplete ? ' data-done="1"' : '') + '>' +
          (alreadyComplete ? '\u2713 Completed' : 'Mark as complete') +
        '</button>' +
        '<div class="lesson-complete-alert" id="lesson-complete-alert"></div>' +
      '</div>' +
      '<div class="lesson-nav">' + prevHtml + nextHtml + '</div>';

    var btn = document.getElementById('lesson-complete-btn');
    if (btn && !alreadyComplete) {
      btn.addEventListener('click', async function () {
        btn.disabled = true;
        var prev = btn.textContent;
        btn.textContent = 'Saving…';
        try {
          await postProgress(lesson.id, { status: 'complete' }, token);
          btn.textContent = '\u2713 Completed';
          btn.setAttribute('data-done', '1');
          btn.disabled = true;
        } catch (e) {
          btn.disabled = false;
          btn.textContent = prev;
          var alertEl = document.getElementById('lesson-complete-alert');
          if (alertEl) alertEl.textContent = 'Could not save — please try again.';
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
