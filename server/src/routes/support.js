// Customer-side support (customer-service cases).
//
//   POST /api/support/cases             create a case + first message
//   GET  /api/support/cases/mine        list the caller's cases
//   GET  /api/support/cases/:id         one case + its message thread
//   POST /api/support/cases/:id/messages   customer posts a reply
//   POST /api/support/cases/:id/read    clear the caller's unread flag
//   POST /api/support/cases/:id/rating  rate a resolved case (1–5)
//
// All routes are requireAuth-gated and operate ONLY on the caller's own
// cases. We use req.supabase (user-scoped, RLS-applied) for reads/writes
// where RLS already enforces ownership, and never accept a user_id from
// the client.
//
// Agent-authored messages and status changes are NOT handled here —
// those come through the admin backend (service key). This file is the
// customer's side of the conversation only.

'use strict';

const express = require('express');
const router = express.Router();

const requireAuth = require('../middleware/requireAuth');

const MAX_BODY = 5000;       // a single message
const MAX_SUBJECT = 200;

function looksLikeUuid(s) {
  return typeof s === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

// ---- POST /api/support/cases -------------------------------------------
// Body: { subject?, category?, body }  — body (the question) required.
// Creates the case, then the first ('customer') message. The case starts
// open + unread_by_agent=true (default), so it surfaces in the admin CS
// tab immediately.
router.post('/cases', requireAuth, async function (req, res, next) {
  try {
    const userId = req.user.id;
    const body = (req.body && req.body.body ? String(req.body.body) : '').trim();
    const subject = (req.body && req.body.subject ? String(req.body.subject) : '').trim();
    const category = (req.body && req.body.category ? String(req.body.category) : '').trim();

    if (!body) {
      return res.status(400).json({ error: 'A message is required.' });
    }
    if (body.length > MAX_BODY) {
      return res.status(400).json({ error: 'Message is too long.' });
    }
    if (subject.length > MAX_SUBJECT) {
      return res.status(400).json({ error: 'Subject is too long.' });
    }

    // Insert the case. case_number/status/unread flags use DB defaults.
    const { data: caseRow, error: caseErr } = await req.supabase
      .from('support_cases')
      .insert({
        user_id: userId,
        subject: subject || null,
        category: category || null,
      })
      .select('id, case_number, status, created_at')
      .single();

    if (caseErr) {
      return res.status(500).json({ error: 'Could not create case: ' + caseErr.message });
    }

    // Insert the first message (the customer's question).
    const { error: msgErr } = await req.supabase
      .from('support_messages')
      .insert({
        case_id: caseRow.id,
        author_type: 'customer',
        author_id: userId,
        body: body,
      });

    if (msgErr) {
      // The case exists but the message failed — surface it; the case
      // will show empty in admin, which is recoverable, but tell the
      // client it didn't fully succeed.
      return res.status(500).json({
        error: 'Case created but message failed to save: ' + msgErr.message,
        case_id: caseRow.id,
        case_number: caseRow.case_number,
      });
    }

    return res.json({
      ok: true,
      case_id: caseRow.id,
      case_number: caseRow.case_number,
      status: caseRow.status,
    });
  } catch (err) {
    return next(err);
  }
});

// ---- GET /api/support/cases/mine ---------------------------------------
// The caller's cases, newest first, with a small projection + the
// count of unread (to the customer) so the envelope badge can total them.
router.get('/cases/mine', requireAuth, async function (req, res, next) {
  try {
    const { data, error } = await req.supabase
      .from('support_cases')
      .select('id, case_number, subject, category, status, unread_by_customer, rating, created_at, updated_at, resolved_at')
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: 'Could not load cases: ' + error.message });
    }

    const cases = data || [];
    const unreadCount = cases.filter(function (c) { return c.unread_by_customer; }).length;

    return res.json({ cases: cases, unread_count: unreadCount });
  } catch (err) {
    return next(err);
  }
});

// ---- GET /api/support/cases/:id ----------------------------------------
// One case + its full message thread. RLS ensures the caller can only
// fetch a case they own (the select returns nothing otherwise).
router.get('/cases/:id', requireAuth, async function (req, res, next) {
  try {
    const caseId = req.params.id;
    if (!looksLikeUuid(caseId)) {
      return res.status(400).json({ error: 'Invalid case id.' });
    }

    const { data: caseRow, error: caseErr } = await req.supabase
      .from('support_cases')
      .select('id, case_number, subject, category, status, unread_by_customer, rating, rating_comment, created_at, updated_at, resolved_at')
      .eq('id', caseId)
      .single();

    if (caseErr || !caseRow) {
      // PGRST116 (no row) lands here too — either not found or not theirs.
      return res.status(404).json({ error: 'Case not found.' });
    }

    const { data: messages, error: msgErr } = await req.supabase
      .from('support_messages')
      .select('id, author_type, body, created_at')
      .eq('case_id', caseId)
      .order('created_at', { ascending: true });

    if (msgErr) {
      return res.status(500).json({ error: 'Could not load messages: ' + msgErr.message });
    }

    return res.json({ case: caseRow, messages: messages || [] });
  } catch (err) {
    return next(err);
  }
});

