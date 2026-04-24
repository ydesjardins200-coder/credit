// iBoost — plans loader.
//
// Fetches subscription plan catalog from Supabase public.plans table,
// with a sessionStorage cache to minimize DB egress.
//
// Why this exists:
//   Plan data (name, prices, perks) used to be hardcoded in multiple
//   places (account.js PLAN_META, checkout.js PLANS) that drifted from
//   pricing.html. Migration 0012 made public.plans the source of truth
//   and the admin UI can edit it. This loader wires the frontend to
//   read from the DB.
//
// Cache strategy:
//   - sessionStorage key: 'iboost_plans_cache_v1'
//   - TTL: 24 hours (plans rarely change; staleness is low-harm)
//   - Cache clears automatically when user closes the browser
//   - Two tabs share the cache (sessionStorage is per-tab, but if
//     they both load fresh, that's still <10 KB of data)
//
// Exposed as window.iboostPlans:
//   getPlans(opts)    -> Promise<Plan[]>   sorted by sort_order
//   getPlan(key, opts) -> Promise<Plan | null>
//   getPlansMap(opts)  -> Promise<{free, essential, complete}>
//   invalidate()       -> clear the cache (used on explicit refresh)
//   FRESH              -> constant flag for opts.fresh (bypass cache)
//
// Opts shape: { fresh: true } to bypass cache (used by checkout.html,
// where seeing the correct price at the payment moment matters).

