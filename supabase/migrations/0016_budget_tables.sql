-- iBoost — migration 0016
-- Create the three tables backing the Budget tab on /account.html:
--   budget_categories — per-user category list (5-kind structure)
--   budget_entries    — daily-rollup spending/income entries
--   budget_goals      — per-category monthly targets (optional)
--
-- Architecture decisions locked in free-budget-analysis.md (2026-04-27):
--
--   1. 5-kind category split (income / fixed / variable / discretionary /
--      transfer) — based on Patrick O'Brien's 15-year spreadsheet wisdom
--      that proved the structural value of separating fixed from variable
--      from discretionary, and treating CC payments as transfers (not
--      expenses, to avoid double-counting).
--
--   2. Daily-rollup entries (one row per user × date × category, but no
--      UNIQUE constraint — power users can split same-day same-category
--      entries if they want; UX defaults to one rollup per day per
--      category).
--
--   3. Soft-delete on categories (is_archived flag) — preserves history
--      so users who delete "gym" in 2027 still see their 2024 gym
--      spending in eventual historical comparison views.
--
--   4. amount_cents int (not float, not numeric) — money math on floats
--      is the bug factory. cents = always exact.
--
--   5. ON DELETE RESTRICT on entries.category_id — forces archive flow
--      instead of hard-delete. Categories with entries cannot be
--      hard-deleted.
--
--   6. source enum field — entries can come from manual entry, Flinks
--      auto-import (paid tier), or csv_import (deferred from v1, future
--      feature). UI may render manual vs auto-imported differently.
--
--   7. Goals are month-scoped (month_start date), not "ongoing" — Patrick's
--      monthly file structure validates this. Goals shift month-to-month
--      (December = more cadeaux, summer = more voyage).
--
-- Tier philosophy:
--   Free tier writes to these tables via manual entry UI.
--   Paid tier (when Flinks integrates) writes here too with source='flinks'.
--   Same tables, different write paths. Read path is identical for both.
--
-- ============================================================================
-- TODO(reconciliation): Patrick's spreadsheet uses a reconciliation ritual
-- (compare tracked balance vs actual bank balance, track diff). Deliberately
-- deferred from v1.
--
--   Path B (simple): single "tracked balance" stat + "Reconcile" button
--     where user enters actual balance, sees diff, accepts or investigates.
--     ~1.5-2 hrs work. Works only for single-account users.
--
--   Path C (full): budget_accounts table with per-account balances and
--     transfers. Matches the QuickBooks-style ledger model from
--     docs/budget-app-vision.md. ~5-7 hrs work. Crosses into paid tier
--     territory — better positioned as a paid feature once Flinks is
--     integrated (Flinks auto-reconciles).
--
-- Decision: 2026-04-27. See free-budget-analysis.md Q8 for full reasoning.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- TABLE: budget_categories
-- ----------------------------------------------------------------------------
-- Per-user category list. Seeded with 16 starter categories on first
-- Budget tab visit (see public/assets/js/lib/budget-seed.js). Users can
-- add, rename, archive, and reorder freely after seeding.
--
-- The `kind` enum is the structural innovation from Patrick's spreadsheet.
-- It surfaces real signals — "variable spending up 15% MoM" beats "total
-- spending up 15%" because the latter hides whether your fixed bills went
-- up (renewal pricing) or your variable spending crept up (lifestyle).

