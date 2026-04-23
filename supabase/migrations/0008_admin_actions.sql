-- iBoost — migration 0008
-- Admin audit log
--
-- Records every edit and delete performed by the operational admin
-- (iboost_admin service on Railway). Required because:
--   - PIPEDA (Canada) and similar frameworks treat edits to personal
--     data as auditable events
--   - Solo-admin-today doesn't mean solo-admin-forever; when the team
--     grows, "who did this?" needs to be answerable
--   - Self-accountability: if something looks wrong tomorrow, the log
--     answers "what did I touch yesterday?"
--
-- Design notes:
--   - admin_user is the ADMIN_USER env var value at time of action
--     (not a real user_id — the admin service uses shared Basic Auth
--     not per-admin identity, so this is the best we can do today)
--   - target_user_id is the id of the public.profiles row being
--     acted on, NOT an FK — we want the log to survive after the
--     target is deleted
--   - before / after store the field values pre/post change as JSONB.
--     For edits: partial objects showing only changed fields.
--     For deletes: full row before delete in `before`, empty in `after`.
--   - Not RLS-gated because the table is only ever touched by the
--     server-side admin service using the secret key. Access control
--     is HTTP-level (basic auth on the admin service itself).
--
-- Safe to re-run. IF NOT EXISTS + DROP IF EXISTS on the index.

create table if not exists public.admin_actions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- Who did it. Shared-Basic-Auth username today (e.g. 'admin').
  admin_user text not null,

  -- What they did. Enum-ish; keep text not enum type for flexibility.
  -- Current values: 'edit', 'delete'. Add more as admin grows.
  action text not null check (action in ('edit', 'delete')),

  -- Which user was affected. UUID not FK so we keep history across
  -- deletes. Nullable only for future admin actions that don't target
  -- a single user (e.g. 'bulk_export').
  target_user_id uuid,

  -- Before / after snapshots. Keep only the fields that changed
  -- (edits) or the full row (deletes). Schema of the JSONB is not
  -- enforced — if we ever add strict shape, add another column.
  before jsonb,
  after jsonb,

  -- Optional free-text note. Useful for deletes: "requested by user
  -- via email, confirmed by Yan". Today no UI to populate it, leaving
  -- the column for later.
  note text
);

-- Index for the common query: "what did admin do recently?"
drop index if exists admin_actions_created_at_idx;
create index admin_actions_created_at_idx
  on public.admin_actions (created_at desc);

-- Index for per-user history: "what happened to this user?"
drop index if exists admin_actions_target_idx;
create index admin_actions_target_idx
  on public.admin_actions (target_user_id, created_at desc);

-- RLS: disabled. This table is server-only (secret-key access).
-- Explicitly mark RLS disabled so if RLS defaults ever change,
-- existing access still works for the admin service. No policies
-- are needed because the secret key bypasses RLS anyway.
alter table public.admin_actions disable row level security;
