// POST /api/checkout/create-session
//
// Branches on the active payment_processor provider:
//
//   stripe (production behavior):
//     Creates a Stripe Checkout Session (hosted) and returns the URL.
//     Card data never touches our servers. Plan is granted by the
//     webhook on checkout.session.completed, NOT by the redirect.
//
//   manual (DEV-MODE — sandbox only):
//     Writes the plan directly to the profile and records a plan_changes
//     row with source='manual_grant'. Returns a URL the frontend should
//     redirect to (the account success page). Lets the developer create
//     test users without going through Stripe checkout every time.
//
//   anything else:
//     503 — the active provider isn't supported for paid checkout.
//
// Live-mode guard: even if integrations.payment_processor='manual',
// we REFUSE manual mode when STRIPE_SECRET_KEY starts with sk_live_.
// In live mode, only Stripe ever runs. This is a code guarantee, not
// a flag-discipline one — manual cannot accidentally grant real
// customers free paid plans in production no matter what the DB says.
//
// Auth: requireAuth — only a logged-in user can start checkout. The
// user's Supabase id is stamped into Stripe metadata (so the webhook
// knows whose profile to update) AND used as the manual-grant target.

'use strict';

const express = require('express');
const router = express.Router();

const requireAuth = require('../middleware/requireAuth');
const { getStripe } = require('../lib/stripe');
const { resolvePriceId, PAID_PLAN_KEYS } = require('../lib/plan-prices');
const { getActiveProvider } = require('../lib/integrations-read');
const { supabaseAdmin } = require('../lib/supabase');

const FRONTEND_URL =
  process.env.FRONTEND_URL || 'https://iboostcredit.netlify.app';

// v1 is CAD-only.
const V1_CURRENCY = 'cad';

// Detect live mode from the Stripe key prefix. We do NOT call Stripe to
// check this — the prefix is authoritative and avoids a network call.
// Used to refuse 'manual' mode in production regardless of the DB flag.
function isLiveStripeMode() {
  const key = process.env.STRIPE_SECRET_KEY || '';
  return key.startsWith('sk_live_') || key.startsWith('rk_live_');
}

// ---------- Stripe-mode handler ----------
async function handleStripeMode({ req, res, userId, userEmail, planKey }) {
  const stripe = getStripe();
  const { priceId } = resolvePriceId(planKey, V1_CURRENCY);

  // Idempotency: 5-minute window. Double-click / retry returns same session.
  const timeBucket = Math.floor(Date.now() / (1000 * 60 * 5));
  const idempotencyKey =
    'checkout_' + userId + '_' + planKey + '_' + timeBucket;

  const session = await stripe.checkout.sessions.create(
    {
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      currency: V1_CURRENCY,
      customer_email: userEmail,
      metadata: { supabase_user_id: userId, plan_key: planKey },
      subscription_data: {
        metadata: { supabase_user_id: userId, plan_key: planKey },
      },
      // Land on the Welcome tab (/account.html) after payment — that's
      // where KYC + onboarding live. The cutover briefly pointed this at
      // /account/profile, which skipped the KYC step.
      success_url: FRONTEND_URL + '/account.html?upgrade=success',
      cancel_url: FRONTEND_URL + '/checkout.html?canceled=1',
      allow_promotion_codes: true,
    },
    { idempotencyKey }
  );

  return res.json({ url: session.url, id: session.id, mode: 'stripe' });
}