create table if not exists public.budget_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Display name. Free text, user-editable. Examples: "Groceries",
  -- "Bouffe", "Loyer", "Netflix subscription".
  name text not null,

  -- The 5-kind classification. Drives the management UI grouping,
  -- the summary calculations, and the implicit sign of entries
  -- (income/transfer = positive flow, fixed/variable/discretionary =
  -- negative flow at query time).
  kind text not null
    check (kind in ('income', 'fixed', 'variable', 'discretionary', 'transfer')),

  -- For sorting in management UI within a kind group. Lower = earlier.
  -- Seed function assigns 0, 10, 20, etc. so users can insert between
  -- without renumbering.
  display_order integer not null default 0,

  -- Optional emoji shown next to the category name (🛒, 🏠, etc.).
  -- Provides visual recognition. Not required — categories without
  -- an emoji render fine.
  emoji text,

  -- Soft-delete flag. Patrick's 15-year rule: a user who deletes "gym"
  -- in 2027 still wants their 2024 gym spending in historical views.
  -- Hard-delete would lose that data. Archive hides from active UI but
  -- preserves history.
  is_archived boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Index for the most common query: "show me my categories ordered by
-- display_order, filtered by archived state".
create index if not exists idx_budget_categories_user
  on public.budget_categories(user_id, is_archived, display_order);

alter table public.budget_categories enable row level security;

drop policy if exists "budget_categories: users read own" on public.budget_categories;
create policy "budget_categories: users read own"
  on public.budget_categories
  for select
  using (auth.uid() = user_id);

drop policy if exists "budget_categories: users insert own" on public.budget_categories;
create policy "budget_categories: users insert own"
  on public.budget_categories
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "budget_categories: users update own" on public.budget_categories;
create policy "budget_categories: users update own"
  on public.budget_categories
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- DELETE intentionally NOT exposed via policy — frontend uses archive
-- (set is_archived = true) instead. If a user truly wants to hard-delete
-- a category with no entries, that's a future feature requiring a
-- service-key admin operation.

-- ----------------------------------------------------------------------------
-- TABLE: budget_entries
-- ----------------------------------------------------------------------------
-- Daily-rollup entries. One row represents "amount X spent (or earned) in
-- category Y on date Z". Patrick's daily-rollup model: lower friction,
-- 15-year proven workflow.
--
-- IMPORTANT: amount_cents is always positive. The sign of the cash flow
-- is determined at query time by joining to budget_categories.kind:
--   - income/transfer = inflow (in many summaries)
--   - fixed/variable/discretionary = outflow
-- This avoids the "did I store -34.20 or 34.20 with kind=expense?"
-- ambiguity that bites apps with negative amounts.

