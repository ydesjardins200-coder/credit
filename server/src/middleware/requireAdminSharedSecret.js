// requireAdminSharedSecret
//
// Express middleware that gates a route on the x-admin-shared-secret
// header matching the ADMIN_INTEGRATIONS_SECRET env var. Used by every
// endpoint on this (credit) backend that the iboost-admin service needs
// to call cross-service.
//
// Trust model:
//   - Constant-time compare (crypto.timingSafeEqual) so we don't leak
//     the secret's content via timing differences.
//   - Length mismatch returns false but still does a self-compare to
//     keep timing flat.
//   - Fails CLOSED on server-side misconfig (no env var = 500, never
//     a silent pass).
//   - Returns 401 (not 403) on bad/missing header — matches the
//     convention used elsewhere in this codebase.
//
// Originally defined inline in routes/integrations.js for GET /status.
// Promoted to a shared middleware on 2026-05-27 so the admin's
// upcoming invoice-lookup endpoint can reuse the same gate without
// duplicating security-critical code.

'use strict';

const crypto = require('crypto');

function safeEqual(a, b) {
  const aBuf = Buffer.from(String(a || ''), 'utf8');
  const bBuf = Buffer.from(String(b || ''), 'utf8');
  if (aBuf.length !== bBuf.length) {
    // Still compare-against-self to keep timing roughly constant.
    crypto.timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function requireAdminSharedSecret(req, res, next) {
  const expected = process.env.ADMIN_INTEGRATIONS_SECRET;
  if (!expected) {
    // eslint-disable-next-line no-console
    console.error(
      '[requireAdminSharedSecret] ADMIN_INTEGRATIONS_SECRET not set — endpoint disabled'
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

module.exports = requireAdminSharedSecret;
