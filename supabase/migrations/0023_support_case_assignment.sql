-- iBoost — migration 0023
-- Case assignment ("take a case") on support_cases.
--
-- Adds operator ownership to support cases. An agent can "take" a case,
-- which assigns it to them. In v1 there is no per-operator identity yet
-- (the admin is single-tier shared auth), so assigned_to is text and
-- holds the literal 'admin' for now. When the upcoming user-management
-- piece introduces distinct operators, assigned_to migrates to a real
-- operator identifier (and we may add a FK then) — kept as plain text
-- now so we don't pre-commit the schema to an operators table that
-- doesn't exist yet.
--
-- Assignment is ORTHOGONAL to status: a case can be open+unassigned
-- (in the shared queue), open+assigned (someone's working it), or
-- resolved. In v1 taking is ADVISORY — it marks ownership but does not
-- gate who can reply/resolve. The role system will later tighten this
-- to take-before-act with proper multi-operator rules.
--
--   assigned_to  — null = unassigned (in the queue); 'admin' = taken.
--   assigned_at  — when it was taken; null while unassigned.
--
-- Additive + idempotent. Safe to re-run.

alter table public.support_cases
  add column if not exists assigned_to text,
  add column if not exists assigned_at timestamptz;

-- Partial index for the "unassigned queue" view (cases nobody owns yet).
create index if not exists idx_support_cases_unassigned
  on public.support_cases(created_at desc)
  where assigned_to is null;