create table if not exists public.budget_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- The category this entry belongs to. RESTRICT (not CASCADE) on delete
  -- because categories with entries should be archived, not hard-deleted.
  -- Hard-delete with CASCADE would silently lose the user's history.
  category_id uuid not null references public.budget_categories(id) on delete restrict,

  -- The date this spending/income happened. Patrick's daily-rollup model:
  -- date matters, time-of-day doesn't. Using `date` not `timestamptz`.
  entry_date date not null,

  -- Always positive. Frontend ensures positivity. Sign is implicit from
  -- the linked category's kind.
  amount_cents integer not null check (amount_cents >= 0),

  -- Optional free-text note. The merchant name, the context, whatever.
  -- Used by the smart category suggestion (lib/merchant-categories.js)
  -- which scans this field for known merchant patterns and pre-selects
  -- the appropriate category at entry time.
  note text,

  -- Where this entry came from. Three values:
  --   'manual'     — user typed it in (the only path in v1, free tier)
  --   'flinks'     — auto-imported via paid tier Flinks integration
  --   'csv_import' — bulk imported from CSV (deferred feature)
  -- UI may differentiate (e.g., show a 🤖 icon for auto-imported entries).
  source text not null default 'manual'
    check (source in ('manual', 'flinks', 'csv_import')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Index for the most common query: "show me this user's entries for the
-- current month, newest first".
create index if not exists idx_budget_entries_user_date
  on public.budget_entries(user_id, entry_date desc);

-- Index for category-scoped queries (e.g., "this user's groceries entries
-- for the year"). Less common but useful for reports.
create index if not exists idx_budget_entries_category
  on public.budget_entries(category_id);

alter table public.budget_entries enable row level security;

drop policy if exists "budget_entries: users read own" on public.budget_entries;
create policy "budget_entries: users read own"
  on public.budget_entries
  for select
  using (auth.uid() = user_id);

drop policy if exists "budget_entries: users insert own" on public.budget_entries;
create policy "budget_entries: users insert own"
  on public.budget_entries
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "budget_entries: users update own" on public.budget_entries;
create policy "budget_entries: users update own"
  on public.budget_entries
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "budget_entries: users delete own" on public.budget_entries;
create policy "budget_entries: users delete own"
  on public.budget_entries
  for delete
  using (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- TABLE: budget_goals
-- ----------------------------------------------------------------------------
-- Per-category monthly targets. Optional — users don't need goals to use
-- the budget. Goals are month-scoped (Patrick's wisdom: December needs
-- different cadeaux/voyage targets than April).
--
-- goal_type enum supports three flavors:
--   'spend_under'    — cap. "Stay under $300 on Dining" → 113% means over.
--   'save_at_least'  — floor. "Save at least $200 in TFSA" → 71% means short.
--   'spend_exactly'  — target. "Spend exactly $100 on streaming" → 100% ideal.
-- Different math, different display logic in the goal progress UI.

create table if not exists public.budget_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- The category this goal targets. CASCADE on delete because if the
  -- category goes away (archive or hard-delete), the goal is meaningless.
  -- This differs from entries where we RESTRICT — goals are ephemeral
  -- per-month metadata; entries are durable history.
  category_id uuid not null references public.budget_categories(id) on delete cascade,

  -- The first day of the month this goal applies to. e.g. 2026-04-01 for
  -- "April 2026". Always normalized to first-of-month at write time.
  month_start date not null,

  -- Target amount. Always positive (the amount you're aiming to spend
  -- or save).
  target_cents integer not null check (target_cents >= 0),

  -- See enum description in the table comment above.
  goal_type text not null
    check (goal_type in ('spend_under', 'save_at_least', 'spend_exactly')),

  created_at timestamptz not null default now(),

  -- One goal per (user, category, month). If user wants to change a goal
  -- for the current month, frontend updates in place rather than inserting
  -- a duplicate.
  unique (user_id, category_id, month_start)
);

create index if not exists idx_budget_goals_user
  on public.budget_goals(user_id, month_start desc);

alter table public.budget_goals enable row level security;

drop policy if exists "budget_goals: users read own" on public.budget_goals;
create policy "budget_goals: users read own"
  on public.budget_goals
  for select
  using (auth.uid() = user_id);

drop policy if exists "budget_goals: users insert own" on public.budget_goals;
create policy "budget_goals: users insert own"
  on public.budget_goals
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "budget_goals: users update own" on public.budget_goals;
create policy "budget_goals: users update own"
  on public.budget_goals
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "budget_goals: users delete own" on public.budget_goals;
create policy "budget_goals: users delete own"
  on public.budget_goals
  for delete
  using (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- updated_at triggers
-- ----------------------------------------------------------------------------
-- Auto-update updated_at on UPDATE for categories and entries (not goals
-- which are immutable in spirit — change a goal = update the row but
-- created_at is the only timestamp that matters).
--
-- Convention: per-table trigger function (matches plans_set_updated_at,
-- integrations_set_updated_at from migrations 0012 and 0013). One generic
-- shared function would be cleaner but the existing codebase consistently
-- uses per-table functions, so we follow that convention here.

create or replace function public.budget_categories_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists budget_categories_set_updated_at on public.budget_categories;
create trigger budget_categories_set_updated_at
  before update on public.budget_categories
  for each row
  execute function public.budget_categories_set_updated_at();

create or replace function public.budget_entries_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists budget_entries_set_updated_at on public.budget_entries;
create trigger budget_entries_set_updated_at
  before update on public.budget_entries
  for each row
  execute function public.budget_entries_set_updated_at();
