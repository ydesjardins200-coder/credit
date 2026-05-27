-- iBoost — migration 0019
-- Subscription cancel-at-period-end support + scheduled-change history.
--
-- Two new admin operations need data structure:
--
--   1) Cancel-at-period-end: agent cancels a subscription, but the user
--      keeps service through their already-paid-for period. The
--      profile needs a flag to render "Canceling on <date>" without
--      having to call Stripe every page load. profile.next_billing_date
--      already tells us WHEN the cancellation will take effect.
--
--   2) Pending plan_changes rows: when a cancel is scheduled, we record
--      a plan_changes row with `effective_at` in the FUTURE. The admin
--      + user-facing UIs render these as "pending" distinctly from past
--      rows. When the customer resumes before period end, the pending
--      row gets `cancelled_at = now()` and a new admin_resume row is
--      written — preserving the audit trail of "was scheduled then
--      unscheduled" for CS investigations later.
--
-- All changes are additive and idempotent. Safe to re-run.

-- ---- 1. profile flag: is a cancellation scheduled? ----
alter table public.profiles
  add column if not exists cancel_at_period_end boolean not null default false;

-- ---- 2. plan_changes: effective_at + cancelled_at columns ----
alter table public.plan_changes
  add column if not exists effective_at timestamptz,
  add column if not exists cancelled_at timestamptz;

-- ---- 3. Extend source CHECK to allow admin_cancel + admin_resume ----
-- Must drop and recreate; CHECK constraints aren't ALTERable.
alter table public.plan_changes
  drop constraint if exists plan_changes_source_check;

alter table public.plan_changes
  add constraint plan_changes_source_check
  check (source in (
    'signup',
    'self_change',
    'admin_change',
    'admin_cancel',
    'admin_resume',
    'stripe_webhook',
    'manual_grant'
  ));

-- ---- 4. Partial index for "pending changes for user X" lookups ----
-- The admin UI's plan-history list and the user-facing Plan card both
-- need to find rows where effective_at is in the future AND not
-- cancelled. Partial index keeps it tiny (most rows are past/cancelled).
create index if not exists plan_changes_user_effective_idx
  on public.plan_changes (user_id, effective_at)
  where effective_at is not null and cancelled_at is null;
