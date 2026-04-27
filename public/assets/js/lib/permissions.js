/**
 * iBoost permissions module — single source of truth for tier-based
 * feature access control on /account.html.
 *
 * Mirrors the pattern of lib/locale.js: a single rule table (FEATURE_GATES),
 * a small public API, and conventions for unknown/edge-case inputs.
 *
 * The matrix of decisions this implements lives in docs/tier-feature-matrix.md.
 * If gates change here, update the doc. If the doc changes, update gates here.
 *
 * USAGE
 *   const result = window.iboostPermissions.canAccess('credit.tab', profile);
 *   //   'allowed'         — render normally
 *   //   'locked-visible'  — render the UI but apply the lock overlay
 *   //   'hidden'          — hide the element entirely
 *
 *   const tier = window.iboostPermissions.getTier(profile);
 *   //   'free' | 'essential' | 'complete'  (null plan -> 'free')
 *
 *   const meets = window.iboostPermissions.tierAtLeast(profile, 'essential');
 *   //   true / false  — convenience for content-adaptive logic
 *
 * INPUT
 *   The functions accept a full profile object (not just a plan string),
 *   so when Stripe integration lands and we add `subscription_status` +
 *   `current_period_end` fields, we extend canAccess() internally without
 *   changing any caller. See "Future: active/cancelled" notes below.
 *
 * EDGE CASES
 *   - profile.plan === null  -> treated as 'free' (pre-checkout edge case,
 *                               matches existing account.js convention at
 *                               line 828-830 — "users who skipped checkout")
 *   - profile === null/undef -> treated as 'free'
 *   - unknown plan value     -> treated as 'free' (defensive; should never
 *                               happen because DB has a CHECK constraint)
 *   - score-gated features   -> require profile.score numeric value;
 *                               missing/null score = 'hidden' (Free users
 *                               don't have a score, gate evaluates as
 *                               not-yet-reached)
 *
 * FUTURE: active/cancelled subscription state
 *   When Stripe lands, profile will gain:
 *     - subscription_status: 'active' | 'past_due' | 'cancelled' | 'incomplete'
 *     - current_period_end:  ISO timestamp
 *
 *   The internal logic of canAccess() will check these fields:
 *     - cancelled BUT current_period_end > now -> still 'allowed' (paid up)
 *     - cancelled AND current_period_end <= now -> demote to free
 *     - past_due (grace period) -> still 'allowed' (you don't kick paying
 *                                  users for one failed charge)
 *
 *   The public API does NOT change. Callers always pass the full profile;
 *   internal logic decides the right answer.
 *
 *   Tracked in docs/tier-feature-matrix.md "open follow-ups".
 */

