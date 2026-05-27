-- iBoost — migration 0018
-- Allow 'manual_grant' as a plan_changes.source value.
--
-- Used by the manual-mode dev path on the credit backend: when
-- public.integrations.payment_processor = 'manual', /create-session
-- writes the plan directly (no Stripe) and records the change with
-- source = 'manual_grant'. Lets us distinguish dev-mode grants from
-- real paying subscriptions in queries / admin UI.
--
-- The constraint must be dropped and recreated; Postgres CHECK
-- constraints aren't ALTERable.

alter table public.plan_changes
  drop constraint if exists plan_changes_source_check;

alter table public.plan_changes
  add constraint plan_changes_source_check
  check (source in (
    'signup',
    'self_change',
    'admin_change',
    'stripe_webhook',
    'manual_grant'
  ));
