-- iBoost — migration 0024
-- Extend admin_actions.action CHECK with customer-service actions.
--
-- The admin CS tab lets operators reply to / resolve / reopen / take
-- support cases. Each emits an admin_actions audit row, but the action
-- CHECK constraint (last set in 0020) only allows edit/delete/
-- subscription_*, so these new actions would be rejected. Add them.
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
    'support_assign'
  ));
