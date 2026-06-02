# iBoost Documentation

This folder contains architectural specs and product vision documents for iBoost. These are **strategic planning documents** — they describe what we're building and why, not how the existing code works.

For working code, see the rest of the repo. For deployed infrastructure, see Railway + Netlify + Supabase dashboards.

---

## What's here

### [`brain-architecture.md`](./brain-architecture.md)
The BRAIN — iBoost's monthly intelligence pipeline. Covers the four-layer architecture (ingestion → snapshot → generation → presentation), why the rules engine is the moat, how the LLM polish layer fits in, regulatory positioning, and the phased build plan.

**Read this first** if you're working on:
- Personalized recommendations
- Score-impact predictions
- The Credit tab on `/account.html`
- LLM integration with Anthropic
- The monthly cron pipeline

### [`budget-app-vision.md`](./budget-app-vision.md)
The Budget app — QuickBooks-style ledger model (NOT Monarch dashboard). Covers the review-queue UX pattern, three-layer auto-categorization without ML, the credit-budget bridge as iBoost's unique edge, and the 12-week phased build plan.

**Read this first** if you're working on:
- Flinks integration
- Transaction categorization
- Budget tab on `/account.html`
- The credit-payment matching feature

### [`credit-bureau-integration.md`](./credit-bureau-integration.md)
Bureau integrations — both reading (pulling user data INTO iBoost) and reporting (sending payment data TO bureaus). Covers per-bureau contract requirements, Path 2A vs Path 2B for reporting (direct furnisher vs reseller), the compliance checklist, and the 5-phase build plan.

**Read this first** if you're working on:
- Anything touching Equifax, TransUnion, or Experian
- The `Reports to all 3 bureaus` marketing claim
- Compliance / FCRA / PIPEDA work
- Bureau API integration in the admin

### [`tier-feature-matrix.md`](./tier-feature-matrix.md)
Per-tab, per-feature gating decisions for `/account.html`. Records what Free vs Essential vs Complete users see across all six dashboard tabs (Welcome, Credit, Offers, Budget, Education, Profile). Covers the hybrid gating model (some tabs always-visible, some visible-locked, some tier-adaptive content), implementation phases for the permissions module, and pre-defined per-feature gates ready for a future shift to per-card lock granularity.

**Read this first** if you're working on:
- The permissions module (`lib/permissions.js`)
- Any tier-conditional behavior on `account.html`
- Updating `pricing.html` plan promises (must stay aligned)
- The Plan card in Profile / upgrade-flow UX
- Adding/removing features from any plan tier

### [`partner-platform.md`](./partner-platform.md)
The partner acquisition platform — a multi-partner system where lenders send iBoost their rejected-borrower leads (first partner: ~10,000/week). Covers the deals-as-data model (per-partner configurable payout basis, rate, tiers, thresholds, attribution window, recurring duration), the anchor rule (pay only on collected revenue, never on free signups), the authenticated idempotent intake webhook, the referral-code → email-match attribution chain, the two-ledger accrual model, the admin partner portal, and the compliance gate (PIPEDA consent-to-share, CROA outreach). **Gated behind Flinks + Equifax — then the top monetization priority.**

**Read this first** if you're working on:
- Lead ingestion / the partner webhook
- Rev-share accrual or reconciliation
- Attribution (connecting a signup back to a referred lead)
- The admin partner-onboarding / deal-config UI
- Anything touching the `partners`, `leads`, or rev-share tables

### [`email-platform.md`](./email-platform.md)
The email platform — Customer.io (startup program accepted), the engine for all future iBoost email. iBoost sends zero email today. Covers why it's deliberately not bound yet (temporary domain → reputation can't transfer), the transactional-vs-marketing split with the full email list mapped, the CASL consent flag (Canada-first), the catch-all inbox → support case reuse, and why it's built LAST (most triggers don't exist until Flinks/Equifax + the partner platform ship). **Roadmap Phase 3 — gated on the real domain + the earlier phases.**

**Read this first** if you're working on:
- Any email iBoost sends (transactional or marketing)
- Customer.io integration
- The CASL/consent mechanism at signup
- The catch-all email → support case feature
- Invoice or case-update notifications

### [`account-architecture.md`](./account-architecture.md)
Active refactor plan: splitting the monolithic `account.html` (13,700+ lines across HTML/JS/CSS) into per-tab pages under `/account/{welcome,credit,offers,budget,education,profile}` with a shared utilities/auth/components layer. Covers the target folder layout, URL structure, migration phases (A=shared extraction, B=shell extraction, C=Profile-first single-tab proof, D=remaining tabs, E=cleanup), risks, and success criteria. Each phase ships a working app — no long-lived feature branches.

**Read this first** if you're working on:
- Anything in `public/account.html`
- Adding a new tab or major feature to the account experience
- Touching `account.js` or `account.css`
- Setting up shared modules or worrying about code organization

---

## Build roadmap (canonical sequencing)

**Key distinction: BUILD order ≠ GO-LIVE order.** Flinks and Equifax incur per-call/subscription fees, so iBoost defers *activating* them as far as possible to avoid burning fees pre-revenue. That cost decision does **not** block building everything around them. So we build the fee-free scaffolding first and flip on the paid integrations when revenue justifies it.

### Build order

