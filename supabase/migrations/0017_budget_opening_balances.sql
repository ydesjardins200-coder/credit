-- ============================================================================
-- 0017_budget_opening_balances.sql — Phase 5j
-- ============================================================================
-- Adds per-month opening balances for the Budget tab. One value per
-- (user, month), recording how much money was in the user's primary
-- operating account at the start of that budget month.
--
-- WHY THIS TABLE EXISTS
--
-- Phase 5d–5i tracked income/spent/transfers per month, but treated every
-- month as if it began at $0. The Budget tab's "Available" card showed
-- (income - spent), which is the budget surplus, not the cash position.
-- Users in the credit-rebuilding target market routinely start months
-- carrying a balance from the previous one, or in some cases overdrawn,
-- and want to see "if I started March with $5,200 and logged everything,
-- what should my chequing actually show right now?"
--
-- This table feeds two new dashboard cards:
--   - Opening balance (the value stored in this table)
--   - Net cash flow / Closing balance (= opening + income - spent - transfers)
--
-- Together they let the Budget tab answer the cash-position question
-- without needing the full account-ledger model from
-- docs/budget-app-vision.md (which depends on Flinks data).
--
-- ROLLOVER MODEL
--
-- When a user views a month with no row in this table, the application
-- computes a default by walking back to the most recent prior month
-- that DOES have data, then projecting forward (each month's closing
-- becomes the next month's opening). The first time we resolve a default
-- this way, we PERSIST it as a row with source='rollover' so future
-- reads are O(1) and the value is sticky.
--
-- Sticky defaults are intentional: if the user later edits an old month,
-- newer months' rollover rows do NOT auto-recalculate. This is by design
-- — Yan's call. Editing March in July silently shifting July's opening
-- balance is more surprising than the alternative.
--
-- Manual user-set rows have source='manual'. They never get overwritten
-- automatically. The application only writes 'rollover' rows when no
-- row exists yet for a month.
-- ============================================================================

create table if not exists public.budget_opening_balances (
  id uuid primary key default gen_random_uuid(),

  -- CASCADE on delete so that a user wiping their account cleans up
  -- opening balances along with everything else. Same pattern as
  -- budget_categories / budget_entries / budget_goals from migration 0016.
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Always normalized to the first-of-month at write time. e.g. 2026-04-01
  -- for "April 2026". Frontend enforces this; the date type allows any
  -- day, so we add a CHECK to defend the invariant at the DB level too.
  month_start date not null
    check (extract(day from month_start) = 1),

  -- The opening balance, in cents. Can be negative — credit-rebuilding
  -- users sometimes start months overdrawn, and pretending zero is the
  -- floor would be paternalistic. No CHECK on sign.
  opening_cents integer not null,

  -- 'manual'   — user explicitly set this value via the edit modal.
  --              Sticky: never auto-overwritten by rollover logic.
  -- 'rollover' — the application defaulted this value by carrying
  --              forward from the most recent prior manual anchor.
  --              Distinguishable so the UI can show "from March 2026"
  --              as the subtitle vs "Manual" for user-set rows.
  source text not null default 'manual'
    check (source in ('manual', 'rollover')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One opening balance per user per month. Upserts on this constraint.
  unique (user_id, month_start)
);

-- Most common query: "give me the opening balance for this month, or
-- the most recent prior month if none exists for this one." Both
-- variants benefit from this index.
create index if not exists idx_budget_opening_balances_user_month
  on public.budget_opening_balances(user_id, month_start desc);

-- ----------------------------------------------------------------------------
-- RLS — same shape as budget_categories / budget_entries / budget_goals
-- ----------------------------------------------------------------------------

alter table public.budget_opening_balances enable row level security;

drop policy if exists "budget_opening_balances: users read own"
  on public.budget_opening_balances;
create policy "budget_opening_balances: users read own"
  on public.budget_opening_balances
  for select
  using (auth.uid() = user_id);

drop policy if exists "budget_opening_balances: users insert own"
  on public.budget_opening_balances;
create policy "budget_opening_balances: users insert own"
  on public.budget_opening_balances
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "budget_opening_balances: users update own"
  on public.budget_opening_balances;
create policy "budget_opening_balances: users update own"
  on public.budget_opening_balances
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "budget_opening_balances: users delete own"
  on public.budget_opening_balances;
create policy "budget_opening_balances: users delete own"
  on public.budget_opening_balances
  for delete
  using (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- updated_at trigger — same per-table-function convention as 0012/0013/0016
-- ----------------------------------------------------------------------------

create or replace function public.budget_opening_balances_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists budget_opening_balances_set_updated_at
  on public.budget_opening_balances;
create trigger budget_opening_balances_set_updated_at
  before update on public.budget_opening_balances
  for each row
  execute function public.budget_opening_balances_set_updated_at();