(function () {
  'use strict';

  var CACHE_KEY = 'iboost_plans_cache_v1';
  var TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

  // Fallback data used ONLY if:
  //   (a) Supabase client isn't available (unlikely — auth.js loads first)
  //   (b) The plans table query fails
  //   (c) sessionStorage is disabled (private browsing weirdness)
  // Mirrors pricing.html verbatim — the same seed used in migration
  // 0012. If the fetch fails, user sees THIS (not a broken page).
  //
  // Kept in this file instead of a separate constants file because
  // this is the natural home — the loader's fallback IS the fallback.
  // If you edit plans via admin and ALSO ship a frontend update,
  // update this array to match the new defaults.
  var FALLBACK_PLANS = [
    {
      plan_key: 'free',
      name: 'Free',
      tagline: 'Learn the system. Build the habits. Upgrade when you\'re ready.',
      price_usd: 0,
      price_cad: 0,
      sort_order: 1,
      perks: [
        { text: 'Full budget app (manual entry)', emphasized: false, muted: false },
        { text: 'Complete education library', emphasized: false, muted: false },
        { text: 'Manual score dashboard', emphasized: false, muted: false },
        { text: 'Monthly credit tips newsletter', emphasized: false, muted: false },
        { text: 'No bureau reporting', emphasized: false, muted: true },
        { text: 'No AI guidance', emphasized: false, muted: true },
        { text: 'Community support only', emphasized: false, muted: true }
      ]
    },
    {
      plan_key: 'essential',
      name: 'iBoost Essential',
      tagline: 'Real credit work without the premium add-ons.',
      price_usd: 15,
      price_cad: 20,
      sort_order: 2,
      perks: [
        { text: '$750 reported credit line', emphasized: false, muted: false },
        { text: 'Monthly reporting to all major bureaus', emphasized: false, muted: false },
        { text: 'Monthly score refresh', emphasized: false, muted: false },
        { text: 'Budget app with goals & smart transaction screening', emphasized: false, muted: false },
        { text: 'Monthly AI credit tip', emphasized: false, muted: false },
        { text: 'Complete education library', emphasized: false, muted: false },
        { text: 'Email support (48-hour response)', emphasized: false, muted: false }
      ]
    },
    {
      plan_key: 'complete',
      name: 'iBoost Complete',
      tagline: 'Everything we offer. Maximum score-building velocity.',
      price_usd: 30,
      price_cad: 40,
      sort_order: 3,
      perks: [
        { text: '$2,000 reported credit line', emphasized: true, muted: false },
        { text: 'Monthly reporting to all major bureaus', emphasized: false, muted: false },
        { text: 'Weekly score refresh', emphasized: true, muted: false },
        { text: 'Budget app with goals & smart transaction screening', emphasized: false, muted: false },
        { text: 'Unlimited on-demand AI advice', emphasized: true, muted: false },
        { text: 'Complete education library', emphasized: false, muted: false },
        { text: 'Dispute assistance for report errors', emphasized: true, muted: false },
        { text: 'Priority support, 7 days a week', emphasized: true, muted: false }
      ]
    }
  ];

  // In-memory cache: survives multiple getPlans() calls within the
  // same pageview without touching sessionStorage each time. Cleared
  // on invalidate(). May be null if never loaded.
  var memoryCache = null;

  // ----------------- cache helpers -----------------

  function readFromStorage() {
    try {
      var raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var entry = JSON.parse(raw);
      if (!entry || typeof entry !== 'object') return null;
      if (!entry.expiresAt || !Array.isArray(entry.plans)) return null;
      if (Date.now() >= entry.expiresAt) return null;  // expired
      return entry.plans;
    } catch (err) {
      // JSON parse error, sessionStorage blocked, etc. Fall through.
      return null;
    }
  }

  function writeToStorage(plans) {
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({
        plans: plans,
        expiresAt: Date.now() + TTL_MS,
        cachedAt: Date.now()
      }));
    } catch (err) {
      // Quota or blocked storage — silently fail, next call just
      // hits the DB again. Not fatal.
    }
  }

  function clearStorage() {
    try { sessionStorage.removeItem(CACHE_KEY); } catch (e) { /* noop */ }
  }

  // ----------------- fetch from Supabase -----------------

  async function fetchFromDb() {
    var auth = window.iboostAuth;
    if (!auth || !auth.client) {
      console.warn('[iboost-plans] Supabase client not available — using fallback');
      return FALLBACK_PLANS;
    }

    try {
      var result = await auth.client
        .from('plans')
        .select('plan_key, name, tagline, price_usd, price_cad, perks, sort_order')
        .order('sort_order', { ascending: true });

      if (result.error) {
        console.warn('[iboost-plans] DB query failed:', result.error.message);
        return FALLBACK_PLANS;
      }
      if (!Array.isArray(result.data) || result.data.length === 0) {
        console.warn('[iboost-plans] Empty plans result — using fallback');
        return FALLBACK_PLANS;
      }
      return result.data;
    } catch (err) {
      console.warn('[iboost-plans] Unexpected error:', err);
      return FALLBACK_PLANS;
    }
  }

  // ----------------- public API -----------------

  async function getPlans(opts) {
    opts = opts || {};

    if (opts.fresh) {
      // Caller wants the freshest data (e.g. checkout). Skip all
      // caches, hit DB, and update caches for subsequent calls.
      var fresh = await fetchFromDb();
      memoryCache = fresh;
      writeToStorage(fresh);
      return fresh;
    }

    // 1. Memory cache (same pageview, multiple calls)
    if (memoryCache) return memoryCache;

    // 2. sessionStorage (tab-persistent until close)
    var cached = readFromStorage();
    if (cached) {
      memoryCache = cached;
      return cached;
    }

    // 3. DB
    var plans = await fetchFromDb();
    memoryCache = plans;
    writeToStorage(plans);
    return plans;
  }

  async function getPlan(key, opts) {
    var plans = await getPlans(opts);
    return plans.find(function (p) { return p.plan_key === key; }) || null;
  }

  async function getPlansMap(opts) {
    var plans = await getPlans(opts);
    var map = {};
    plans.forEach(function (p) { map[p.plan_key] = p; });
    return map;
  }

  function invalidate() {
    memoryCache = null;
    clearStorage();
  }

  window.iboostPlans = {
    getPlans: getPlans,
    getPlan: getPlan,
    getPlansMap: getPlansMap,
    invalidate: invalidate,
    FALLBACK_PLANS: FALLBACK_PLANS
  };
}());
