-- iBoost — migration 0022
-- Customer-service case system: "Get help" → a tracked, two-way case.
--
-- Two tables:
--
--   support_cases    — one row per case. Has a human-friendly
--                      case_number (for phone/email reference), a
--                      status, two-sided unread flags, and the
--                      customer's post-resolution rating.
--
--   support_messages — the thread. Many messages per case, each
--                      authored by either the customer or an agent.
--                      Two-way from day one (customer asks, agent
--                      answers, customer can reply). This is also the
--                      data foundation the future live-chat feature
--                      will build real-time transport on top of.
--
-- Unread model (v1 = simple booleans, symmetric for a two-way thread):
--   unread_by_customer — set true when an AGENT posts; cleared when the
--                        customer views the case. Drives the envelope
--                        badge in the account header.
--   unread_by_agent    — set true when a CUSTOMER posts (including the
--                        initial message); cleared when an agent views.
--                        Drives the "needs attention" signal in the
--                        admin CS tab.
--   These are maintained by the application layer (the message-insert
--   endpoints), not by DB triggers — keeps the logic visible in code.
--
-- RLS: customers can read/write only their OWN cases + messages
-- (auth.uid() = user_id). The admin backend uses the service key and
-- bypasses RLS, exactly as it does for every other admin read/write.
--
-- Access control note: this migration does NOT encode agent-vs-
-- poweruser roles. The admin side is currently single-tier. The role
-- system is the next piece; nothing here forecloses it (status,
-- author_type, future assignment columns all leave room).
--
-- Additive + idempotent. Safe to re-run.

-- ============================================================
-- Human-friendly case numbers
-- ============================================================
-- A sequence backs a readable case number ("1001", "1002", …) so the
-- customer and agent can reference a case without quoting a UUID.
-- Starts at 1001 so the very first case doesn't look like "#1".
create sequence if not exists support_case_number_seq start with 1001;

-- ============================================================
-- support_cases
-- ============================================================
create table if not exists public.support_cases (
  id uuid primary key default gen_random_uuid(),

  -- Human-friendly reference number. Unique, assigned at insert from
  -- the sequence above. Stored as bigint; the UI renders it as "#1001".
  case_number bigint not null unique default nextval('support_case_number_seq'),

  user_id uuid not null references auth.users(id) on delete cascade,

  -- Short subject / category. Optional in v1 (the form may offer a
  -- category dropdown; free-text subject also fine). No CHECK — keep it
  -- flexible until categories are nailed down.
  subject text,
  category text,

  -- Lifecycle. v1 has two states; 'closed' reserved for future use
  -- (e.g. auto-close after inactivity) without a migration.
  status text not null default 'open'
    check (status in ('open', 'resolved', 'closed')),

  -- Two-sided unread flags (see header note). A brand-new case is
  -- unread for agents (a customer just asked something) and read for
  -- the customer (they just wrote it).
  unread_by_customer boolean not null default false,
  unread_by_agent boolean not null default true,

  -- Post-resolution rating. Enabled (in the UI) only when status =
  -- 'resolved'. 1–5 stars + optional comment. Null until rated.
  rating smallint check (rating between 1 and 5),
  rating_comment text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- Customer's "my cases" list: their cases, newest first.
create index if not exists idx_support_cases_user
  on public.support_cases(user_id, created_at desc);

-- Admin CS tab: filter by status, and surface agent-unread first.
create index if not exists idx_support_cases_status
  on public.support_cases(status, created_at desc);

-- Partial index for the admin "needs attention" (new customer
-- messages waiting) query.
create index if not exists idx_support_cases_agent_unread
  on public.support_cases(unread_by_agent)
  where unread_by_agent = true;

alter table public.support_cases enable row level security;

drop policy if exists "support_cases: users read own" on public.support_cases;
create policy "support_cases: users read own"
  on public.support_cases
  for select
  using (auth.uid() = user_id);

drop policy if exists "support_cases: users insert own" on public.support_cases;
create policy "support_cases: users insert own"
  on public.support_cases
  for insert
  with check (auth.uid() = user_id);

-- Customers may update their own case — but only for the narrow
-- purposes the UI exposes (marking read, submitting a rating). We
-- can't easily column-restrict in RLS, so the policy allows the row;
-- the customer backend endpoints are what actually constrain WHICH
-- columns change (status/resolution are agent-only, written via the
-- service key). The customer never gets the service key.
drop policy if exists "support_cases: users update own" on public.support_cases;
create policy "support_cases: users update own"
  on public.support_cases
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- support_messages
-- ============================================================
create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),

  case_id uuid not null references public.support_cases(id) on delete cascade,

  -- Who wrote it. 'customer' messages come through the customer
  -- backend (author_id = the user). 'agent' messages come through the
  -- admin backend (author_id = the admin actor, or null if we don't
  -- track individual admins yet — the role system will firm this up).
  author_type text not null check (author_type in ('customer', 'agent')),
  author_id uuid,

  body text not null,

  created_at timestamptz not null default now()
);

-- Thread fetch: all messages for a case, oldest first.
create index if not exists idx_support_messages_case
  on public.support_messages(case_id, created_at asc);

alter table public.support_messages enable row level security;

-- A customer can read messages belonging to a case they own. This
-- joins back to support_cases to check ownership.
drop policy if exists "support_messages: users read own" on public.support_messages;
create policy "support_messages: users read own"
  on public.support_messages
  for select
  using (
    exists (
      select 1 from public.support_cases c
      where c.id = support_messages.case_id
        and c.user_id = auth.uid()
    )
  );

-- A customer can post a message to a case they own, and only as a
-- 'customer'-type message. Agent messages are written via the service
-- key (which bypasses RLS), so this policy never needs to allow them.
drop policy if exists "support_messages: users insert own" on public.support_messages;
create policy "support_messages: users insert own"
  on public.support_messages
  for insert
  with check (
    author_type = 'customer'
    and exists (
      select 1 from public.support_cases c
      where c.id = support_messages.case_id
        and c.user_id = auth.uid()
    )
  );

-- No customer UPDATE/DELETE on messages — a sent message is immutable
-- from the customer side. (Agents likewise don't edit; the thread is
-- an append-only record.)
