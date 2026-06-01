-- iBoost — migration 0032
-- Education: per-user lesson progress tracking.
--
-- One row per (user, lesson). lesson_id is the STABLE registry id from
-- education-curriculum.js (e.g. 'f1', 'l3', 'm2') — NOT a UUID, NOT a
-- foreign key (the curriculum lives in code, not the DB; the registry is
-- the single source of truth). We deliberately don't FK or CHECK the
-- lesson_id against a table: lessons are defined in JS and can be added
-- without a migration. An orphaned progress row (lesson later removed) is
-- harmless — the library only reads progress for lessons that exist.
--
-- Progress model (v1, deliberately simple):
--   status  — 'in_progress' | 'complete'. A row exists once the user has
--             opened the lesson; it flips to 'complete' on mark-complete.
--   percent — 0..100 scroll/read progress (optional granularity; the
--             "continue where you left off" + per-lesson % use it). A
--             complete lesson is always 100.
--
-- Why a row-per-lesson (vs a JSON blob on profiles): clean per-lesson
-- queries, easy "N complete" counts, and it scales if lessons grow. The
-- whole table is tiny (lessons * active users) and fully RLS-scoped.
--
-- RLS: a user reads/writes ONLY their own rows (auth.uid() = user_id),
-- same pattern as support_cases. The app uses the user-scoped supabase
-- client; no admin/service access is needed for this table.
--
-- Additive + idempotent. Safe to re-run.

create table if not exists public.lesson_progress (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null references auth.users(id) on delete cascade,

  -- Stable registry id from education-curriculum.js. Text, not UUID.
  lesson_id text not null,

  status text not null default 'in_progress'
    check (status in ('in_progress', 'complete')),

  -- 0..100 read progress. Complete lessons are 100.
  percent integer not null default 0
    check (percent >= 0 and percent <= 100),

  started_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),

  -- One progress row per user per lesson. Enables upsert on conflict.
  unique (user_id, lesson_id)
);

-- Hot path: "all progress for this user" (the library overlay) and
-- "this user + this lesson" (the lesson page). The unique index above
-- already covers (user_id, lesson_id); add a plain user_id index for the
-- list-all-for-user read.
create index if not exists lesson_progress_user_idx
  on public.lesson_progress (user_id);

-- ============================================================
-- RLS — users see and write only their own progress.
-- ============================================================
alter table public.lesson_progress enable row level security;

drop policy if exists "lesson_progress: users read own" on public.lesson_progress;
create policy "lesson_progress: users read own"
  on public.lesson_progress
  for select
  using (auth.uid() = user_id);

drop policy if exists "lesson_progress: users insert own" on public.lesson_progress;
create policy "lesson_progress: users insert own"
  on public.lesson_progress
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "lesson_progress: users update own" on public.lesson_progress;
create policy "lesson_progress: users update own"
  on public.lesson_progress
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
