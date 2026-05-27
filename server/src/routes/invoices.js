// GET /api/invoices/mine
//
// Returns the authenticated user's Stripe invoices, sanitized for the
// frontend. Auth-gated by requireAuth so a user can only ever see their
// own invoices — the Stripe customer ID is looked up from THIS user's
// profile via the user-scoped Supabase client (RLS enforces the bound).
//
// Trust model:
//   - We DO NOT accept a customer ID from the client. The frontend can't
//     ask for someone else's invoices, even if it knows their ID.
//   - The profile read uses req.supabase (user-scoped client, with the
//     user's JWT applied). RLS policies on profiles ensure they can
//     only read their own row.
//   - The shape we return is a curated projection — not Stripe's full
//     object. Avoids leaking fields we'd later wish we hadn't.
//
// No cache: invoices are infrequent reads (a profile page hit), they
// change in ways the user expects to see immediately (new monthly
// invoice, refunds). Direct passthrough is fine; Stripe rate-limits
// generously enough that this won't be a problem at our scale.

'use strict';

const express = require('express');
const router = express.Router();

const requireAuth = require('../middleware/requireAuth');
const { getStripe } = require('../lib/stripe');

// How many invoices to return. 12 = roughly a year of monthly billing.
// More than enough for the profile UI; admin can expand later if needed.
const INVOICE_LIMIT = 12;

// Curated projection — only the fields the UI actually needs.
// Keeping this list explicit (vs. returning the whole Stripe object)
// means we can extend safely without accidentally exposing new Stripe
// fields if the API changes.
function projectInvoice(inv) {
  if (!inv) return null;
  return {
    id: inv.id,
    number: inv.number || null,           // human-readable invoice number, e.g. "ABC-0001"
    status: inv.status,                    // draft | open | paid | uncollectible | void
    created: inv.created,                  // unix seconds
    period_start: inv.period_start || null, // unix seconds
    period_end: inv.period_end || null,
    amount_due: inv.amount_due,            // in smallest currency unit (cents)
    amount_paid: inv.amount_paid,
    amount_remaining: inv.amount_remaining,
    currency: inv.currency,                // 'cad', 'usd', etc.
    hosted_invoice_url: inv.hosted_invoice_url || null, // public-link PDF/HTML page
    invoice_pdf: inv.invoice_pdf || null,               // direct PDF download
  };
}

router.get('/mine', requireAuth, async function (req, res, next) {
  try {
    const userId = req.user.id;

    // Read THIS user's profile via the user-scoped client. RLS makes
    // it impossible to read any other user's row.
    const { data: profile, error: profErr } = await req.supabase
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', userId)
      .single();

    if (profErr) {
      // If the read fails, surface a clean error — don't expose internals.
      // eslint-disable-next-line no-console
      console.error('[invoices/mine] profile read failed:', profErr.message);
      return res.status(500).json({ error: 'Could not read profile.' });
    }

    const customerId = profile && profile.stripe_customer_id;
    if (!customerId) {
      // No Stripe customer = no invoices. Could be a Free user, a manual-
      // grant test user, or someone who hasn't subscribed yet. Return an
      // empty list with a hint so the UI can render the right empty state.
      return res.json({
        has_stripe_customer: false,
        invoices: [],
      });
    }

    let stripeResp;
    try {
      const stripe = getStripe();
      stripeResp = await stripe.invoices.list({
        customer: customerId,
        limit: INVOICE_LIMIT,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[invoices/mine] stripe.invoices.list failed:', err.message);
      // Don't leak Stripe's internal error to the client. The UI just
      // needs to know "we couldn't fetch them; try again."
      return res.status(502).json({
        error: 'Could not fetch invoices from payment provider.',
      });
    }

    const invoices = (stripeResp.data || []).map(projectInvoice);

    return res.json({
      has_stripe_customer: true,
      customer_id: customerId,
      invoices: invoices,
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
