-- iBoost — migration 0030
-- Persist the most recently generated free->paid upgrade link on the
-- profile, so the admin Plan & billing card can show it (and re-share it)
-- without regenerating. Cleared when the user gets provisioned (webhook
-- checkout.session.completed) or is otherwise no longer Free.
--
-- The link is a Stripe Checkout Session URL — it expires ~24h, so we also
-- record when it was created so the UI can show staleness.
alter table public.profiles
  add column if not exists upgrade_link_url text,
  add column if not exists upgrade_link_plan text,
  add column if not exists upgrade_link_created_at timestamptz;
