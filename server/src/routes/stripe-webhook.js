// POST /api/stripe/webhook
//
// The reliable source of truth for granting a paid plan. Stripe POSTs
// events here from its servers. We verify the signature against the RAW
// request body, then act on the events we care about.
//
// IMPORTANT — raw body:
//   Signature verification requires the unparsed request body. This
//   route MUST be mounted with express.raw() BEFORE any express.json()
//   parser touches it (see index.js). If the body is JSON-parsed first,
//   verification will always fail. This is the #1 Stripe integration bug.
//
// IMPORTANT — never trust the redirect:
//   The success_url redirect in checkout.js is UX only. A user can close
//   the tab before it fires. THIS handler is what actually writes the
//   plan to the database, because Stripe delivers it reliably.
//
// Security:
//   - Unsigned / bad-signature requests get 400 and do nothing.
//   - We use the service-role Supabase client (bypasses RLS) because the
//     webhook acts on behalf of the system, not a logged-in user.
//   - We respond 200 quickly after the DB write; if the write fails we
//     return 500 so Stripe retries (events are delivered at-least-once,
//     so handlers must be idempotent — re-applying the same plan is safe).

'use strict';

const express = require('express');
const router = express.Router();

const { getStripe } = require('../lib/stripe');
const { supabaseAdmin } = require('../lib/supabase');

// Map a Stripe Price ID back to a plan key, so a webhook that only has
// the price (e.g. future subscription.updated events) can still resolve
// the plan. Built from the same env vars checkout uses.
function planKeyFromPriceId(priceId) {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_ESSENTIAL_CAD) return 'essential';
  if (priceId === process.env.STRIPE_PRICE_COMPLETE_CAD) return 'complete';
  // USD prices would be added here when/if US launches.
  return null;
}

// Apply a completed checkout to the user's profile + history.
// Idempotent: re-running with the same data is a harmless no-op-ish
// upsert (plan ends up the same; a duplicate history row is possible on
// retry but acceptable — history is append-only and a dupe is benign).
async function grantPlan({ userId, planKey, currency, stripeCustomerId, stripeSubscriptionId, currentPeriodEnd }) {
  if (!userId || !planKey) {
    throw new Error(
      'grantPlan called without userId or planKey (metadata missing?)'
    );
  }

  // Read the prior plan for the history row's from_plan.
  const { data: existing, error: readErr } = await supabaseAdmin
    .from('profiles')
    .select('plan')
    .eq('id', userId)
    .single();

  if (readErr) {
    // If we can't read the profile, the user id is probably bad. Throw so
    // Stripe retries and we get a loud log rather than a silent miss.
    throw new Error('profile read failed for ' + userId + ': ' + readErr.message);
  }

  const fromPlan = (existing && existing.plan) || null;

  // next_billing_date is a DATE column; current_period_end is a unix ts.
  let nextBillingDate = null;
  if (currentPeriodEnd) {
    nextBillingDate = new Date(currentPeriodEnd * 1000)
      .toISOString()
      .slice(0, 10); // YYYY-MM-DD
  }

  const update = {
    plan: planKey,
    plan_activated_at: new Date().toISOString(),
    plan_currency: currency || 'cad',
    stripe_customer_id: stripeCustomerId || null,
    stripe_subscription_id: stripeSubscriptionId || null,
    next_billing_date: nextBillingDate,
    updated_at: new Date().toISOString(),
  };

  const { error: updErr } = await supabaseAdmin
    .from('profiles')
    .update(update)
    .eq('id', userId);

  if (updErr) {
    throw new Error('profile update failed for ' + userId + ': ' + updErr.message);
  }

  // Append a history row. Non-fatal if it fails — the plan is already
  // set, which is what matters. Skip if plan didn't actually change.
  if (fromPlan !== planKey) {
    const { error: histErr } = await supabaseAdmin
      .from('plan_changes')
      .insert({
        user_id: userId,
        from_plan: fromPlan,
        to_plan: planKey,
        source: 'stripe_webhook',
      });
    if (histErr) {
      // eslint-disable-next-line no-console
      console.warn('[webhook] plan_changes insert failed (non-fatal):', histErr.message);
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    '[webhook] granted plan=' + planKey + ' to user=' + userId +
    ' (from=' + fromPlan + ')'
  );
}

// express.raw() is applied to this route in index.js, so req.body is a
// Buffer here.
//
// NOTE: this router is mounted at '/api/stripe/webhook' in index.js, so
// the handler path is '/' (not '/webhook') — otherwise the live path
// would double to '/api/stripe/webhook/webhook'.
router.post('/', async function (req, res) {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    // eslint-disable-next-line no-console
    console.error('[webhook] STRIPE_WEBHOOK_SECRET not set — cannot verify');
    return res.status(500).send('Webhook not configured');
  }

  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[webhook] signature verification failed:', err.message);
    return res.status(400).send('Webhook Error: ' + err.message);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;

        // Only subscription-mode sessions matter to us.
        if (session.mode !== 'subscription') {
          break;
        }

        const userId = session.metadata && session.metadata.supabase_user_id;
        let planKey = session.metadata && session.metadata.plan_key;

        const stripeCustomerId = session.customer || null;
        const stripeSubscriptionId = session.subscription || null;

        // Pull the subscription to get the period end (for next_billing_date)
        // and to confirm the plan from the price if metadata is missing.
        let currentPeriodEnd = null;
        if (stripeSubscriptionId) {
          try {
            const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
            currentPeriodEnd = sub.current_period_end || null;
            if (!planKey) {
              const priceId =
                sub.items &&
                sub.items.data &&
                sub.items.data[0] &&
                sub.items.data[0].price &&
                sub.items.data[0].price.id;
              planKey = planKeyFromPriceId(priceId);
            }
          } catch (e) {
            // eslint-disable-next-line no-console
            console.warn('[webhook] subscription retrieve failed:', e.message);
          }
        }

        await grantPlan({
          userId,
          planKey,
          currency: 'cad',
          stripeCustomerId,
          stripeSubscriptionId,
          currentPeriodEnd,
        });
        break;
      }

      // Future-proofing hooks. Logged but not yet acted on — wire these
      // when handling renewals, cancellations, and failed payments.
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
      case 'invoice.payment_failed':
        // eslint-disable-next-line no-console
        console.log('[webhook] received (not yet handled):', event.type);
        break;

      default:
        // Unhandled event types are normal — Stripe sends many. Ack them.
        break;
    }

    // Ack. Stripe treats any 2xx as "received"; non-2xx triggers retries.
    return res.json({ received: true });
  } catch (err) {
    // A handler threw (e.g. DB write failed). Return 500 so Stripe retries
    // later. Handlers are idempotent, so a retry is safe.
    // eslint-disable-next-line no-console
    console.error('[webhook] handler error for', event.type, ':', err.message);
    return res.status(500).send('Handler error');
  }
});

module.exports = router;
