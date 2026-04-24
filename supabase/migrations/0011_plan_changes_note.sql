-- iBoost — migration 0011
-- Add a `note` column to plan_changes so admin-driven plan changes
-- can carry context (e.g. "Called in 2pm Apr 24, downgraded to Essential").
--
-- Required at the API layer for source='admin_change' rows; optional
-- otherwise (signup / self_change / stripe_webhook don't write notes).
-- DB default is null; server-side validation enforces the admin-change
-- requirement.

alter table public.plan_changes
  add column if not exists note text;

comment on column public.plan_changes.note is
  'Free-text context for admin-initiated plan changes. Required when source=admin_change; null for other sources.';
