// Education progress — per-user lesson tracking.
//
// All routes are requireAuth-gated and operate ONLY on the caller's own
// rows via req.supabase (user-scoped, RLS-applied). The lesson_id values
// are the stable registry ids defined in the frontend curriculum
// (education-curriculum.js); the backend treats them as opaque strings —
// the curriculum lives in code, not the DB.
//
// Endpoints:
//   GET  /api/education/progress          -> all of the user's progress rows
//   POST /api/education/progress          -> upsert one lesson's progress
//        body: { lesson_id, status?, percent? }
//        - status 'complete' forces percent 100 + sets completed_at
//        - otherwise status 'in_progress' with the given percent (0..100)

const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/requireAuth');
const requireAdminSharedSecret = require('../middleware/requireAdminSharedSecret');
const { supabaseAdmin } = require('../lib/supabase');

// GET /api/education/lessons — the full curriculum (chapters + published
// lessons), shaped the way the frontend curriculum registry used to be.
// requireAuth so it's members-only (education is free to all members);
// RLS also restricts the tables to authenticated reads.
router.get('/lessons', requireAuth, async function (req, res, next) {
  try {
    const { data: chapters, error: chErr } = await req.supabase
      .from('education_chapters')
      .select('id, number, title, tagline, score_gate')
      .order('number', { ascending: true });
    if (chErr) {
      return res.status(500).json({ error: 'Could not load chapters: ' + chErr.message });
    }

    const { data: lessons, error: lErr } = await req.supabase
      .from('education_lessons')
      .select('id, chapter_id, progress_key, slug, title, minutes, intro, body, sort_order, is_published')
      .eq('is_published', true)
      .order('sort_order', { ascending: true });
    if (lErr) {
      return res.status(500).json({ error: 'Could not load lessons: ' + lErr.message });
    }

    // Group lessons under their chapter, preserving sort order.
    const byChapter = {};
    (lessons || []).forEach(function (l) {
      (byChapter[l.chapter_id] = byChapter[l.chapter_id] || []).push(l);
    });

    const result = (chapters || []).map(function (ch) {
      return {
        number: ch.number,
        title: ch.title,
        tagline: ch.tagline,
        scoreGate: ch.score_gate || null,
        lessons: (byChapter[ch.id] || []).map(function (l) {
          return {
            id: l.progress_key,   // stable id used by progress + as the registry id
            slug: l.slug,
            title: l.title,
            minutes: l.minutes,
            intro: l.intro || null,
            body: l.body || [],
          };
        }),
      };
    });

    return res.json({ chapters: result });
  } catch (err) {
    return next(err);
  }
});

// GET /api/education/progress — list the caller's progress.
router.get('/progress', requireAuth, async function (req, res, next) {
  try {
    const { data, error } = await req.supabase
      .from('lesson_progress')
      .select('lesson_id, status, percent, started_at, completed_at, updated_at')
      .eq('user_id', req.user.id);
    if (error) {
      return res.status(500).json({ error: 'Could not load progress: ' + error.message });
    }
    // Return as a map keyed by lesson_id for easy overlay on the registry.
    const progress = {};
    (data || []).forEach(function (row) {
      progress[row.lesson_id] = {
        status: row.status,
        percent: row.percent,
        started_at: row.started_at,
        completed_at: row.completed_at,
        updated_at: row.updated_at,
      };
    });
    return res.json({ progress: progress });
  } catch (err) {
    return next(err);
  }
});

// POST /api/education/progress — upsert one lesson's progress.
router.post('/progress', requireAuth, async function (req, res, next) {
  try {
    const body = req.body || {};
    const lessonId = String(body.lesson_id || '').trim();
    if (!lessonId || lessonId.length > 64) {
      return res.status(400).json({ error: 'Invalid lesson_id.' });
    }

    let status = body.status === 'complete' ? 'complete' : 'in_progress';
    let percent;
    if (status === 'complete') {
      percent = 100;
    } else {
      percent = parseInt(body.percent, 10);
      if (isNaN(percent)) percent = 0;
      if (percent < 0) percent = 0;
      if (percent > 100) percent = 100;
    }

    const now = new Date().toISOString();
    const row = {
      user_id: req.user.id,
      lesson_id: lessonId,
      status: status,
      percent: percent,
      updated_at: now,
    };
    if (status === 'complete') row.completed_at = now;

    // Upsert on the (user_id, lesson_id) unique constraint. started_at
    // keeps its DB default on first insert; we don't overwrite it.
    const { data, error } = await req.supabase
      .from('lesson_progress')
      .upsert(row, { onConflict: 'user_id,lesson_id' })
      .select('lesson_id, status, percent, completed_at')
      .single();
    if (error) {
      return res.status(500).json({ error: 'Could not save progress: ' + error.message });
    }
    return res.json({ ok: true, progress: data });
  } catch (err) {
    return next(err);
  }
});

// =====================================================================
// ADMIN endpoints (admin-secret-gated, service-role writes). The admin
// service has no Supabase access for these tables, so it proxies here.
// =====================================================================

function isBlockArray(v) {
  if (!Array.isArray(v)) return false;
  return v.every(function (b) {
    return b && typeof b === 'object' && (
      typeof b.h === 'string' || typeof b.p === 'string' ||
      typeof b.callout === 'string' || Array.isArray(b.list) || Array.isArray(b.steps)
    );
  });
}

