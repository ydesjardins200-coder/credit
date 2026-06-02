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
const { accrueOnCollectedPayment } = require('../lib/partner-accrual');

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
    // A completed checkout means an active subscription. Clear any stale
    // past-due flag (e.g. a user who lapsed then re-subscribed).
    subscription_status: 'active',
    payment_failed_at: null,
    // Provisioned now — the upgrade link (if any) has done its job. Clear
    // it so the admin card stops showing a now-consumed link.
    upgrade_link_url: null,
    upgrade_link_plan: null,
    upgrade_link_created_at: null,
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
    .select('id, plan, cancel_at_period_end, stripe_subscription_id, next_billing_date, subscription_status, payment_failed_at, card_last_four, card_brand, pending_plan')
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

// Read the current card details (last4 + brand) for a customer. Used to
// keep profile.card_last_four / card_brand in sync when a user changes
// their card via the Customer Portal — those events don't carry the
// card inline, so we resolve the customer's default payment method.
//
// Resolution order, matching how Stripe stores the "default" card:
//   1) subscription.default_payment_method (sub-level override)
//   2) customer.invoice_settings.default_payment_method (customer default)
// Falls back to listing the customer's card payment methods if neither
// default is set.
//
// Returns { cardLast4, cardBrand } — either may be null if unresolved.
// Never throws; logs and returns nulls on Stripe errors so a card-read
// failure doesn't break the rest of the sync.
async function readCustomerCard(stripe, stripeCustomerId, subscription) {
  try {
    // 1) Subscription-level default payment method, if the sub specifies one.
    let pmId =
      subscription && subscription.default_payment_method
        ? (typeof subscription.default_payment_method === 'string'
            ? subscription.default_payment_method
            : subscription.default_payment_method.id)
        : null;

    // 2) Customer-level default.
    if (!pmId) {
      const customer = await stripe.customers.retrieve(stripeCustomerId);
      pmId =
        customer &&
        customer.invoice_settings &&
        customer.invoice_settings.default_payment_method
          ? customer.invoice_settings.default_payment_method
          : null;
    }

    // 3) Resolve the payment method object to read card last4/brand.
    if (pmId) {
      const pm = await stripe.paymentMethods.retrieve(pmId);
      if (pm && pm.card) {
        return { cardLast4: pm.card.last4 || null, cardBrand: pm.card.brand || null };
      }
    }

    // 4) Last resort: list the customer's card payment methods, take the
    //    first. Covers customers with a card but no explicit default set.
    const list = await stripe.paymentMethods.list({
      customer: stripeCustomerId,
      type: 'card',
      limit: 1,
    });
    const first = list && list.data && list.data[0];
    if (first && first.card) {
      return { cardLast4: first.card.last4 || null, cardBrand: first.card.brand || null };
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[webhook] readCustomerCard failed for ' + stripeCustomerId + ': ' + err.message);
  }
  return { cardLast4: null, cardBrand: null };
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
async function syncSubscriptionState(stripe, sub) {
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

  // Sync subscription_status straight from Stripe's own field. Stripe
  // is authoritative — it sends 'active' | 'past_due' | 'canceled' |
  // 'incomplete' | 'trialing' | etc. We store whatever it says (no
  // CHECK constraint), and the UI treats anything != 'past_due' as
  // "no banner", so an unexpected value fails safe.
  const desiredStatus = sub.status || null;
  if (desiredStatus && profile.subscription_status !== desiredStatus) {
    update.subscription_status = desiredStatus;
  }

  // If Stripe reports the sub is healthy again ('active'), clear any
  // stale payment_failed_at. The dedicated invoice.payment_succeeded
  // handler also does this, but catching it here too means a recovery
  // that arrives only as a status flip still clears the flag.
  if (desiredStatus === 'active' && profile.payment_failed_at) {
    update.payment_failed_at = null;
  }

  // Sync card details. The webhook's sub object isn't expanded, so
  // resolve the current default card via Stripe. Only write when it
  // actually changed (avoids a needless write on every renewal event).
  const card = await readCustomerCard(stripe, stripeCustomerId, sub);
  if (card.cardLast4 && /^[0-9]{4}$/.test(card.cardLast4) &&
      card.cardLast4 !== profile.card_last_four) {
    update.card_last_four = card.cardLast4;
  }
  if (card.cardBrand && card.cardBrand !== profile.card_brand) {
    update.card_brand = card.cardBrand;
  }

  // Plan sync from the subscription's current price. When a scheduled
  // plan change (Subscription Schedule) lands at renewal, the price on
  // the sub changes; map it to a plan key and sync profiles.plan. If the
  // new plan matches a pending marker, the scheduled change has taken
  // effect — clear the marker. (We deliberately did NOT flip plan when
  // the change was scheduled; this is where it becomes real.)
  const livePriceId = firstItem && firstItem.price && firstItem.price.id;
  const livePlanKey = planKeyFromPriceId(livePriceId);
  if (livePlanKey && livePlanKey !== profile.plan) {
    update.plan = livePlanKey;
  }
  if (profile.pending_plan) {
    // Clear the pending marker once the live plan reaches it (the
    // schedule landed), or if the sub no longer reflects a pending state.
    if (livePlanKey === profile.pending_plan) {
      update.pending_plan = null;
      update.pending_plan_currency = null;
      update.pending_plan_effective_at = null;
    }
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
    ' status=' + (desiredStatus || 'n/a') +
    (nextBillingDate ? ' next=' + nextBillingDate : '')
  );

  // If the plan actually changed (e.g. a scheduled change landed at
  // renewal), append a history row so plan_changes reflects reality.
  if (update.plan && update.plan !== profile.plan) {
    try {
      await supabaseAdmin
        .from('plan_changes')
        .insert({
          user_id: profile.id,
          from_plan: profile.plan,
          to_plan: update.plan,
          source: 'stripe_webhook',
          note: 'plan change effective at renewal',
        });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.log('[webhook] plan_changes insert threw: ' + (e && e.message));
    }
  }
}

// customer.updated fires when a customer's details change — including
// when their default payment method changes (which is what a card
// update via the Customer Portal does, if it doesn't also touch the
// subscription). We sync only the card fields here; subscription state
// is handled by the subscription.updated path. Idempotent: writes only
// when the card actually differs from what we have stored.
async function handleCustomerUpdated(stripe, customer) {
  const stripeCustomerId = customer && customer.id;
  if (!stripeCustomerId) return;

  const profile = await findUserByStripeCustomerId(stripeCustomerId);
  if (!profile) return; // unknown customer — nothing to sync

  // Pass no subscription — readCustomerCard will fall back to the
  // customer's default payment method (which is exactly what changed).
  const card = await readCustomerCard(stripe, stripeCustomerId, null);

  const update = {};
  if (card.cardLast4 && /^[0-9]{4}$/.test(card.cardLast4) &&
      card.cardLast4 !== profile.card_last_four) {
    update.card_last_four = card.cardLast4;
  }
  if (card.cardBrand && card.cardBrand !== profile.card_brand) {
    update.card_brand = card.cardBrand;
  }

  if (Object.keys(update).length === 0) {
    return; // card unchanged — nothing to do
  }

  update.updated_at = new Date().toISOString();
  const { error: updErr } = await supabaseAdmin
    .from('profiles')
    .update(update)
    .eq('id', profile.id);
  if (updErr) {
    throw new Error(
      'customer.updated card sync failed for ' + profile.id + ': ' + updErr.message
    );
  }
  // eslint-disable-next-line no-console
  console.log(
    '[webhook] synced card for user=' + profile.id +
    ' last4=' + (update.card_last_four || profile.card_last_four)
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
    // Subscription is gone — status + payment-failure tracking are moot.
    subscription_status: 'canceled',
    payment_failed_at: null,
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

// invoice.payment_failed fires when a renewal charge fails. Stripe then
// enters dunning and retries — so this event can fire MULTIPLE times for
// one genuinely-failing card. We record only the FIRST failure timestamp
// (so the admin sees "declining since May 20", not "since the last
// retry 2 hours ago"). subscription_status flips to past_due via the
// companion subscription.updated event Stripe sends alongside.
//
// Idempotency: guarded by "only set payment_failed_at if currently null".
async function handlePaymentFailed(invoice) {
  const stripeCustomerId = invoice.customer;
  if (!stripeCustomerId) return;

  const profile = await findUserByStripeCustomerId(stripeCustomerId);
  if (!profile) {
    // eslint-disable-next-line no-console
    console.log(
      '[webhook] payment_failed for unknown customer ' +
      stripeCustomerId + ' — ignoring'
    );
    return;
  }

  // Already recorded a failure — don't overwrite the first-failure time
  // on subsequent dunning retries. This is the idempotency guard.
  if (profile.payment_failed_at) {
    return;
  }

  const { error: updErr } = await supabaseAdmin
    .from('profiles')
    .update({
      payment_failed_at: new Date().toISOString(),
      // status is also synced via subscription.updated, but set it here
      // too in case the events arrive out of order — fail safe toward
      // showing the past_due banner sooner rather than later.
      subscription_status: 'past_due',
      updated_at: new Date().toISOString(),
    })
    .eq('id', profile.id);
  if (updErr) {
    throw new Error(
      'payment_failed update failed for ' + profile.id + ': ' + updErr.message
    );
  }
  // eslint-disable-next-line no-console
  console.log('[webhook] payment failed: user=' + profile.id + ' marked past_due');

  // Create an INTERNAL customer-service case so a human follows up
  // (call/email the customer). We're inside the first-failure block
  // (guarded by the payment_failed_at null check above), so Stripe's
  // dunning retries never reach here — exactly one case per failure
  // episode, no separate dedup query needed. Unassigned, so it shows in
  // the CS queue for a collection agent to take. category
  // 'payment_failed' is excluded from the customer's own case list, so
  // the customer never sees it (they see the past-due banner instead).
  try {
    const failedAt = new Date();
    const planLabel = profile.plan || 'subscription';
    const { data: caseRow, error: caseErr } = await supabaseAdmin
      .from('support_cases')
      .insert({
        user_id: profile.id,
        category: 'payment_failed',
        subject: 'Payment failed — outreach needed',
        // unassigned (assigned_to null) → appears in the CS queue
      })
      .select('id')
      .single();
    if (caseErr) {
      // Don't fail the webhook over a case-creation hiccup; the past-due
      // state (and Collection tab) is the source of truth. Log + move on.
      console.log('[webhook] payment_failed case create error: ' + caseErr.message);
    } else if (caseRow) {
      const summary = 'Renewal payment failed for the ' + planLabel +
        ' plan on ' + failedAt.toISOString().slice(0, 10) +
        '. Account is past due. Reach out to the customer (call, or email ' +
        'if unreachable) to help them update their payment method.';
      await supabaseAdmin
        .from('support_messages')
        .insert({
          case_id: caseRow.id,
          author_type: 'agent', // system-authored, internal
          author_id: null,
          body: summary,
        });
    }
  } catch (e) {
    console.log('[webhook] payment_failed case create threw: ' + (e && e.message));
  }
}

// invoice.payment_succeeded fires on every successful charge — initial
// AND renewals. We use it to CLEAR a past-due flag once the customer's
// card recovers (they updated it, or a retry finally went through).
//
// Idempotency: only writes when there's actually a flag to clear.
async function handlePaymentSucceeded(invoice) {
  const stripeCustomerId = invoice.customer;
  if (!stripeCustomerId) return;

  const profile = await findUserByStripeCustomerId(stripeCustomerId);
  if (!profile) return; // unknown customer — nothing to clear

  // Partner rev-share accrual (the anchor rule lives here: we accrue ONLY
  // on a collected payment, never on signup). Best-effort and idempotent —
  // it must never break the webhook, so it's wrapped and its result is just
  // logged. Runs on every collected payment, BEFORE the past-due early
  // return below (a routine successful renewal must still accrue).
  try {
    const accrual = await accrueOnCollectedPayment({
      userId: profile.id,
      email: profile.email,
      invoiceId: invoice.id,
      eventId: invoice.id, // invoice id is the stable idempotency key
      amountCents: invoice.amount_paid != null ? invoice.amount_paid : invoice.amount_due,
      currency: invoice.currency || null,
      plan: profile.plan || null,
    });
    if (accrual && accrual.accrued) {
      console.log('[webhook] partner accrual: user=' + profile.id +
        ' partner=' + accrual.partner_id + ' accrued=' + accrual.amount_cents + 'c');
    } else if (accrual && !accrual.ok) {
      console.log('[webhook] partner accrual error: ' + (accrual.error || 'unknown'));
    }
  } catch (e) {
    console.log('[webhook] partner accrual threw: ' + (e && e.message));
  }

  // Nothing to clear if not currently flagged. Avoids a needless write
  // on every routine successful renewal.
  if (!profile.payment_failed_at && profile.subscription_status !== 'past_due') {
    return;
  }

  const { error: updErr } = await supabaseAdmin
    .from('profiles')
    .update({
      payment_failed_at: null,
      subscription_status: 'active',
      updated_at: new Date().toISOString(),
    })
    .eq('id', profile.id);
  if (updErr) {
    throw new Error(
      'payment_succeeded update failed for ' + profile.id + ': ' + updErr.message
    );
  }
  // eslint-disable-next-line no-console
  console.log('[webhook] payment recovered: user=' + profile.id + ' back to active');

  // Auto-resolve the open payment_failed case (if any): the problem
  // fixed itself (card updated or a retry succeeded), so the outreach
  // work item is done. Post a system note + mark resolved, so the CS
  // queue self-cleans alongside the Collection tab.
  try {
    const { data: openCases } = await supabaseAdmin
      .from('support_cases')
      .select('id')
      .eq('user_id', profile.id)
      .eq('category', 'payment_failed')
      .eq('status', 'open');
    for (const c of (openCases || [])) {
      await supabaseAdmin
        .from('support_messages')
        .insert({
          case_id: c.id,
          author_type: 'agent',
          author_id: null,
          body: 'Payment recovered on ' + new Date().toISOString().slice(0, 10) +
            ' — account is active again. Auto-resolved.',
        });
      await supabaseAdmin
        .from('support_cases')
        .update({
          status: 'resolved',
          resolved_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', c.id);
    }
  } catch (e) {
    console.log('[webhook] payment_succeeded auto-resolve threw: ' + (e && e.message));
  }
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
        await syncSubscriptionState(stripe, sub);
        break;
      }

      // customer.updated fires when customer details change, including a
      // default-payment-method swap from the Customer Portal that doesn't
      // also touch the subscription. Sync card fields.
      case 'customer.updated': {
        const customer = event.data.object;
        await handleCustomerUpdated(stripe, customer);
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

      // invoice.payment_failed fires when a renewal charge bounces.
      // Records the first-failure time + flips status to past_due.
      // Fires repeatedly during dunning — handler is idempotent.
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        await handlePaymentFailed(invoice);
        break;
      }

      // invoice.payment_succeeded fires on every successful charge.
      // Used to clear a past-due flag when the card recovers. No-op
      // when the user wasn't flagged.
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        await handlePaymentSucceeded(invoice);
        break;
      }

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