```
BUILD 1 — Partner acquisition platform (fee-free scaffolding)
  Tables, intake webhook, admin deal-config, attribution logic.
  Costs nothing to build: no Flinks/Equifax dependency, and rev-share
  accrual hooks the ALREADY-LIVE Stripe invoice.payment_succeeded webhook.
  Built + tested against a MOCK partner. NOT flowing real leads yet.
  Spec: partner-platform.md
                            │
                            ▼
BUILD 2 — Core product stack (the paid integrations)
  Flinks (budget intelligence) + Equifax (bureau reading/reporting).
  Activated when revenue justifies the fees. This is what lets a converted
  lead actually receive iBoost's value.
  Specs: budget-app-vision.md, credit-bureau-integration.md, brain-architecture.md
                            │
                            ▼
BUILD 3 — Email platform (Customer.io)
  All iBoost email. Last because most triggers don't exist until Builds
  1 & 2 ship (banking alerts need Flinks, bureau-report emails need
  Equifax, partner outreach needs the partner platform). Gated on the
  real domain (reputation can't transfer from the temporary one).
  Spec: email-platform.md
```

### Go-live gate (independent of build order)

Building the partner platform first does **not** mean flowing real leads first. Real lead flow stays gated behind:
- **Core features active** — a referred lead who signs up is promised bureau reporting + budget intelligence; don't flow real leads into a product whose paid value isn't switched on.
- **Compliance cleared** — PIPEDA consent-to-share, CROA/CASL outreach copy, the partner data agreement.
- **Partner's real rev-share terms** — build the deal-config to hold any terms; don't hard-code accrual math against assumptions.

So: **build partner platform → activate Flinks/Equifax → flow real leads + email.** The partner platform is built and ready first; it goes *live* once the product can deliver.

**Near-term exception:** two transactional emails (invoices, case-update notifications) may be pulled forward to launch ahead of the full Email build — see `email-platform.md`. Yan's call.

---

## How the four documents relate

```
┌──────────────────────────────────────────────────────────────────┐
│  credit-bureau-integration.md                                     │
│  Data flowing IN (READING) and OUT (REPORTING)                    │
└──────────────────────────────────────────────────────────────────┘
                            │
                            │ feeds
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  brain-architecture.md                                            │
│  Turns data into personalized recommendations                     │
└──────────────────────────────────────────────────────────────────┘
                            │
                            │ surfaces in
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  budget-app-vision.md                                             │
│  User-facing tool that consumes both the data + the BRAIN's      │
│  recommendations                                                  │
└──────────────────────────────────────────────────────────────────┘
                            │
                            │ all surfaces gated by
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  tier-feature-matrix.md                                           │
│  Which features each subscription tier unlocks                    │
└──────────────────────────────────────────────────────────────────┘
```

The first three docs describe **what we're building**. The matrix describes **who gets to see it**. Bureau → BRAIN → Budget is the value pipeline. The matrix is the commercial layer that turns that pipeline into three different product offerings.

---

## Status as of April 27, 2026

| Spec | Status | Phase 1 buildable today? |
|---|---|---|
| BRAIN architecture | ✅ Spec complete | ✅ Yes (rules engine + mocked snapshots, no external deps) |
| Budget app vision | ✅ Spec complete | ❌ Gated on Flinks contract |
| Bureau integration | ✅ Spec complete | ❌ Gated on bureau vendor selection |
| Tier feature matrix | ✅ Decisions complete | ✅ Yes (permissions module + lock overlay component) |
| Partner platform | ✅ Spec complete | 🔜 BUILD FIRST (fee-free scaffolding); go-live gated on core features + compliance |
| Email platform | ✅ Spec complete | ❌ Roadmap Phase 3 — gated on real domain + Phases 1 & 2 |

The BRAIN's Phase 1 is still the most actionable spec-level item.

The tier matrix is now the most actionable **product** item — building the permissions module is ~1 day of work and unlocks per-feature gating for everything that comes later.

---

## Re-orientation cheat sheet for new sessions

Working on this project after a break? Paste one of these to get oriented:

> "We're picking up iBoost work. Read `docs/README.md` first, then dive into `docs/{relevant-spec}.md` based on what we're tackling. Status: [what's changed since last time]."

For specific work:

> "Working on the BRAIN — see `docs/brain-architecture.md`. We're at [Phase X]."

> "Working on the Budget app — see `docs/budget-app-vision.md`. Flinks status: [signed/pending]."

> "Working on bureau integrations — see `docs/credit-bureau-integration.md`. Bureau path decision: [direct/reseller/undecided]."

> "Working on the partner acquisition platform — see `docs/partner-platform.md`. Status: gated on Flinks + Equifax; [partner terms known/pending]."

> "Working on email / Customer.io — see `docs/email-platform.md`. Status: Phase 3, gated on real domain; target domain [chosen/not chosen]."

---

## Additions worth writing eventually

These specs aren't urgent but would round out the documentation:

- **`docs/payment-and-stripe.md`** — subscription billing flows once Stripe is live (plan changes, prorations, failed payments, the profile.plan ↔ Stripe subscription state relationship)
- **`docs/admin-operations.md`** — runbook for common admin tasks (handling user disputes, managing plan changes on behalf, bureau pull failures)
- **`docs/data-model.md`** — comprehensive schema reference once all migrations land

Add these when the underlying work is built, not before.

---

*This index reflects documentation as of April 24, 2026. Update when adding new specs.*
