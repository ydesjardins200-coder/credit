-- iBoost — migration 0038
-- daily_metrics: one row per day, a snapshot of business-health numbers,
-- so the dashboard can show REAL trend lines over time (we have no
-- historical series today — only current-state snapshots).
--
-- Captured opportunistically when an operator loads the dashboard (upsert
-- on date) — no cron needed. Gaps on days nobody views the dashboard are
-- fine for trend purposes. Append/overwrite is idempotent on the date.
--
-- RLS: service-role only (the admin backend writes/reads it with the
-- service key), deny-by-default for anon/auth.

create table if not exists public.daily_metrics (
  metric_date     date primary key,           -- one row per calendar day
  active_total    integer not null default 0, -- paying subscribers
  free_total      integer not null default 0,
  mrr_cad         numeric not null default 0, -- DB-derived approximation
  mrr_usd         numeric not null default 0,
  essential_count integer not null default 0,
  complete_count  integer not null default 0,
  past_due        integer not null default 0,
  kyc_incomplete  integer not null default 0,
  new_signups_24h integer not null default 0,
  captured_at     timestamptz not null default now()
);

alter table public.daily_metrics enable row level security;
