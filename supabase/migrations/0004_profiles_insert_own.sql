-- iBoost — migration 0004
-- profiles_insert_own policy
--
-- Allows an authenticated user to insert their own profile row. Needed
-- as a fallback for OAuth signups where the handle_new_user trigger
-- sometimes doesn't fire for OAuth-created auth.users rows (observed
-- empirically with Google OAuth in April 2026 — no Postgres error
-- logged, trigger body runs fine when invoked manually, but no row
-- was created at signup time).
--
-- With this policy in place, complete-profile.js's client-side
-- upsert can create the row if it's missing. If the trigger DID run
-- and create the row, the upsert is a no-op (ON CONFLICT DO UPDATE).
-- Belt and suspenders in a way that makes failures visible — upsert
-- returns real HTTP errors instead of silently doing nothing (which
-- was the actual symptom today).
--
-- Scoped to auth.uid() = id so users can only insert their own
-- profile row, never another user's. Matches the scoping of the
-- existing profiles_select_own and profiles_update_own policies.
--
-- Run this in the Supabase SQL editor (Project -> SQL -> New query ->
-- paste -> Run). Safe to re-run: drop + create.

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert
  with check (auth.uid() = id);
