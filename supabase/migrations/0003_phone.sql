-- iBoost — migration 0003
-- Add `phone` to public.profiles and update handle_new_user() so it copies
-- phone from auth.users.raw_user_meta_data into the profile row on signup.
--
-- Context: the signup page (/signup.html) now collects a required phone
-- number for the client-center team to follow up with every new lead.
-- The signup client passes the value via:
--   supabase.auth.signUp({ options: { data: { phone: '(514) 555-0100' } } })
-- That lands in auth.users.raw_user_meta_data automatically. This migration
-- makes sure the trigger also copies it into public.profiles so the rest
-- of the app (dashboard, admin tooling, any future CRM sync) can read it
-- from the normal profiles table without needing service-role access to
-- auth.users.
--
-- Format stored: display format '(NXX) NXX-XXXX' (NANP). This matches
-- what the user typed. If we ever need E.164 ('+15551234567') for Twilio
-- / SMS integration, a follow-up migration can run an UPDATE to normalize
-- existing rows in-place.
--
-- Run this in the Supabase SQL editor (Project -> SQL -> New query ->
-- paste -> Run). Safe to re-run: IF NOT EXISTS + CREATE OR REPLACE are
-- idempotent.


-- 1. Add the column. IF NOT EXISTS so re-running is safe.
--    We intentionally do NOT add a NOT NULL constraint: existing rows
--    (pre-migration accounts) have no phone and would otherwise error.
--    New signups will always have phone because signup.html makes it
--    required client-side. If this becomes a data-integrity concern
--    later, a follow-up migration can backfill + flip to NOT NULL.
alter table public.profiles
  add column if not exists phone text;


-- 2. Update the trigger function to also read phone from metadata.
--    Everything else in the function body matches migration 0002 —
--    we're just adding the phone line to the declare + insert + update
--    clauses.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta_full_name text := nullif(new.raw_user_meta_data->>'full_name', '');
  meta_phone text     := nullif(new.raw_user_meta_data->>'phone', '');
  meta_country text   := upper(nullif(new.raw_user_meta_data->>'country', ''));
begin
  -- Only accept known country codes. Any other value is discarded (column
  -- stays null) so the CHECK constraint cannot fail and the signup still
  -- succeeds. OAuth signups that don't supply country land here too.
  if meta_country is not null and meta_country not in ('CA', 'US') then
    meta_country := null;
  end if;

  insert into public.profiles (id, email, full_name, phone, country)
  values (new.id, new.email, meta_full_name, meta_phone, meta_country)
  on conflict (id) do update
    set
      email = excluded.email,
      full_name = coalesce(excluded.full_name, public.profiles.full_name),
      phone = coalesce(excluded.phone, public.profiles.phone),
      country = coalesce(excluded.country, public.profiles.country);

  return new;
end;
$$;

-- Trigger itself is unchanged from 0001/0002; no need to drop/recreate.
-- The ON CONFLICT DO UPDATE path above handles the rare case where a
-- profiles row somehow exists before the auth.users row (should not
-- happen in normal flow).
