// Read the currently-active provider for an integrations category.
//
// Source of truth: public.integrations table. Updated by the admin via
// PATCH /api/settings/integrations/:category on the iboost-admin service.
//
// Caching: short in-memory TTL so a flip in admin propagates within
// ~10s without us hammering Supabase on every request. Cache is process-
// local; Railway runs one container per service today, so this is fine.
// If we ever scale to multiple replicas, a flip would take up to TTL to
// propagate across replicas (still fine for an admin toggle).
//
// Used by:
//   - middleware/requireProvider.js (route gating)
//   - routes/integrations.js GET /availability (public read for the frontend)
//   - any future code that needs to know which provider is active

'use strict';

const { supabaseAdmin } = require('./supabase');

const TTL_MS = 10 * 1000; // 10 seconds

// Default fallback when the table is unreadable or a category is missing.
// 'manual' is the always-safe default — every category defines what manual
// means in its own context, and 'manual' is allowed for every category.
const DEFAULT_PROVIDER = 'manual';

// Single shared cache: { activeMap: { category -> providerKey }, fetchedAt }
let cache = null;

async function fetchActiveMap() {
  const { data, error } = await supabaseAdmin
    .from('integrations')
    .select('category, active_provider_key');
  if (error) {
    // Throw — the caller decides whether to fail-closed (block the
    // request) or fail-open (assume manual). For payment routes we
    // want fail-closed; for less critical surfaces, fail-open.
    throw new Error('integrations read failed: ' + error.message);
  }
  const map = {};
  (data || []).forEach(function (row) {
    map[row.category] = row.active_provider_key || DEFAULT_PROVIDER;
  });
  return map;
}

// Returns the active provider key string for the given category.
// Options:
//   { fresh: true } -> bypass cache, re-read from DB
async function getActiveProvider(category, options) {
  const opts = options || {};

  if (!opts.fresh && cache && Date.now() - cache.fetchedAt < TTL_MS) {
    return cache.activeMap[category] || DEFAULT_PROVIDER;
  }

  const activeMap = await fetchActiveMap();
  cache = { activeMap: activeMap, fetchedAt: Date.now() };
  return activeMap[category] || DEFAULT_PROVIDER;
}

// Bulk read — returns the full { category -> provider } map. Used by
// the public /availability endpoint so the frontend gets the whole
// picture in one call.
async function getActiveMap(options) {
  const opts = options || {};
  if (!opts.fresh && cache && Date.now() - cache.fetchedAt < TTL_MS) {
    return Object.assign({}, cache.activeMap);
  }
  const activeMap = await fetchActiveMap();
  cache = { activeMap: activeMap, fetchedAt: Date.now() };
  return Object.assign({}, activeMap);
}

// Invalidate the cache manually (e.g. tests, or if we ever wire an
// admin->backend webhook on flips).
function invalidate() {
  cache = null;
}

module.exports = {
  getActiveProvider,
  getActiveMap,
  invalidate,
  DEFAULT_PROVIDER,
  TTL_MS,
};
