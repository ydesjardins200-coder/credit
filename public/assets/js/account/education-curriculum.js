/**
 * Education curriculum — runtime access to the lesson library.
 *
 * As of the Education CMS migration, the curriculum + content live in the
 * DB (education_chapters + education_lessons) and are managed from the
 * admin. This module no longer hardcodes the curriculum; it fetches it
 * from GET /api/education/lessons and exposes the same helper API the
 * rest of the education frontend already uses.
 *
 * Usage:
 *   await window.iboostEducation.load(token);   // fetch + populate (once)
 *   window.iboostEducation.chapters;            // then read as before
 *
 * The helpers (allLessons, neighbors, lessonBySlug, chapterLocked,
 * lessonUrl, totalLessons, …) are unchanged in behaviour — they just read
 * the loaded data instead of a hardcoded array. Lesson bodies/intros now
 * arrive on each lesson object (body, intro), so the separate content
 * module is no longer needed.
 *
 * Pattern: IIFE, exposed via window.iboostEducation.
 */
(function () {
  'use strict';

  var CHAPTERS = [];   // populated by load()
  var loaded = false;
  var loadingPromise = null;

  function apiBase() {
    var cfg = window.IBOOST_CONFIG || {};
    return (cfg.API_BASE_URL || '').replace(/\/$/, '');
  }

  // Fetch the curriculum from the API and populate CHAPTERS. Idempotent:
  // repeated calls return the same in-flight/settled promise.
  function load(token) {
    if (loaded) return Promise.resolve(CHAPTERS);
    if (loadingPromise) return loadingPromise;
    loadingPromise = (async function () {
      var headers = { 'Accept': 'application/json' };
      if (token) headers.Authorization = 'Bearer ' + token;
      var resp = await fetch(apiBase() + '/api/education/lessons', { headers: headers });
      if (!resp.ok) {
        loadingPromise = null;
        throw new Error('Could not load curriculum (HTTP ' + resp.status + ')');
      }
      var body = await resp.json();
      CHAPTERS = (body && body.chapters) || [];
      loaded = true;
      return CHAPTERS;
    })();
    return loadingPromise;
  }

  // ---- Derived helpers (computed, unchanged behaviour) ------------------

  function allLessons() {
    var out = [];
    CHAPTERS.forEach(function (ch) {
      (ch.lessons || []).forEach(function (ls, idx) {
        out.push({
          id: ls.id,
          slug: ls.slug,
          title: ls.title,
          minutes: ls.minutes,
          intro: ls.intro || null,
          body: ls.body || [],
          chapterNumber: ch.number,
          chapterTitle: ch.title,
          indexInChapter: idx + 1,
          scoreGate: ch.scoreGate || null
        });
      });
    });
    return out;
  }

  function totalLessons() { return allLessons().length; }
  function totalMinutes() { return allLessons().reduce(function (s, l) { return s + l.minutes; }, 0); }
  function chapterMinutes(ch) { return (ch.lessons || []).reduce(function (s, l) { return s + l.minutes; }, 0); }

  function lessonById(id) { return allLessons().filter(function (l) { return l.id === id; })[0] || null; }
  function lessonBySlug(slug) { return allLessons().filter(function (l) { return l.slug === slug; })[0] || null; }

  function neighbors(slug) {
    var list = allLessons();
    var i = -1;
    for (var k = 0; k < list.length; k++) { if (list[k].slug === slug) { i = k; break; } }
    if (i === -1) return { prev: null, next: null };
    return {
      prev: i > 0 ? list[i - 1] : null,
      next: i < list.length - 1 ? list[i + 1] : null
    };
  }

  function chapterLocked(ch, userScore) {
    if (!ch.scoreGate) return false;
    if (userScore == null) return true;
    return userScore < ch.scoreGate;
  }

  function lessonUrl(slug) {
    return '/account/education/lesson.html?slug=' + encodeURIComponent(slug);
  }

  window.iboostEducation = {
    load: load,
    get chapters() { return CHAPTERS; },
    allLessons: allLessons,
    totalLessons: totalLessons,
    totalMinutes: totalMinutes,
    chapterMinutes: chapterMinutes,
    lessonById: lessonById,
    lessonBySlug: lessonBySlug,
    neighbors: neighbors,
    chapterLocked: chapterLocked,
    lessonUrl: lessonUrl
  };
})();
