-- iBoost — migration 0015
-- Backfill profiles.country for users where it's NULL.
--
-- CONTEXT
--   profiles.country was added in 0001_init with constraint:
--     country text check (country in ('CA', 'US'))
--   It was made nullable so OAuth signups (which don't supply country
--   in raw_user_meta_data) could land safely. Email signups with the
--   /signup.html form supply country via radio buttons.
--
--   Over time, that means we have a mix of users with country set
--   ('CA' or 'US') and users with NULL country. The new lib/locale.js
--   module (frontend + admin) treats NULL as "fall back to CA defaults"
--   so things still work — but having NULL in the DB means:
--     - Account.html shows "Country not set" instead of a flag/name
--     - Admin can't compute applicable bureaus or billing currency
--     - Stats / reporting that group by country lose visibility
--
-- DECISION (Yan, 2026-04-25)
--   All current users are test users (no real users yet — pre-launch).
--   Default all NULL countries to 'CA' since iBoost launched
--   Quebec-first and any test user with NULL is most likely a Canadian
--   tester who used OAuth (which skipped the country radio).
--
--   This is a one-time backfill. Going forward, the signup form
--   requires country, and the OAuth completion flow on
--   /complete-profile.html captures it explicitly. So new users
--   will always have country set, and this migration is a "clean up
--   the historical NULL state" pass.
--
-- ROLLBACK
--   No structural schema change — just a data UPDATE. To roll back
--   you'd need to re-NULL specific user rows, which is unlikely to
--   be useful. Safer: just don't run this if the assumption above
--   ever stops being true.

begin;

update public.profiles
set country = 'CA',
    updated_at = now()
where country is null;

-- Sanity check: after this migration, every profile should have country set.
-- This block raises an error if backfill missed any rows (defensive).
do $$
declare
  null_count integer;
begin
  select count(*) into null_count from public.profiles where country is null;
  if null_count > 0 then
    raise exception 'Migration 0015 backfill missed % profiles with NULL country', null_count;
  end if;
end $$;

commit;
