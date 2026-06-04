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
const { resolvePriceId } = require('../lib/plan-prices');
const { schedulePlanChange, cancelToFree, resumeSubscription, cancelScheduledChange } = require('../lib/subscription-ops');

// Same env var + fallback the rest of the credit backend uses (checkout.js,
// billing.js). Stripe requires success_url/cancel_url to be fully-qualified
// URLs — the fallback guarantees we never pass a bare path.
const FRONTEND_URL =
  process.env.FRONTEND_URL || 'https://iboostcredit.netlify.app';

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

    // All mechanics (Stripe cancel-at-period-end, schedule release, profile
    // flags, plan_changes history) live in the shared subscription-ops so
    // customer + admin cancels share one code path. The route keeps only
    // the admin-specific validation above and the legacy response shape
    // below (the admin proxy/UI read effective_at + pending_change_id).
    const r = await cancelToFree(userId, reason, note, adminActor);
    if (!r.ok) {
      return res.status(r.status).json(r.body);
    }
    return res.json({
      ok: true,
      user_id: userId,
      cancel_at_period_end: true,
      effective_at: r.body.effective_at,
      pending_change_id: r.body.pending_change_id || null,
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

    // Mechanics live in the shared subscription-ops (ported verbatim from
    // the previous inline implementation): Stripe cancel_at_period_end=false,
    // profile flag + stale pending-marker clear, rescind pending
    // admin_cancel/admin_schedule rows, admin_resume audit row.
    const r = await resumeSubscription(userId, note, adminActor);
    if (!r.ok) {
      return res.status(r.status).json(r.body);
    }
    return res.json({
      ok: true,
      user_id: userId,
      cancel_at_period_end: false,
    });
  }
);

// ---------------------------------------------------------------------
// POST /api/subscription/schedule-plan-change
// Paid <-> paid plan change (Essential <-> Complete), effective at the
// NEXT billing cycle with NO proration, via a Stripe Subscription
// Schedule. The current price runs until period end; the new price
// starts on the next cycle. We DON'T flip profiles.plan now — we record
// the intent in a pending marker + plan_changes(admin_schedule), and the
// webhook flips the real plan when the schedule lands at renewal.
//
// Body: { target_plan, currency?, admin_actor? }
// Not for: paid->free (use /cancel) or free->paid (use /upgrade-link).
// ---------------------------------------------------------------------
router.post(
  '/schedule-plan-change',
  requireAdminSharedSecret,
  async function (req, res) {
    const body = req.body || {};
    const userId = String(body.user_id || '').trim();
    const targetPlan = String(body.target_plan || '').toLowerCase().trim();
    const currency = String(body.currency || 'cad').toLowerCase().trim();
    const adminActor = body.admin_actor || 'unknown';

    if (!UUID_RE.test(userId)) {
      return res.status(400).json({ error: 'Invalid user id.' });
    }
    if (targetPlan !== 'essential' && targetPlan !== 'complete') {
      return res.status(400).json({
        error: 'schedule-plan-change is only for paid plans (essential/complete). ' +
          'Use /cancel for downgrades to free, /upgrade-link for free->paid.',
      });
    }
    if (currency !== 'cad') {
      return res.status(400).json({
        error: 'Only CAD is supported in v1.',
        reason: 'currency_unsupported',
      });
    }

    // All mechanics (price resolution, profile guards, the two-phase
    // Stripe Subscription Schedule with proration none, pending markers,
    // plan_changes history) live in the shared subscription-ops so
    // customer + admin plan changes share one code path. The route keeps
    // its own validation above (operator-facing guidance text) and the
    // legacy response shape below (admin reads effective_at).
    const r = await schedulePlanChange(userId, targetPlan, currency, adminActor);
    if (!r.ok) {
      return res.status(r.status).json(r.body);
    }
    return res.json({
      ok: true,
      user_id: userId,
      scheduled: true,
      target_plan: targetPlan,
      effective_at: r.body.effective_at,
    });
  }
);

