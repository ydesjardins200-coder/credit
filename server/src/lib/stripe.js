// Stripe SDK client.
//
// Server-only. Initializes the Stripe client from STRIPE_SECRET_KEY and
// pins the API version so a dashboard-side version bump can't silently
// change behavior in production (a documented Stripe footgun).
//
// Lazy-initialized: the service can boot without Stripe configured (e.g.
// the health check still works), but any code that actually calls
// getStripe() when the key is missing fails loud rather than silently
// no-op'ing a payment path.
//
// API version is pinned to the value the installed SDK (stripe@22.1.1)
// was generated against: 2026-04-22.dahlia. If you upgrade the stripe
// package, review this pin against the new SDK's baked-in version and
// Stripe's changelog before bumping.

'use strict';

const Stripe = require('stripe');

// Pin explicitly. Do NOT remove — unpinned API versions are a known
// source of silent production breakage.
const STRIPE_API_VERSION = '2026-04-22.dahlia';

let _client = null;

function getStripe() {
  if (_client) return _client;

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      'Stripe not configured: set STRIPE_SECRET_KEY (use a sandbox/test ' +
        'key like sk_test_… until launch).'
    );
  }

  _client = new Stripe(key, {
    apiVersion: STRIPE_API_VERSION,
    // Helps Stripe attribute API traffic; harmless if it doesn't match
    // a registered app. Useful in support tickets.
    appInfo: { name: 'iboost-server', version: '0.1.0' },
  });
  return _client;
}

module.exports = { getStripe, STRIPE_API_VERSION };
