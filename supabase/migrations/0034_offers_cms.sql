-- iBoost — migration 0034
-- Offers CMS: move the affiliate offers from static HTML into the DB so
-- they can be managed from the admin (list / edit / add / reorder), with
-- an affiliate link and a min_score threshold per offer.
--
-- One table (offers). Two render shapes share it:
--   featured (is_featured=true): full specs[] + highlight line, shown in
--                                the 'Best matches' row.
--   category (is_featured=false): a hook line, shown under its category.
--
-- specs is JSONB: array of {label,val} (flexible — a card's specs differ
-- from a loan's). logo is text initials + either a CSS class (existing
-- brand colors) or an inline hex color. affiliate_link is the CTA target.
--
-- min_score is STORED now but does NOT filter yet — there is no bureau
-- score in the product. When the bureau integration lands, the read path
-- can start filtering on it with no data migration. Until then all
-- published offers show.
--
-- RLS: authenticated members read published offers; admin writes via the
-- service key (same pattern as education_*). Seeded with the 11 offers
-- that were on the page. Re-runnable (truncates the table first).

create table if not exists public.offers (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  lender text not null,
  name text not null,
  highlight text,
  hook text,
  logo_text text not null,
  logo_class text,
  logo_color text,
  specs jsonb not null default '[]'::jsonb,
  affiliate_link text,
  min_score integer,
  is_featured boolean not null default false,
  is_published boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists offers_category_idx on public.offers (category);

alter table public.offers enable row level security;
drop policy if exists "offers: members read" on public.offers;
create policy "offers: members read" on public.offers
  for select using (auth.role() = 'authenticated');

-- Seed (re-runnable).
truncate table public.offers;
insert into public.offers (category, lender, name, highlight, hook, logo_text, logo_class, logo_color, specs, affiliate_link, min_score, is_featured, sort_order) values
  ('credit_card', 'Royal Bank', 'Cash Back Mastercard', '2% cash back on groceries, 1% on everything else', null, 'RBC', 'dash-offer-logo-rbc', null, '[{"label":"Annual fee","val":"$0"},{"label":"Regular APR","val":"20.99%"},{"label":"Min. score","val":"660"}]'::jsonb, null, 660, true, 0),
  ('credit_card', 'Tangerine', 'Money-Back Credit Card', '2% cash back in up to 3 categories you choose', null, 'TANG', 'dash-offer-logo-tang', null, '[{"label":"Annual fee","val":"$0"},{"label":"Regular APR","val":"19.95%"},{"label":"Min. score","val":"650"}]'::jsonb, null, 650, true, 1),
  ('credit_card', 'TD Bank', 'Cash Back Visa Infinite', '3% cash back on grocery + recurring bills', null, 'TD', 'dash-offer-logo-td', null, '[{"label":"Annual fee","val":"$120"},{"label":"Regular APR","val":"20.99%"},{"label":"Min. score","val":"675"}]'::jsonb, null, 675, true, 2),
  ('credit_card', 'Scotiabank', 'Scene+ Visa', null, '5x points on grocery, $0 annual fee', 'SCO', 'dash-offer-logo-scotia', null, '[]'::jsonb, null, null, false, 3),
  ('credit_card', 'BMO', 'CashBack Mastercard', null, '5% welcome cash back for 3 months', 'BMO', 'dash-offer-logo-bmo', null, '[]'::jsonb, null, null, false, 4),
  ('personal_loan', 'Borrowell', 'Personal loan up to $35,000', null, 'Rates from 5.99% · Check in 3 min', 'BRS', null, '#6b21a8', '[]'::jsonb, null, null, false, 0),
  ('personal_loan', 'Fairstone', 'Debt consolidation loan', null, 'Consolidate up to 10 balances into one', 'FAIR', null, '#059669', '[]'::jsonb, null, null, false, 1),
  ('bank_account', 'Koho', 'Spending account', null, 'No-fee banking · 1% cash back', 'KOH', null, '#000000', '[]'::jsonb, null, null, false, 0),
  ('bank_account', 'CIBC', 'Smart Plus Chequing', null, '$450 welcome bonus · Unlimited transactions', 'CIBC', 'dash-offer-logo-cibc', null, '[]'::jsonb, null, null, false, 1),
  ('insurance', 'Square One', 'Tenant insurance', null, 'From $12/month · Pay-as-you-go', 'SQU', null, '#dc2626', '[]'::jsonb, null, null, false, 0),
  ('insurance', 'Ladder', 'Term life insurance', null, '100% online · Decision in minutes', 'LAD', null, '#1e40af', '[]'::jsonb, null, null, false, 1);
