-- iBoost — migration 0037
-- Partner platform — ATTRIBUTION + ACCRUAL (the money engine).
--
-- Two append-only ledgers (see docs/partner-platform.md):
--   attribution_ledger — what HAPPENED. An immutable trail linking a lead
--                        to the account it became and the payments collected
--                        from it. (signed_up, paid_collected, refunded.)
--   rev_share_events   — what we OWE. An accrual computed from the partner's
--                        deal AT THE TIME of a collected payment. Carries a
--                        frozen snapshot of the deal terms for audit.
--
-- ANCHOR RULE (enforced in code, reflected here): a rev_share_event is only
-- ever written on a COLLECTED payment (Stripe invoice.payment_succeeded),
-- never on a free signup. The 'signed_up' attribution_ledger row is
-- tracking-only and never produces an accrual.
--
-- IDEMPOTENCY: the Stripe webhook can deliver the same event more than once.
-- Both ledgers carry a unique key so a replay cannot double-write:
--   attribution_ledger: unique (event, dedupe_key)
--   rev_share_events:   unique (dedupe_key)
-- where dedupe_key is the stripe invoice/event id for payment events.
--
-- RLS: service-role only (deny-by-default), same as the other partner
-- tables. Customers never touch these.

-- ================================================== attribution_ledger
create table if not exists public.attribution_ledger (
  id                uuid primary key default gen_random_uuid(),
  lead_id           uuid references public.leads(id) on delete set null,
  partner_id        uuid not null references public.partners(id) on delete cascade,
  user_id           uuid references auth.users(id) on delete set null,

  event             text not null
                      check (event in ('signed_up', 'paid_collected', 'refunded')),

  -- payment context (null for 'signed_up')
  stripe_event_id   text,
  invoice_id        text,
  amount_cents      bigint,
  currency          text,

  -- idempotency: for payment events this is the invoice/event id; for
  -- 'signed_up' it's the lead id (one signup attribution per lead).
  dedupe_key        text not null,

  created_at        timestamptz not null default now()
);

create unique index if not exists uq_attr_ledger_event_dedupe
  on public.attribution_ledger(event, dedupe_key);
create index if not exists idx_attr_ledger_partner on public.attribution_ledger(partner_id);
create index if not exists idx_attr_ledger_lead on public.attribution_ledger(lead_id);
create index if not exists idx_attr_ledger_user on public.attribution_ledger(user_id);

-- ==================================================== rev_share_events
create table if not exists public.rev_share_events (
  id                    uuid primary key default gen_random_uuid(),
  partner_id            uuid not null references public.partners(id) on delete cascade,
  lead_id               uuid references public.leads(id) on delete set null,
  user_id               uuid references auth.users(id) on delete set null,
  deal_id               uuid references public.partner_deals(id) on delete set null,
  attribution_ledger_id uuid references public.attribution_ledger(id) on delete set null,

  -- the collected payment this accrual is computed from
  collected_cents       bigint not null,
  currency              text,

  -- what we owe + a frozen snapshot of the deal terms applied
  accrued_cents         bigint not null default 0,
  basis_snapshot        jsonb,

  status                text not null default 'accrued'
                          check (status in ('accrued', 'paid_out', 'reversed')),

  -- idempotency: the stripe invoice/event id. One accrual per collected
  -- payment per partner.
  dedupe_key            text not null,

  created_at            timestamptz not null default now(),
  paid_out_at           timestamptz
);

create unique index if not exists uq_rev_share_dedupe
  on public.rev_share_events(dedupe_key);
create index if not exists idx_rev_share_partner on public.rev_share_events(partner_id, status);
create index if not exists idx_rev_share_lead on public.rev_share_events(lead_id);

-- ====================================================== RLS (lock down)
alter table public.attribution_ledger enable row level security;
alter table public.rev_share_events   enable row level security;
