-- iBoost — migration 0012
-- Create public.plans as the single source of truth for subscription
-- plan data (name, prices in USD + CAD, tagline, perks).
--
-- Today's state (before this migration):
--   Plan data is hardcoded in FOUR places that have drifted:
--     - pricing.html (marketing source of truth)
--     - checkout.html (hardcoded <label> blocks)
--     - account.js PLAN_META (outdated prices + perks)
--     - admin.js PLAN_LABELS (just names)
--   profiles.plan uses CHECK constraint ('free' | 'essential' | 'complete')
--   which still governs identity of a plan — this table is 'everything
--   about a plan EXCEPT the identity'.
--
-- After this migration:
--   This table is the source. Admin edits rows here. Frontend reads
--   from here (wired up in a future session).
--
-- The plan_key column matches profiles.plan enum values exactly.

create table if not exists public.plans (
  -- 'free' | 'essential' | 'complete'. Matches profiles.plan CHECK
  -- constraint exactly — no second source of truth on the enum set.
  plan_key text primary key
    check (plan_key in ('free', 'essential', 'complete')),

  -- Display name. e.g. 'iBoost Essential', 'Free'.
  name text not null,

  -- Tagline shown under the price on pricing.html.
  -- e.g. 'Real credit work without the premium add-ons.'
  tagline text,

  -- Prices in whole dollars (no cents — we don't have sub-dollar
  -- pricing). 0 = free. Separate columns rather than nullable because
  -- we explicitly want both currencies available for every plan.
  price_usd integer not null default 0 check (price_usd >= 0),
  price_cad integer not null default 0 check (price_cad >= 0),

  -- Perks as a JSON array of objects. Each perk has:
  --   { "text": "<visible text>",
  --     "emphasized": bool,   -- renders bold
  --     "muted":      bool }  -- renders dimmed (e.g. 'No bureau reporting' on Free tier)
  -- Admin UI surfaces these as a list with a checkbox for each flag.
  -- Frontend reads this shape and renders accordingly.
  perks jsonb not null default '[]'::jsonb,

  -- Sort order for displaying plans left-to-right on pricing pages.
  -- free = 1, essential = 2, complete = 3.
  sort_order integer not null default 99,

  -- Audit timestamps
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.plans is
  'Subscription plan definitions — source of truth for name, prices, perks. Admin-editable.';

-- RLS: plans are public information (pricing page reads them via
-- anon-key queries). Admin writes via service key which bypasses RLS.
alter table public.plans enable row level security;

drop policy if exists "plans: anyone can read" on public.plans;
create policy "plans: anyone can read"
  on public.plans for select
  using (true);

-- No INSERT/UPDATE/DELETE policy: all writes go through the admin
-- backend using the service key. Regular users cannot mutate plans.

-- updated_at trigger — keep the timestamp fresh on every admin edit
-- so the admin UI can show 'last edited'.
create or replace function public.plans_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists plans_set_updated_at on public.plans;
create trigger plans_set_updated_at
  before update on public.plans
  for each row
  execute function public.plans_set_updated_at();

-- ============ SEED DATA ============
-- Values mirror public/pricing.html (the marketing source of truth
-- on iboostcredit.netlify.app). Perks are the 7-bullet lists verbatim.
--
-- Using ON CONFLICT so this migration is safely re-runnable. If rows
-- already exist (someone ran it, then edited via admin), we DO NOT
-- overwrite their edits — we only insert if the row is missing.
-- To reseed from scratch, manually delete the rows first.

insert into public.plans (plan_key, name, tagline, price_usd, price_cad, sort_order, perks)
values (
  'free',
  'Free',
  'Learn the system. Build the habits. Upgrade when you''re ready.',
  0, 0, 1,
  '[
    {"text": "Full budget app (manual entry)", "emphasized": false, "muted": false},
    {"text": "Complete education library", "emphasized": false, "muted": false},
    {"text": "Manual score dashboard", "emphasized": false, "muted": false},
    {"text": "Monthly credit tips newsletter", "emphasized": false, "muted": false},
    {"text": "No bureau reporting", "emphasized": false, "muted": true},
    {"text": "No AI guidance", "emphasized": false, "muted": true},
    {"text": "Community support only", "emphasized": false, "muted": true}
  ]'::jsonb
)
on conflict (plan_key) do nothing;

insert into public.plans (plan_key, name, tagline, price_usd, price_cad, sort_order, perks)
values (
  'essential',
  'iBoost Essential',
  'Real credit work without the premium add-ons.',
  15, 20, 2,
  '[
    {"text": "$750 reported credit line", "emphasized": false, "muted": false},
    {"text": "Monthly reporting to all major bureaus", "emphasized": false, "muted": false},
    {"text": "Monthly score refresh", "emphasized": false, "muted": false},
    {"text": "Budget app with goals & smart transaction screening", "emphasized": false, "muted": false},
    {"text": "Monthly AI credit tip", "emphasized": false, "muted": false},
    {"text": "Complete education library", "emphasized": false, "muted": false},
    {"text": "Email support (48-hour response)", "emphasized": false, "muted": false}
  ]'::jsonb
)
on conflict (plan_key) do nothing;

insert into public.plans (plan_key, name, tagline, price_usd, price_cad, sort_order, perks)
values (
  'complete',
  'iBoost Complete',
  'Everything we offer. Maximum score-building velocity.',
  30, 40, 3,
  '[
    {"text": "$2,000 reported credit line", "emphasized": true, "muted": false},
    {"text": "Monthly reporting to all major bureaus", "emphasized": false, "muted": false},
    {"text": "Weekly score refresh", "emphasized": true, "muted": false},
    {"text": "Budget app with goals & smart transaction screening", "emphasized": false, "muted": false},
    {"text": "Unlimited on-demand AI advice", "emphasized": true, "muted": false},
    {"text": "Complete education library", "emphasized": false, "muted": false},
    {"text": "Dispute assistance for report errors", "emphasized": true, "muted": false},
    {"text": "Priority support, 7 days a week", "emphasized": true, "muted": false}
  ]'::jsonb
)
on conflict (plan_key) do nothing;
