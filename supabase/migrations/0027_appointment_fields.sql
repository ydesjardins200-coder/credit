-- iBoost — migration 0027
-- Onboarding-appointment fields on support_cases.
--
-- An onboarding appointment is a support_case with
-- category = 'onboarding_appointment'. The case flows through the
-- existing CS tab (take / reply / resolve), but it also carries
-- STRUCTURED booking data that doesn't fit a message thread. These
-- columns hold that data. All nullable — only populated for
-- appointment cases; ordinary support cases leave them null.
--
--   appointment_requested_date  — the weekday DATE the user wants
--                                 (a real upcoming business day).
--   appointment_requested_hour  — hour of day, 8–17 (8am–5pm).
--   appointment_timezone        — IANA tz (e.g. 'America/Toronto') so
--                                 the team calls at the right moment.
--   appointment_alt_phone       — optional call-specific phone (does NOT
--                                 touch the user's profile phone).
--   appointment_status          — 'requested' | 'confirmed'. The
--                                 confirmation state an agent sets.
--   appointment_confirmed_at    — when an agent confirmed.
--
-- Additive + idempotent.

alter table public.support_cases
  add column if not exists appointment_requested_date date,
  add column if not exists appointment_requested_hour smallint
    check (appointment_requested_hour is null
           or (appointment_requested_hour between 8 and 17)),
  add column if not exists appointment_timezone text,
  add column if not exists appointment_alt_phone text,
  add column if not exists appointment_status text
    check (appointment_status is null
           or appointment_status in ('requested', 'confirmed')),
  add column if not exists appointment_confirmed_at timestamptz;

-- Index for the admin "upcoming onboarding appointments" view and to
-- find a user's active appointment quickly.
create index if not exists idx_support_cases_appointment
  on public.support_cases(category, appointment_requested_date)
  where category = 'onboarding_appointment';
