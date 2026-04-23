-- iBoost — migration 0007
-- Profile KYC fields: DOB, address (split), credit goal
--
-- Context: the dashboard's "complete your profile" flow needs these
-- fields to prepare users for the eventual bureau integration. DOB
-- and full address are required for bureau match; credit_goal_kind
-- is iBoost-internal segmentation (how the team personalizes
-- outreach and coaching).
--
-- DELIBERATELY NOT INCLUDED (deferred to bureau-integration time):
--   - SIN / SSN (even last 4)
--   - identity_verified_at
--   - bureau_file_created_at
-- When the bureau partnership is signed, a future migration will add
-- these with encryption / audit logging appropriate to their
-- compliance requirements. The decision to defer was documented in
-- the conversation: bureaus treat soft-pull identity verification
-- differently from hard-pull origination, and iBoost is in the
-- soft-pull space. SIN/SSN is optional for soft match and can be
-- collected at moment-of-API-call later.
--
-- All columns nullable at the database layer. A non-null check on
-- DOB + address_line1 + address_city + address_region +
-- address_postal + credit_goal_kind defines "profile complete for
-- bureau prep" — the dashboard computes completeness from that rule
-- rather than a stored boolean.
--
-- Safe to re-run: IF NOT EXISTS on columns + DROP IF EXISTS on
-- constraints make this idempotent.

alter table public.profiles
  add column if not exists date_of_birth        date,
  add column if not exists address_line1        text,
  add column if not exists address_line2        text,
  add column if not exists address_city         text,
  add column if not exists address_region       text,
  add column if not exists address_postal       text,
  add column if not exists credit_goal_kind     text,
  add column if not exists credit_goal_detail   text;

-- Credit-goal enum constraint. Allows 6 predefined kinds + 'other'.
-- Stored as text (not a real enum type) so future additions don't
-- require altering a type — just update this check constraint.
alter table public.profiles
  drop constraint if exists profiles_credit_goal_kind_check;

alter table public.profiles
  add constraint profiles_credit_goal_kind_check
  check (
    credit_goal_kind is null
    or credit_goal_kind in (
      'buy_home',
      'buy_car',
      'rebuild',
      'lower_rates',
      'business_loan',
      'learning',
      'other'
    )
  );

-- Region sanity check: 2-letter uppercase (CA provinces / US states).
-- Allows null. If we ever expand beyond CA/US, this goes.
alter table public.profiles
  drop constraint if exists profiles_address_region_check;

alter table public.profiles
  add constraint profiles_address_region_check
  check (
    address_region is null
    or address_region ~ '^[A-Z]{2}$'
  );

-- DOB sanity: not in the future, not impossibly old (> 120 years ago).
alter table public.profiles
  drop constraint if exists profiles_date_of_birth_check;

alter table public.profiles
  add constraint profiles_date_of_birth_check
  check (
    date_of_birth is null
    or (
      date_of_birth <= current_date
      and date_of_birth >= current_date - interval '120 years'
    )
  );
