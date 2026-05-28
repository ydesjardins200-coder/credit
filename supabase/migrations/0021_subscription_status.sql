-- iBoost — migration 0021
-- Track subscription status + payment-failure timing on profiles.
--
-- Two new columns, both populated from Stripe webhook events:
--
--   subscription_status: mirrors Stripe's own subscription.status
--     ('active' | 'past_due' | 'canceled' | 'incomplete' | 'trialing').
--     Nullable — Free users with no subscription have no status.
--     Written from customer.subscription.updated (Stripe sends this
--     field on every update) + set to 'active' on checkout completion.
--
--   payment_failed_at: when a card FIRST started failing. Stripe's
--     status field tells us "past_due" but not "since when" — this
--     captures the first failure so the admin can see "declining since
--     May 20". Set on the first invoice.payment_failed (guarded so
--     retries don't overwrite it), cleared on invoice.payment_succeeded
--     and when the subscription ends.
--
-- IMPORTANT: This migration does NOT change access control. The
-- permissions module (lib/permissions.js) continues to gate on plan
-- tier only. past_due users keep full access (grace period — you don't
-- revoke a paying customer for one bounced charge). Wiring
-- subscription_status into canAccess() is deliberately deferred to a
-- separate change.
--
-- No CHECK constraint on subscription_status: Stripe may add new status
-- values over time, and we'd rather store an unexpected value than
-- reject a webhook. The app treats anything other than 'past_due' as
-- "no banner" so an unknown value fails safe.
--
-- Additive + idempotent. Safe to re-run.

alter table public.profiles
  add column if not exists subscription_status text,
  add column if not exists payment_failed_at timestamptz;

-- Partial index for the admin "show me all past-due users" query that
-- will eventually exist (a CS dashboard of failing accounts). Tiny —
-- only indexes rows actually in past_due.
create index if not exists profiles_past_due_idx
  on public.profiles (subscription_status)
  where subscription_status = 'past_due';
