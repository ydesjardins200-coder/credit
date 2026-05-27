// GET /api/integrations/status
//
// Authoritative integration-feasibility check for the customer backend.
//
// Purpose: the iBoost admin service (a separate Railway service) needs
// to know which integrations on THIS service are actually configured —
// e.g. "does the credit backend have STRIPE_SECRET_KEY set?". Before
// this endpoint, the admin checked its own env vars, which gave wrong
// answers because the Stripe keys deliberately live here (the customer
// backend) and not on the admin (private locked room, no payment keys).
//
// Trust model:
//   - This endpoint is on a public URL, so it MUST not be open.
//   - It is gated by a shared secret header (x-admin-shared-secret)
//     checked against ADMIN_INTEGRATIONS_SECRET, with constant-time
//     compare to resist timing attacks.
//   - It NEVER returns secret values themselves. Only booleans, the
//     Stripe key mode (test/live), and a short masked prefix that lets
//     the admin display "sk_test_…" for operator awareness.
//   - 401 on missing/bad secret; 500 if the server itself isn't
//     configured (so we never silently pass with auth disabled).

'use strict';

const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const { getActiveMap } = require('../lib/integrations-read');

// Constant-time string compare. Returns false for length mismatch
// without leaking the length difference via early-exit timing.
function safeEqual(a, b) {
  const aBuf = Buffer.from(String(a || ''), 'utf8');
  const bBuf = Buffer.from(String(b || ''), 'utf8');
  if (aBuf.length !== bBuf.length) {
    // Still do a compare against self to keep timing flat-ish.
    crypto.timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function requireSharedSecret(req, res, next) {
  const expected = process.env.ADMIN_INTEGRATIONS_SECRET;
  if (!expected) {
    // Fail closed: if WE are misconfigured, do not pretend the request
    // was unauthorized — surface a 500 so the admin can show "unknown"
    // and an operator can fix it.
    // eslint-disable-next-line no-console
    console.error(
      '[integrations] ADMIN_INTEGRATIONS_SECRET not set — endpoint disabled'
    );
    return res
      .status(500)
      .json({ error: 'Server misconfigured: shared secret not set' });
  }
  const provided = req.headers['x-admin-shared-secret'] || '';
  if (!safeEqual(provided, expected)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
}

// Inspect the Stripe key WITHOUT returning the secret itself. Returns a
// summary the admin can render: configured y/n, mode (test/live/unknown),
// short masked prefix for operator-eyeball confirmation.
function inspectStripeKey() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || typeof key !== 'string') {
    return { configured: false, mode: null, key_prefix: null };
  }
  let mode = 'unknown';
  if (key.startsWith('sk_test_') || key.startsWith('rk_test_')) mode = 'test';
  else if (key.startsWith('sk_live_') || key.startsWith('rk_live_')) mode = 'live';
  return {
    configured: true,
    mode: mode,
    // Mask everything after the prefix. Keeps the operator-useful bit
    // (test vs live, first chars) without leaking the key.
    key_prefix: key.slice(0, 8) + '\u2026',
  };
}

router.get('/status', requireSharedSecret, function (req, res) {
  const stripeKey = inspectStripeKey();
  const webhookSecretSet = !!process.env.STRIPE_WEBHOOK_SECRET;
  const essentialPriceSet = !!process.env.STRIPE_PRICE_ESSENTIAL_CAD;
  const completePriceSet = !!process.env.STRIPE_PRICE_COMPLETE_CAD;

  // Stripe is "feasible" only if ALL required pieces are in place. The
  // admin uses this single boolean to decide whether the operator is
  // allowed to switch payment_processor to 'stripe'.
  const stripeFeasible =
    stripeKey.configured &&
    webhookSecretSet &&
    essentialPriceSet &&
    completePriceSet;

  res.json({
    service: 'iboost-api',
    timestamp: new Date().toISOString(),
    integrations: {
      payment_processor: {
        // 'stripe' is the only non-manual provider we support here.
        stripe: {
          feasible: stripeFeasible,
          key: stripeKey, // { configured, mode, key_prefix } — never the raw key
          webhook_secret_set: webhookSecretSet,
          price_ids_set: {
            essential_cad: essentialPriceSet,
            complete_cad: completePriceSet,
          },
        },
      },
    },
  });
});

// GET /api/integrations/availability
//
// PUBLIC endpoint (no auth) — the frontend hits this to learn which
// provider is active per integrations category, so it can render the
// right UI without exposing any secrets.
//
// Returns ONLY what the public needs: the active provider key per
// category, full stop. No env-var info, no key prefixes, no API hints.
router.get('/availability', async function (req, res) {
  try {
    const activeMap = await getActiveMap();
    res.json({
      timestamp: new Date().toISOString(),
      providers: activeMap, // { payment_processor: 'stripe', email_provider: 'manual', ... }
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[integrations] availability read failed:', err.message);
    // Fail-open shape: empty providers map. Frontend treats this as
    // "everything's manual" → safer than 500ing the page.
    res.json({
      timestamp: new Date().toISOString(),
      providers: {},
      error: 'integrations table unavailable',
    });
  }
});

module.exports = router;
