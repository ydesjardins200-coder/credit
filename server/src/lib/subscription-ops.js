// Shared subscription operations — ONE source of truth for the Stripe
// plan-change mechanics, called by BOTH the admin route (operator action,
// secret-gated) and the customer billing route (self-service, auth-gated).
//
// Keeping this logic in one place avoids two divergent copies of
// billing-critical code. The callers differ only in WHO is authorized;
// the Stripe + DB mechanics are identical.
//
// Policy: changes take effect at the next billing cycle, no proration,
// no partial refund.
//   - scheduleePlanChange: paid<->paid via Stripe Subscription Schedule
//   - cancelToFree:         paid->free via cancel-at-period-end
//
// Each returns { ok, status, body } where body is the JSON payload the
// route should return (or an { error, reason } on failure).

'use strict';

const { getStripe } = require('./stripe');
const { supabaseAdmin } = require('./supabase');
const { resolvePriceId } = require('./plan-prices');

function unixToIso(unixSeconds) {
  if (!unixSeconds) return null;
  return new Date(unixSeconds * 1000).toISOString();
}
function readPeriodEndUnix(sub) {
  const item = sub && sub.items && sub.items.data && sub.items.data[0];
  return (item && item.current_period_end) || (sub && sub.current_period_end) || null;
}

