-- iBoost — migration 0014
-- Extends public.integrations check constraint + seed data with 4
-- new categories beyond payment + email:
--
--   banking_aggregator  -> feeds account.html > Budget tab
--                          (Flinks for Canada, eventually Plaid for US)
--   credit_equifax      -> feeds account.html > Credit tab
--   credit_transunion   -> feeds account.html > Credit tab
--   credit_experian     -> feeds account.html > Credit tab (US only)
--
-- WHY SEPARATE CATEGORIES PER BUREAU
--   Equifax, TransUnion, Experian are not alternatives to each other —
--   they're independent data sources. A user's Credit tab ideally shows
--   scores from all 3 bureaus side-by-side. So each bureau gets its
--   own category with its own on/off toggle, not a single 'credit_bureau'
--   category where you'd pick one.
--
--   When each bureau's API credentials are configured in Railway, that
--   category's provider becomes feasible and admin can activate it.
--   Until then: each sits at 'manual' (no automated data pull).
--
-- REPLACES the check constraint rather than ALTER-ing it because
-- Postgres makes check-constraint modifications awkward. Drop + recreate
-- is cleaner and idempotent.

-- 1. Drop + recreate the check constraint to allow the new category keys.
alter table public.integrations
  drop constraint if exists integrations_category_check;

alter table public.integrations
  add constraint integrations_category_check
  check (category in (
    'payment_processor',
    'email_provider',
    'banking_aggregator',
    'credit_equifax',
    'credit_transunion',
    'credit_experian'
  ));

-- 2. Seed the 4 new categories with 'manual' active. ON CONFLICT DO
-- NOTHING so re-running doesn't clobber existing rows or admin edits.
insert into public.integrations (category, active_provider_key)
values
  ('banking_aggregator', 'manual'),
  ('credit_equifax',     'manual'),
  ('credit_transunion',  'manual'),
  ('credit_experian',    'manual')
on conflict (category) do nothing;
