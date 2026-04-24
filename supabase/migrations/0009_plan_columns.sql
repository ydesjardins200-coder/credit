-- iBoost — migration 0009
-- Plan + billing columns on profiles
--
-- All nullable. Stripe columns are forward-declared so when we wire
-- Stripe up later, no schema change is needed — just start filling values.
--
-- Applied manually by Yan via Supabase SQL editor before this commit.

alter table public.profiles
  add column if not exists plan text
    check (plan in ('free', 'essential', 'complete')),
  add column if not exists plan_activated_at timestamptz,
  add column if not exists plan_currency text
    check (plan_currency in ('cad', 'usd')),
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists card_last_four text
    check (card_last_four ~ '^[0-9]{4}$'),
  add column if not exists card_brand text,
  add column if not exists next_billing_date date;

comment on column public.profiles.stripe_customer_id is
  'Set by Stripe integration (not yet implemented as of migration 0009)';
comment on column public.profiles.stripe_subscription_id is
  'Set by Stripe integration (not yet implemented as of migration 0009)';
comment on column public.profiles.card_last_four is
  'Set from Stripe payment method data (not yet implemented as of migration 0009)';
comment on column public.profiles.card_brand is
  'Set from Stripe payment method data (not yet implemented as of migration 0009)';
comment on column public.profiles.next_billing_date is
  'Set from Stripe subscription data (not yet implemented as of migration 0009)';
