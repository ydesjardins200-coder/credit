/**
 * iBoost budget module — data access layer for the Budget tab on
 * /account.html. Wraps Supabase queries against the three budget tables
 * (budget_categories, budget_entries, budget_goals from migration 0016).
 *
 * Responsibilities:
 *   - Read path: getCategories, getEntriesForMonth, getGoalsForMonth,
 *     getMonthSummary
 *   - Write path: addEntry, updateEntry, deleteEntry, addCategory,
 *     updateCategory, archiveCategory, setGoal, deleteGoal
 *   - Seed path: ensureSeeded (calls budget-seed.js if user has no
 *     categories yet)
 *
 * Layered above:
 *   - Add Entry modal (account.js, future commit) calls addEntry()
 *   - Budget tab render (account.js) calls getMonthSummary() + renders
 *   - Manage Categories screen calls CRUD functions
 *
 * Design conventions:
 *   - All amounts stored and returned in CENTS (integer). Frontend
 *     formats to dollars at render time. NEVER do float math on money.
 *   - All dates are ISO YYYY-MM-DD strings on the wire, JS Date objects
 *     internally where math is needed.
 *   - Functions return { data, error } shape matching Supabase pattern,
 *     so callers can do `if (error) ...` consistently.
 *   - User identity comes from the authenticated supabase client; this
 *     module never takes a userId parameter (RLS enforces it server-side).
 *
 * Dependencies (must be loaded before this script):
 *   - lib/budget-seed.js (window.iboostBudgetSeed)
 *   - lib/merchant-categories.js (window.iboostMerchants)
 *   - The supabase client (set up by auth.js)
 *
 * Exports a global `window.iboostBudget`.
 */

