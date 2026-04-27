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

---

## Additions worth writing eventually

These specs aren't urgent but would round out the documentation:

- **`docs/payment-and-stripe.md`** — subscription billing flows once Stripe is live (plan changes, prorations, failed payments, the profile.plan ↔ Stripe subscription state relationship)
- **`docs/admin-operations.md`** — runbook for common admin tasks (handling user disputes, managing plan changes on behalf, bureau pull failures)
- **`docs/data-model.md`** — comprehensive schema reference once all migrations land

Add these when the underlying work is built, not before.

---

*This index reflects documentation as of April 24, 2026. Update when adding new specs.*
