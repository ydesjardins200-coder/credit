-- iBoost — migration 0026
-- Extend admin_actions.action CHECK with operator-management actions.
--
-- Stage D adds operator (admin_users) management: create, update,
-- deactivate, password reset. Each emits an admin_actions audit row, so
-- the action CHECK (last set in 0024) must allow the new values.
--
-- Idempotent: drops + recreates the constraint with the full set.

alter table public.admin_actions
  drop constraint if exists admin_actions_action_check;

alter table public.admin_actions
  add constraint admin_actions_action_check
  check (action in (
    'edit',
    'delete',
    'subscription_cancel',
    'subscription_resume',
    'support_reply',
    'support_resolve',
    'support_reopen',
    'support_assign',
    'operator_create',
    'operator_update',
    'operator_deactivate',
    'operator_password_reset'
  ));
