-- iBoost — migration 0029
-- Scheduled plan changes (paid <-> paid via Stripe Subscription Schedule).
--
-- Policy: plan changes take effect at the NEXT billing cycle, no
-- proration, no partial refunds. A paid<->paid change is implemented as a
-- Stripe Subscription Schedule that swaps the price at period end. Until
-- it lands, we record the INTENT here as a pending marker; the actual
-- profiles.plan flip happens when the Stripe webhook reports the change
-- at renewal (so we never show a plan the customer isn't yet paying for).
--
-- (paid->free uses cancel_at_period_end, not this. free->paid uses a
-- Checkout Session link, not this.)
--
-- 1) Pending-plan marker on profiles. All nullable — set when a change is
--    scheduled, cleared when it lands (or is superseded/cancelled).
alter table public.profiles
  add column if not exists pending_plan text,
  add column if not exists pending_plan_currency text,
  add column if not exists pending_plan_effective_at timestamptz;

-- 2) Allow 'admin_schedule' as a plan_changes source (the scheduled
--    intent; the eventual landing is recorded as a 'stripe_webhook' row).
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
    'admin_schedule',
    'stripe_webhook',
    'manual_grant'
  ));
