-- 0041_marketing_consent.sql
--
-- CASL marketing consent for the free-user nurture campaign (Customer.io
-- Phase 2). A free user only enters the campaign when marketing_consent is
-- true. marketing_consent_at is the proof-of-consent record CASL expects a
-- sender to be able to produce (the timestamp the consent was given).
--
-- Default false: existing free users predate the signup checkbox and never
-- gave consent, so they are correctly excluded from the campaign. Re-
-- permissioning them is a separate, deliberate CASL flow — not a backfill.
--
-- NOTE (decided with counsel, risk accepted by the business): the signup
-- checkbox is checked by default (opt-out) rather than an unchecked opt-in.
-- The CRTC's stated position is that express consent requires a positive
-- opt-in and pre-checked boxes do not constitute valid express consent.
-- This column stores whatever the box yields; the compliance posture lives
-- in the signup UI, not here.

alter table public.profiles
  add column if not exists marketing_consent boolean not null default false,
  add column if not exists marketing_consent_at timestamptz;

comment on column public.profiles.marketing_consent is
  'CASL marketing-email consent (Customer.io nurture campaign). Checked-by-default opt-out at signup per business decision.';
comment on column public.profiles.marketing_consent_at is
  'Timestamp consent was recorded — proof-of-consent for CASL.';
