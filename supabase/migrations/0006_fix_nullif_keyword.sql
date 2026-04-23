-- iBoost — migration 0006
-- Undo the pg_catalog.nullif() mistake from 0005.
--
-- CONTEXT
--
-- 0005 set search_path='' on handle_new_user and tried to fully-qualify
-- every name to sidestep search-path hijack. Applied that rule to
-- nullif() by writing pg_catalog.nullif(). That breaks — nullif is a
-- SQL *keyword* (a special parser construct, like CASE or COALESCE),
-- not a function in any schema. pg_catalog.nullif does not exist.
--
-- Result at runtime:
--   function pg_catalog.nullif(text, unknown) does not exist
--   SQLSTATE 42883
--   during statement block local variable initialization
--
-- This broke email/password signup (trigger fires on the auth.users
-- INSERT, throws, entire transaction rolls back). OAuth signups still
-- appeared to work on the client because the JWT was already issued
-- before the trigger failure — but the auth.users row was never
-- committed to the database.
--
-- FIX
--
-- Replace pg_catalog.nullif(...) with plain nullif(...) and
-- pg_catalog.upper(nullif(...)) with upper(nullif(...)). These are
-- special SQL forms / parser-level keywords; they don't need (and
-- can't accept) schema qualification.
--
-- For the schema-path-hardening benefit 0005 was aiming for, the
-- important thing is that TABLE references are fully qualified. Those
-- are still public.profiles everywhere in the function body.
-- Function calls that are NOT keywords (upper, coalesce, etc. where
-- applicable) remain unqualified; Postgres resolves them from the
-- pg_catalog safe-list even with search_path=''.
--
-- Safe to re-run. CREATE OR REPLACE is idempotent.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $func$
declare
  meta_full_name text := nullif(new.raw_user_meta_data->>'full_name', '');
  meta_phone text     := nullif(new.raw_user_meta_data->>'phone', '');
  meta_country text   := upper(nullif(new.raw_user_meta_data->>'country', ''));
begin
  -- Whitelist country: only CA or US, null otherwise
  if meta_country is not null and meta_country not in ('CA', 'US') then
    meta_country := null;
  end if;

  -- Fully-qualified schema.table reference — search_path is empty so
  -- unqualified 'profiles' would fail with 'relation profiles does not exist'.
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

-- Re-grant (idempotent). From 0005; keeping here so re-running 0006
-- from scratch restores the full safe state.
grant insert, update, select on public.profiles to supabase_auth_admin;
