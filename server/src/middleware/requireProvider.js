// requireProvider(category, allowedProviders)
//
// Express middleware factory. Use it at the top of any route that should
// only run when a specific provider is active for an integrations category.
//
// Usage:
//   const requireProvider = require('../middleware/requireProvider');
//   router.post(
//     '/create-session',
//     requireAuth,
//     requireProvider('payment_processor', ['stripe']),
//     handler
//   );
//
// On rejection: returns 503 with a structured body so the frontend can
// render a meaningful message instead of a generic error:
//   { error: '...', reason: 'provider_not_active', category, current_provider }
//
// Fails CLOSED on DB read errors: if we can't read the integrations
// table, we refuse the request rather than risk acting on a stale flag.
// Categories where fail-open is preferable can wrap their own logic.

'use strict';

const { getActiveProvider } = require('../lib/integrations-read');

function requireProvider(category, allowedProviders) {
  if (!category || !Array.isArray(allowedProviders) || allowedProviders.length === 0) {
    throw new Error('requireProvider: category + non-empty allowedProviders required');
  }

  return async function (req, res, next) {
    let current;
    try {
      current = await getActiveProvider(category);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[requireProvider] read failed for ' + category + ':', err.message);
      return res.status(503).json({
        error: 'Service temporarily unavailable.',
        reason: 'integrations_unreadable',
        category: category,
      });
    }

    if (allowedProviders.indexOf(current) === -1) {
      return res.status(503).json({
        error:
          'This action is temporarily unavailable. ' +
          'The active provider for ' + category + ' is "' + current +
          '" (expected one of: ' + allowedProviders.join(', ') + ').',
        reason: 'provider_not_active',
        category: category,
        current_provider: current,
        allowed_providers: allowedProviders,
      });
    }
    return next();
  };
}

module.exports = requireProvider;
