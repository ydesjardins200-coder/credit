# iBoost Partner Acquisition Platform — Architecture & Build Plan

> **Status:** Spec / pre-build (gated on Flinks + Equifax going live first)
> **Owner:** Yan Desjardins
> **Last updated:** June 2, 2026
> **Source:** Captured from working session with Claude on June 2, 2026
> **Related:** [`docs/credit-bureau-integration.md`](./credit-bureau-integration.md), [`docs/tier-feature-matrix.md`](./tier-feature-matrix.md)

---

## North Star

iBoost will acquire users at scale through **partner referral deals** — primarily online lenders who send iBoost the leads they *reject* for credit. A rejected borrower is, almost by definition, someone who needs to build or rebuild credit: a perfect-fit lead.

The first secured partner is an online Canadian lender expected to send **~10,000 leads/week** (loan refusals). More partners are expected over time, **each with different deal terms**. So this is not "a lead pipe for one lender" — it is a **multi-partner acquisition platform** where each partner is onboarded and configured as data, not code.

The platform has three jobs:

1. **Ingest** leads reliably at volume (webhook from each partner's CRM).
2. **Convert** them into iBoost accounts (email-first outreach → signup → paid subscription).
3. **Account** for revenue share — track each lead through to collected revenue and accrue what each partner is owed, auditably.

---

## The one rule that anchors everything

> **iBoost pays partners only on collected revenue. Never on free signups. Pay only when *we* get paid.** — Yan

This is the load-bearing constraint of the entire money model. Its consequences ripple through the whole design:

- A payout event accrues **only when a real payment is collected** (the `invoice.payment_succeeded` Stripe webhook), never on signup, never even on subscription-created.
- A subscription created whose first payment **fails** owes the partner **nothing**.
- This elegantly neutralizes the refund/chargeback risk: you never pay a partner for revenue you then refund, because accrual follows *collected* money. (Post-accrual refunds are a rare edge case — see Clawbacks.)
- Free signups are still **tracked** (they're the conversion runway and a useful funnel metric for the partner) but sit in the ledger as non-payable.

Every configurable deal option below is valid **only within this rule.** The rule is the safety rail baked into the foundation; the config is flexible on top of it.

---

## Sequencing — why this is NOT first

This platform is **deliberately gated behind Flinks + Equifax going live.**

The reason is simple and non-negotiable: iBoost's core promise is bureau reporting and credit intelligence. Until that promise is *fulfillable*, pouring 10,000 leads/week into the product would burn an irreplaceable lead supply on an experience that can't yet deliver its value. You get one shot at a partner's lead stream; spend it after the product works, not before.

**Order of operations:**

1. Flinks integration live (Budget app fulfills its promise).
2. Equifax (and ideally a second bureau) reading + reporting live (core product promise fulfillable).
3. **Then** this platform becomes the absolute priority — it is the monetization engine that turns the finished product into revenue at scale.

This doc exists so that when step 3 arrives, the blueprint is already vetted and the build is mechanical.

---

## Core concept: deals are data, not code

The defining architectural decision: **a partner's deal terms live in the database and are configured through the admin. Adding a partner is a data operation — a new row plus config — never a deployment.**

This mirrors patterns iBoost already uses and likes:

- The **provider router** (`getActiveProvider` + `requireProvider`) — runtime behavior driven by a DB config row.
- The **integrations config** — `integrations.active_provider_key` as a runtime control.

A partner system is the same philosophy: partners and their deals are data; the ingestion, attribution, and payout logic *read* that config and enforce it. New lender? Onboard them in the admin, hand them the webhook docs, done.

The design tension is **flexibility vs. over-engineering.** Every partner is different, but we do NOT build a Turing-complete deal-rules engine. We define a **structured deal config** — a finite set of fields covering the common deal shapes — and explicitly defer exotic structures to "v2 / handle manually." See the deal config model below.

---

## Configurable deal terms (all per-partner)

Every one of these is definable per partner, confirmed in the planning session:

| Axis | Options | Notes |
|---|---|---|
| **Payout basis** | per qualified lead · per signup · per paid conversion · recurring % of subscription | All four valid & selectable. But the *payable trigger* is always a **collected payment** (the anchor rule). "Per signup" in iBoost's world means a signup that became a paying, collected customer. |
| **Rate type** | flat $ amount · percentage | Both supported. A % basis applies to the collected subscription revenue; a flat $ applies per qualifying event. |
| **Tiering** | flat, or volume-tiered (e.g. $X for first N/month, $Y above) | Structured tiers supported in config; **arbitrarily complex tiers deferred to v2** — flag exotic deals for manual handling. |
| **Thresholds** | minimum volume before payout · caps · qualifying criteria | Per-partner. E.g. "no payout until 500 collected conversions," or "cap at $Z/month." |
| **Attribution window** | definable (e.g. 30 / 60 / 90 days) | Per-partner. The window in which a signup can be attributed back to a lead. **Contractual** — must match the signed deal. |
| **Recurring duration** | one-time · N months · lifetime-of-subscription | Per-partner. For recurring-% deals: how long iBoost keeps paying the partner a cut as the customer keeps paying. |

**Deferred / out of v1 scope (handle manually or in v2):**
- Arbitrarily nested tier structures.
- Per-product-tier different rates within one partner (unless trivially expressible).
- Retroactive deal changes applied to already-accrued events (deal changes apply going forward).

---

## Data model

All partner data lives **separate from `auth.users` and `support_cases`.** A lead is not a user until they sign up; a lead is not a support case. Keep the blast radius contained.

### `partners`
Partner identity and operational state.
- `id` (uuid, pk)
- `name`, `slug`
- `status` (`active` | `paused` | `disabled`)
- `contact_name`, `contact_email` (their account manager)
- intake credentials: `api_key_hash`, `hmac_secret` (for webhook auth — see Intake)
- `created_at`, `notes`

### `partner_deals`
The configurable deal terms (the heart of "deals as data"). One active deal per partner at a time; historical deals retained for audit.
- `id`, `partner_id` (fk)
- `payout_basis` (`qualified_lead` | `signup` | `paid_conversion` | `recurring_pct`)
- `rate_type` (`flat` | `percent`), `rate_value`
- `tiers` (jsonb — optional volume tiers)
- `min_volume_threshold`, `payout_cap` (nullable)
- `qualifying_criteria` (jsonb — what counts; always subject to the collected-payment anchor)
- `attribution_window_days`
- `recurring_duration` (`one_time` | `n_months` | `lifetime`), `recurring_months` (nullable)
- `effective_from`, `effective_to` (nullable — deals are versioned, changes apply forward)
- `is_active`

### `leads`
One row per ingested lead. **Email is the primary conversion-matching key.**
- `id`, `partner_id` (fk)
- `partner_lead_id` (the lender's OWN id — critical for their reconciliation)
- `email` (the join key to a future account), `full_name`, `phone`, `address` (minimize — see Compliance)
- `referral_code` (unique per lead — the deterministic attribution token)
- `status` (`ingested` | `contacted` | `signed_up_free` | `signed_up_paid` | `converted_collected` | `expired` | `suppressed`)
- `ingested_at`, `idempotency_key` (dedupe — see Intake)
- `attributed_user_id` (nullable fk to the account, once matched)
- `attributed_at`, `attribution_method` (`referral_code` | `email_match` | `pii_match`)
- `raw_payload` (jsonb — the original POST, for audit/debug; PII-retention policy applies)

### `attribution_ledger`
The immutable audit trail linking lead → account → subscription. Append-only.
- `id`, `lead_id` (fk), `user_id` (fk), `partner_id` (fk)
- `event` (`signed_up` | `paid_collected` | `recurring_collected` | `refunded`)
- `stripe_event_id`, `invoice_id`, `amount_collected_cents`, `currency`
- `created_at`

### `rev_share_events`
Accrual records — what a partner is *owed*, computed against their deal at the time of the event. Append-only; this is what reconciliation/payout reads.
- `id`, `partner_id` (fk), `lead_id` (fk), `attribution_ledger_id` (fk)
- `deal_id` (fk — which deal version this was computed under)
- `accrued_amount_cents`, `currency`
- `basis_snapshot` (jsonb — the deal terms applied, frozen for audit)
- `status` (`accrued` | `paid_out` | `reversed`)
- `created_at`, `paid_out_at` (nullable)

Why two ledgers? `attribution_ledger` records **what happened** (money was collected). `rev_share_events` records **what we owe** (computed from the deal). Separating them means a deal misconfiguration can be recomputed against the immutable event history without corrupting the record of what actually happened.

---

## Intake — the partner webhook contract

Each partner's CRM POSTs leads to iBoost. This is the doc handed to the partner's technical team.

**Endpoint:** `POST /api/partners/leads` (on the credit backend; public route, partner-authenticated)

**Auth:** per-partner. Two layers:
- `X-Partner-Key` header (identifies the partner; looked up against `partners.api_key_hash`).
- `X-Partner-Signature` — HMAC-SHA256 of the raw body using the partner's `hmac_secret`. Rejects tampered/forged payloads.

**Payload (per lead, or small batches):**
```json
{
  "partner_lead_id": "LENDER-INTERNAL-12345",
  "email": "person@example.com",
  "full_name": "Jordan Smith",
  "phone": "(514) 555-0142",
  "address": { "...": "minimize — see compliance" },
  "idempotency_key": "LENDER-INTERNAL-12345"
}
```

**Idempotency:** the `idempotency_key` (the partner's own lead id is a fine default) dedupes retries. Re-POSTing the same key returns the original result, never creates a duplicate lead. **Non-negotiable** at 10k/week — partner CRMs retry, networks fail.

**Volume / bursts:** 10k/week ≈ 1,430/day ≈ 60/hour sustained, but **bursty** (refusals cluster in business hours — expect spikes of hundreds in minutes). Design:
- Accept fast, process async. The webhook validates + persists the raw lead, returns `202 Accepted` immediately; enrichment/outreach happens in a background job. Don't do email sending inline in the webhook.
- Per-partner rate limiting (generous, but protects against a runaway CRM loop).

**Responses:** `202` accepted, `200` duplicate (idempotent replay), `400` validation error (with field detail), `401` bad auth, `429` rate-limited. Document retry expectations (exponential backoff; iBoost is idempotent so retries are safe).

**Batch vs. single:** support both — a `leads: [...]` array for CRMs that batch, single-object for those that fire per-event. Same idempotency rules per item.

---

## Attribution — connecting a signup back to a lead

The crux of correct rev-share. Email being present (confirmed) makes this **far** more reliable than PII-fuzzy-matching. Precedence:

1. **Referral code (deterministic).** Each lead gets a unique `referral_code`; outreach links are `signup.html?ref=CODE`. If they sign up via the link, attribution is certain. Carry the code through signup → store on the account.
2. **Email match (strong fallback).** If they sign up without the link (lost it, typed the URL fresh, came back weeks later), match the signup email against `leads.email` within the partner's attribution window. This is the workhorse fallback — high confidence because email is an exact key. Reuses the same silent-match pattern the contact form already uses against `profiles`.
3. **PII match-back (rare tertiary).** Phone/address match as a last resort. Fuzzy, PII-heavy, used only when 1 and 2 miss. May be disabled per-partner.

**Attribution window** is per-partner and **contractual** — a signup outside the window is organic, not attributed. Precedence + window must be written into the deal agreement to avoid disputes.

**Edge cases to handle in the spec build:**
- Same email appears in two partners' lead lists → first-touch vs. last-touch attribution rule (decide; likely first-touch within window, documented per deal).
- Lead signs up, cancels, re-subscribes later → recurring duration governs whether the later revenue still accrues.
- A person already an iBoost user appears as a lead → not a new acquisition; suppress (don't pay a partner for an existing customer). The email-match against existing `profiles` at ingestion time flags this.

---

## Lead lifecycle

```
INGESTED            webhook validated, lead persisted, dedup checked,
                    existing-customer suppression checked
   │
   ▼
CONTACTED           automated, CROA-compliant email: "you were referred by
                    [partner] — here's how iBoost helps" + referral link.
                    (Email engagement tracked: delivered / opened / clicked.)
   │
   ▼
SIGNED_UP_FREE  ──► tracked, NOT payable. Conversion runway. Nurture toward paid.
   │
   ▼
SIGNED_UP_PAID      subscription created — still NOT payable yet (anchor rule).
   │
   ▼
CONVERTED_COLLECTED first payment actually collected (invoice.payment_succeeded)
                    → attribution_ledger entry → rev_share_event accrued
                    against the partner's deal.
   │
   ▼ (recurring deals only)
RECURRING_COLLECTED each subsequent collected payment within the recurring
                    duration → further accrual.
```

Outreach reuses the existing signup/account-creation flow. The only genuinely new runtime piece is **carrying the referral attribution through signup** and **hooking the Stripe collected-payment webhook to accrue rev-share.**

> **Email delivery:** the automated outreach is sent via Customer.io — see [`docs/email-platform.md`](./email-platform.md). The partner outreach is one of the marketing/commercial email types there (CASL consent applies). This is why the partner platform (Phase 2) precedes the email platform (Phase 3) in the build roadmap.

---

## Admin partner portal (v1)

Built into the existing admin (reuses the cross-service + operator-role patterns). Where *you* run the platform:

- **Onboard a partner** — create the partner, generate API key + HMAC secret (shown once), set status.
- **Configure the deal** — a structured form for every axis in the deal table (basis, rate, tiers, thresholds, window, recurring duration). Versioned: editing creates a new deal version effective forward.
- **Per-partner dashboard** — funnel: leads ingested → contacted → email engagement → free signups → paid → **collected conversions** → **revenue accrued/owed**. Split by currency (never summed across, per existing MRR convention).
- **Reconciliation export** — CSV/JSON keyed on the partner's `partner_lead_id`, listing attributed conversions + accrued amounts for a period. This is what you send the partner to settle up.
- **Lead inspector** — look up a lead, see its status + attribution trail (for support/disputes).

Reuses: `requireAdminSharedSecret` cross-service pattern, operator roles (a `partner_manager` role could gate this), the admin's filtered-list + counts patterns.

---

## Partner-facing portal — DEFERRED to v2 (decision point)

**v1 recommendation: export-only.** Partners do NOT log into iBoost; you send them reconciliation exports/reports from the admin. Far simpler, no external auth surface, no partner-facing security boundary to harden.

**v2: self-serve partner portal** — partners log in to see their own live dashboard (their leads, conversions, revenue owed, download reconciliation). Earns its keep once you have several partners and the manual export overhead grows. This is a meaningful additional build (partner auth, scoped data access, a whole separate frontend surface) — not v1.

**This is a reversible decision** — start export-only, add the portal when partner count justifies it. The data model above already supports it (everything is per-partner scoped); only the presentation layer is deferred.

> **Open decision:** confirm export-only for v1. The multi-partner vision suggests a portal eventually, but not on day one.

---

## Compliance gate — MUST clear before go-live

This is the heaviest compliance surface iBoost has. These are **refused-borrower records — vulnerable consumers, PII, flowing under a commercial deal.** This is a **legal-review gate, not a code gate**, and must happen in parallel with the build.

Checklist:

- [ ] **PIPEDA — consent to share.** The partner must have the borrower's consent (or lawful basis) to share their PII with iBoost. A loan refusal does not automatically grant third-party-sharing rights. This belongs in the **partnership data agreement** and likely in the partner's own disclosures/ToS.
- [ ] **Privacy policy coverage.** iBoost's privacy policy must cover ingested partner-lead data: what's collected, why, retention, and the user's rights over it.
- [ ] **CROA-compliant outreach.** Marketing credit-improvement to just-refused borrowers is precisely the vulnerable-consumer scenario CROA targets. The outreach email copy needs legal review — no guaranteed-outcome language, clear disclosures.
- [ ] **Data minimization.** Do we even *need* the address at intake? Email + name + phone may suffice; address is the most sensitive and least used field. Ingest the minimum. (Open question for the data agreement.)
- [ ] **Per-partner data processing agreement (DPA).** Each partner relationship needs its own data agreement defining permitted use, retention, deletion-on-request handling.
- [ ] **Raw payload retention policy.** `leads.raw_payload` holds original PII — define a retention/purge window consistent with PIPEDA.
- [ ] **Suppression / unsubscribe.** Leads who don't convert and don't want contact must be suppressible; honor unsubscribe.

**Do not ingest a single live lead until the data agreement + outreach copy clear legal review.**

---

## Clawbacks & refunds (edge case, but spec it)

Because accrual follows collected revenue, refunds are rare and bounded. But define the rule:
- A refund/chargeback **after** a rev-share event was accrued → emit a `refunded` event in `attribution_ledger` and a `reversed` entry in `rev_share_events` (negative accrual / clawback against the next payout).
- Whether reversal is automatic or manual-review is a **per-deal contractual choice** — default to recording it and netting against the next reconciliation, not a standalone invoice to the partner.

---

## Build phases (when step 3 arrives)

1. **Phase 1 — Data model + intake.** `partners`, `partner_deals`, `leads` tables; the authenticated webhook (`/api/partners/leads`) with HMAC + idempotency; lands leads + dedup + existing-customer suppression. Returns `202`, async-ready. No outreach yet. Testable with a mock partner.
2. **Phase 2 — Admin onboarding + deal config.** Admin UI to create partners, generate credentials, configure the structured deal. Lead inspector.
3. **Phase 3 — Outreach.** Automated CROA-compliant email with referral link; engagement tracking. (Copy pending legal.)
4. **Phase 4 — Attribution + accrual.** Carry referral code through signup; email-match fallback; hook `invoice.payment_succeeded` → `attribution_ledger` → `rev_share_events` against the deal. The money engine.
5. **Phase 5 — Reconciliation + reporting.** Per-partner dashboard, reconciliation export, clawback handling.
6. **Phase 6 (v2) — Self-serve partner portal.** Partner auth + scoped live dashboard. Only when partner count justifies it.

Each phase ships something testable. Phases 1–2 are buildable and safe to dry-run with a mock partner before any real lead or any legal clearance — but **no real leads flow until the compliance gate clears.**

---

## Open questions / decisions deferred

| Question | Status | Notes |
|---|---|---|
| Exact rev-share terms (basis/rate/window) for the first partner | **Pending partner** | Awaiting official partner expectations. The deal config holds whatever they land on. |
| Partner-facing portal in v1? | **Recommend export-only v1** | Self-serve portal = v2. Reversible. |
| Expected partner count, year 1 | **Unknown** | Data model scales to dozens at no extra cost. Drives portal-vs-export timing. |
| Do we ingest address at all? | **Open — minimize** | Decide in the data agreement. Less PII = less risk. |
| First-touch vs. last-touch when a lead appears for two partners | **Decide at build** | Likely first-touch within window; document per deal. |
| Automatic vs. manual clawback on post-accrual refund | **Per-deal** | Default: record + net against next reconciliation. |

---

## TL;DR for a future session

- Multi-partner acquisition platform. Lenders send rejected-borrower leads (first: ~10k/week). **Deals are data, configured per-partner in the admin.**
- **Anchor rule: pay partners only on collected revenue, never on free signups.** Accrual triggers on `invoice.payment_succeeded`.
- Intake = authenticated (API key + HMAC), idempotent webhook; accept fast, process async.
- Attribution = referral code → **email match** (the reliable workhorse) → PII fallback, within a per-partner contractual window.
- Two ledgers: `attribution_ledger` (what happened) + `rev_share_events` (what we owe).
- **Gated behind Flinks + Equifax.** Then it's the top monetization priority.
- **Compliance is a hard legal gate** (PIPEDA consent-to-share, CROA outreach copy, data minimization) — clears before a single real lead flows.
- v1 = export-only reconciliation; self-serve partner portal = v2.
