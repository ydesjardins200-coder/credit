-- iBoost — migration 0035
-- Public contact form -> support cases.
--
-- The contact page (public, unauthenticated) creates support_cases. Two
-- problems with the existing schema for that:
--   1. user_id is NOT NULL references auth.users — an anonymous visitor
--      has no account.
--   2. We want to MATCH the submitter to an existing account by email/
--      phone when possible (link the case to their real user_id), and
--      otherwise let it through as a true anonymous case.
--
-- Changes:
--   - user_id becomes NULLABLE (anonymous cases have no account).
--   - contact_name / contact_email / contact_phone hold the submitter's
--     details. Always captured from the form; for matched cases they're
--     redundant with the profile but harmless and useful as the
--     as-submitted record.
--   - source marks how the case originated ('app' for the in-product
--     widget, 'contact_form' for the public page). Defaults to 'app' so
--     existing rows + the existing widget path are unaffected.
--
-- Member cases created by the in-app widget continue to set user_id as
-- before; nothing about that path changes.

alter table public.support_cases
  alter column user_id drop not null;

alter table public.support_cases
  add column if not exists contact_name text,
  add column if not exists contact_email text,
  add column if not exists contact_phone text,
  add column if not exists source text not null default 'app'
    check (source in ('app', 'contact_form'));

-- Index for the admin CS tab to find contact-form cases / anonymous ones.
create index if not exists idx_support_cases_source
  on public.support_cases(source, created_at desc);
