-- iBoost — migration 0002
-- Update handle_new_user() to read full_name and country from
-- auth.users.raw_user_meta_data. The signup client passes these fields via
-- supabase.auth.signUp({ options: { data: { full_name, country } } }).
--
-- The country column and its CHECK constraint already exist in 0001_init.
-- No column changes here — only the trigger function is replaced.
--
-- Run this in the Supabase SQL editor (Project -> SQL -> New query -> paste
-- -> Run). Safe to re-run: CREATE OR REPLACE is idempotent.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta_full_name text := nullif(new.raw_user_meta_data->>'full_name', '');
  meta_country text := upper(nullif(new.raw_user_meta_data->>'country', ''));
begin
  -- Only accept known country codes. Any other value is discarded (column
  -- stays null) so the CHECK constraint cannot fail and the signup still
  -- succeeds. OAuth signups that don't supply country land here too.
  if meta_country is not null and meta_country not in ('CA', 'US') then
    meta_country := null;
  end if;

  insert into public.profiles (id, email, full_name, country)
  values (new.id, new.email, meta_full_name, meta_country)
  on conflict (id) do update
    set
      email = excluded.email,
      full_name = coalesce(excluded.full_name, public.profiles.full_name),
      country = coalesce(excluded.country, public.profiles.country);

  return new;
end;
$$;

-- Trigger itself is unchanged from 0001; no need to drop/recreate.
-- The ON CONFLICT DO UPDATE path above handles the rare case where a
-- profiles row somehow exists before the auth.users row (should not happen
-- in normal flow).
