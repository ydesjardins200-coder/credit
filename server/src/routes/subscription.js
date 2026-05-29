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

    // Resolve the target Stripe price up front — fail loud if misconfigured.
    let targetPriceId;
    try {
      targetPriceId = resolvePriceId(targetPlan, currency).priceId;
    } catch (err) {
      return res.status(err.statusCode || 500).json({ error: err.message });
    }

    // Read the profile.
    let profile;
    try {
      const r = await supabaseAdmin
        .from('profiles')
        .select('id, plan, plan_currency, stripe_subscription_id, cancel_at_period_end')
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

    if (!profile.stripe_subscription_id) {
      return res.status(400).json({
        error: 'User has no active Stripe subscription. Use the upgrade link for free users.',
        reason: 'no_subscription',
      });
    }
    if (profile.cancel_at_period_end) {
      return res.status(409).json({
        error: 'Subscription is scheduled to cancel; resume it before changing plans.',
        reason: 'pending_cancel',
      });
    }
    if (profile.plan === targetPlan) {
      return res.status(409).json({
        error: 'User is already on the ' + targetPlan + ' plan.',
        reason: 'no_change',
      });
    }

    // Build a Subscription Schedule: phase 1 = current price until period
    // end, phase 2 = new price thereafter. proration_behavior: none so no
    // mid-cycle money moves — the change bills on the next renewal.
    let effectiveAtIso;
    try {
      const stripe = getStripe();

      // Create a schedule FROM the existing subscription. Stripe seeds
      // phase 1 from the current subscription's items/period.
      const schedule = await stripe.subscriptionSchedules.create(
        { from_subscription: profile.stripe_subscription_id },
        { idempotencyKey: 'sched-create-' + userId + '-' + Date.now() }
      );

      // The seeded phase 1 carries the current price + period. We append a
      // phase 2 with the new price. Phase 1's end becomes phase 2's start
      // (= next billing boundary).
      const phase0 = (schedule.phases && schedule.phases[0]) || {};
      const currentItems = (phase0.items || []).map(function (it) {
        return { price: it.price, quantity: it.quantity || 1 };
      });

      const updated = await stripe.subscriptionSchedules.update(
        schedule.id,
        {
          end_behavior: 'release', // hand back to a normal subscription after
          proration_behavior: 'none',
          phases: [
            {
              items: currentItems.length ? currentItems : undefined,
              start_date: phase0.start_date,
              end_date: phase0.end_date,
            },
            {
              items: [{ price: targetPriceId, quantity: 1 }],
              // starts when phase 1 ends (next billing boundary)
            },
          ],
        },
        { idempotencyKey: 'sched-update-' + userId + '-' + Date.now() }
      );

      // Effective date = phase 1 end (= next cycle).
      var p0end = (updated.phases && updated.phases[0] && updated.phases[0].end_date) ||
        phase0.end_date || null;
      effectiveAtIso = p0end ? unixToIso(p0end) : null;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[sub/schedule] stripe error:', err.message);
      return res.status(502).json({ error: 'Payment provider error: ' + err.message });
    }

    // Record the pending intent (NOT a profiles.plan flip — that happens
    // when the webhook reports the schedule landed at renewal).
    try {
      await supabaseAdmin
        .from('profiles')
        .update({
          pending_plan: targetPlan,
          pending_plan_currency: currency,
          pending_plan_effective_at: effectiveAtIso,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[sub/schedule] pending marker update threw:', err.message);
    }

    try {
      await supabaseAdmin
        .from('plan_changes')
        .insert({
          user_id: userId,
          from_plan: profile.plan,
          to_plan: targetPlan,
          source: 'admin_schedule',
          effective_at: effectiveAtIso,
          note: 'scheduled at period end; actor=' + adminActor,
        });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[sub/schedule] history insert threw:', err.message);
    }

    return res.json({
      ok: true,
      user_id: userId,
      scheduled: true,
      target_plan: targetPlan,
      effective_at: effectiveAtIso,
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

    return res.json({
      ok: true,
      user_id: userId,
      target_plan: targetPlan,
      url: checkoutUrl,
    });
  }
);

module.exports = router;
