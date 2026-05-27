// Admin subscription operations.
//
//   POST /api/subscription/cancel  — schedule a cancel-at-period-end
//   POST /api/subscription/resume  — undo a scheduled cancel
//
// Both endpoints are gated by the admin shared secret (same x-admin-shared-secret
// header used elsewhere on this backend for admin->credit calls). Neither
// accepts a user token — these are operator actions, not self-service.
//
// Cancel semantics (deliberate choice — see project memory for context):
//   - cancel_at_period_end = true on the Stripe subscription
//   - User keeps service through the already-paid-for period
//   - On the period end date, Stripe fires customer.subscription.deleted
//     and the webhook drops the user to Free
//   - Resume before period end: cancel_at_period_end = false, no money
//     moves, no refund, sub just keeps renewing
//
// Resume semantics:
//   - Only valid when there's a pending cancel (Stripe sub has
//     cancel_at_period_end=true AND profile.cancel_at_period_end=true)
//   - Marks the pending plan_changes row as cancelled (cancelled_at=now)
//   - Writes a new plan_changes row with source='admin_resume'
//
// Audit:
//   - Every cancel writes a plan_changes row with future effective_at +
//     source='admin_cancel' + the reason in `note`.
//   - The admin-side proxy (in iboost_admin repo) also writes its own
//     admin_actions row for cross-service traceability.

'use strict';

const express = require('express');
const router = express.Router();

const requireAdminSharedSecret = require('../middleware/requireAdminSharedSecret');
const { getStripe } = require('../lib/stripe');
const { supabaseAdmin } = require('../lib/supabase');

// UUID shape check (same as invoices route — should probably extract,
// but two duplications is the threshold; one more triggers a shared lib).
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// Allowed cancel reason categories. Matches the dropdown on the admin UI.
// 'other' requires the free-text note to be non-empty.
const CANCEL_REASONS = [
  'customer_request',
  'billing_issue',
  'service_issue',
  'duplicate_account',
  'other',
];

// Helper: read the Stripe subscription's current period end. The Basil
// API moved this from sub.current_period_end (top-level) to
// sub.items.data[0].current_period_end. Read from items, fall back to
// the legacy field for safety.
function readPeriodEndUnix(sub) {
  const item = sub && sub.items && sub.items.data && sub.items.data[0];
  if (item && item.current_period_end) return item.current_period_end;
  if (sub && sub.current_period_end) return sub.current_period_end;
  return null;
}

// Convert a unix-seconds timestamp into an ISO string for Postgres.
// Stripe returns seconds; Postgres timestamptz wants ISO or epoch ms.
function unixToIso(unixSeconds) {
  if (!unixSeconds && unixSeconds !== 0) return null;
  return new Date(unixSeconds * 1000).toISOString();
}

