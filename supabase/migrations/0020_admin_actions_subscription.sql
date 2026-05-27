-- iBoost — migration 0020
-- Extend admin_actions.action CHECK to allow subscription cancel/resume.
--
-- Stage 2a of the subscription-cancel feature: the admin server
-- writes one admin_actions row per cancel/resume operation, in
-- addition to the plan_changes row written by the credit backend.
-- This gives us cross-service audit trail — the credit backend
-- proves the operation hit Stripe, and the admin proves which CS
-- agent triggered it.
--
-- Idempotent — safe to re-run.

alter table public.admin_actions
  drop constraint if exists admin_actions_action_check;

alter table public.admin_actions
  add constraint admin_actions_action_check
  check (action in (
    'edit',
    'delete',
    'subscription_cancel',
    'subscription_resume'
  ));