// GET /api/education/admin/lessons — full curriculum incl. unpublished,
// with chapter context. For the admin Lessons tab.
router.get('/admin/lessons', requireAdminSharedSecret, async function (req, res) {
  try {
    const { data: chapters, error: chErr } = await supabaseAdmin
      .from('education_chapters')
      .select('id, number, title, tagline, score_gate')
      .order('number', { ascending: true });
    if (chErr) return res.status(500).json({ error: chErr.message });

    const { data: lessons, error: lErr } = await supabaseAdmin
      .from('education_lessons')
      .select('id, chapter_id, progress_key, slug, title, minutes, intro, body, sort_order, is_published, updated_at')
      .order('sort_order', { ascending: true });
    if (lErr) return res.status(500).json({ error: lErr.message });

    return res.json({ chapters: chapters || [], lessons: lessons || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/education/admin/lessons — create a lesson.
router.post('/admin/lessons', requireAdminSharedSecret, async function (req, res) {
  try {
    const b = req.body || {};
    const chapterId = String(b.chapter_id || '').trim();
    const slug = String(b.slug || '').trim().toLowerCase();
    const progressKey = String(b.progress_key || '').trim();
    const title = String(b.title || '').trim();
    if (!chapterId) return res.status(400).json({ error: 'chapter_id required.' });
    if (!/^[a-z0-9-]+$/.test(slug)) return res.status(400).json({ error: 'slug must be lowercase letters, numbers, and hyphens.' });
    if (!progressKey) return res.status(400).json({ error: 'progress_key required (stable id, e.g. f7).' });
    if (!title) return res.status(400).json({ error: 'title required.' });
    const body = b.body;
    if (body != null && !isBlockArray(body)) return res.status(400).json({ error: 'body must be an array of content blocks.' });

    // Default sort_order = end of chapter.
    let sortOrder = parseInt(b.sort_order, 10);
    if (isNaN(sortOrder)) {
      const { data: last } = await supabaseAdmin
        .from('education_lessons').select('sort_order')
        .eq('chapter_id', chapterId).order('sort_order', { ascending: false }).limit(1);
      sortOrder = (last && last[0] ? last[0].sort_order + 1 : 0);
    }

    const row = {
      chapter_id: chapterId,
      slug: slug,
      progress_key: progressKey,
      title: title,
      minutes: Math.max(1, parseInt(b.minutes, 10) || 3),
      intro: b.intro ? String(b.intro) : null,
      body: Array.isArray(body) ? body : [],
      sort_order: sortOrder,
      is_published: b.is_published !== false,
    };
    const { data, error } = await supabaseAdmin
      .from('education_lessons').insert(row).select('*').single();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'A lesson with that slug or progress_key already exists.' });
      return res.status(500).json({ error: error.message });
    }
    return res.json({ ok: true, lesson: data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /api/education/admin/lessons/:id — update a lesson.
router.patch('/admin/lessons/:id', requireAdminSharedSecret, async function (req, res) {
  try {
    const id = req.params.id;
    const b = req.body || {};
    const update = { updated_at: new Date().toISOString() };
    if (b.title != null) update.title = String(b.title).trim();
    if (b.intro != null) update.intro = b.intro ? String(b.intro) : null;
    if (b.minutes != null) update.minutes = Math.max(1, parseInt(b.minutes, 10) || 3);
    if (b.is_published != null) update.is_published = !!b.is_published;
    if (b.chapter_id != null) update.chapter_id = String(b.chapter_id);
    if (b.sort_order != null) update.sort_order = parseInt(b.sort_order, 10) || 0;
    if (b.slug != null) {
      const slug = String(b.slug).trim().toLowerCase();
      if (!/^[a-z0-9-]+$/.test(slug)) return res.status(400).json({ error: 'slug must be lowercase letters, numbers, and hyphens.' });
      update.slug = slug;
    }
    if (b.body != null) {
      if (!isBlockArray(b.body)) return res.status(400).json({ error: 'body must be an array of content blocks.' });
      update.body = b.body;
    }
    const { data, error } = await supabaseAdmin
      .from('education_lessons').update(update).eq('id', id).select('*').single();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Slug already in use by another lesson.' });
      if (error.code === 'PGRST116') return res.status(404).json({ error: 'Lesson not found.' });
      return res.status(500).json({ error: error.message });
    }
    return res.json({ ok: true, lesson: data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /api/education/admin/lessons/:id — delete a lesson.
router.delete('/admin/lessons/:id', requireAdminSharedSecret, async function (req, res) {
  try {
    const { error } = await supabaseAdmin
      .from('education_lessons').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/education/admin/reorder — set sort_order for a list of lesson
// ids within a chapter. Body: { lesson_ids: [id, id, ...] }.
router.post('/admin/reorder', requireAdminSharedSecret, async function (req, res) {
  try {
    const ids = (req.body && req.body.lesson_ids) || [];
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'lesson_ids array required.' });
    for (let i = 0; i < ids.length; i++) {
      const { error } = await supabaseAdmin
        .from('education_lessons')
        .update({ sort_order: i, updated_at: new Date().toISOString() })
        .eq('id', ids[i]);
      if (error) return res.status(500).json({ error: 'Reorder failed at index ' + i + ': ' + error.message });
    }
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
