-- iBoost — migration 0025
-- Operator (staff) accounts for the admin panel.
--
-- DELIBERATELY SEPARATE from customer identity. Customers live in
-- auth.users + public.profiles (Supabase Auth). Operators live HERE,
-- with their own password hash and our own session auth. The two
-- identity pools never mix — a bug in one cannot grant access to the
-- other, and there's zero risk of a customer being mistaken for staff.
-- For a financial product this separation is the safe default.
--
-- This table is read/written ONLY by the admin backend via the service
-- key. RLS is enabled with no permissive policies, so anon/authenticated
-- (customer) roles get nothing; the service key bypasses RLS as usual.
--
-- Roles: a text[] array holding any of 'admin', 'customer_service',
-- 'collection_agent'. Multi-select. ENFORCEMENT of what each role can
-- see/do is NOT here; roles are stored now, gating comes later.
--
-- Additive + idempotent.

create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  full_name text not null,
  roles text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz
);

create index if not exists idx_admin_users_email
  on public.admin_users(lower(email));

alter table public.admin_users enable row level security;
