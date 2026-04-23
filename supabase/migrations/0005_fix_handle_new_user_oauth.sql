-- iBoost — migration 0005
-- Fix handle_new_user trigger for OAuth signups.
--
-- PROBLEM
--
-- Google OAuth signups were silently failing: Supabase issued a JWT
-- and redirected the browser with a valid access_token, but no
-- auth.users row was ever created. Confirmed empirically — JWT's
-- 'sub' claim contained a UUID, but `select * from auth.users
-- where id = '<that uuid>'` returned 0 rows.
--
-- Root cause (per Supabase official docs):
-- https://supabase.com/docs/guides/troubleshooting/database-error-saving-new-user-RU_EwB
--
-- When OAuth creates a user, the transaction spans inserts into
-- auth.users AND auth.identities. Any failure in an AFTER INSERT
-- trigger on auth.users rolls back the whole transaction — including
-- the auth.users row itself. Supabase still returns the JWT it
-- generated during the first phase, but the database is empty.
--
-- The specific failure mode: the trigger function, even with
-- SECURITY DEFINER, can hit permission issues when `search_path`
-- is set to `public`. Supabase's current official pattern is to
-- set `search_path = ''` (empty) and fully-qualify every table
-- reference with its schema. This sidesteps a class of privilege-
-- escalation and search-path-hijack bugs, and makes the trigger
-- reliable across all auth entry points (email/password signup,
-- OAuth, admin-invite, SSO).
--
-- Why password signups were working despite the same setup: password
-- signups are a simpler single-insert transaction. The trigger runs
-- in a context where the effective permissions path happens to
-- resolve. OAuth's two-phase transaction is stricter.
--
-- FIX
--
-- 1. Recreate handle_new_user with:
--    - `set search_path = ''` (empty, per Supabase's current docs)
--    - Fully-qualified `public.profiles` references
--    - Fully-qualified `pg_catalog.nullif`, `pg_catalog.upper` (search_path=''
--      means even builtin functions need explicit schema)
--
-- 2. Grant INSERT, UPDATE, SELECT on public.profiles to supabase_auth_admin
--    as a belt-and-suspenders. If there's ever an edge case where the
--    trigger runs as supabase_auth_admin instead of the DEFINER role,
--    the grant ensures it still works.
--
-- No data loss. Existing profiles rows are untouched.
-- Safe to re-run (CREATE OR REPLACE + GRANT is idempotent).

-- 1. Recreate the trigger function per Supabase's 2025 official pattern
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $func$
declare
  meta_full_name text := pg_catalog.nullif(new.raw_user_meta_data->>'full_name', '');
  meta_phone text     := pg_catalog.nullif(new.raw_user_meta_data->>'phone', '');
  meta_country text   := pg_catalog.upper(pg_catalog.nullif(new.raw_user_meta_data->>'country', ''));
begin
  -- Whitelist country: only CA or US, null otherwise
  if meta_country is not null and meta_country not in ('CA', 'US') then
    meta_country := null;
  end if;

  -- Fully-qualified schema.table reference because search_path is empty.
  -- Without the schema prefix, this would fail with 'relation "profiles"
  -- does not exist'.
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
$func$;

-- 2. Explicit grants for supabase_auth_admin — belt-and-suspenders.
-- The SECURITY DEFINER should mean the function runs with the creator's
-- (postgres) privileges regardless of caller, but explicit grants remove
-- any ambiguity in edge cases (e.g., if Supabase internals ever change
-- how the trigger is invoked).
grant insert, update, select on public.profiles to supabase_auth_admin;

-- Note: we deliberately do NOT re-create the trigger itself. The
-- existing `on_auth_user_created AFTER INSERT ON auth.users` wiring
-- from 0001 is correct and still in place. CREATE OR REPLACE FUNCTION
-- updates the body that the trigger calls — no need to touch the
-- trigger definition.
