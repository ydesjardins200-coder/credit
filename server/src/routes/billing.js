// POST /api/billing/portal-session
//
// Creates a Stripe Customer Portal session for the authenticated user
// and returns its URL. The frontend redirects the browser there; the
// user updates their payment method (and views invoices) on Stripe's
// hosted page, then returns to our site via the return_url.
//
// Scope of the portal (configured in the Stripe dashboard, NOT here):
//   - Update payment method  -> ENABLED (the reason this exists)
//   - View invoice history    -> ENABLED (harmless)
//   - Cancel subscription     -> DISABLED (we keep cancel as an
//                                agent-mediated action with reason
//                                tracking; no self-serve side door)
//   - Switch plans            -> DISABLED
//
// Trust model:
//   - requireAuth-gated. The customer id is read from THIS user's own
//     profile via the user-scoped Supabase client (RLS-enforced) — we
//     never accept a customer id from the client.
//   - A user with no stripe_customer_id (Free / manual-grant / never
//     checked out) gets a 400 with a clear reason; the frontend hides
//     the button in that case anyway.
//
// Prerequisite: the Customer Portal must be configured once in the
// Stripe dashboard (Settings -> Billing -> Customer portal) or the
// create() call errors with 'No configuration provided'. We surface
// that as a 502 with the Stripe message so it's diagnosable.

'use strict';

const express = require('express');
const router = express.Router();

const requireAuth = require('../middleware/requireAuth');
const { getStripe } = require('../lib/stripe');
const { schedulePlanChange, cancelToFree, cancelScheduledChange } = require('../lib/subscription-ops');

const FRONTEND_URL =
  process.env.FRONTEND_URL || 'https://iboostcredit.netlify.app';

router.post('/portal-session', requireAuth, async function (req, res, next) {
  try {
    const userId = req.user.id;

    // Read THIS user's customer id via the user-scoped client (RLS).
    const { data: profile, error: profErr } = await req.supabase
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', userId)
      .single();

    if (profErr) {
      // eslint-disable-next-line no-console
      console.error('[billing/portal] profile read failed:', profErr.message);
      return res.status(500).json({ error: 'Could not read profile.' });
    }

    const customerId = profile && profile.stripe_customer_id;
    if (!customerId) {
      // No Stripe customer — nothing to manage. Frontend should hide the
      // button in this state, but guard the endpoint regardless.
      return res.status(400).json({
        error: 'No billing account on file.',
        reason: 'no_stripe_customer',
      });
    }

    let session;
    try {
      const stripe = getStripe();
      session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: FRONTEND_URL + '/account/profile',
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[billing/portal] session create failed:', err.message);
      // Most common first-run cause: portal not configured in the
      // dashboard. Pass Stripe's message through so it's diagnosable.
      return res.status(502).json({
        error: 'Could not open the billing portal: ' + err.message,
      });
    }

    return res.json({ url: session.url });
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------
// POST /api/billing/change-plan  (self-service, paid <-> paid)
// The authenticated user changes their own plan. Effective next cycle,
// no proration. Free users hit this with no sub -> 400 directing them to
// checkout. Body: { target_plan }
// ---------------------------------------------------------------------
router.post('/change-plan', requireAuth, async function (req, res, next) {
  try {
    const userId = req.user.id;
    const targetPlan = (req.body && req.body.target_plan) || '';
    const result = await schedulePlanChange(userId, targetPlan, 'cad', 'self:' + userId);
    return res.status(result.status).json(result.body);
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------
// POST /api/billing/cancel  (self-service, paid -> free)
// The authenticated user cancels their own subscription at period end.
// The retention flow lives on the frontend; by the time this is called
// the user has chosen to proceed. Body: { reason?, note? }
// ---------------------------------------------------------------------
router.post('/cancel', requireAuth, async function (req, res, next) {
  try {
    const userId = req.user.id;
    const reason = (req.body && req.body.reason) || 'customer_request';
    const note = (req.body && req.body.note) || '';
    const result = await cancelToFree(userId, reason, note, 'self:' + userId);
    return res.status(result.status).json(result.body);
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------
// POST /api/billing/cancel-scheduled-change  (self-service)
// Undo a pending scheduled plan change — releases the schedule, the user
// stays on their current plan. No body needed.
// ---------------------------------------------------------------------
router.post('/cancel-scheduled-change', requireAuth, async function (req, res, next) {
  try {
    const userId = req.user.id;
    const result = await cancelScheduledChange(userId, 'self:' + userId);
    return res.status(result.status).json(result.body);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
