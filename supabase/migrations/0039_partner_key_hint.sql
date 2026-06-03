-- iBoost — migration 0039
-- Non-secret API-key hint for the partner Integration tab.
--
-- The raw key is shown ONCE and stored only as a hash (api_key_hash) — it
-- can never be re-displayed (Stripe/GitHub model). To let an operator or
-- partner *identify* which key is active without exposing it, we store a
-- non-secret hint: the prefix (pk_live_/pk_test_) and the last 4 chars.
-- Knowing 4 hex chars of a 48-char random key gives no brute-force uplift,
-- same as Stripe showing sk_live_…a3f9.

alter table public.partners
  add column if not exists api_key_prefix text,   -- 'pk_live_' | 'pk_test_'
  add column if not exists api_key_last4  text;   -- last 4 chars of the key
