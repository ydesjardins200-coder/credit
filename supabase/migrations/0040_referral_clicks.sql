-- iBoost — migration 0040
-- referral_clicks: top-of-funnel click tracking for partner referral links.
--
-- When a visitor lands on the signup page with ?ref=ib_… the page fires a
-- best-effort beacon that records one click. Deduped per browser (the
-- client only fires once per ref code), so a refresh isn't 5 clicks. Most
-- simple link-unfurl bots don't run JS, so the JS beacon filters much of
-- that noise; the dedupe handles the rest.
--
-- One row per counted click (ref code + resolved partner + day bucket).
-- This is an event table that can grow — it folds into the daily-metrics
-- rollup pattern later if volume warrants (per the scaling plan), never a
-- hard delete.
--
-- RLS service-role only (the public endpoint writes via the service role).

create table if not exists public.referral_clicks (
  id            uuid primary key default gen_random_uuid(),
  referral_code text not null,
  partner_id    uuid references public.partners(id) on delete cascade,
  -- coarse browser dedupe token (random id stored client-side per ref);
  -- lets us count distinct-ish clicks without any PII.
  client_token  text,
  clicked_at    timestamptz not null default now()
);

create index if not exists idx_referral_clicks_partner on public.referral_clicks(partner_id);
create index if not exists idx_referral_clicks_code on public.referral_clicks(referral_code);

alter table public.referral_clicks enable row level security;