// ---- paid <-> paid : schedule the swap at period end -------------------
async function schedulePlanChange(userId, targetPlan, currency, actor) {
  targetPlan = String(targetPlan || '').toLowerCase();
  currency = String(currency || 'cad').toLowerCase();

  if (targetPlan !== 'essential' && targetPlan !== 'complete') {
    return { ok: false, status: 400, body: { error: 'Target must be a paid plan (essential/complete).' } };
  }
  if (currency !== 'cad') {
    return { ok: false, status: 400, body: { error: 'Only CAD is supported in v1.', reason: 'currency_unsupported' } };
  }

  let targetPriceId;
  try {
    targetPriceId = resolvePriceId(targetPlan, currency).priceId;
  } catch (err) {
    return { ok: false, status: err.statusCode || 500, body: { error: err.message } };
  }

  let profile;
  try {
    const r = await supabaseAdmin
      .from('profiles')
      .select('id, plan, plan_currency, stripe_subscription_id, cancel_at_period_end')
      .eq('id', userId)
      .single();
    if (r.error) {
      if (r.error.code === 'PGRST116') return { ok: false, status: 404, body: { error: 'User not found.' } };
      return { ok: false, status: 500, body: { error: 'Could not read profile.' } };
    }
    profile = r.data;
  } catch (e) {
    return { ok: false, status: 500, body: { error: 'Profile lookup error.' } };
  }

  if (!profile.stripe_subscription_id) {
    return { ok: false, status: 400, body: { error: 'No active subscription to change. Free users must subscribe via checkout.', reason: 'no_subscription' } };
  }
  if (profile.cancel_at_period_end) {
    return { ok: false, status: 409, body: { error: 'Subscription is scheduled to cancel; resume it before changing plans.', reason: 'pending_cancel' } };
  }
  if (profile.plan === targetPlan) {
    return { ok: false, status: 409, body: { error: 'Already on the ' + targetPlan + ' plan.', reason: 'no_change' } };
  }

  let effectiveAtIso;
  try {
    const stripe = getStripe();
    const schedule = await stripe.subscriptionSchedules.create(
      { from_subscription: profile.stripe_subscription_id },
      { idempotencyKey: 'sched-create-' + userId + '-' + Date.now() }
    );
    const phase0 = (schedule.phases && schedule.phases[0]) || {};
    const currentItems = (phase0.items || []).map(function (it) {
      return { price: it.price, quantity: it.quantity || 1 };
    });
    const updated = await stripe.subscriptionSchedules.update(
      schedule.id,
      {
        end_behavior: 'release',
        proration_behavior: 'none',
        phases: [
          { items: currentItems.length ? currentItems : undefined, start_date: phase0.start_date, end_date: phase0.end_date },
          { items: [{ price: targetPriceId, quantity: 1 }] },
        ],
      },
      { idempotencyKey: 'sched-update-' + userId + '-' + Date.now() }
    );
    const p0end = (updated.phases && updated.phases[0] && updated.phases[0].end_date) || phase0.end_date || null;
    effectiveAtIso = p0end ? unixToIso(p0end) : null;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[sub-ops/schedule] stripe error:', err.message);
    return { ok: false, status: 502, body: { error: 'Payment provider error: ' + err.message } };
  }

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
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[sub-ops/schedule] pending marker threw:', e && e.message);
  }
  try {
    await supabaseAdmin.from('plan_changes').insert({
      user_id: userId,
      from_plan: profile.plan,
      to_plan: targetPlan,
      source: 'admin_schedule',
      effective_at: effectiveAtIso,
      note: 'scheduled at period end; actor=' + (actor || 'unknown'),
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[sub-ops/schedule] history insert threw:', e && e.message);
  }

  return { ok: true, status: 200, body: { ok: true, scheduled: true, target_plan: targetPlan, effective_at: effectiveAtIso } };
}

// ---- paid -> free : cancel at period end -------------------------------
async function cancelToFree(userId, reason, note, actor) {
  let profile;
  try {
    const r = await supabaseAdmin
      .from('profiles')
      .select('id, plan, stripe_subscription_id, cancel_at_period_end')
      .eq('id', userId)
      .single();
    if (r.error) {
      if (r.error.code === 'PGRST116') return { ok: false, status: 404, body: { error: 'User not found.' } };
      return { ok: false, status: 500, body: { error: 'Could not read profile.' } };
    }
    profile = r.data;
  } catch (e) {
    return { ok: false, status: 500, body: { error: 'Profile lookup error.' } };
  }

  if (!profile.stripe_subscription_id) {
    return { ok: false, status: 400, body: { error: 'No active subscription.', reason: 'no_subscription' } };
  }
  if (profile.cancel_at_period_end) {
    return { ok: false, status: 409, body: { error: 'Already scheduled to cancel.', reason: 'already_canceling' } };
  }

  let updatedSub;
  try {
    const stripe = getStripe();

    // If a Subscription Schedule governs this sub (e.g. a pending plan
    // change), Stripe refuses a direct cancel_at_period_end on the sub.
    // Release the schedule first — that detaches it and hands control back
    // to the underlying subscription (which keeps running on its current
    // plan), abandoning the pending change. Then we can cancel normally.
    let scheduleId = null;
    try {
      const sub = await stripe.subscriptions.retrieve(profile.stripe_subscription_id);
      scheduleId = sub && sub.schedule
        ? (typeof sub.schedule === 'string' ? sub.schedule : sub.schedule.id)
        : null;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[sub-ops/cancel] sub retrieve failed:', e && e.message);
    }
    if (scheduleId) {
      try {
        await stripe.subscriptionSchedules.release(scheduleId);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[sub-ops/cancel] schedule release failed:', e && e.message);
        return { ok: false, status: 502, body: { error: 'Could not release the pending change before cancelling: ' + e.message } };
      }
    }

    updatedSub = await stripe.subscriptions.update(
      profile.stripe_subscription_id,
      { cancel_at_period_end: true },
      { idempotencyKey: 'cancel-' + userId + '-' + Date.now() }
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[sub-ops/cancel] stripe error:', err.message);
    return { ok: false, status: 502, body: { error: 'Payment provider error: ' + err.message } };
  }

  const effectiveAtIso = unixToIso(readPeriodEndUnix(updatedSub));
  try {
    const r = await supabaseAdmin
      .from('profiles')
      .update({
        cancel_at_period_end: true,
        next_billing_date: effectiveAtIso,
        // Abandon any pending scheduled change — they're leaving, not upgrading.
        pending_plan: null,
        pending_plan_currency: null,
        pending_plan_effective_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);
    if (r.error) {
      // Don't bail — Stripe already accepted the cancel. Log + continue so
      // the history row is still written; the webhook reconciles the flag.
      // eslint-disable-next-line no-console
      console.error('[sub-ops/cancel] profile update failed:', r.error.message);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[sub-ops/cancel] profile update threw:', e && e.message);
  }
  // Mark any pending scheduled-change history rows as cancelled so they
  // drop out of "pending changes" — the upgrade is abandoned on cancel.
  try {
    await supabaseAdmin
      .from('plan_changes')
      .update({ cancelled_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('source', 'admin_schedule')
      .is('cancelled_at', null)
      .gt('effective_at', new Date().toISOString());
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[sub-ops/cancel] mark-schedule-cancelled threw:', e && e.message);
  }
  let pendingRowId = null;
  try {
    const r = await supabaseAdmin.from('plan_changes').insert({
      user_id: userId,
      from_plan: profile.plan,
      to_plan: 'free',
      source: 'admin_cancel',
      effective_at: effectiveAtIso,
      note: 'reason=' + (reason || 'customer_request') + (note ? '; ' + note : '') + '; actor=' + (actor || 'unknown'),
    }).select('id').single();
    if (r.error) {
      // eslint-disable-next-line no-console
      console.error('[sub-ops/cancel] history insert failed:', r.error.message);
    } else {
      pendingRowId = r.data.id;
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[sub-ops/cancel] history insert threw:', e && e.message);
  }

  return { ok: true, status: 200, body: { ok: true, scheduled: true, target_plan: 'free', effective_at: effectiveAtIso, pending_change_id: pendingRowId } };
}

// ---- resume : undo a pending cancel-at-period-end -----------------------
// Stripe-side: cancel_at_period_end = false (no money moves; the sub just
// keeps renewing on its current plan). DB-side: clear the cancel flag and
// any stale pending-change marker (a released schedule is NOT recreated by
// resume), rescind pending admin_cancel/admin_schedule history rows, and
// write an admin_resume audit row. Ported verbatim from the admin route's
// inline implementation during the subscription-ops consolidation.
async function resumeSubscription(userId, note, actor) {
  let profile;
  try {
    const r = await supabaseAdmin
      .from('profiles')
      .select('id, plan, stripe_subscription_id, cancel_at_period_end')
      .eq('id', userId)
      .single();
    if (r.error) {
      if (r.error.code === 'PGRST116') return { ok: false, status: 404, body: { error: 'User not found.' } };
      return { ok: false, status: 500, body: { error: 'Could not read profile.' } };
    }
    profile = r.data;
  } catch (e) {
    return { ok: false, status: 500, body: { error: 'Profile lookup error.' } };
  }

  if (!profile.stripe_subscription_id) {
    return { ok: false, status: 400, body: { error: 'User has no Stripe subscription to resume.', reason: 'no_subscription' } };
  }
  if (!profile.cancel_at_period_end) {
    return { ok: false, status: 409, body: { error: 'Subscription is not scheduled for cancellation.', reason: 'not_canceling' } };
  }

  try {
    const stripe = getStripe();
    await stripe.subscriptions.update(
      profile.stripe_subscription_id,
      { cancel_at_period_end: false },
      { idempotencyKey: 'resume-' + userId + '-' + Date.now() }
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[sub-ops/resume] stripe update failed:', err.message);
    return { ok: false, status: 502, body: { error: 'Payment provider error: ' + err.message } };
  }

  try {
    const r = await supabaseAdmin
      .from('profiles')
      .update({
        cancel_at_period_end: false,
        // A released schedule isn't recreated by resume, so clear any
        // stale pending-change marker too.
        pending_plan: null,
        pending_plan_currency: null,
        pending_plan_effective_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);
    if (r.error) {
      // eslint-disable-next-line no-console
      console.error('[sub-ops/resume] profile update failed:', r.error.message);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[sub-ops/resume] profile update threw:', e && e.message);
  }

  // Rescind pending admin_cancel rows; also clear pending admin_schedule
  // rows — the cancel released their Stripe schedule and resume does NOT
  // recreate it, so a lingering row must not keep showing as pending.
  try {
    const r = await supabaseAdmin
      .from('plan_changes')
      .update({ cancelled_at: new Date().toISOString() })
      .eq('user_id', userId)
      .in('source', ['admin_cancel', 'admin_schedule'])
      .is('cancelled_at', null)
      .gt('effective_at', new Date().toISOString());
    if (r.error) {
      // eslint-disable-next-line no-console
      console.error('[sub-ops/resume] mark-pending failed:', r.error.message);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[sub-ops/resume] mark-pending threw:', e && e.message);
  }

  // Resume audit row (same plan in and out; resume changes nothing else).
  try {
    const r = await supabaseAdmin
      .from('plan_changes')
      .insert({
        user_id: userId,
        from_plan: profile.plan,
        to_plan: profile.plan,
        source: 'admin_resume',
        note: (note ? note + '; ' : '') + 'actor=' + (actor || 'unknown'),
      });
    if (r.error) {
      // eslint-disable-next-line no-console
      console.error('[sub-ops/resume] history insert failed:', r.error.message);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[sub-ops/resume] history insert threw:', e && e.message);
  }

  return { ok: true, status: 200, body: { ok: true, cancel_at_period_end: false } };
}

// ---- Cancel a pending scheduled plan change (undo) ---------------------
// Releases the Stripe Subscription Schedule (the sub returns to normal on
// its CURRENT plan, the phase-2 change never happens — no proration, no
// charge, same renewal date), clears the pending marker, and marks the
// pending admin_schedule history row cancelled. Used when the user (or an
// operator) changes their mind before the scheduled change lands.
async function cancelScheduledChange(userId, actor) {
  let profile;
  try {
    const r = await supabaseAdmin
      .from('profiles')
      .select('id, plan, stripe_subscription_id, pending_plan')
      .eq('id', userId)
      .single();
    if (r.error) {
      if (r.error.code === 'PGRST116') return { ok: false, status: 404, body: { error: 'User not found.' } };
      return { ok: false, status: 500, body: { error: 'Could not read profile.' } };
    }
    profile = r.data;
  } catch (e) {
    return { ok: false, status: 500, body: { error: 'Profile lookup error.' } };
  }

  if (!profile.pending_plan) {
    return { ok: false, status: 409, body: { error: 'No scheduled change to cancel.', reason: 'no_pending_change' } };
  }
  if (!profile.stripe_subscription_id) {
    return { ok: false, status: 400, body: { error: 'No active subscription.', reason: 'no_subscription' } };
  }

  // Release the schedule (if one is attached). Releasing returns the sub
  // to a normal subscription on its current plan; the future phase is
  // dropped. Idempotent-ish: if no schedule is found we still clear the
  // marker so the UI recovers from any drift.
  try {
    const stripe = getStripe();
    let scheduleId = null;
    try {
      const sub = await stripe.subscriptions.retrieve(profile.stripe_subscription_id);
      scheduleId = sub && sub.schedule
        ? (typeof sub.schedule === 'string' ? sub.schedule : sub.schedule.id)
        : null;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[sub-ops/cancel-scheduled] sub retrieve failed:', e && e.message);
    }
    if (scheduleId) {
      await stripe.subscriptionSchedules.release(scheduleId);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[sub-ops/cancel-scheduled] release failed:', err.message);
    return { ok: false, status: 502, body: { error: 'Could not cancel the scheduled change: ' + err.message } };
  }

  // Clear the pending marker.
  try {
    await supabaseAdmin
      .from('profiles')
      .update({
        pending_plan: null,
        pending_plan_currency: null,
        pending_plan_effective_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[sub-ops/cancel-scheduled] marker clear threw:', e && e.message);
  }

  // Mark the pending admin_schedule history row(s) cancelled.
  try {
    await supabaseAdmin
      .from('plan_changes')
      .update({ cancelled_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('source', 'admin_schedule')
      .is('cancelled_at', null)
      .gt('effective_at', new Date().toISOString());
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[sub-ops/cancel-scheduled] mark-cancelled threw:', e && e.message);
  }

  // Audit row noting the scheduled change was cancelled (stays on current plan).
  try {
    await supabaseAdmin.from('plan_changes').insert({
      user_id: userId,
      from_plan: profile.plan,
      to_plan: profile.plan, // no actual change — they keep current plan
      source: 'admin_resume', // reuse: "undo a pending change, no money moves"
      note: 'cancelled scheduled change to ' + profile.pending_plan + '; actor=' + (actor || 'unknown'),
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[sub-ops/cancel-scheduled] audit insert threw:', e && e.message);
  }

  return { ok: true, status: 200, body: { ok: true, cancelled_scheduled_change: true, plan: profile.plan } };
}

module.exports = { schedulePlanChange, cancelToFree, resumeSubscription, cancelScheduledChange };
