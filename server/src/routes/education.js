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

module.exports = router;