// ============ POST /api/subscription/cancel ============
router.post(
  '/cancel',
  express.json(),
  requireAdminSharedSecret,
  async function (req, res) {
    const body = req.body || {};
    const userId = body.user_id;
    const reason = body.reason || 'customer_request';
    const note = (body.note || '').trim();
    const adminActor = body.admin_actor || 'unknown'; // surfaced from admin proxy

    if (!UUID_RE.test(String(userId))) {
      return res.status(400).json({ error: 'Invalid user_id (expected UUID).' });
    }
    if (CANCEL_REASONS.indexOf(reason) === -1) {
      return res.status(400).json({
        error: 'Invalid reason. Allowed: ' + CANCEL_REASONS.join(', '),
      });
    }
    if (reason === 'other' && !note) {
      return res.status(400).json({
        error: 'When reason is "other", a note is required.',
      });
    }

    // 1) Read the profile (service-role; entry point already secret-gated).
    let profile;
    try {
      const r = await supabaseAdmin
        .from('profiles')
        .select('id, plan, stripe_subscription_id, cancel_at_period_end')
        .eq('id', userId)
        .single();
      if (r.error) {
        if (r.error.code === 'PGRST116') {
          return res.status(404).json({ error: 'User not found.' });
        }
        // eslint-disable-next-line no-console
        console.error('[sub/cancel] profile read failed:', r.error.message);
        return res.status(500).json({ error: 'Could not read profile.' });
      }
      profile = r.data;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[sub/cancel] profile lookup error:', err.message);
      return res.status(500).json({ error: 'Profile lookup error.' });
    }

    if (!profile.stripe_subscription_id) {
      return res.status(400).json({
        error: 'User has no active Stripe subscription.',
        reason: 'no_subscription',
      });
    }
    if (profile.cancel_at_period_end) {
      return res.status(409).json({
        error: 'Subscription is already scheduled for cancellation.',
        reason: 'already_canceling',
      });
    }

    // 2) Tell Stripe to cancel at period end + read fresh period_end.
    let updatedSub;
    try {
      const stripe = getStripe();
      updatedSub = await stripe.subscriptions.update(
        profile.stripe_subscription_id,
        { cancel_at_period_end: true },
        { idempotencyKey: 'admin-cancel-' + userId + '-' + Date.now() }
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[sub/cancel] stripe update failed:', err.message);
      return res.status(502).json({
        error: 'Payment provider error: ' + err.message,
      });
    }

    const periodEndUnix = readPeriodEndUnix(updatedSub);
    const effectiveAtIso = unixToIso(periodEndUnix);

    // 3) Update profile flag + next_billing_date for accuracy.
    try {
      const r = await supabaseAdmin
        .from('profiles')
        .update({
          cancel_at_period_end: true,
          next_billing_date: effectiveAtIso, // keep in sync with Stripe truth
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId);
      if (r.error) {
        // eslint-disable-next-line no-console
        console.error('[sub/cancel] profile update failed:', r.error.message);
        // Don't bail — Stripe already accepted the cancel. Log + continue
        // so we still write the history row. The next webhook will
        // reconcile profile.cancel_at_period_end anyway.
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[sub/cancel] profile update threw:', err.message);
    }

    // 4) Write pending plan_changes row.
    // from_plan = current plan, to_plan = free (what they'll be after cancel),
    // changed_at = now (when the operator decided),
    // effective_at = period_end (when it actually takes effect),
    // source = admin_cancel.
    let pendingRowId = null;
    try {
      const r = await supabaseAdmin
        .from('plan_changes')
        .insert({
          user_id: userId,
          from_plan: profile.plan,
          to_plan: 'free',
          source: 'admin_cancel',
          effective_at: effectiveAtIso,
          note: 'reason=' + reason + (note ? '; ' + note : '') +
                '; actor=' + adminActor,
        })
        .select('id')
        .single();
      if (r.error) {
        // eslint-disable-next-line no-console
        console.error('[sub/cancel] history insert failed:', r.error.message);
      } else {
        pendingRowId = r.data.id;
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[sub/cancel] history insert threw:', err.message);
    }

    return res.json({
      ok: true,
      user_id: userId,
      cancel_at_period_end: true,
      effective_at: effectiveAtIso,
      pending_change_id: pendingRowId,
    });
  }
);

// ============ POST /api/subscription/resume ============
router.post(
  '/resume',
  express.json(),
  requireAdminSharedSecret,
  async function (req, res) {
    const body = req.body || {};
    const userId = body.user_id;
    const note = (body.note || '').trim(); // optional on resume
    const adminActor = body.admin_actor || 'unknown';

    if (!UUID_RE.test(String(userId))) {
      return res.status(400).json({ error: 'Invalid user_id (expected UUID).' });
    }

    // 1) Profile lookup.
    let profile;
    try {
      const r = await supabaseAdmin
        .from('profiles')
        .select('id, plan, stripe_subscription_id, cancel_at_period_end')
        .eq('id', userId)
        .single();
      if (r.error) {
        if (r.error.code === 'PGRST116') {
          return res.status(404).json({ error: 'User not found.' });
        }
        return res.status(500).json({ error: 'Could not read profile.' });
      }
      profile = r.data;
    } catch (err) {
      return res.status(500).json({ error: 'Profile lookup error.' });
    }

    if (!profile.stripe_subscription_id) {
      return res.status(400).json({
        error: 'User has no Stripe subscription to resume.',
        reason: 'no_subscription',
      });
    }
    if (!profile.cancel_at_period_end) {
      return res.status(409).json({
        error: 'Subscription is not scheduled for cancellation.',
        reason: 'not_canceling',
      });
    }

    // 2) Tell Stripe to undo the cancel.
    let updatedSub;
    try {
      const stripe = getStripe();
      updatedSub = await stripe.subscriptions.update(
        profile.stripe_subscription_id,
        { cancel_at_period_end: false },
        { idempotencyKey: 'admin-resume-' + userId + '-' + Date.now() }
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[sub/resume] stripe update failed:', err.message);
      return res.status(502).json({
        error: 'Payment provider error: ' + err.message,
      });
    }

    // 3) Update profile.
    try {
      const r = await supabaseAdmin
        .from('profiles')
        .update({
          cancel_at_period_end: false,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId);
      if (r.error) {
        // eslint-disable-next-line no-console
        console.error('[sub/resume] profile update failed:', r.error.message);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[sub/resume] profile update threw:', err.message);
    }

    // 4) Mark any pending admin_cancel rows for this user as rescinded.
    // There should be at most one (the most recent un-cancelled, future-
    // effective_at admin_cancel row), but UPDATE-by-filter handles N safely.
    try {
      const r = await supabaseAdmin
        .from('plan_changes')
        .update({ cancelled_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('source', 'admin_cancel')
        .is('cancelled_at', null)
        .gt('effective_at', new Date().toISOString());
      if (r.error) {
        // eslint-disable-next-line no-console
        console.error('[sub/resume] mark-pending failed:', r.error.message);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[sub/resume] mark-pending threw:', err.message);
    }

    // 5) Write the resume audit row.
    try {
      const r = await supabaseAdmin
        .from('plan_changes')
        .insert({
          user_id: userId,
          from_plan: profile.plan,
          to_plan: profile.plan, // no plan change; resume keeps the same plan
          source: 'admin_resume',
          note: (note ? note + '; ' : '') + 'actor=' + adminActor,
        });
      if (r.error) {
        // eslint-disable-next-line no-console
        console.error('[sub/resume] history insert failed:', r.error.message);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[sub/resume] history insert threw:', err.message);
    }

    return res.json({
      ok: true,
      user_id: userId,
      cancel_at_period_end: false,
    });
  }
);

module.exports = router;
