// POST /api/checkout/create-session
//
// Creates a Stripe Checkout Session in SUBSCRIPTION mode for the
// authenticated user, and returns the hosted-checkout URL for the
// frontend to redirect to.
//
// Why hosted Checkout (not a custom card form):
//   - Card data never touches our servers or our frontend → lowest PCI
//     tier (SAQ A). For a credit company carrying CROA/PIPEDA weight,
//     shedding PCI scope is a deliberate compliance win.
//   - Stripe handles 3DS / SCA, declines, retries, receipts.
//
// Trust model: this endpoint is auth-gated (requireAuth) so only a
// logged-in user can start checkout, and we stamp the user's Supabase
// id into session metadata. But access is NOT granted here — it's
// granted by the webhook (stripe-webhook.js) on
// checkout.session.completed. The redirect back to the site is UX only
// and must never be trusted to grant a plan (the user can close the tab
// before redirect; the webhook is the reliable signal).

'use strict';

const express = require('express');
const router = express.Router();

const requireAuth = require('../middleware/requireAuth');
const requireProvider = require('../middleware/requireProvider');
const { getStripe } = require('../lib/stripe');
const { resolvePriceId } = require('../lib/plan-prices');

// Where Stripe sends the user after the hosted page. Read from env so
// it differs between local dev and production without code changes.
// Falls back to the known Netlify URL.
const FRONTEND_URL =
  process.env.FRONTEND_URL || 'https://iboostcredit.netlify.app';

// v1 is CAD-only (US launch undecided). The frontend may still display a
// USD price via its toggle, but checkout always charges CAD until USD
// plumbing is added. Hardcoded here rather than trusting a client value.
const V1_CURRENCY = 'cad';

router.post(
  '/create-session',
  requireAuth,
  requireProvider('payment_processor', ['stripe']),
  async function (req, res, next) {
  try {
    const stripe = getStripe();

    const userId = req.user.id;
    const userEmail = req.user.email || undefined;
    const planKey = (req.body && req.body.planKey) || '';

    // Resolve the Stripe Price ID. resolvePriceId throws a 400 for an
    // invalid/free plan and a 500 if the price env var is missing.
    const { priceId } = resolvePriceId(planKey, V1_CURRENCY);

    // Idempotency: if the user double-clicks or a network retry fires,
    // Stripe returns the same session rather than creating two. Keyed on
    // user + plan + a coarse time bucket so a genuinely new attempt
    // minutes later still works.
    const timeBucket = Math.floor(Date.now() / (1000 * 60 * 5)); // 5-min bucket
    const idempotencyKey =
      'checkout_' + userId + '_' + planKey + '_' + timeBucket;

    const session = await stripe.checkout.sessions.create(
      {
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        currency: V1_CURRENCY,

        // Prefill + bind the customer email. Stripe will create/reuse a
        // Customer for the subscription.
        customer_email: userEmail,

        // CRITICAL: stamp the Supabase user id so the webhook knows whose
        // profile to update. Put it on BOTH the session metadata and the
        // subscription metadata so it's available regardless of which
        // object a future webhook handler reads.
        metadata: { supabase_user_id: userId, plan_key: planKey },
        subscription_data: {
          metadata: { supabase_user_id: userId, plan_key: planKey },
        },

        // Redirect targets. {CHECKOUT_SESSION_ID} is substituted by Stripe.
        // success path is UX only — the webhook grants the plan.
        success_url:
          FRONTEND_URL +
          '/account.html?signup=success&plan=' +
          encodeURIComponent(planKey) +
          '&session_id={CHECKOUT_SESSION_ID}',
        cancel_url: FRONTEND_URL + '/checkout.html?canceled=1',

        // Let returning users reuse a saved payment method if Stripe has one.
        allow_promotion_codes: true,
      },
      { idempotencyKey }
    );

    return res.json({ url: session.url, id: session.id });
  } catch (err) {
    // resolvePriceId errors carry a .statusCode (400/500). Surface those
    // cleanly; everything else falls through to the generic handler.
    if (err && err.statusCode) {
      return res
        .status(err.statusCode)
        .json({ error: err.message });
    }
    // Stripe SDK errors have a useful .message; log full, return safe.
    // eslint-disable-next-line no-console
    console.error('[checkout] create-session failed:', err);
    return next(err);
  }
});

module.exports = router;
