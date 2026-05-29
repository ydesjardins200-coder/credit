-- iBoost — migration 0028
-- Backfill explicit case categories.
--
-- We now have three case types (help / onboarding_appointment /
-- payment_failed) and the admin Type column derives from `category`.
-- Historically the Get-help form left category null. Set those to the
-- explicit 'help' slug so the Type column is unambiguous and so the
-- customer-facing case list's null-safe internal-category filter has
-- clean data to work with.
--
-- Only touches rows that are clearly help cases (null category and not
-- an appointment). Idempotent.

update public.support_cases
set category = 'help'
where category is null;
