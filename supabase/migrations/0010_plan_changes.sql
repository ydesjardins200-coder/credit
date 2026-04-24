-- iBoost — migration 0010
-- Plan change history
--
-- Every plan change appends a row. Used by:
--   - Profile tab "View plan history" link on /account.html
--   - Admin user detail "Plan & billing" section
--   - Future: Stripe webhook handlers write 'stripe_webhook' rows here
--     when subscription.updated events arrive
--
-- Applied manually by Yan via Supabase SQL editor before this commit.

create table if not exists public.plan_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  from_plan text,
  to_plan text not null,
  changed_at timestamptz not null default now(),
  source text not null check (source in (
    'signup',
    'self_change',
    'admin_change',
    'stripe_webhook'
  ))
);

drop index if exists plan_changes_user_changed_idx;
create index plan_changes_user_changed_idx
  on public.plan_changes (user_id, changed_at desc);

-- ----- RLS -----
-- Users can read and insert their own rows. No update/delete policies
-- (append-only for integrity). Admin service uses service key and
-- bypasses RLS entirely.

alter table public.plan_changes enable row level security;

drop policy if exists "plan_changes: users read own" on public.plan_changes;
create policy "plan_changes: users read own"
  on public.plan_changes
  for select
  using (auth.uid() = user_id);

drop policy if exists "plan_changes: users insert own" on public.plan_changes;
create policy "plan_changes: users insert own"
  on public.plan_changes
  for insert
  with check (auth.uid() = user_id);
