-- 0042_partner_leads_consent.sql
--
-- Per-PARTNER (per-lender) consent gate for syncing ingested leads into
-- Customer.io. Consent is confirmed at the partner level, not per lead:
-- an operator manually ticks the box on a partner once they've verified
-- (with counsel) that the lender's intake actually captured CASL CEM
-- consent naming iBoost. Only then do that partner's leads flow to the
-- marketing platform.
--
-- Gating logic (applied at ingest):
--   syncToCio = partner.is_test OR partner.leads_consent_confirmed
-- TEST partners always sync so the full pipeline can be exercised with
-- synthetic leads without touching the real consent flag.
--
-- The confirmed_at / confirmed_by / notes columns are the proof-of-consent
-- record — what an operator attests to, when, and why (e.g. "lender intake
-- clause v3, counsel-reviewed 2026-06"). Keep this; it's the artifact you
-- show if a CASL question is ever raised about a partner's leads.

alter table public.partners
  add column if not exists leads_consent_confirmed    boolean not null default false,
  add column if not exists leads_consent_confirmed_at  timestamptz,
  add column if not exists leads_consent_confirmed_by  text,
  add column if not exists leads_consent_notes         text;

comment on column public.partners.leads_consent_confirmed is
  'Operator-confirmed: this partner''s leads have valid CASL CEM consent and may be synced to Customer.io. TEST partners bypass this gate.';
comment on column public.partners.leads_consent_confirmed_at is
  'When the consent box was ticked — proof-of-consent record.';
comment on column public.partners.leads_consent_confirmed_by is
  'Which operator confirmed consent — proof-of-consent record.';
comment on column public.partners.leads_consent_notes is
  'Operator notes on the basis for consent (e.g. lender intake clause version, counsel review date).';
