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
    return window.iboostRetry.withRetry(async function () {
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
    });
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
    if (!categoryId || !updates) {
      return { data: null, error: new Error('updateCategory: categoryId and updates required') };
    }
    return window.iboostRetry.withRetry(async function () {
      const auth = await getClient();
      if (auth.error) return { data: null, error: auth.error };

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
    });
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
    return window.iboostRetry.withRetry(async function () {
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
    });
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
    return window.iboostRetry.withRetry(async function () {
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
    });
  }

  /**
   * Fetch entries spanning an arbitrary date range. Used by CSV import
   * dedup (Phase 5e): a single import can span many months, and we need
   * to compare every parsed row against every existing entry in that
   * window to flag duplicates.
   *
   * Returns the same shape as getEntriesForMonth — { data, error } with
   * each row joined to its category. Slimmer columns would be enough for
   * dedup (just date/amount/note), but consistency with getEntriesForMonth
   * is more valuable than the few KB saved on the wire.
   *
   * @param {string} startIsoDate 'YYYY-MM-DD' inclusive
   * @param {string} endIsoDate   'YYYY-MM-DD' inclusive
   */
  async function getEntriesInRange(startIsoDate, endIsoDate) {
    if (!startIsoDate || !endIsoDate) {
      return { data: [], error: new Error('getEntriesInRange: start/end required') };
    }
    return window.iboostRetry.withRetry(async function () {
      const auth = await getClient();
      if (auth.error) return { data: [], error: auth.error };

      const { data, error } = await auth.client
        .from('budget_entries')
        .select(`
          *,
          category:budget_categories (id, name, kind, emoji)
        `)
        .eq('user_id', auth.userId)
        .gte('entry_date', startIsoDate)
        .lte('entry_date', endIsoDate)
        .order('entry_date', { ascending: false });

      return { data: data || [], error: error };
    });
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
   * Bulk insert multiple entries — used by CSV import (Phase 5d).
   *
   * Each entry is the same shape as addEntry's input. We batch-insert
   * up to 500 rows per Supabase request to stay well under the 1000-row
   * default limit. For larger imports we chunk transparently.
   *
   * source defaults to 'csv' (vs 'manual' for addEntry) so users can
   * tell imported entries from typed ones if they ever query directly.
   *
   * Returns { data: insertedRows[], error, inserted: count }. Partial
   * success: if chunk N fails, all rows up to N-1 are committed; rows
   * from N onward are not. We surface the error and the count actually
   * inserted so the UI can tell the user.
   *
   * @param {Array<{category_id, entry_date, amount_cents, note?}>} entries
   */
  async function addEntriesBatch(entries) {
    const auth = await getClient();
    if (auth.error) return { data: [], error: auth.error, inserted: 0 };

    if (!Array.isArray(entries) || entries.length === 0) {
      return { data: [], error: new Error('addEntriesBatch: entries array required'), inserted: 0 };
    }

    // Validate every row before sending. If ANY row is malformed we
    // refuse the whole batch — partial success on validation feels
    // worse than no success (user has to figure out which rows worked).
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (!e || !e.category_id || !e.entry_date || typeof e.amount_cents !== 'number') {
        return {
          data: [],
          error: new Error('addEntriesBatch: row ' + (i + 1) + ' missing required fields'),
          inserted: 0,
        };
      }
      if (e.amount_cents < 0) {
        return {
          data: [],
          error: new Error('addEntriesBatch: row ' + (i + 1) + ' has negative amount_cents'),
          inserted: 0,
        };
      }
    }

    const rows = entries.map(function (e) {
      return {
        user_id: auth.userId,
        category_id: e.category_id,
        entry_date: e.entry_date,
        amount_cents: Math.round(e.amount_cents),
        note: e.note ? String(e.note).trim() : null,
        // Must match the budget_entries_source_check constraint from
        // migration 0016, which allows: 'manual', 'flinks', 'csv_import'.
        // (Past-me named it 'csv_import' to leave room for future
        // distinct sources like 'plaid_import' etc.)
        source: 'csv_import',
      };
    });

    const CHUNK = 500;
    const allInserted = [];
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const { data, error } = await auth.client
        .from('budget_entries')
        .insert(chunk)
        .select('id');
      if (error) {
        return { data: allInserted, error: error, inserted: allInserted.length };
      }
      if (Array.isArray(data)) {
        for (const row of data) allInserted.push(row);
      }
    }

    return { data: allInserted, error: null, inserted: allInserted.length };
  }

  /**
   * Update an existing entry. All fields optional.
   *
   * @param {string} entryId
   * @param {{category_id?: string, entry_date?: string, amount_cents?: number, note?: string}} updates
   */
  async function updateEntry(entryId, updates) {
    if (!entryId || !updates) {
      return { data: null, error: new Error('updateEntry: entryId and updates required') };
    }
    return window.iboostRetry.withRetry(async function () {
      const auth = await getClient();
      if (auth.error) return { data: null, error: auth.error };

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
    });
  }

  /**
   * Hard-delete an entry. Unlike categories (which we archive),
   * entries CAN be hard-deleted because they're additive data points,
   * not structural. A user removing yesterday's grocery entry is
   * undoing a typo, not erasing history.
   */
  async function deleteEntry(entryId) {
    return window.iboostRetry.withRetry(async function () {
      const auth = await getClient();
      if (auth.error) return { error: auth.error };

      const { error } = await auth.client
        .from('budget_entries')
        .delete()
        .eq('id', entryId)
        .eq('user_id', auth.userId);

      return { error: error };
    });
  }

  // ============================================================
  // GOALS
  // ============================================================

  /**
   * Get all goals for the given month.
   */
  async function getGoalsForMonth(month) {
    return window.iboostRetry.withRetry(async function () {
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
    });
  }

  /**
   * Set (or update) a goal for a category in a given month. Uses upsert
   * because the unique constraint (user_id, category_id, month_start)
   * means there's at most one goal per cat per month.
   *
   * @param {{category_id: string, month: Date|string, target_cents: number, goal_type: string}} input
   */
  async function setGoal(input) {
    if (!input || !input.category_id || !input.month || typeof input.target_cents !== 'number' || !input.goal_type) {
      return { data: null, error: new Error('setGoal: category_id, month, target_cents, goal_type required') };
    }

    const VALID_TYPES = ['spend_under', 'save_at_least', 'spend_exactly'];
    if (VALID_TYPES.indexOf(input.goal_type) < 0) {
      return { data: null, error: new Error('setGoal: invalid goal_type: ' + input.goal_type) };
    }

    return window.iboostRetry.withRetry(async function () {
      const auth = await getClient();
      if (auth.error) return { data: null, error: auth.error };

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
    });
  }

  async function deleteGoal(goalId) {
    return window.iboostRetry.withRetry(async function () {
      const auth = await getClient();
      if (auth.error) return { error: auth.error };

      const { error } = await auth.client
        .from('budget_goals')
        .delete()
        .eq('id', goalId)
        .eq('user_id', auth.userId);

      return { error: error };
    });
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
   *     available_cents:   income - spent (NOT minus transfers — see below)
   *     savings_rate:      (income - spent) / income, as 0..1 fraction
   *     by_category: [
   *       { category_id, category_name, kind, emoji, total_cents, entry_count },
   *       ...
   *     ]
   *   }
   *
   * Why available_cents = income - spent (and not also - transfers):
   *   Phase 5i decision. Transfers are money you've MOVED (CC payment,
   *   savings contribution, RRSP contribution). Subtracting them from
   *   "Available" produced a confusing UI where contributing to savings
   *   made Available go down — users read "I saved more, why is my
   *   available money less?" The dashboard subtitle promised "Income
   *   minus spending" while the math actually did "income - spent -
   *   transfers", so the label and the value disagreed.
   *
   *   Now: Available = income - spent, matching the on-screen subtitle
   *   and consistent with savings_rate (which already used that
   *   formula). Transfers get their own summary card so users can
   *   still see at a glance how much they've moved this month.
   *
   * Why a separate function (not a SQL view): we want the entries list
   * AND the summary in one DB roundtrip. So we fetch entries once,
   * derive summary client-side. For the data volumes in question
   * (typically <100 entries/month) this is trivial.
   *
   * NOTE: actual function declaration is below the OPENING BALANCES
   * section since summarize() is now invoked by resolveOpeningBalanceForMonth
   * (to compute prior-month closings for rollover). The JSDoc lives here
   * with the SUMMARY section header for findability.
   */
  // ============================================================
  // OPENING BALANCES (Phase 5j)
  // ============================================================
  //
  // Per-month opening balance for the user's primary operating
  // account. Backed by the budget_opening_balances table from
  // migration 0017.
  //
  // The user-facing model:
  //   - User can set an opening balance for any month explicitly
  //     (source='manual'). This sticks: never auto-overwritten.
  //   - For months with no row, the application resolves a default
  //     by walking back to the most recent prior month with data,
  //     projecting that month's closing forward.
  //   - The first time we resolve a default, we PERSIST it as a
  //     row with source='rollover'. This makes future reads O(1)
  //     and makes the value sticky against retroactive edits to
  //     older months. (Yan's call: predictability beats math
  //     purity here.)
  //
  // Performance note: typical user has <24 months of history. The
  // recursive resolve walks back from N to find the most recent
  // anchor, which is at most O(months in DB). Capped implicitly by
  // the user's signup date. No need for a smart query — a simple
  // 'most recent prior with data' lookup is enough.

  /**
   * Read the opening balance row for a specific month, if one
   * exists. Does NOT trigger rollover — use resolveOpeningBalanceForMonth
   * for the full read-or-default path. Useful when you specifically
   * want to know whether a manual value exists.
   *
   * @param {Date|string} month
   * @returns {{ data: {id, opening_cents, source, month_start} | null, error }}
   */
  async function getOpeningBalance(month) {
    return window.iboostRetry.withRetry(async function () {
      const auth = await getClient();
      if (auth.error) return { data: null, error: auth.error };

      const monthIso = toMonthStart(month);
      const { data, error } = await auth.client
        .from('budget_opening_balances')
        .select('id, opening_cents, source, month_start')
        .eq('user_id', auth.userId)
        .eq('month_start', monthIso)
        .maybeSingle();

      return { data: data || null, error: error };
    });
  }

  /**
   * Find the most recent opening balance row at or before the given
   * month, joined with that month's entries so we can compute the
   * closing balance and project forward.
   *
   * Used by resolveOpeningBalanceForMonth to walk back to the most
   * recent anchor when the requested month has no row.
   *
   * Returns the prior row + its month's closing balance, or null
   * if no prior row exists at all (i.e., user has never set an
   * opening balance).
   *
   * @param {string} monthIso  YYYY-MM-01 of the month we're trying
   *                           to resolve. The lookup excludes this
   *                           month and looks at strictly-prior months.
   * @returns {{ row, closing_cents } | null}
   */
  async function findMostRecentPriorOpening(monthIso) {
    const priorRowResult = await window.iboostRetry.withRetry(async function () {
      const auth = await getClient();
      if (auth.error) return { data: null, error: auth.error };

      const { data, error } = await auth.client
        .from('budget_opening_balances')
        .select('id, opening_cents, source, month_start')
        .eq('user_id', auth.userId)
        .lt('month_start', monthIso)
        .order('month_start', { ascending: false })
        .limit(1)
        .maybeSingle();

      return { data: data || null, error: error };
    });

    if (priorRowResult.error || !priorRowResult.data) return null;
    const data = priorRowResult.data;

    // Compute that month's closing = its opening + its income - spent
    // - transfers. We need that month's entries to do this. (We
    // intentionally re-derive instead of caching closing_cents on the
    // table — it's cheap, and caching means we'd have to invalidate
    // every time entries in that month change.)
    const { data: priorEntries } = await getEntriesForMonth(data.month_start);
    const priorSummary = summarize(priorEntries || []);
    const closing = data.opening_cents
      + priorSummary.income_cents
      - priorSummary.spent_cents
      - priorSummary.transfers_cents;

    return { row: data, closing_cents: closing };
  }

  /**
   * The full read-or-default path for a month's opening balance.
   *
   * Returns:
   *   { opening_cents, source, isResolved, anchorMonth }
   *     where source is 'manual' | 'rollover' | null
   *           isResolved is true if we have a value, false if no
   *             prior data exists anywhere (UI shows "Not set")
   *           anchorMonth is the YYYY-MM-01 of the original manual
   *             row this rolled forward from, when source='rollover'.
   *             Null otherwise.
   *
   * Side effect: when no row exists for the requested month but a
   * prior anchor does, we INSERT a new row with source='rollover'
   * so future reads skip the walk-back. The insert is best-effort:
   * if it fails (network, RLS quirk), we still return the computed
   * value — the user sees the right number, we just recompute next
   * time.
   *
   * @param {Date|string} month
   * @returns {{ data, error }}
   */
  async function resolveOpeningBalanceForMonth(month) {
    const auth = await getClient();
    if (auth.error) {
      return { data: null, error: auth.error };
    }

    const monthIso = toMonthStart(month);

    // 1. Direct hit?
    const direct = await getOpeningBalance(monthIso);
    if (direct.error) return { data: null, error: direct.error };
    if (direct.data) {
      return {
        data: {
          opening_cents: direct.data.opening_cents,
          source: direct.data.source,
          isResolved: true,
          anchorMonth: direct.data.source === 'rollover' ? null : monthIso,
        },
        error: null,
      };
    }

    // 2. Walk back to the most recent prior month that has a row.
    const prior = await findMostRecentPriorOpening(monthIso);
    if (!prior) {
      return {
        data: {
          opening_cents: null,
          source: null,
          isResolved: false,
          anchorMonth: null,
        },
        error: null,
      };
    }

    // 3. Roll the prior month's closing forward into this month.
    //    This is potentially many months forward — we just project
    //    one hop. If the user views month N+5 with an anchor at N,
    //    we'd compute N's closing and use that as the opening for
    //    N+1 (months N+2..N+5 get filled in lazily as the user
    //    visits them). For a smarter all-at-once fill, we'd have
    //    to fetch all intermediate months' entries — premature
    //    optimization. Lazy fill is fine.
    //
    //    BUT: if there are intermediate months between prior and
    //    requested, we must NOT skip them. So we only roll forward
    //    one month at a time. If prior is the previous month,
    //    great. If not, we still anchor on prior's closing — it's
    //    the best information we have, and intermediate-month
    //    closings would all be derived from this same anchor
    //    anyway (since they have no entries either, by definition).
    const computedOpening = prior.closing_cents;

    // Persist as rollover so next read is O(1) and the value is
    // sticky against retroactive edits to the anchor month.
    // Best-effort: if insert fails (rare race or RLS issue), we
    // still return the computed value below.
    await auth.client
      .from('budget_opening_balances')
      .insert([{
        user_id: auth.userId,
        month_start: monthIso,
        opening_cents: computedOpening,
        source: 'rollover',
      }]);
    // Intentionally not checking error: a unique-constraint failure
    // here means another tab/request inserted concurrently, in which
    // case our value is still correct. Other errors don't block the
    // user's read.

    return {
      data: {
        opening_cents: computedOpening,
        source: 'rollover',
        isResolved: true,
        anchorMonth: prior.row.month_start,
      },
      error: null,
    };
  }

  /**
   * Set (upsert) a manual opening balance for a month. Always writes
   * source='manual'; this never gets auto-overwritten by rollover
   * resolution.
   *
   * Existing 'rollover' rows for the same month are overwritten —
   * the user is replacing the system default with their own number.
   *
   * @param {Date|string} month
   * @param {number} opening_cents  may be negative
   * @returns {{ data, error }}
   */
  async function setOpeningBalance(month, opening_cents) {
    if (typeof opening_cents !== 'number' || isNaN(opening_cents)) {
      return { data: null, error: new Error('setOpeningBalance: opening_cents must be a number') };
    }

    return window.iboostRetry.withRetry(async function () {
      const auth = await getClient();
      if (auth.error) return { data: null, error: auth.error };

      const monthIso = toMonthStart(month);

      const row = {
        user_id: auth.userId,
        month_start: monthIso,
        opening_cents: Math.round(opening_cents),
        source: 'manual',
      };

      // Upsert on the unique (user_id, month_start) constraint. If a
      // rollover row already exists for this month, this overwrites it
      // and flips source to 'manual'.
      const { data, error } = await auth.client
        .from('budget_opening_balances')
        .upsert([row], { onConflict: 'user_id,month_start' })
        .select()
        .single();

      return { data: data, error: error };
    });
  }

  /**
   * Phase 5j extension to summarize: optional opening_cents parameter.
   * When provided, summary.closing_cents is populated as
   *   opening + income - spent - transfers
   * (the user's projected month-end cash position). When omitted,
   * closing_cents is null — UI distinguishes "not set" from $0.
   */
  function summarize(entries, opening_cents) {
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

    const available = income - spent;
    const savings_rate = income > 0 ? Math.max(0, (income - spent) / income) : 0;

    // Phase 5j: closing balance.
    const opening = (typeof opening_cents === 'number') ? opening_cents : null;
    const closing = opening != null
      ? opening + income - spent - transfers
      : null;

    return {
      income_cents: income,
      spent_cents: spent,
      transfers_cents: transfers,
      available_cents: available,
      savings_rate: savings_rate,
      opening_cents: opening,
      closing_cents: closing,
      by_category: by_category,
    };
  }

  /**
   * Convenience function: fetch entries for a month AND compute summary
   * in one call. The most common caller flow.
   *
   * Phase 5j: also resolves the opening balance for this month
   * (manual row, rolled-forward default, or null if no anchor exists)
   * and feeds it into summarize() so closing_cents is populated.
   *
   * Caller can opt out of opening-balance resolution via
   * opts.skipOpeningBalance when the cost of the extra DB call isn't
   * worth it (e.g., prior-month walk-back during rollover resolution
   * where we recurse).
   *
   * @param {Date|string} month
   * @param {{skipOpeningBalance?: boolean}} [opts]
   */
  async function getMonthSummary(month, opts) {
    const { data: entries, error } = await getEntriesForMonth(month);
    if (error) return { data: null, error: error };

    let openingInfo = null;
    if (!opts || !opts.skipOpeningBalance) {
      const ob = await resolveOpeningBalanceForMonth(month);
      if (!ob.error && ob.data) {
        openingInfo = ob.data;
      }
    }

    const opening_cents = openingInfo && openingInfo.isResolved
      ? openingInfo.opening_cents
      : null;
    const summary = summarize(entries, opening_cents);

    // Surface the resolution metadata too — UI uses it to show
    // "Manual" vs "From Feb 2026" subtitles.
    if (openingInfo) {
      summary.opening_source = openingInfo.source;
      summary.opening_anchor_month = openingInfo.anchorMonth;
    } else {
      summary.opening_source = null;
      summary.opening_anchor_month = null;
    }

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
    getEntriesInRange: getEntriesInRange,
    addEntry: addEntry,
    addEntriesBatch: addEntriesBatch,
    updateEntry: updateEntry,
    deleteEntry: deleteEntry,

    // Goals
    getGoalsForMonth: getGoalsForMonth,
    setGoal: setGoal,
    deleteGoal: deleteGoal,

    // Opening balances (Phase 5j)
    getOpeningBalance: getOpeningBalance,
    setOpeningBalance: setOpeningBalance,
    resolveOpeningBalanceForMonth: resolveOpeningBalanceForMonth,

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
