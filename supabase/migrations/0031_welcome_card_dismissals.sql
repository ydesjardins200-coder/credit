-- iBoost — migration 0031
-- Per-user dismissal flags for the welcome-tab confirmation cards.
-- Stored on profiles (a few tightly-coupled per-user booleans; a separate
-- table would be overkill) so a dismissal persists across devices —
-- localStorage wouldn't survive a PC -> iPhone switch.
--
-- Only the two CONFIRMATION cards are dismissible for now:
--   welcome_setup_dismissed  -> "You're all set" (KYC done) card
--   welcome_call_dismissed   -> "Your call is confirmed" card
-- The "Connect your toolkit" card is intentionally NOT dismissible until
-- the bureau + bank integrations exist to mark it complete.
alter table public.profiles
  add column if not exists welcome_setup_dismissed boolean not null default false,
  add column if not exists welcome_call_dismissed boolean not null default false;