(function () {
  'use strict';

  // ---------- Tier ranking ----------
  // Higher rank = more features unlocked. Used for "minTier" comparisons.
  // If you add a new tier between essential and complete, just renumber.
  const TIER_RANK = {
    free: 0,
    essential: 1,
    complete: 2,
  };

  function rankOf(tier) {
    return TIER_RANK[tier] != null ? TIER_RANK[tier] : 0;
  }

  // ---------- Feature gate table ----------
  //
  // Schema:
  //   minTier:   string — minimum tier required for access ('free'|'essential'|'complete')
  //              Default: 'free' (everyone passes if omitted)
  //   maxTier:   string — maximum tier where this gate is "for" this tier
  //              Used for Free-only features (smart suggestions etc.)
  //   mode:      'visible-locked' | (undefined)
  //              When user fails the gate:
  //                'visible-locked' -> return 'locked-visible' (show with overlay)
  //                undefined        -> return 'hidden'         (hide entirely)
  //              Default: 'hidden'
  //   scoreGate: number — minimum credit score required (orthogonal to tier)
  //              When user's score is below: returns 'hidden'
  //              No score on profile = treated as 0 (gate not yet reached)
  //
  // The matrix mirrors docs/tier-feature-matrix.md. If you change one,
  // change the other.
  const FEATURE_GATES = {

    // ---------- Welcome ----------
    'welcome.tab':                   { minTier: 'free' },
    'welcome.greeting':              { minTier: 'free' },
    'welcome.streak':                { minTier: 'free' },
    'welcome.profile_completion':    { minTier: 'free' },
    'welcome.todays_focus':          { minTier: 'free' },
    'welcome.milestones':            { minTier: 'free' },
    // Note: milestones content is tier-ADAPTIVE (different items per tier),
    // not gated. The gate above just controls visibility of the card itself.
    // Caller picks content variant via getTier(profile).

    // ---------- Credit ----------
    // Whole-panel lock for Free today. Per-card gates pre-defined for
    // future per-card mode (matrix doc Phase 2 refactor).
    //
    // credit.tab uses minTier: 'essential' + mode: 'visible-locked' so:
    //   - Free user FAILS the tier check, mode triggers 'locked-visible'
    //     (tab visible, content overlaid with upgrade CTA)
    //   - Essential/Complete PASS the tier check, return 'allowed'
    //     (tab fully accessible)
    'credit.tab':                    { minTier: 'essential', mode: 'visible-locked' },
    'credit.panel_unlock':           { minTier: 'essential' },
    // Below: when we shift to per-card mode, swap the panel-level overlay
    // logic for these. Today they're "shadow gates" — defined but unused.
    'credit.score_gauge':            { minTier: 'essential' },
    'credit.score_graph':            { minTier: 'essential' },
    'credit.ai_tip':                 { minTier: 'essential' },
    'credit.action_items':           { minTier: 'essential' },
    'credit.progress_card':          { minTier: 'essential' },
    'credit.utilization_card':       { minTier: 'essential' },
    'credit.recent_activity':        { minTier: 'essential' },
    'credit.dispute_assistance':     { minTier: 'complete' },

    // ---------- Offers ----------
    // Tab visible to everyone. Internal cards differ by tier (content-adaptive).
    'offers.tab':                    { minTier: 'free' },
    'offers.score_match_card':       { minTier: 'essential' },
    'offers.full_catalog':           { minTier: 'essential' },
    // Free users see a curated starter set instead. Caller picks variant
    // via getTier(profile) (similar pattern to welcome.milestones).

    // ---------- Budget ----------
    'budget.tab':                    { minTier: 'free' },
    'budget.flinks_connection':      { minTier: 'essential' },
    'budget.smart_suggestions':      { minTier: 'free', maxTier: 'free' },
    // ^ smart_suggestions is FREE-ONLY because paid tiers get auto-categorization
    // from Flinks. We don't need both running. maxTier='free' makes this gate
    // return 'hidden' for paid tiers.

    // ---------- Education ----------
    // All free for everyone. Score-gated chapter is orthogonal to tier.
    'education.tab':                 { minTier: 'free' },
    'education.chapter_mortgage':    { scoreGate: 700 },

    // ---------- Profile ----------
    'profile.tab':                   { minTier: 'free' },
    'profile.upgrade_cta_prominent': { minTier: 'free', maxTier: 'free' },
    // ^ Show prominent upgrade CTA only to Free users; paid users see the
    // standard "Change plan" button without the visual emphasis.
    // Hidden sections (payment method, invoices, notifications) are gated by
    // INFRASTRUCTURE availability not tier — those gates aren't here.
  };

  // ---------- Public API ----------

  /**
   * Returns the user's effective tier. Handles null/missing plan as 'free'.
   * This is the right way to ask "what tier is this user?" — never read
   * profile.plan directly elsewhere; go through here.
   */
  function getTier(profile) {
    if (!profile) return 'free';
    var plan = profile.plan;
    if (plan === 'free' || plan === 'essential' || plan === 'complete') {
      return plan;
    }
    // null / undefined / unknown value (DB CHECK should prevent unknown)
    return 'free';
  }

  /**
   * Convenience: "does this user's tier meet the bar of `minTier`?"
   * Use this for content-adaptive logic where you don't need the
   * 'allowed/locked-visible/hidden' tri-state.
   */
  function tierAtLeast(profile, minTier) {
    return rankOf(getTier(profile)) >= rankOf(minTier);
  }

  /**
   * Returns 'allowed' | 'locked-visible' | 'hidden' for a given feature.
   * This is the primary access decision — every gated UI element calls
   * this to decide its render state.
   */
  function canAccess(featureKey, profile) {
    var gate = FEATURE_GATES[featureKey];
    if (!gate) {
      // Unknown feature key — defensive: deny by hiding. Spec violation,
      // surfaces as a JS warning so devs notice during local testing.
      console.warn('[iboost-permissions] Unknown feature key:', featureKey);
      return 'hidden';
    }

    var userTier = getTier(profile);
    var userRank = rankOf(userTier);

    // Score gate (orthogonal to tier). Apply first because it short-circuits.
    if (gate.scoreGate != null) {
      var userScore = (profile && typeof profile.score === 'number')
        ? profile.score
        : 0;
      if (userScore < gate.scoreGate) {
        // Score gates render as locked-visible (show the chapter as locked
        // with a "you're X points away" message — matches existing
        // account.html line 1492-1504 pattern).
        return 'locked-visible';
      }
      // Score gate met — fall through to tier checks (which are usually
      // 'free' for these features anyway).
    }

    // Min-tier check
    var minTier = gate.minTier || 'free';
    var minRank = rankOf(minTier);
    if (userRank < minRank) {
      // User's tier is below the minimum. Mode decides hidden vs locked-visible.
      return gate.mode === 'visible-locked' ? 'locked-visible' : 'hidden';
    }

    // Max-tier check (Free-only features)
    if (gate.maxTier != null) {
      var maxRank = rankOf(gate.maxTier);
      if (userRank > maxRank) {
        // User's tier is above the cap — feature isn't "for them".
        // Hide entirely (these are usually Free-only features that paid
        // tiers replace with something better — no overlay needed).
        return 'hidden';
      }
    }

    return 'allowed';
  }

  /**
   * Returns the recommended upgrade target for a feature when the user
   * doesn't meet the gate. Used by the lock overlay to pick the right
   * "Upgrade to Essential" vs "Upgrade to Complete" CTA.
   *
   * Returns null if the feature is fully accessible to the user.
   */
  function recommendedTier(featureKey, profile) {
    var gate = FEATURE_GATES[featureKey];
    if (!gate) return null;
    if (canAccess(featureKey, profile) === 'allowed') return null;

    // Score-gated features are not solved by upgrading — return null so
    // the overlay can show a different message ("you're X points away").
    if (gate.scoreGate != null) return null;

    return gate.minTier || 'essential';
  }

  // ----- Lock pitches: what the overlay actually says -----
  //
  // Each lock state has its own copy. Two layers:
  //   1. Per-feature pitch (specific — what THIS card unlocks)
  //   2. Generic per-tier fallback (when no per-feature pitch is defined)
  //
  // Structure of each pitch:
  //   { title, body }
  //
  // The CTA button text is composed at render-time by the caller using
  // the recommended tier's plan.name and plan.price_usd / plan.price_cad
  // from the plans table (admin-managed). This keeps prices and plan
  // names dynamic — admin edits in Settings are reflected on the next
  // page load. See account.js wrapWithLockOverlay for the composition.
  //
  // Voice notes for title + body (matches plans-loader.js taglines):
  //   - Action-oriented, verbs forward
  //   - Specific: name the feature, name the benefit
  //   - Not pushy: state what's there, let the user decide

  const LOCK_PITCHES = {

    // ----- Credit tab: whole-panel lock for Free users -----
    'credit.tab': {
      essential: {
        title: 'Unlock your real credit dashboard',
        body: 'Real bureau reporting, monthly score updates, and personalized AI tips to grow your score faster.',
      },
      // No 'complete' variant — credit.tab unlocks at Essential, so users
      // who already have Essential never see this overlay. If they did
      // (data corruption, etc.), the generic fallback would handle it.
    },

    // ----- Credit per-card gates (future per-card mode, not active today) -----
    // These exist so the overlay component doesn't crash if accidentally
    // triggered. Real per-card pitches would be tuned during Phase 2 of
    // the matrix-doc roadmap. For now: useful generic fallbacks.
    'credit.score_gauge': {
      essential: {
        title: 'See your real score',
        body: 'Pull from Equifax, TransUnion, and Experian. See where you stand and how you\'re trending.',
      },
    },
    'credit.score_graph': {
      essential: {
        title: 'Track your score over time',
        body: '6-month trend graph with bureau-by-bureau breakdown. Watch your work pay off.',
      },
    },
    'credit.ai_tip': {
      essential: {
        title: 'Get personalized AI tips',
        body: 'A monthly tip from iBoost\'s AI based on your actual credit profile. Specific, actionable, no fluff.',
      },
      complete: {
        title: 'Get unlimited AI guidance',
        body: 'On-demand AI tips whenever you need them. Ask questions about your credit, get specific advice tailored to your file.',
      },
    },
    'credit.action_items': {
      essential: {
        title: 'Know what to focus on',
        body: 'Each month iBoost shows you the 3 actions most likely to move your score — based on YOUR profile.',
      },
    },
    'credit.progress_card': {
      essential: {
        title: 'Track your tier progress',
        body: 'See exactly how far you are from Very Good (740+), Excellent (800+), and beyond.',
      },
    },
    'credit.utilization_card': {
      essential: {
        title: 'Watch your utilization',
        body: 'Real-time tracking of credit utilization across all your cards. The single biggest score lever you control.',
      },
    },
    'credit.recent_activity': {
      essential: {
        title: 'See your bureau activity',
        body: 'Real-time feed of score changes, payment reports, and credit events from all bureaus.',
      },
    },

    // ----- Dispute assistance: Complete-only feature -----
    'credit.dispute_assistance': {
      complete: {
        title: 'Get dispute help',
        body: 'iBoost helps you dispute errors on your credit report — pre-written letters, follow-up tracking, the works.',
      },
    },

    // ----- Offers: score-match card and full catalog (Free sees curated subset) -----
    // Free users see the Offers tab fully — these specific pitches only fire
    // if the per-feature gates are checked individually (future per-card mode).
    'offers.score_match_card': {
      essential: {
        title: 'See offers matched to your score',
        body: 'Pre-approval checks based on your real credit profile. Soft pulls only — no impact on your score.',
      },
    },

    // ----- Budget: Flinks connection (Free uses manual entry) -----
    'budget.flinks_connection': {
      essential: {
        title: 'Auto-import your transactions',
        body: 'Connect your bank with Flinks. Transactions categorize automatically. No more typing every coffee purchase.',
      },
    },
  };

  // Generic fallback by tier — used when a feature has no specific pitch
  // defined. Intentionally vague but on-brand.
  const GENERIC_PITCHES = {
    essential: {
      title: 'Unlock with iBoost Essential',
      body: 'Real bureau reporting. Monthly score updates. Personalized AI guidance.',
    },
    complete: {
      title: 'Unlock with iBoost Complete',
      body: 'Everything in Essential, plus weekly score refresh, unlimited AI guidance, and dispute assistance.',
    },
  };

  /**
   * Returns the pitch object { title, body, cta } for a feature's lock
   * overlay. Picks the right copy based on which tier would unlock the
   * feature. Falls back to a generic per-tier pitch if no specific copy
   * is defined.
   *
   * Returns null when the feature is allowed (no overlay needed) or
   * when it's score-gated (caller renders a different message format).
   */
  function getPitch(featureKey, profile) {
    var access = canAccess(featureKey, profile);
    if (access === 'allowed') return null;

    var gate = FEATURE_GATES[featureKey];
    if (!gate) return null;

    // Score-gated: caller handles "you're X points away" copy. We don't
    // own that template because it requires user-specific math.
    if (gate.scoreGate != null) return null;

    var tier = recommendedTier(featureKey, profile);
    if (!tier) return null;

    // Try feature-specific pitch first, fall back to generic per-tier.
    var specific = LOCK_PITCHES[featureKey] && LOCK_PITCHES[featureKey][tier];
    if (specific) return specific;

    return GENERIC_PITCHES[tier] || GENERIC_PITCHES.essential;
  }

  // ---------- Expose globally ----------

  window.iboostPermissions = {
    getTier: getTier,
    tierAtLeast: tierAtLeast,
    canAccess: canAccess,
    recommendedTier: recommendedTier,
    getPitch: getPitch,
    // Exposing internals for debugging / testing only. Do not iterate
    // on these from product code — use the API above.
    _gates: FEATURE_GATES,
    _pitches: LOCK_PITCHES,
  };
})();
