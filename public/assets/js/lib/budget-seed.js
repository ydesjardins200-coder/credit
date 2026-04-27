/**
 * iBoost budget seed — creates the 16 starter categories on a user's
 * first Budget tab visit.
 *
 * The seed runs lazily, NOT on signup, because:
 *   1. Signup is already heavy (auth, profile, plan selection). Adding
 *      16 INSERTs to that flow is unnecessary load if the user never
 *      opens the Budget tab.
 *   2. Deferring seed to first-visit means we can change the starter
 *      set later without a backfill — users who haven't opened Budget
 *      yet get the new defaults; users who have keep their existing
 *      categories.
 *   3. The seed is idempotent (checks for existing categories first),
 *      so safe to call repeatedly.
 *
 * Trigger flow (wired in lib/budget.js, future commit):
 *   1. User clicks Budget tab
 *   2. lib/budget.js calls getCategories()
 *   3. If query returns empty list → call this seed function
 *   4. Re-query, render UI with seeded categories
 *
 * The 16 categories cover the 5 kinds (income/fixed/variable/discretionary/
 * transfer) per the locked decision in free-budget-analysis.md Q2:
 *   - Income (2):       Salary, Other income
 *   - Fixed (5):        Housing, Insurance, Telecom, Utilities,
 *                       Home improvement
 *   - Variable (4):     Groceries, Dining, Transport, Healthcare
 *   - Discretionary (3): Personal, Entertainment, Fitness & Subscriptions
 *   - Transfers (3):    Credit card payment, Emergency fund, Long-term savings
 *
 * Users add more categories as they hit the need (e.g., "Pet", "Auto",
 * "Lottery"). The starter set is the scaffolding, not the ceiling.
 *
 * Exports a global `window.iboostBudgetSeed` for use by lib/budget.js.
 */

// TODO(i18n): When iBoost adds French localization, swap STARTER_CATEGORIES
// for a locale-aware version. For fr-CA users, use Patrick-style French
// labels (loyer, bouffe, paye, carte de crédit, etc.) matching the
// terminology in /mnt/transcripts (Patrick O'Brien's spreadsheet).
// Decision: 2026-04-27. See free-budget-analysis.md Q4 for context.

(function () {
  'use strict';

  // Display order is spaced (10, 20, 30...) so users can later insert
  // categories between existing ones without renumbering everything.
  // Within a kind, order is roughly "most common first."
  const STARTER_CATEGORIES = [
    // ----- Income (2) -----
    { name: 'Salary',                kind: 'income',        emoji: '💰', display_order: 10 },
    { name: 'Other income',          kind: 'income',        emoji: '✨', display_order: 20 },

    // ----- Fixed expenses (5) -----
    { name: 'Housing',               kind: 'fixed',         emoji: '🏠', display_order: 10 },
    { name: 'Insurance',             kind: 'fixed',         emoji: '🛡️', display_order: 20 },
    { name: 'Telecom',               kind: 'fixed',         emoji: '📞', display_order: 30 },
    { name: 'Utilities',             kind: 'fixed',         emoji: '⚡', display_order: 40 },
    { name: 'Home improvement',      kind: 'fixed',         emoji: '🔧', display_order: 50 },

    // ----- Variable expenses (4) -----
    { name: 'Groceries',             kind: 'variable',      emoji: '🛒', display_order: 10 },
    { name: 'Dining',                kind: 'variable',      emoji: '🍴', display_order: 20 },
    { name: 'Transport',             kind: 'variable',      emoji: '🚗', display_order: 30 },
    { name: 'Healthcare',            kind: 'variable',      emoji: '💊', display_order: 40 },

    // ----- Discretionary (3) -----
    { name: 'Personal',              kind: 'discretionary', emoji: '👤', display_order: 10 },
    { name: 'Entertainment',         kind: 'discretionary', emoji: '🎬', display_order: 20 },
    { name: 'Fitness & Subscriptions', kind: 'discretionary', emoji: '🏋️', display_order: 30 },

    // ----- Transfers (3) -----
    // Credit card payment is FIRST in transfers because it's the most
    // common and most important — Patrick's wisdom: CC payments are
    // transfers (not expenses), avoiding the double-counting bug that
    // most budget apps make.
    { name: 'Credit card payment',   kind: 'transfer',      emoji: '💳', display_order: 10 },
    { name: 'Emergency fund',        kind: 'transfer',      emoji: '🆘', display_order: 20 },
    { name: 'Long-term savings',     kind: 'transfer',      emoji: '🎯', display_order: 30 },
  ];

  // Sanity check at module load time — if STARTER_CATEGORIES gets edited
  // and accidentally drops below the documented 16, fail loudly.
  // (Intentionally permissive on the upper bound — we may add more later.)
  if (STARTER_CATEGORIES.length < 16) {
    console.error(
      '[budget-seed] STARTER_CATEGORIES has only ' + STARTER_CATEGORIES.length +
      ' entries (expected at least 16). Onboarding will be sparse.'
    );
  }

  /**
   * Seed the user's starter categories. Idempotent — safe to call multiple
   * times. Returns the categories that were created (empty array if user
   * already had categories).
   *
   * @param {SupabaseClient} supabase - The authenticated supabase client
   * @param {string} userId - The user's UUID (auth.uid())
   * @returns {Promise<{seeded: boolean, categories: Array, error: any}>}
   */
  async function seedIfEmpty(supabase, userId) {
    if (!supabase || !userId) {
      return { seeded: false, categories: [], error: new Error('seedIfEmpty: missing supabase or userId') };
    }

    // 1. Check if user already has categories. We check ALL (including
    // archived) — if user previously archived all their categories, we
    // don't want to re-seed and create duplicates of the archived set.
    const { data: existing, error: checkError } = await supabase
      .from('budget_categories')
      .select('id')
      .eq('user_id', userId)
      .limit(1);

    if (checkError) {
      console.error('[budget-seed] check existing failed:', checkError);
      return { seeded: false, categories: [], error: checkError };
    }

    // User already has categories — don't seed.
    if (existing && existing.length > 0) {
      return { seeded: false, categories: [], error: null };
    }

    // 2. Build the rows to insert. Each row gets the user_id.
    const rows = STARTER_CATEGORIES.map(function (cat) {
      return {
        user_id: userId,
        name: cat.name,
        kind: cat.kind,
        emoji: cat.emoji,
        display_order: cat.display_order,
      };
    });

    // 3. Insert. Single batch INSERT is faster than 16 round-trips.
    const { data: inserted, error: insertError } = await supabase
      .from('budget_categories')
      .insert(rows)
      .select();

    if (insertError) {
      console.error('[budget-seed] insert failed:', insertError);
      return { seeded: false, categories: [], error: insertError };
    }

    return { seeded: true, categories: inserted || [], error: null };
  }

  // Export for lib/budget.js to use. Not exposing the STARTER_CATEGORIES
  // array — that's an implementation detail and shouldn't be relied on
  // by callers (it may change between versions).
  window.iboostBudgetSeed = {
    seedIfEmpty: seedIfEmpty,

    // Exposed for the eventual onboarding wizard, which renders these
    // as checkboxes ("Pick categories that apply to you"). Callers
    // should treat the returned array as immutable.
    getStarterCategories: function () {
      return STARTER_CATEGORIES.map(function (c) { return Object.assign({}, c); });
    },
  };
})();
