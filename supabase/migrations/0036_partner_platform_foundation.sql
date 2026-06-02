-- iBoost — migration 0036
-- Partner acquisition platform — FOUNDATION (Slice 1 of the build).
--
-- See docs/partner-platform.md for the full design. This migration creates
-- only the three foundation tables the intake webhook + admin will build on:
--   partners       — who the partner is + how their CRM authenticates
--   partner_deals  — the configurable, versioned rev-share terms
--   leads          — one row per ingested lead (email = the conversion key)
--
-- NOT in this migration (later slices): attribution_ledger + rev_share_events
-- (they depend on the intake + signup flow existing first).
--
-- KEY DESIGN POINTS
--   * is_test on partners — the dummy-partner flag. A $0-commission test
--     partner exercises the whole pipeline with synthetic leads, zero
--     financial/compliance exposure, and stays as a permanent canary.
--     Test-partner data is excluded from real reporting / payout runs.
--   * partner_deals is FULL-FLEXIBLE + versioned (effective_from/to) so it
--     can hold ANY partner's terms before they're known. The anchor rule
--     (pay only on collected revenue, never on free signups) is enforced in
--     the accrual code, not here.
--   * RLS: these are service-role-only tables. The credit backend writes
--     them with the service key (bypasses RLS); the admin reads via the
--     shared-secret cross-service path. Customers NEVER touch them. So RLS
--     is enabled with NO public policies = deny-by-default for anon/auth.
--
-- This is foundation only — no real leads flow until the core features are
-- active AND the compliance gate clears (see docs/partner-platform.md).
-- Safe to apply now; nothing reads/writes these tables until later slices.

-- ============================================================ partners
create table if not exists public.partners (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text not null unique,
  status        text not null default 'active'
                  check (status in ('active', 'paused', 'disabled')),
  is_test       boolean not null default false,
  contact_name  text,
  contact_email text,
  api_key_hash  text not null,   -- hashed intake key; raw key never stored
  hmac_secret   text not null,   -- for webhook signature verification
  notes         text,
  created_at    timestamptz not null default now()
);

-- ======================================================= partner_deals
create table if not exists public.partner_deals (
  id                       uuid primary key default gen_random_uuid(),
  partner_id               uuid not null references public.partners(id) on delete cascade,

  -- payout basis + rate
  payout_basis             text not null
                             check (payout_basis in ('qualified_lead','signup','paid_conversion','recurring_pct')),
  rate_type                text not null
                             check (rate_type in ('flat','percent')),
  rate_value               numeric not null default 0,   -- cents if flat, percent if percent

  -- optional structure
  tiers                    jsonb,                        -- optional volume tiers
  min_volume_threshold     integer,                      -- no payout until N qualifying events
  payout_cap_cents         bigint,                       -- optional cap
  qualifying_criteria      jsonb,                        -- what counts (always under the collected-payment anchor)

  -- attribution + recurrence
  attribution_window_days  integer not null default 60,
  recurring_duration       text not null default 'one_time'
                             check (recurring_duration in ('one_time','n_months','lifetime')),
  recurring_months         integer,                      -- when recurring_duration = 'n_months'

  -- versioning: editing a deal closes the old row (effective_to) and opens
  -- a new one. One active deal per partner at a time.
  effective_from           timestamptz not null default now(),
  effective_to             timestamptz,
  is_active                boolean not null default true,

  created_at               timestamptz not null default now()
);

create index if not exists idx_partner_deals_partner on public.partner_deals(partner_id);
-- At most one active deal per partner (enforced for the active rows only).
create unique index if not exists uq_partner_deals_one_active
  on public.partner_deals(partner_id) where is_active;

-- =============================================================== leads
create table if not exists public.leads (
  id                  uuid primary key default gen_random_uuid(),
  partner_id          uuid not null references public.partners(id) on delete cascade,

  partner_lead_id     text,                 -- the partner's OWN id (their reconciliation key)
  email               text not null,        -- the join key to a future account
  full_name           text,
  phone               text,
  address             jsonb,                -- minimize — intake may choose not to populate (data agreement)

  referral_code       text not null unique, -- deterministic attribution token (used in signup link)

  status              text not null default 'ingested'
                        check (status in ('ingested','contacted','signed_up_free','signed_up_paid','converted_collected','expired','suppressed')),

  idempotency_key     text not null,        -- dedupe; unique PER PARTNER (below)

  -- attribution (filled when matched to an account, later slice)
  attributed_user_id  uuid references auth.users(id) on delete set null,
  attributed_at       timestamptz,
  attribution_method  text check (attribution_method in ('referral_code','email_match','pii_match')),

  raw_payload         jsonb,                -- original POST, for audit (PII-retention policy applies)
  ingested_at         timestamptz not null default now()
);

-- Idempotency is scoped per-partner: two partners may coincidentally reuse
-- a key, but within one partner the same key never creates a duplicate lead.
create unique index if not exists uq_leads_partner_idempotency
  on public.leads(partner_id, idempotency_key);

create index if not exists idx_leads_partner on public.leads(partner_id);
create index if not exists idx_leads_email on public.leads(lower(email));
create index if not exists idx_leads_status on public.leads(status, ingested_at desc);

-- ====================================================== RLS (lock down)
-- Service-role-only. Enable RLS with NO policies → anon/authenticated are
-- denied by default; the service key (credit backend) bypasses RLS to read
-- and write. Customers and the public never access these tables.
alter table public.partners       enable row level security;
alter table public.partner_deals  enable row level security;
alter table public.leads          enable row level security;