// ---- POST /api/support/cases/:id/messages ------------------------------
// Customer posts a reply on their own case. Also flips unread_by_agent
// true (a new customer message needs agent attention) and clears
// unread_by_customer (they're obviously caught up — they just wrote).
router.post('/cases/:id/messages', requireAuth, async function (req, res, next) {
  try {
    const userId = req.user.id;
    const caseId = req.params.id;
    if (!looksLikeUuid(caseId)) {
      return res.status(400).json({ error: 'Invalid case id.' });
    }
    const body = (req.body && req.body.body ? String(req.body.body) : '').trim();
    if (!body) {
      return res.status(400).json({ error: 'A message is required.' });
    }
    if (body.length > MAX_BODY) {
      return res.status(400).json({ error: 'Message is too long.' });
    }

    // Confirm the case is the caller's and isn't closed. RLS already
    // bounds it to their own; this read also tells us the status.
    const { data: caseRow, error: caseErr } = await req.supabase
      .from('support_cases')
      .select('id, status')
      .eq('id', caseId)
      .single();

    if (caseErr || !caseRow) {
      return res.status(404).json({ error: 'Case not found.' });
    }

    const { error: msgErr } = await req.supabase
      .from('support_messages')
      .insert({
        case_id: caseId,
        author_type: 'customer',
        author_id: userId,
        body: body,
      });

    if (msgErr) {
      return res.status(500).json({ error: 'Could not post message: ' + msgErr.message });
    }

    // Update unread flags + touch updated_at. A customer reply on a
    // resolved case re-opens it (they still need help).
    const patch = {
      unread_by_agent: true,
      unread_by_customer: false,
      updated_at: new Date().toISOString(),
    };
    if (caseRow.status === 'resolved') {
      patch.status = 'open';
      patch.resolved_at = null;
    }

    await req.supabase
      .from('support_cases')
      .update(patch)
      .eq('id', caseId);

    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

// ---- POST /api/support/cases/:id/read ----------------------------------
// Clear the caller's unread flag (they've viewed the agent's reply).
router.post('/cases/:id/read', requireAuth, async function (req, res, next) {
  try {
    const caseId = req.params.id;
    if (!looksLikeUuid(caseId)) {
      return res.status(400).json({ error: 'Invalid case id.' });
    }
    const { error } = await req.supabase
      .from('support_cases')
      .update({ unread_by_customer: false })
      .eq('id', caseId);
    if (error) {
      return res.status(500).json({ error: 'Could not update: ' + error.message });
    }
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

// ---- POST /api/support/cases/:id/rating --------------------------------
// Rate a resolved case (1–5) + optional comment. Only allowed when the
// case is resolved; settable/overwritable while it stays resolved.
router.post('/cases/:id/rating', requireAuth, async function (req, res, next) {
  try {
    const caseId = req.params.id;
    if (!looksLikeUuid(caseId)) {
      return res.status(400).json({ error: 'Invalid case id.' });
    }
    const rating = parseInt(req.body && req.body.rating, 10);
    const comment = (req.body && req.body.comment ? String(req.body.comment) : '').trim();

    if (!(rating >= 1 && rating <= 5)) {
      return res.status(400).json({ error: 'Rating must be 1–5.' });
    }

    // Must be resolved to rate. Read status first (RLS bounds to own).
    const { data: caseRow, error: caseErr } = await req.supabase
      .from('support_cases')
      .select('id, status')
      .eq('id', caseId)
      .single();

    if (caseErr || !caseRow) {
      return res.status(404).json({ error: 'Case not found.' });
    }
    if (caseRow.status !== 'resolved') {
      return res.status(400).json({ error: 'Only resolved cases can be rated.' });
    }

    const { error: updErr } = await req.supabase
      .from('support_cases')
      .update({
        rating: rating,
        rating_comment: comment || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', caseId);

    if (updErr) {
      return res.status(500).json({ error: 'Could not save rating: ' + updErr.message });
    }

    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

// ---- GET /api/support/unread-count -------------------------------------
// Cheap, poll-friendly: just the count of the caller's cases that have
// an unread agent message. Index-only count, RLS-bounded to their own
// rows. Used by the envelope's background poll so we don't fetch the
// full case list every 45s.
router.get('/unread-count', requireAuth, async function (req, res, next) {
  try {
    const { count, error } = await req.supabase
      .from('support_cases')
      .select('id', { count: 'exact', head: true })
      .eq('unread_by_customer', true);
    if (error) {
      return res.status(500).json({ error: 'Could not load count: ' + error.message });
    }
    return res.json({ unread_count: count || 0 });
  } catch (err) {
    return next(err);
  }
});

// ---- GET /api/support/appointment -------------------------------------
// The caller's active onboarding appointment, if any. "Active" = an
// onboarding_appointment case that isn't resolved/closed. Returns null
// when none, so the UI can show the scheduler vs. the existing-request
// state.
router.get('/appointment', requireAuth, async function (req, res, next) {
  try {
    const { data, error } = await req.supabase
      .from('support_cases')
      .select('id, case_number, status, appointment_requested_date, ' +
        'appointment_requested_hour, appointment_timezone, ' +
        'appointment_alt_phone, appointment_status, appointment_confirmed_at, created_at')
      .eq('category', 'onboarding_appointment')
      .in('status', ['open']) // resolved/closed appointments are done
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) {
      return res.status(500).json({ error: 'Could not load appointment: ' + error.message });
    }
    const appt = (data && data[0]) || null;
    return res.json({ appointment: appt });
  } catch (err) {
    return next(err);
  }
});

// ---- POST /api/support/appointment -------------------------------------
// Request an onboarding call. Creates an onboarding_appointment case +
// a first message summarizing the request. One active appointment per
// user — if an open one exists, return it instead of creating a second.
// Body: { date 'YYYY-MM-DD', hour 8-17, timezone, alt_phone? }
router.post('/appointment', requireAuth, async function (req, res, next) {
  try {
    const userId = req.user.id;
    const date = (req.body && req.body.date ? String(req.body.date) : '').trim();
    const hour = parseInt(req.body && req.body.hour, 10);
    const timezone = (req.body && req.body.timezone ? String(req.body.timezone) : '').trim();
    const altPhone = (req.body && req.body.alt_phone ? String(req.body.alt_phone) : '').trim();

    // Validate date is a real YYYY-MM-DD and a weekday (Mon–Fri).
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Please choose a valid date.' });
    }
    const d = new Date(date + 'T12:00:00Z'); // midday UTC to avoid tz edge
    if (isNaN(d.getTime())) {
      return res.status(400).json({ error: 'Please choose a valid date.' });
    }
    const dow = d.getUTCDay(); // 0=Sun..6=Sat
    if (dow === 0 || dow === 6) {
      return res.status(400).json({ error: 'Please choose a weekday (Monday–Friday).' });
    }
    if (!(hour >= 8 && hour <= 17)) {
      return res.status(400).json({ error: 'Please choose a time between 8am and 5pm.' });
    }

    // One active appointment per user — return the existing open one.
    const { data: existing } = await req.supabase
      .from('support_cases')
      .select('id, case_number, status, appointment_requested_date, appointment_requested_hour, appointment_timezone, appointment_status')
      .eq('category', 'onboarding_appointment')
      .eq('status', 'open')
      .limit(1);
    if (existing && existing[0]) {
      return res.json({ ok: true, already: true, appointment: existing[0] });
    }

    // Create the appointment case.
    const { data: caseRow, error: caseErr } = await req.supabase
      .from('support_cases')
      .insert({
        user_id: userId,
        category: 'onboarding_appointment',
        subject: 'Onboarding call request',
        appointment_requested_date: date,
        appointment_requested_hour: hour,
        appointment_timezone: timezone || null,
        appointment_alt_phone: altPhone || null,
        appointment_status: 'requested',
      })
      .select('id, case_number, status, appointment_requested_date, appointment_requested_hour, appointment_timezone, appointment_alt_phone, appointment_status')
      .single();

    if (caseErr) {
      return res.status(500).json({ error: 'Could not create appointment: ' + caseErr.message });
    }

    // First message summarizing the request (human-readable in the
    // thread; the structured columns are the source of truth).
    const hourLabel = formatHour(hour);
    const summary = 'Onboarding call requested for ' + date + ' at ' + hourLabel +
      (timezone ? ' (' + timezone + ')' : '') +
      (altPhone ? '. Preferred call number: ' + altPhone : '.');
    await req.supabase
      .from('support_messages')
      .insert({
        case_id: caseRow.id,
        author_type: 'customer',
        author_id: userId,
        body: summary,
      });

    return res.json({ ok: true, appointment: caseRow });
  } catch (err) {
    return next(err);
  }
});

function formatHour(h) {
  // 8 -> '8:00 AM', 13 -> '1:00 PM', 17 -> '5:00 PM'
  var ampm = h < 12 ? 'AM' : 'PM';
  var h12 = h % 12; if (h12 === 0) h12 = 12;
  return h12 + ':00 ' + ampm;
}

module.exports = router;