(function () {
  'use strict';

  // ----- Internal helpers -----

  /**
   * Get the authenticated supabase client + userId. Waits for auth
   * to finish bootstrapping (sessionBootReady) before returning, so
   * callers can fire this before init() has finished racing through
   * requireCompleteProfile().
   *
   * Why a helper: the Budget tab init can fire from two places:
   *   1. activateTab('budget') triggered by DOMContentLoaded if URL
   *      has ?tab=budget (BEFORE init() awaits requireCompleteProfile)
   *   2. init() itself, after auth is ready
   * Path 1 races the auth boot. Using getSessionSettled() makes the
   * race safe by parking until session resolution settles.
   *
   * iboostAuth API contract (from public/assets/js/auth.js):
   *   - window.iboostAuth.client                — the Supabase client (PROPERTY)
   *   - window.iboostAuth.getSessionSettled()   — async, waits for boot, returns { session }
   */
  async function getClient() {
    if (!window.iboostAuth || !window.iboostAuth.client || !window.iboostAuth.getSessionSettled) {
      console.warn('[budget] iboostAuth not ready');
      return { client: null, userId: null, error: new Error('auth not initialized') };
    }
    const { session } = await window.iboostAuth.getSessionSettled();
    if (!session || !session.user) {
      return { client: null, userId: null, error: new Error('not authenticated') };
    }
    return { client: window.iboostAuth.client, userId: session.user.id, error: null };
  }

  /**
   * Format a Date or YYYY-MM-DD string as the first-of-month YYYY-MM-01
   * string. Goals are month-scoped so we always normalize to month_start.
   */
  function toMonthStart(dateOrString) {
    let d;
    if (dateOrString instanceof Date) {
      d = dateOrString;
    } else if (typeof dateOrString === 'string') {
      d = new Date(dateOrString + 'T00:00:00'); // avoid TZ drift
    } else {
      d = new Date();
    }
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return y + '-' + m + '-01';
  }

  /**
   * Last day of the month, given a Date or YYYY-MM-DD string.
   * Used to bound month-scoped queries.
   */
  function toMonthEnd(dateOrString) {
    let d;
    if (dateOrString instanceof Date) {
      d = dateOrString;
    } else if (typeof dateOrString === 'string') {
      d = new Date(dateOrString + 'T00:00:00');
    } else {
      d = new Date();
    }
    // Day 0 of next month = last day of this month
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const y = last.getFullYear();
    const m = String(last.getMonth() + 1).padStart(2, '0');
    const day = String(last.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  // ============================================================
  // SEED
  // ============================================================

  /**
   * Called by the Budget tab on first render. If user has no categories,
   * seeds the 16 starter set. Idempotent.
   *
   * @returns {Promise<{seeded: boolean, error: any}>}
   */
  async function ensureSeeded() {
    const auth = await getClient();
    if (auth.error) return { seeded: false, error: auth.error };

    if (!window.iboostBudgetSeed) {
      return { seeded: false, error: new Error('budget-seed module not loaded') };
    }

    const result = await window.iboostBudgetSeed.seedIfEmpty(auth.client, auth.userId);
    return { seeded: result.seeded, error: result.error };
  }

  // ============================================================
  // CATEGORIES
  // ============================================================

  /**
   * Get all of the user's categories, ordered by kind grouping then
   * display_order. By default excludes archived categories — pass
   * { includeArchived: true } for the management screen.
   *
   * @returns {Promise<{data: Array, error: any}>}
   */
  async function getCategories(opts) {
    opts = opts || {};
    const auth = await getClient();
    if (auth.error) return { data: [], error: auth.error };

    let query = auth.client
      .from('budget_categories')
      .select('*')
      .eq('user_id', auth.userId)
      .order('kind', { ascending: true })
      .order('display_order', { ascending: true });

    if (!opts.includeArchived) {
      query = query.eq('is_archived', false);
    }

    const { data, error } = await query;
    return { data: data || [], error: error };
  }

  /**
   * Add a new category. Returns the created row.
   *
   * @param {{name: string, kind: string, emoji?: string, display_order?: number}} input
   */
  async function addCategory(input) {
    const auth = await getClient();
    if (auth.error) return { data: null, error: auth.error };

    if (!input || !input.name || !input.kind) {
      return { data: null, error: new Error('addCategory: name and kind required') };
    }

    const VALID_KINDS = ['income', 'fixed', 'variable', 'discretionary', 'transfer'];
    if (VALID_KINDS.indexOf(input.kind) < 0) {
      return { data: null, error: new Error('addCategory: invalid kind: ' + input.kind) };
    }

    const row = {
      user_id: auth.userId,
      name: input.name.trim(),
      kind: input.kind,
      emoji: input.emoji || null,
      display_order: typeof input.display_order === 'number' ? input.display_order : 99,
    };

    const { data, error } = await auth.client
      .from('budget_categories')
      .insert([row])
      .select()
      .single();

    return { data: data, error: error };
  }

  /**
   * Update name, emoji, kind, or display_order of a category.
   *
   * @param {string} categoryId
   * @param {{name?: string, kind?: string, emoji?: string, display_order?: number}} updates
   */
  async function updateCategory(categoryId, updates) {
    const auth = await getClient();
    if (auth.error) return { data: null, error: auth.error };

    if (!categoryId || !updates) {
      return { data: null, error: new Error('updateCategory: categoryId and updates required') };
    }

    // Whitelist allowed fields. Never let callers update user_id, id,
    // is_archived (use archiveCategory), created_at, updated_at.
    const allowed = ['name', 'kind', 'emoji', 'display_order'];
    const patch = {};
    for (const key of allowed) {
      if (updates.hasOwnProperty(key)) patch[key] = updates[key];
    }

    if (patch.name !== undefined) patch.name = patch.name.trim();

    const { data, error } = await auth.client
      .from('budget_categories')
      .update(patch)
      .eq('id', categoryId)
      .eq('user_id', auth.userId) // belt-and-suspenders with RLS
      .select()
      .single();

    return { data: data, error: error };
  }

  /**
   * Archive (soft-delete) a category. Use this instead of hard-delete —
   * preserves entries' history per Patrick's 15-year rule.
   *
   * To "un-archive" later, call updateCategory with is_archived: false
   * (we'd need to allow it in the update whitelist; not exposed today
   * because the management UI doesn't have an un-archive flow yet).
   */
  async function archiveCategory(categoryId) {
    const auth = await getClient();
    if (auth.error) return { data: null, error: auth.error };

    const { data, error } = await auth.client
      .from('budget_categories')
      .update({ is_archived: true })
      .eq('id', categoryId)
      .eq('user_id', auth.userId)
      .select()
      .single();

    return { data: data, error: error };
  }

  // ============================================================
  // ENTRIES
  // ============================================================

  /**
   * Get all entries in a given month. month is a Date or 'YYYY-MM-DD'
   * string (any date in the target month works — we normalize).
   *
   * Returns entries joined with their category info so the UI doesn't
   * have to do its own join client-side.
   *
   * @param {Date | string} month
   */
  async function getEntriesForMonth(month) {
    const auth = await getClient();
    if (auth.error) return { data: [], error: auth.error };

    const start = toMonthStart(month);
    const end = toMonthEnd(month);

    const { data, error } = await auth.client
      .from('budget_entries')
      .select(`
        *,
        category:budget_categories (id, name, kind, emoji)
      `)
      .eq('user_id', auth.userId)
      .gte('entry_date', start)
      .lte('entry_date', end)
      .order('entry_date', { ascending: false })
      .order('created_at', { ascending: false });

    return { data: data || [], error: error };
  }

  /**
   * Add a single entry. Amount is in cents (integer).
   *
   * @param {{category_id: string, entry_date: string, amount_cents: number, note?: string}} input
   */
  async function addEntry(input) {
    const auth = await getClient();
    if (auth.error) return { data: null, error: auth.error };

    if (!input || !input.category_id || !input.entry_date || typeof input.amount_cents !== 'number') {
      return { data: null, error: new Error('addEntry: category_id, entry_date, amount_cents required') };
    }
    if (input.amount_cents < 0) {
      return { data: null, error: new Error('addEntry: amount_cents must be non-negative') };
    }

    const row = {
      user_id: auth.userId,
      category_id: input.category_id,
      entry_date: input.entry_date,
      amount_cents: Math.round(input.amount_cents), // defensive integerization
      note: input.note ? input.note.trim() : null,
      source: 'manual',
    };

    const { data, error } = await auth.client
      .from('budget_entries')
      .insert([row])
      .select(`*, category:budget_categories (id, name, kind, emoji)`)
      .single();

    return { data: data, error: error };
  }

  /**
   * Update an existing entry. All fields optional.
   *
   * @param {string} entryId
   * @param {{category_id?: string, entry_date?: string, amount_cents?: number, note?: string}} updates
   */
  async function updateEntry(entryId, updates) {
    const auth = await getClient();
    if (auth.error) return { data: null, error: auth.error };

    if (!entryId || !updates) {
      return { data: null, error: new Error('updateEntry: entryId and updates required') };
    }

    const allowed = ['category_id', 'entry_date', 'amount_cents', 'note'];
    const patch = {};
    for (const key of allowed) {
      if (updates.hasOwnProperty(key)) patch[key] = updates[key];
    }

    if (patch.amount_cents !== undefined) {
      if (patch.amount_cents < 0) {
        return { data: null, error: new Error('updateEntry: amount_cents must be non-negative') };
      }
      patch.amount_cents = Math.round(patch.amount_cents);
    }
    if (patch.note !== undefined && patch.note !== null) patch.note = patch.note.trim();

    const { data, error } = await auth.client
      .from('budget_entries')
      .update(patch)
      .eq('id', entryId)
      .eq('user_id', auth.userId)
      .select(`*, category:budget_categories (id, name, kind, emoji)`)
      .single();

    return { data: data, error: error };
  }

  /**
   * Hard-delete an entry. Unlike categories (which we archive),
   * entries CAN be hard-deleted because they're additive data points,
   * not structural. A user removing yesterday's grocery entry is
   * undoing a typo, not erasing history.
   */
  async function deleteEntry(entryId) {
    const auth = await getClient();
    if (auth.error) return { error: auth.error };

    const { error } = await auth.client
      .from('budget_entries')
      .delete()
      .eq('id', entryId)
      .eq('user_id', auth.userId);

    return { error: error };
  }

  // ============================================================
  // GOALS
  // ============================================================

  /**
   * Get all goals for the given month.
   */
  async function getGoalsForMonth(month) {
    const auth = await getClient();
    if (auth.error) return { data: [], error: auth.error };

    const monthStart = toMonthStart(month);

    const { data, error } = await auth.client
      .from('budget_goals')
      .select(`
        *,
        category:budget_categories (id, name, kind, emoji)
      `)
      .eq('user_id', auth.userId)
      .eq('month_start', monthStart);

    return { data: data || [], error: error };
  }

  /**
   * Set (or update) a goal for a category in a given month. Uses upsert
   * because the unique constraint (user_id, category_id, month_start)
   * means there's at most one goal per cat per month.
   *
   * @param {{category_id: string, month: Date|string, target_cents: number, goal_type: string}} input
   */
  async function setGoal(input) {
    const auth = await getClient();
    if (auth.error) return { data: null, error: auth.error };

    if (!input || !input.category_id || !input.month || typeof input.target_cents !== 'number' || !input.goal_type) {
      return { data: null, error: new Error('setGoal: category_id, month, target_cents, goal_type required') };
    }

    const VALID_TYPES = ['spend_under', 'save_at_least', 'spend_exactly'];
    if (VALID_TYPES.indexOf(input.goal_type) < 0) {
      return { data: null, error: new Error('setGoal: invalid goal_type: ' + input.goal_type) };
    }

    const row = {
      user_id: auth.userId,
      category_id: input.category_id,
      month_start: toMonthStart(input.month),
      target_cents: Math.round(Math.abs(input.target_cents)),
      goal_type: input.goal_type,
    };

    const { data, error } = await auth.client
      .from('budget_goals')
      .upsert([row], { onConflict: 'user_id,category_id,month_start' })
      .select(`*, category:budget_categories (id, name, kind, emoji)`)
      .single();

    return { data: data, error: error };
  }

  async function deleteGoal(goalId) {
    const auth = await getClient();
    if (auth.error) return { error: auth.error };

    const { error } = await auth.client
      .from('budget_goals')
      .delete()
      .eq('id', goalId)
      .eq('user_id', auth.userId);

    return { error: error };
  }

  // ============================================================
  // SUMMARY (aggregations for the overview screen)
  // ============================================================

  /**
   * Compute monthly summary stats from a flat entries list. Pure
   * function — no DB hit. Caller passes entries (typically the result
   * of getEntriesForMonth).
   *
   * Returns:
   *   {
   *     income_cents:      sum of entries where category.kind = 'income'
   *     spent_cents:       sum where kind in ('fixed','variable','discretionary')
   *     transfers_cents:   sum where kind = 'transfer'
   *     available_cents:   income - spent - transfers
   *     savings_rate:      (income - spent) / income, as 0..1 fraction
   *     by_category: [
   *       { category_id, category_name, kind, emoji, total_cents, entry_count },
   *       ...
   *     ]
   *   }
   *
   * Why a separate function (not a SQL view): we want the entries list
   * AND the summary in one DB roundtrip. So we fetch entries once,
   * derive summary client-side. For the data volumes in question
   * (typically <100 entries/month) this is trivial.
   */
  function summarize(entries) {
    let income = 0, spent = 0, transfers = 0;
    const byCat = {};

    for (const e of entries || []) {
      const kind = e.category && e.category.kind;
      if (!kind) continue;

      const amount = e.amount_cents || 0;

      if (kind === 'income') income += amount;
      else if (kind === 'transfer') transfers += amount;
      else if (kind === 'fixed' || kind === 'variable' || kind === 'discretionary') {
        spent += amount;
      }

      // Build the by-category aggregation
      const cid = e.category_id;
      if (!byCat[cid]) {
        byCat[cid] = {
          category_id: cid,
          category_name: e.category ? e.category.name : 'Unknown',
          kind: kind,
          emoji: e.category ? e.category.emoji : null,
          total_cents: 0,
          entry_count: 0,
        };
      }
      byCat[cid].total_cents += amount;
      byCat[cid].entry_count += 1;
    }

    // Convert to array sorted by total_cents desc (biggest spending
    // categories at the top — matches Patrick-style bar chart).
    const by_category = Object.values(byCat).sort(function (a, b) {
      return b.total_cents - a.total_cents;
    });

    const available = income - spent - transfers;
    const savings_rate = income > 0 ? Math.max(0, (income - spent) / income) : 0;

    return {
      income_cents: income,
      spent_cents: spent,
      transfers_cents: transfers,
      available_cents: available,
      savings_rate: savings_rate,
      by_category: by_category,
    };
  }

  /**
   * Convenience function: fetch entries for a month AND compute summary
   * in one call. The most common caller flow.
   */
  async function getMonthSummary(month) {
    const { data: entries, error } = await getEntriesForMonth(month);
    if (error) return { data: null, error: error };

    const summary = summarize(entries);
    return {
      data: { entries: entries, summary: summary },
      error: null,
    };
  }

  // ============================================================
  // FORMATTING HELPERS
  // ============================================================

  /**
   * Format a cents integer as a currency string. Default $ display
   * (no currency code). UI may want CAD/USD distinction later — for
   * now we just show the dollar sign.
   *
   * Example: formatCents(3420) -> "$34.20"
   *          formatCents(0) -> "$0.00"
   *          formatCents(150000) -> "$1,500.00"
   */
  function formatCents(cents) {
    if (typeof cents !== 'number' || isNaN(cents)) return '$0.00';
    const dollars = cents / 100;
    return '$' + dollars.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  /**
   * Inverse of formatCents — parse a user-entered string into cents.
   * Permissive on input format ("34.20", "$34.20", "34", "1,234.56").
   *
   * Returns null if unparseable. UI should fall back to a validation
   * error in that case.
   */
  function parseDollarsToCents(input) {
    if (typeof input !== 'string') return null;
    const cleaned = input.replace(/[$,\s]/g, '');
    if (!cleaned) return null;
    const num = parseFloat(cleaned);
    if (isNaN(num)) return null;
    return Math.round(num * 100);
  }

  // ============================================================
  // EXPORT
  // ============================================================

  window.iboostBudget = {
    // Seed
    ensureSeeded: ensureSeeded,

    // Categories
    getCategories: getCategories,
    addCategory: addCategory,
    updateCategory: updateCategory,
    archiveCategory: archiveCategory,

    // Entries
    getEntriesForMonth: getEntriesForMonth,
    addEntry: addEntry,
    updateEntry: updateEntry,
    deleteEntry: deleteEntry,

    // Goals
    getGoalsForMonth: getGoalsForMonth,
    setGoal: setGoal,
    deleteGoal: deleteGoal,

    // Summary
    summarize: summarize,
    getMonthSummary: getMonthSummary,

    // Formatting helpers (also useful in UI code)
    formatCents: formatCents,
    parseDollarsToCents: parseDollarsToCents,

    // Date helpers (also exposed for callers that want them)
    toMonthStart: toMonthStart,
    toMonthEnd: toMonthEnd,
  };
})();