// ---------- Manual-mode handler (DEV-MODE — sandbox only) ----------
//
// Writes the plan directly to the profile and records a plan_changes
// row tagged as 'manual_grant'. Returns the same /account.html success
// URL the Stripe flow uses, so the frontend can do a single redirect.
//
// Stripe IDs (customer/subscription) and card fields are left null —
// they don't exist for manual grants, and that null-ness is itself the
// signal that this isn't a real paying subscriber.
async function handleManualMode({ req, res, userId, planKey }) {
  // Read prior plan for the from->to history row.
  const { data: existing, error: readErr } = await supabaseAdmin
    .from('profiles')
    .select('plan')
    .eq('id', userId)
    .single();

  if (readErr) {
    // eslint-disable-next-line no-console
    console.error('[checkout/manual] profile read failed:', readErr.message);
    return res.status(500).json({
      error: 'Could not read profile.',
      detail: readErr.message,
    });
  }

  const fromPlan = (existing && existing.plan) || null;

  const update = {
    plan: planKey,
    plan_activated_at: new Date().toISOString(),
    plan_currency: V1_CURRENCY,
    // Explicitly null out Stripe fields — manual grants are NOT
    // backed by a Stripe subscription. The null IDs are the signal
    // that this user isn't a real paying customer.
    stripe_customer_id: null,
    stripe_subscription_id: null,
    next_billing_date: null,
    updated_at: new Date().toISOString(),
  };

  const { error: updErr } = await supabaseAdmin
    .from('profiles')
    .update(update)
    .eq('id', userId);

  if (updErr) {
    // eslint-disable-next-line no-console
    console.error('[checkout/manual] profile update failed:', updErr.message);
    return res.status(500).json({
      error: 'Could not update profile.',
      detail: updErr.message,
    });
  }

  // History row, only if the plan actually changed. Tagged 'manual_grant'
  // so the row is distinguishable from real Stripe-backed signups.
  if (fromPlan !== planKey) {
    const { error: histErr } = await supabaseAdmin
      .from('plan_changes')
      .insert({
        user_id: userId,
        from_plan: fromPlan,
        to_plan: planKey,
        source: 'manual_grant',
      });
    if (histErr) {
      // Non-fatal: plan is already set, history is best-effort.
      // eslint-disable-next-line no-console
      console.warn('[checkout/manual] history insert failed:', histErr.message);
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    '[checkout/manual] granted plan=' + planKey + ' to user=' + userId +
    ' (from=' + fromPlan + ') [DEV MODE]'
  );

  // Same success URL shape Stripe uses, so the frontend can redirect
  // uniformly regardless of mode. No session_id (manual has no session).
  return res.json({
    url: FRONTEND_URL + '/account.html?signup=success&plan=' + encodeURIComponent(planKey) + '&manual=1',
    id: null,
    mode: 'manual',
  });
}

// ---------- Router ----------
router.post('/create-session', requireAuth, async function (req, res, next) {
  try {
    const userId = req.user.id;
    const userEmail = req.user.email || undefined;
    const planKey = (req.body && req.body.planKey) || '';

    // Basic input validation early — same shape both branches need it.
    if (!PAID_PLAN_KEYS.includes(planKey)) {
      return res.status(400).json({
        error: 'Invalid or non-purchasable plan: ' + JSON.stringify(planKey),
      });
    }

    // Double-billing guard: create-session starts a NEW subscription. If
    // the user already has one, this would create a second sub and bill
    // them twice. An existing subscriber changing plans must go through
    // the change/cancel flow (schedule at next cycle), not a new session.
    try {
      const { data: prof } = await supabaseAdmin
        .from('profiles')
        .select('stripe_subscription_id')
        .eq('id', userId)
        .single();
      if (prof && prof.stripe_subscription_id) {
        return res.status(409).json({
          error: 'You already have an active subscription. Use Change plan to switch plans.',
          reason: 'has_subscription',
        });
      }
    } catch (e) {
      // Non-fatal read error — don't block checkout for a new user over a
      // transient read; the webhook + unique constraints are the backstop.
      // eslint-disable-next-line no-console
      console.error('[checkout] subscription guard read failed:', e && e.message);
    }

    // Resolve the active provider for payment_processor. This drives
    // the whole branch. Caching is 10s per the integrations-read lib.
    let activeProvider;
    try {
      activeProvider = await getActiveProvider('payment_processor');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[checkout] could not read active provider:', err.message);
      return res.status(503).json({
        error: 'Service temporarily unavailable.',
        reason: 'integrations_unreadable',
      });
    }

    if (activeProvider === 'stripe') {
      return await handleStripeMode({ req, res, userId, userEmail, planKey });
    }

    if (activeProvider === 'manual') {
      // Live-mode safety: manual is a sandbox-only convenience. Refuse
      // it whenever the Stripe key is a live key. Operator must flip
      // back to 'stripe' (or the system must be sandbox).
      if (isLiveStripeMode()) {
        // eslint-disable-next-line no-console
        console.error(
          '[checkout] REFUSING manual mode in live Stripe environment. ' +
          'Flip payment_processor to stripe (or use a test key in sandbox).'
        );
        return res.status(503).json({
          error: 'Manual mode is disabled in production. Stripe is required for paid plans.',
          reason: 'manual_disabled_in_live',
        });
      }
      return await handleManualMode({ req, res, userId, planKey });
    }

    // Any other provider value: not supported for paid checkout.
    return res.status(503).json({
      error: 'Paid checkout is not available with the current configuration.',
      reason: 'provider_not_active',
      category: 'payment_processor',
      current_provider: activeProvider,
      allowed_providers: ['stripe', 'manual'],
    });
  } catch (err) {
    if (err && err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    // eslint-disable-next-line no-console
    console.error('[checkout] create-session failed:', err);
    return next(err);
  }
});

module.exports = router;
