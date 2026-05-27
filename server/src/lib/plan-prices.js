// Plan → Stripe Price ID resolver.
//
// Maps an iBoost plan key (+ currency) to the Stripe Price ID that the
// Checkout Session should subscribe the customer to. Price IDs live in
// env vars, NOT in code — so the sandbox→live switch is purely an env
// change with zero code edits, and no price_ IDs end up in git.
//
// --- v1 scope: CAD ONLY ---
// The US launch is undecided, so we deliberately do not build USD
// plumbing yet. Currency is accepted as a parameter and validated, but
// only 'cad' is supported. When/if USD launches, the work is:
//   1. Create USD prices in the Stripe dashboard.
//   2. Add STRIPE_PRICE_ESSENTIAL_USD / STRIPE_PRICE_COMPLETE_USD env vars.
//   3. Add the 'usd' branch to PRICE_ENV below.
// No other code changes required. The shape below is intentionally
// keyed by currency so that extension is additive, not a rewrite.

'use strict';

// Map of currency → plan key → env var name holding the Price ID.
// Only CAD is populated for v1.
const PRICE_ENV = {
  cad: {
    essential: 'STRIPE_PRICE_ESSENTIAL_CAD',
    complete: 'STRIPE_PRICE_COMPLETE_CAD',
  },
  // usd: { essential: 'STRIPE_PRICE_ESSENTIAL_USD', complete: 'STRIPE_PRICE_COMPLETE_USD' },
};

// Plan keys that are actually purchasable. 'free' is intentionally absent:
// the free tier never goes through Stripe checkout, so a request to create
// a paid session for 'free' is a caller bug, not a valid path.
const PAID_PLAN_KEYS = ['essential', 'complete'];

const SUPPORTED_CURRENCIES = Object.keys(PRICE_ENV); // ['cad'] for now

/**
 * Resolve a Stripe Price ID for a plan + currency.
 *
 * @param {string} planKey  - 'essential' | 'complete'
 * @param {string} currency - 'cad' (only CAD supported in v1)
 * @returns {{ priceId: string }} on success
 * @throws  {Error} with a `.statusCode` of 400 for bad input, 500 for
 *          missing server config (env var not set).
 */
function resolvePriceId(planKey, currency) {
  const key = String(planKey || '').toLowerCase();
  const cur = String(currency || '').toLowerCase();

  if (!PAID_PLAN_KEYS.includes(key)) {
    const err = new Error(
      'Invalid or non-purchasable plan: ' + JSON.stringify(planKey)
    );
    err.statusCode = 400;
    throw err;
  }

  if (!SUPPORTED_CURRENCIES.includes(cur)) {
    const err = new Error(
      'Unsupported currency: ' +
        JSON.stringify(currency) +
        '. v1 supports CAD only.'
    );
    err.statusCode = 400;
    throw err;
  }

  const envName = PRICE_ENV[cur][key];
  const priceId = process.env[envName];

  if (!priceId) {
    // Config error, not user error. The plan/currency were valid but the
    // server is missing the Price ID env var. Fail loud — a paid checkout
    // must never proceed without a real price.
    const err = new Error(
      'Server misconfigured: ' + envName + ' is not set.'
    );
    err.statusCode = 500;
    throw err;
  }

  return { priceId };
}

module.exports = {
  resolvePriceId,
  PAID_PLAN_KEYS,
  SUPPORTED_CURRENCIES,
};
