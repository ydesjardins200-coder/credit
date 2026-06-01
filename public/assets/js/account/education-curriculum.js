/**
 * Education curriculum registry — the SINGLE SOURCE OF TRUTH for the
 * lesson library.
 *
 * Everything reads from here:
 *   - the Education library page (chapters, lessons, counts, durations)
 *   - each lesson page (its own metadata + prev/next nav)
 *   - progress overview ("N of M complete", the bar) once DB progress
 *     tracking is wired (Step 2) — progress overlays this registry by id.
 *
 * NOTHING about the curriculum should be hardcoded anywhere else. To add,
 * remove, or reorder a lesson, edit ONLY this file (and write the matching
 * lesson page). The library + progress math recompute automatically.
 *
 * Curriculum approved 2026-06 — 17 lessons across 4 chapters, matching the
 * 4-chapter structure in docs/tier-feature-matrix.md (Foundations /
 * Building fast levers / Building & sustaining / Mortgage readiness).
 *
 * Lesson IDs are STABLE — they key DB progress rows, so never renumber or
 * reuse an id once it has shipped. Slugs map to the lesson page filename
 * (/account/education/<slug>.html).
 *
 * `scoreGate` on a chapter = the credit score required to unlock it. Real
 * gating needs the user's bureau score (integration pending), so a gated
 * chapter currently locks for everyone — same behaviour as the original
 * mockup. When the bureau lands, the library reads the real score.
 *
 * Pattern: IIFE, exposed via window.iboostEducation (matches the other
 * shared/data modules).
 */
(function () {
  'use strict';

  var CHAPTERS = [
    {
      number: 1,
      title: 'Foundations',
      tagline: 'Start here if you\u2019re new to credit.',
      lessons: [
        { id: 'f1', slug: 'what-a-credit-score-measures', title: 'What a credit score actually measures', minutes: 3 },
        { id: 'f2', slug: 'five-factors-ranked', title: 'The five factors, ranked by impact', minutes: 4 },
        { id: 'f3', slug: 'utilization-calculated', title: 'How credit utilization is really calculated', minutes: 4 },
        { id: 'f4', slug: 'hard-vs-soft-pulls', title: 'Hard pulls vs soft pulls \u2014 and when each matters', minutes: 3 },
        { id: 'f5', slug: 'reading-your-report', title: 'Reading your credit report without panicking', minutes: 8 },
        { id: 'f6', slug: 'credit-canada-vs-us', title: 'Credit in Canada vs the US \u2014 what\u2019s different', minutes: 4 }
      ]
    },
    {
      number: 2,
      title: 'The fast levers',
      tagline: 'Things you can change this week to nudge your score up.',
      lessons: [
        { id: 'l1', slug: 'when-to-pay-your-card', title: 'When to actually pay your credit card', minutes: 3 },
        { id: 'l2', slug: 'credit-limit-increase', title: 'Asking for a credit limit increase the right way', minutes: 4 },
        { id: 'l3', slug: 'disputing-an-error', title: 'Disputing an error on your report', minutes: 5 },
        { id: 'l4', slug: 'thin-file-quick-wins', title: 'The quickest wins for a thin credit file', minutes: 4 }
      ]
    },
    {
      number: 3,
      title: 'Building & sustaining',
      tagline: 'The longer game \u2014 habits that compound.',
      lessons: [
        { id: 'b1', slug: 'history-that-compounds', title: 'Building credit history that compounds', minutes: 5 },
        { id: 'b2', slug: 'new-accounts-and-closures', title: 'How new accounts and closures move your score', minutes: 4 },
        { id: 'b3', slug: 'recovering-after-a-miss', title: 'Recovering after a missed payment or collection', minutes: 6 },
        { id: 'b4', slug: 'avoiding-credit-scams', title: 'Avoiding the common credit-repair scams', minutes: 5 }
      ]
    },
    {
      number: 4,
      title: 'Mortgage readiness',
      tagline: 'For when you\u2019ve stabilized and want to optimize.',
      scoreGate: 700,
      lessons: [
        { id: 'm1', slug: 'beyond-the-score', title: 'What lenders look for beyond the score', minutes: 5 },
        { id: 'm2', slug: 'file-mortgage-ready', title: 'Getting your file mortgage-ready', minutes: 6 },
        { id: 'm3', slug: 'debt-to-income', title: 'Debt-to-income and how it\u2019s assessed', minutes: 5 }
      ]
    }
  ];

  // ---- Derived helpers (computed, never hardcoded) ----------------------

  // Flat list of every lesson with its chapter context attached, in
  // curriculum order. Useful for prev/next nav and "continue" logic.
  function allLessons() {
    var out = [];
    CHAPTERS.forEach(function (ch) {
      ch.lessons.forEach(function (ls, idx) {
        out.push({
          id: ls.id,
          slug: ls.slug,
          title: ls.title,
          minutes: ls.minutes,
          chapterNumber: ch.number,
          chapterTitle: ch.title,
          indexInChapter: idx + 1,
          scoreGate: ch.scoreGate || null
        });
      });
    });
    return out;
  }

  function totalLessons() {
    return allLessons().length;
  }

  function totalMinutes() {
    return allLessons().reduce(function (sum, l) { return sum + l.minutes; }, 0);
  }

  function chapterMinutes(ch) {
    return ch.lessons.reduce(function (sum, l) { return sum + l.minutes; }, 0);
  }

  // Look a lesson up by id or slug (lesson pages identify themselves by
  // slug; DB progress rows key by id).
  function lessonById(id) {
    return allLessons().filter(function (l) { return l.id === id; })[0] || null;
  }
  function lessonBySlug(slug) {
    return allLessons().filter(function (l) { return l.slug === slug; })[0] || null;
  }

  // Prev/next in curriculum order (for in-lesson navigation).
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

  // Is a chapter locked for a given score? (score may be null/unknown ->
  // gated chapters lock until we have a real bureau score.)
  function chapterLocked(ch, userScore) {
    if (!ch.scoreGate) return false;
    if (userScore == null) return true; // no score yet -> locked
    return userScore < ch.scoreGate;
  }

  function lessonUrl(slug) {
    return '/account/education/' + slug + '.html';
  }

  window.iboostEducation = {
    chapters: CHAPTERS,
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
