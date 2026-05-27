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
async function grantPlan({ userId, planKey, currency, stripeCustomerId, stripeSubscriptionId, currentPeriodEnd, cardLast4, cardBrand }) {
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

  // Only set card fields when we actually have them — avoids overwriting
  // previously-stored card details with null on a retry where the payment
  // method didn't expand. card_last_four has a CHECK (^[0-9]{4}$), so we
  // only write it if it matches that shape.
  if (cardLast4 && /^[0-9]{4}$/.test(cardLast4)) {
    update.card_last_four = cardLast4;
  }
  if (cardBrand) {
    update.card_brand = cardBrand;
  }

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

// Find a profile row by its Stripe customer id. Used by every webhook
// handler that gets a customer-keyed event (subscription.updated /
// .deleted, invoice.payment_failed). Returns the row or null if not
// found — caller decides whether that's an error or expected.
async function findUserByStripeCustomerId(stripeCustomerId) {
  if (!stripeCustomerId) return null;
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, plan, cancel_at_period_end, stripe_subscription_id, next_billing_date')
    .eq('stripe_customer_id', stripeCustomerId)
    .single();
  if (error) {
    // PGRST116 = no row. Not an error — could be a webhook for a
    // customer we never tracked (e.g. test data, deleted profile).
    if (error.code === 'PGRST116') return null;
    throw new Error(
      'profile lookup by stripe_customer_id failed: ' + error.message
    );
  }
  return data;
}

// Sync our profile.cancel_at_period_end + next_billing_date with what
// Stripe says about a subscription. Idempotent: safe to call any number
// of times; only writes when state differs.
//
// Called from customer.subscription.updated. Catches three scenarios:
//   1) Operator cancelled directly in the Stripe dashboard (DB drifts).
//   2) Operator un-cancelled directly in the Stripe dashboard.
//   3) Renewal: Stripe updates current_period_end to the next cycle.
//      Keeps profile.next_billing_date current.
async function syncSubscriptionState(sub) {
  const stripeCustomerId = sub.customer;
  if (!stripeCustomerId) return;

  const profile = await findUserByStripeCustomerId(stripeCustomerId);
  if (!profile) {
    // eslint-disable-next-line no-console
    console.log(
      '[webhook] subscription.updated for unknown customer ' +
      stripeCustomerId + ' — ignoring'
    );
    return;
  }

  // Period end lives on the subscription item in Basil API (same as
  // grantPlan handles).
  const firstItem = sub.items && sub.items.data && sub.items.data[0];
  const currentPeriodEnd =
    (firstItem && firstItem.current_period_end) ||
    sub.current_period_end ||
    null;
  const nextBillingDate = currentPeriodEnd
    ? new Date(currentPeriodEnd * 1000).toISOString().slice(0, 10)
    : null;

  const desiredCancel = !!sub.cancel_at_period_end;
  const update = {};

  if (profile.cancel_at_period_end !== desiredCancel) {
    update.cancel_at_period_end = desiredCancel;
  }
  if (nextBillingDate && profile.next_billing_date !== nextBillingDate) {
    update.next_billing_date = nextBillingDate;
  }

  if (Object.keys(update).length === 0) {
    return; // already in sync, nothing to do
  }

  update.updated_at = new Date().toISOString();
  const { error: updErr } = await supabaseAdmin
    .from('profiles')
    .update(update)
    .eq('id', profile.id);
  if (updErr) {
    throw new Error(
      'profile sync update failed for ' + profile.id + ': ' + updErr.message
    );
  }
  // eslint-disable-next-line no-console
  console.log(
    '[webhook] synced subscription state for user=' + profile.id +
    ' cancel_at_period_end=' + desiredCancel +
    (nextBillingDate ? ' next=' + nextBillingDate : '')
  );
}

// Handle the actual end of a subscription. Stripe fires
// customer.subscription.deleted when:
//   1) cancel_at_period_end was true and the period rolled over.
//   2) Operator clicked "Cancel immediately" in the Stripe dashboard.
//   3) Stripe gave up on a card after dunning (involuntary churn).
//
// In all three cases: drop the user to Free in our DB. Clear the
// cancel_at_period_end flag (it's no longer "pending" — it happened).
// Leave Stripe customer/subscription IDs intact for historical lookup
// (the invoice page would break if we cleared customer_id).
//
// Idempotent guard: skip the plan_changes insert if the most recent
// row is already this exact transition (some Stripe retries can deliver
// the deletion event twice within seconds).
async function handleSubscriptionEnded(sub) {
  const stripeCustomerId = sub.customer;
  if (!stripeCustomerId) return;

  const profile = await findUserByStripeCustomerId(stripeCustomerId);
  if (!profile) {
    // eslint-disable-next-line no-console
    console.log(
      '[webhook] subscription.deleted for unknown customer ' +
      stripeCustomerId + ' — ignoring'
    );
    return;
  }

  if (profile.plan === 'free') {
    // Already on Free. Just clear stale flags if any and exit.
    if (profile.cancel_at_period_end) {
      await supabaseAdmin
        .from('profiles')
        .update({
          cancel_at_period_end: false,
          updated_at: new Date().toISOString(),
        })
        .eq('id', profile.id);
    }
    return;
  }

  const update = {
    plan: 'free',
    plan_activated_at: new Date().toISOString(),
    cancel_at_period_end: false,
    next_billing_date: null,
    // Intentionally NOT clearing stripe_customer_id — keeps the invoice
    // history visible after cancellation (the user's past invoices are
    // still real). The subscription_id we clear because it no longer
    // refers to anything billable.
    stripe_subscription_id: null,
    card_brand: null,
    card_last_four: null,
    updated_at: new Date().toISOString(),
  };

  const { error: updErr } = await supabaseAdmin
    .from('profiles')
    .update(update)
    .eq('id', profile.id);
  if (updErr) {
    throw new Error(
      'profile drop-to-free update failed for ' + profile.id +
      ': ' + updErr.message
    );
  }

  // Idempotency check: only write the history row if the last
  // stripe_webhook row for this user isn't already this exact
  // transition. Stripe's at-least-once delivery means we can get
  // duplicates.
  const { data: recent } = await supabaseAdmin
    .from('plan_changes')
    .select('id, from_plan, to_plan, source, changed_at')
    .eq('user_id', profile.id)
    .order('changed_at', { ascending: false })
    .limit(1);
  const lastRow = recent && recent[0];
  const isDuplicate =
    lastRow &&
    lastRow.source === 'stripe_webhook' &&
    lastRow.from_plan === profile.plan &&
    lastRow.to_plan === 'free' &&
    // Within 5 minutes — generous window for Stripe retries.
    Date.now() - new Date(lastRow.changed_at).getTime() < 5 * 60 * 1000;

  if (!isDuplicate) {
    const { error: histErr } = await supabaseAdmin
      .from('plan_changes')
      .insert({
        user_id: profile.id,
        from_plan: profile.plan,
        to_plan: 'free',
        source: 'stripe_webhook',
      });
    if (histErr) {
      // eslint-disable-next-line no-console
      console.warn(
        '[webhook] history insert failed (drop-to-free): ' + histErr.message
      );
    }
  }

  // If there's a pending admin_cancel row that pointed at this very
  // transition, mark it cancelled_at=now so it doesn't keep appearing
  // as "pending" forever in the plan history UI. The cancel actually
  // happened — it's now history, not pending.
  await supabaseAdmin
    .from('plan_changes')
    .update({ cancelled_at: new Date().toISOString() })
    .eq('user_id', profile.id)
    .eq('source', 'admin_cancel')
    .is('cancelled_at', null)
    .lt('effective_at', new Date(Date.now() + 60 * 1000).toISOString());

  // eslint-disable-next-line no-console
  console.log(
    '[webhook] subscription ended: user=' + profile.id +
    ' was=' + profile.plan + ' now=free'
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

        // Pull the subscription to get the period end (for next_billing_date),
        // the card details (last4/brand), and to confirm the plan from the
        // price if metadata is missing. We expand default_payment_method so
        // the card object comes back inline.
        let currentPeriodEnd = null;
        let cardLast4 = null;
        let cardBrand = null;
        if (stripeSubscriptionId) {
          try {
            const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId, {
              expand: ['default_payment_method'],
            });

            // current_period_end moved OFF the Subscription object onto the
            // subscription ITEM as of Stripe's Basil API (2025-03-31). Our
            // pinned version (2026-04-22.dahlia) is well past that, so read
            // it from items.data[0]. Fall back to the (legacy) top-level
            // field just in case.
            const firstItem =
              sub.items && sub.items.data && sub.items.data[0];
            currentPeriodEnd =
              (firstItem && firstItem.current_period_end) ||
              sub.current_period_end ||
              null;

            if (!planKey) {
              const priceId =
                firstItem && firstItem.price && firstItem.price.id;
              planKey = planKeyFromPriceId(priceId);
            }

            // Card details from the default payment method (expanded above).
            const pm = sub.default_payment_method;
            if (pm && typeof pm === 'object' && pm.card) {
              cardLast4 = pm.card.last4 || null;
              cardBrand = pm.card.brand || null;
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
          cardLast4,
          cardBrand,
        });
        break;
      }

      // customer.subscription.updated fires for every state change on
      // the subscription — including operator-side cancel/uncancel in
      // the Stripe dashboard, renewal (current_period_end shifts), card
      // updates, etc. Sync our profile to match Stripe's truth.
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        await syncSubscriptionState(sub);
        break;
      }

      // customer.subscription.deleted fires at the actual end of a
      // subscription: scheduled cancel reaching its period end, or an
      // immediate cancel, or Stripe giving up after dunning. Drops the
      // user to Free.
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await handleSubscriptionEnded(sub);
        break;
      }

      // Future-proofing: failed payment dunning. We'll act on this when
      // we build the lifecycle UI ("your card was declined, update it").
      // Logged for now.
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