// ---------------------------------------------------------------------
// POST /api/subscription/upgrade-link
// Free -> paid. A free user has no subscription and no card on file, so
// we can't schedule anything — they must subscribe. Generates a Stripe
// Hosted Checkout Session for the target paid plan and returns its URL.
// The admin sends this to the customer (in a case); when they complete
// it, the EXISTING checkout.session.completed webhook provisions the
// subscription. Card data stays entirely in Stripe.
//
// Body: { user_id, target_plan, currency?, admin_actor? }
// ---------------------------------------------------------------------
router.post(
  '/upgrade-link',
  requireAdminSharedSecret,
  async function (req, res) {
    const body = req.body || {};
    const userId = String(body.user_id || '').trim();
    const targetPlan = String(body.target_plan || '').toLowerCase().trim();
    const currency = String(body.currency || 'cad').toLowerCase().trim();

    if (!UUID_RE.test(userId)) {
      return res.status(400).json({ error: 'Invalid user id.' });
    }
    if (targetPlan !== 'essential' && targetPlan !== 'complete') {
      return res.status(400).json({ error: 'Target must be a paid plan (essential/complete).' });
    }
    if (currency !== 'cad') {
      return res.status(400).json({ error: 'Only CAD is supported in v1.', reason: 'currency_unsupported' });
    }

    let priceId;
    try {
      priceId = resolvePriceId(targetPlan, currency).priceId;
    } catch (err) {
      return res.status(err.statusCode || 500).json({ error: err.message });
    }

    // Read profile for email + existing stripe customer (reuse if present).
    let profile;
    try {
      const r = await supabaseAdmin
        .from('profiles')
        .select('id, email, plan, stripe_customer_id, stripe_subscription_id')
        .eq('id', userId)
        .single();
      if (r.error) {
        if (r.error.code === 'PGRST116') return res.status(404).json({ error: 'User not found.' });
        return res.status(500).json({ error: 'Could not read profile.' });
      }
      profile = r.data;
    } catch (err) {
      return res.status(500).json({ error: 'Profile lookup error.' });
    }

    if (profile.stripe_subscription_id) {
      return res.status(409).json({
        error: 'User already has a subscription. Use schedule-plan-change to change plans.',
        reason: 'has_subscription',
      });
    }

    let checkoutUrl;
    try {
      const stripe = getStripe();
      const sessionParams = {
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: FRONTEND_URL + '/account/profile?upgrade=success',
        cancel_url: FRONTEND_URL + '/account/profile?upgrade=cancelled',
        client_reference_id: userId,
        // Use the SAME metadata keys the webhook's checkout.session.completed
        // handler reads (supabase_user_id, plan_key) so provisioning works
        // identically to a normal signup checkout.
        metadata: { supabase_user_id: userId, plan_key: targetPlan, source: 'admin_upgrade_link' },
        subscription_data: {
          metadata: { supabase_user_id: userId, plan_key: targetPlan },
        },
      };
      if (profile.stripe_customer_id) {
        sessionParams.customer = profile.stripe_customer_id;
      } else if (profile.email) {
        sessionParams.customer_email = profile.email;
      }
      const session = await stripe.checkout.sessions.create(sessionParams);
      checkoutUrl = session.url;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[sub/upgrade-link] stripe error:', err.message);
      return res.status(502).json({ error: 'Payment provider error: ' + err.message });
    }

    // Persist the link on the profile so the admin card can show/re-share
    // it. Cleared on provisioning (webhook) or when no longer Free.
    try {
      await supabaseAdmin
        .from('profiles')
        .update({
          upgrade_link_url: checkoutUrl,
          upgrade_link_plan: targetPlan,
          upgrade_link_created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[sub/upgrade-link] persist link threw:', e && e.message);
    }

    return res.json({
      ok: true,
      user_id: userId,
      target_plan: targetPlan,
      url: checkoutUrl,
    });
  }
);

// ---------------------------------------------------------------------
// POST /api/subscription/cancel-scheduled-change  (admin-secret-gated)
// Operator undoes a user's pending scheduled plan change. Delegates to
// the shared subscription-ops so customer + admin share one code path.
// ---------------------------------------------------------------------
router.post(
  '/cancel-scheduled-change',
  requireAdminSharedSecret,
  async function (req, res) {
    const body = req.body || {};
    const userId = String(body.user_id || '').trim();
    const adminActor = body.admin_actor || 'unknown';
    if (!UUID_RE.test(userId)) {
      return res.status(400).json({ error: 'Invalid user id.' });
    }
    const result = await cancelScheduledChange(userId, adminActor);
    return res.status(result.status).json(result.body);
  }
);

module.exports = router;
