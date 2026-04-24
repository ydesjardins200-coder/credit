-- iBoost — migration 0013
-- Create public.integrations as the admin-controlled "which provider
-- is active" table, per-category.
--
-- Model:
--   Railway env vars  = feasibility (what CAN be used). Derived from
--                       which secrets are set in the deployment.
--   public.integrations = active selection (what IS being used).
--                       Persisted here so admin UI can change it
--                       without a redeploy.
--
-- A provider is selectable only if its required env vars are set in
-- Railway (backend validates this on PATCH). The "manual" fallback
-- is always feasible for every category — it has no env deps.
--
-- Today this table has 2 rows:
--   payment_processor -> manual  (fake card form on checkout.html)
--   email_provider    -> manual  (no transactional emails sent)
--
-- More categories land as features expand (sms_provider, bureau_api,
-- analytics_provider, etc.). Each new category = one new row.

create table if not exists public.integrations (
  -- Category key. Matches the admin UI's row grouping.
  -- Free-form text constrained by a check so invalid categories
  -- can't sneak in via a bad PATCH.
  category text primary key
    check (category in (
      'payment_processor',
      'email_provider'
    )),

  -- Which provider is currently active for this category.
  -- Validated against a per-category allowlist in the backend
  -- (the DB can't enforce cross-column rules without a trigger
  -- or a composite-FK table, and we want to keep this simple).
  -- 'manual' is always valid for every category.
  active_provider_key text not null default 'manual',

  -- Audit
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.integrations is
  'Admin-selected active provider per integration category. Feasibility is derived from Railway env vars; this table records the choice.';

-- RLS: integration config is not public-readable (unlike plans).
-- Frontend doesn't need to know which payment processor is active;
-- that's determined server-side when checkout is wired. Admin
-- backend uses service key, which bypasses RLS entirely.
alter table public.integrations enable row level security;

-- No policies = nothing can read/write except via service key.

-- updated_at bumper so the admin UI can show "last changed N ago"
create or replace function public.integrations_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists integrations_set_updated_at on public.integrations;
create trigger integrations_set_updated_at
  before update on public.integrations
  for each row
  execute function public.integrations_set_updated_at();

-- Seed with 'manual' active for both categories.
-- ON CONFLICT DO NOTHING so re-running the migration doesn't
-- overwrite admin-selected values.
insert into public.integrations (category, active_provider_key)
values ('payment_processor', 'manual')
on conflict (category) do nothing;

insert into public.integrations (category, active_provider_key)
values ('email_provider', 'manual')
on conflict (category) do nothing;
