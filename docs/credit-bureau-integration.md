# iBoost Credit Bureau Integrations — Architecture & Build Plan

> **Status:** Spec / pre-contract
> **Owner:** Yan Desjardins
> **Last updated:** April 24, 2026
> **Source:** Captured from working session with Claude on April 24, 2026
> **Related:** [`docs/brain-architecture.md`](./brain-architecture.md), [`docs/budget-app-vision.md`](./budget-app-vision.md)

---

## North Star

iBoost integrates with credit bureaus in **two fundamentally different directions** that are easy to confuse:

1. **READING** — pulling user credit data (scores, tradelines, inquiries) FROM the bureau INTO iBoost. Powers the Credit tab and feeds the BRAIN.
2. **REPORTING** — sending user payment data (on-time payments, tradelines we manage) FROM iBoost TO the bureaus. The core promise of the marketing copy: "we report to all 3 bureaus."

These are different products, with different contracts, different APIs, different compliance frameworks, and different timelines. Treating them as one integration is the most common mistake in this space.

---

## The big honest disclosure

The promise on `pricing.html` — "Monthly reporting to all major bureaus" — is **not yet fulfillable**. Reporting requires becoming a registered data furnisher with each bureau, a 6-12 month process gated by contracts, compliance review, and minimum volume commitments.

Until reporting is live, iBoost is in **manual mode** for that promise. The product is honest about this internally; the marketing copy is aspirational. **Do not launch publicly until at least one reporting path is live and verified.**

This document covers both paths so the architecture is in place when contracts close.

---

## Path 1 — READING (credit data ingestion)

### What we're pulling

Per user, monthly:

- **Credit scores** from each enabled bureau (Equifax, TransUnion, optionally Experian for US)
- **Tradelines** — every account on the user's report (creditor, type, balance, limit, payment history, open date)
- **Inquiries** — recent hard pulls
- **Public records** — bankruptcies, collections, judgments (where applicable)
- **Personal info** snapshot — addresses, employers (used for verification, not stored long-term)

### Cadence

- **Soft pull, monthly** — does not affect user's score
- Aligned to user's monthly reporting day (staggered across the month)
- Triggered by the same cron job that runs the BRAIN snapshot

### Per-bureau contract requirements

| Bureau | Country | Auth shape (likely) | Notes |
|---|---|---|---|
| Equifax Canada | CA | OAuth2 + member number + signed agreement | Most accessible Canadian path |
| TransUnion Canada | CA | API key + subscriber code + signed agreement | Often paired with Equifax for full-coverage |
| Equifax (US) | US | API key + member number | Separate contract from Equifax Canada |
| TransUnion (US) | US | API key + subscriber code | Separate from TU Canada |
| Experian (US) | US | API key + client ID | US only — does not operate consumer credit reporting in Canada |

Required env vars (already provisioned in admin Settings > APIs config):

```
EQUIFAX_API_KEY            EQUIFAX_MEMBER_NUMBER
TRANSUNION_API_KEY         TRANSUNION_SUBSCRIBER_CODE
EXPERIAN_API_KEY           EXPERIAN_CLIENT_ID
```

These are placeholders. Real env var names follow each vendor's actual API spec — adjust when contracts close.

### Compliance for READING

- **Consumer consent** — user must explicitly authorize iBoost to pull their credit. Captured at signup or during KYC.
- **Permissible purpose** under FCRA (US) — must be one of the legally enumerated reasons (e.g., "user-initiated review of own credit").
- **PIPEDA (Canada)** — user has right to see their data, correct errors, withdraw consent.
- **Data retention** — only keep what's needed for the BRAIN snapshots. Don't retain raw bureau responses indefinitely; the snapshot's frozen `raw_bureau_data` jsonb is the audit trail.

### Architecture (READING)

```
┌──────────────────────────────────────────────────────────────────┐
│  Cron worker on Railway (3am EST daily)                           │
│  For each user where next_snapshot_date = today:                  │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│  bureau-pull worker                                               │
│  Reads admin's per-bureau toggle from public.integrations         │
│  For each enabled bureau (e.g., credit_equifax = 'equifax'):      │
│    1. Fetch user's report via vendor SDK / HTTPS API              │
│    2. Normalize response → typed schema                           │
│    3. Insert into credit_scores, tradelines, inquiries tables     │
│    4. Cache raw response in financial_snapshots.raw_bureau_data   │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│  Snapshot builder (BRAIN Layer 2)                                 │
│  Computes derived metrics across all bureaus                      │
│  → financial_snapshots row                                        │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                   BRAIN rules engine runs
```

The `integrations` table (migration 0013/0014) gates which bureaus are active per environment. If no bureau credentials are set in Railway, all rows say `manual`, snapshots have null scores, BRAIN rules dependent on credit data degrade gracefully.

### Tables (READING side)

```sql
-- One row per user per bureau per pull. Most recent score per bureau is
-- "current"; history forms the score timeline shown on Credit tab.
credit_scores (
  id uuid pk,
  user_id uuid,
  bureau text check in ('equifax_ca','transunion_ca','equifax_us','transunion_us','experian_us'),
  score integer check (score between 300 and 900),
  score_model text,                  -- 'FICO_8', 'VantageScore_3.0', etc.
  pulled_at timestamptz,
  unique(user_id, bureau, pulled_at)
);

-- One row per tradeline per pull. Tradelines update over time;
-- we keep history but link by (user_id, bureau, tradeline_external_id).
tradelines (
  id uuid pk,
  user_id uuid,
  bureau text,
  tradeline_external_id text,        -- bureau's own ID for this account
  creditor text,
  account_type text,                 -- 'revolving','installment','mortgage','line_of_credit'
  balance integer,
  credit_limit integer,
  utilization_pct numeric(5,2),
  open_date date,
  payment_status text,               -- 'current','30_late','60_late','90_late','collections'
  payment_history jsonb,             -- last 24 months month-by-month
  pulled_at timestamptz
);

inquiries (
  id uuid pk,
  user_id uuid,
  bureau text,
  inquiry_date date,
  inquirer text,
  inquiry_type text,                 -- 'hard','soft','account_review'
  pulled_at timestamptz
);
```

### Failure modes (READING)

- **Bureau API down** → use last cached score, log degraded snapshot, BRAIN rules degrade gracefully
- **Rate limit hit** → exponential backoff retry, defer to next day's batch if needed
- **User identity verification fails** → flag user for manual review, surface in admin
- **Score model mismatch** (Equifax returns FICO 8, TransUnion returns VantageScore) → store both; BRAIN rules normalize where appropriate
- **Bureau response shape changes** → guard clauses + ingestion fails loudly, not silently

### Cost (READING)

- ~$1-5 per pull per bureau per user, depending on volume tier and contract
- Blended across 3 bureaus: ~$8/user/month
- **Biggest variable cost on the platform** — 50% of OpEx in Scenario C of the financial model
- Negotiable downward at enterprise volume (a path from $8 → $3-4 blended at 50K+ users adds $1M+/year to net profit)

---

## Path 2 — REPORTING (data furnishing TO bureaus)

This is the harder, riskier, more strategic side. Two viable paths.

### Path 2A — Direct furnisher (long timeline, high upside)

iBoost becomes a **registered data furnisher** with each bureau directly.

**What it requires:**

- Signed Data Furnishing Agreement per bureau
- Subscriber Code / Furnisher ID per bureau
- **Metro 2 format** compliance — the standardized monthly file format all bureaus consume
- **FCRA compliance** (US) — legal obligations about data accuracy, dispute handling (e-OSCAR system), correction procedures
- **PIPEDA / provincial compliance** (Canada)
- Minimum volume commitments (typically 100s-1000s of accounts/month)
- Dispute resolution capability — when a user disputes a tradeline iBoost reports, we have ~30 days to investigate and respond
- Legal entity review — bureaus verify iBoost is a legitimate business
- Errors & Omissions insurance (typical requirement)

**Timeline:** 6-12 months from first contact to first successful submission.

**Cost:** Legal fees, compliance setup, potential consultant for Metro 2 expertise. Estimate $50-150K upfront.

**Upside:** iBoost owns the reporting pipeline. No middleman taking margin. Direct control over data accuracy. Real moat.

### Path 2B — Reseller / aggregator (faster, margin squeeze)

iBoost partners with an existing furnisher who white-labels the reporting capability.

**Candidates to evaluate:**

- **eCredable** — established US-focused alternative tradeline reporter
- **Nova Credit** — cross-border focus, good Canada-US story
- **PaymentReport / RentReporters** — focused on rent + utility reporting
- **Boom** — newer entrant, similar credit-builder positioning

**What it requires:**

- Partnership contract with chosen vendor
- API integration (typically HTTPS + JSON, much simpler than Metro 2 files)
- User consent flow (your user opts in to data being shared with the partner who reports it)
- Data quality SLA from the partner

**Timeline:** Weeks to a few months.

**Cost:** Per-report fee charged by partner (typically $1-5/user/month).

**Tradeoff:** Margin squeeze (the partner takes a cut). Less control over data accuracy. But fast time to market.

### Recommendation

**Start with Path 2B (reseller) for v1 launch. Move to Path 2A (direct furnisher) at scale.**

Rationale:

- v1 launch can't wait 12 months for direct furnisher status
- Reseller path lets you fulfill the marketing promise within months of integration
- Once at 5-10K paying users, direct furnisher economics start making sense — partner margin becomes meaningful, and you have the volume to meet bureau minimums
- Direct furnisher work happens in parallel: sign contracts and prep Metro 2 capability while operating on reseller, swap when ready

This is also a useful narrative for partners/investors: "Phase 1 partner-led, Phase 2 owned pipeline as we scale."

### Architecture (REPORTING — both paths)

The integration architecture (admin Settings > APIs) already supports this pattern. We just add new categories:

```
credit_reporting_equifax    → which provider reports TO Equifax
credit_reporting_transunion → which provider reports TO TransUnion
credit_reporting_experian   → which provider reports TO Experian
```

Each row in `public.integrations` would have providers like:

```
manual    → no automated reporting (current state)
direct    → iBoost is the furnisher (Path 2A)
ecredable → reporting via eCredable partnership (Path 2B)
nova      → reporting via Nova Credit partnership (Path 2B)
```

This is symmetrical to the existing READING side: admin toggles which provider is active per bureau, env vars in Railway gate feasibility, frontend doesn't care about implementation details.

### Reporting cadence

- **Monthly batch** — industry standard. Real-time reporting is not a thing in this space.
- Each user has a "reporting cycle" date (typically aligned with their iBoost statement / payment date)
- On the bureau's defined cutoff day each month, generate a Metro 2 file (Path 2A) or invoke partner API (Path 2B)
- Bureau processes the file/API call, typically 5-10 days later it appears on consumer's report

### What gets reported

For iBoost specifically, the reportable item is the **iBoost-managed credit line** — the $750 or $2,000 reported credit line that's part of the Essential / Complete plans.

```
Reportable per user per month:
  - Account: iBoost line
  - Account type: revolving / installment (TBD per product spec)
  - Balance: current
  - Limit: $750 (Essential) / $2,000 (Complete)
  - Payment status: current / 30 late / 60 late / etc.
  - Payment amount + date for the month
  - Months reviewed: cumulative tenure
```

**This requires the iBoost line to actually exist as a credit product.** That's a separate compliance question — secured credit line, charge card-like, etc. Out of scope for this doc but flagged: **the reporting layer requires the underlying credit product to be real.**

### Tables (REPORTING side)

```sql
-- One row per user per reporting cycle. Captures what was reported.
reporting_submissions (
  id uuid pk,
  user_id uuid,
  bureau text,
  reporting_cycle date,              -- the month being reported
  provider_used text,                -- 'direct','ecredable','nova', etc.
  payload jsonb,                     -- what we sent (Metro 2 fields or API body)
  status text,                       -- 'queued','submitted','accepted','rejected','disputed'
  submitted_at timestamptz,
  bureau_confirmed_at timestamptz,
  notes text
);

-- Disputes a user files about something we reported. Track the
-- 30-day FCRA / equivalent investigation timeline.
reporting_disputes (
  id uuid pk,
  user_id uuid,
  submission_id uuid references reporting_submissions,
  filed_at timestamptz,
  reason text,
  investigation_due_by timestamptz,  -- 30 days for FCRA
  resolution text,                   -- 'corrected','verified','withdrawn'
  resolved_at timestamptz,
  notes text
);
```

### Failure modes (REPORTING)

- **Bureau rejects submission** (formatting, validation) → log, alert ops, retry next cycle
- **User disputes a tradeline** → 30-day FCRA clock starts; admin tooling to investigate + respond
- **Reseller partner outage** → some submissions delayed; transparent comms to users about timing
- **Data accuracy error** (we reported wrong amount) → MUST be corrected promptly; legal liability

### Cost (REPORTING)

| Path | Per user per month | Notes |
|---|---|---|
| 2A — Direct (US) | ~$0.20-0.50 | Mostly fixed costs amortized over volume |
| 2A — Direct (CA) | ~$0.30-0.80 | Smaller market, less amortization |
| 2B — Reseller | ~$1-5 | Per-report fee paid to partner |

Reporting cost is dwarfed by reading cost. The complexity is in compliance and operations, not unit economics.

---

## Integration with The BRAIN

The BRAIN consumes data from the READING path and produces recommendations. The REPORTING path is invisible to the BRAIN — it's an operations concern, not a recommendation concern.

But there's a subtle feedback loop:

- iBoost reports a $200 on-time payment on the user's iBoost line
- Bureau processes it next month
- Next BRAIN snapshot reads the bureau and sees the user has 1 more on-time payment
- BRAIN may emit: "Your on-time payment streak is now 6 months. This is what's driving the +18 point lift since you started."

So the reporting we do shows up as data the BRAIN reads next cycle. Closes the loop. The product becomes a flywheel: iBoost reports → user score improves → BRAIN explains why → user stays subscribed.

---

## Integration with the Admin

### Currently surfaced

`Settings > APIs > User data sources` shows:

- Credit bureau — Equifax (Manual / Equifax API)
- Credit bureau — TransUnion (Manual / TransUnion API)
- Credit bureau — Experian (Manual / Experian API)

These are READING-side toggles. Admin can switch each to active when env vars are set.

### Future additions (when reporting goes live)

Add a new section in admin Settings:

`Settings > APIs > Bureau reporting`

- Credit reporting — Equifax (Manual / Direct / eCredable / Nova)
- Credit reporting — TransUnion (Manual / Direct / eCredable / Nova)
- Credit reporting — Experian (Manual / Direct)

Same UI pattern. Same env-var-feasibility gating. Same Save flow.

### Operational tooling needed

When reporting is live, admin needs:

- **Reporting status per user** — has this user's data been reported this cycle? Submission ID? Bureau confirmation?
- **Dispute queue** — list of active disputes with deadline countdown (30-day FCRA clock visible)
- **Bulk reporting actions** — re-submit failed batches, cancel a queued submission
- **Audit log** — who changed what and when on reporting-related actions (extension of existing admin_actions audit pattern)

---

## Compliance — the most important section

This is the section that determines whether iBoost is a real business or a lawsuit waiting to happen.

### Pre-launch checklist (non-negotiable)

- [ ] Real credit-industry lawyer reviews data furnishing agreements before signing
- [ ] FCRA compliance officer (in-house or fractional) — required for US operations
- [ ] PIPEDA-compliant privacy policy + user consent flow
- [ ] Data Processing Agreement with every bureau and partner
- [ ] User-facing dispute mechanism (web form, email, phone — at least one)
- [ ] 30-day FCRA investigation procedure documented and operational
- [ ] Errors & Omissions insurance ($1M+ minimum)
- [ ] Cyber liability insurance ($2M+ minimum)
- [ ] Data breach notification procedures per province / state requirements
- [ ] Internal compliance audit before going live
- [ ] User-facing language reviewed by legal — no "we guarantee score improvement"

### Ongoing compliance

- Monthly internal audit of reporting accuracy (sample-based)
- Quarterly review of dispute resolution times (must average <30 days)
- Annual external compliance audit (recommended for any furnisher)
- Reporting accuracy rate tracking (target: >99.5%)

### Common landmines

- **"We guarantee a 100-point score boost in 30 days"** — illegal in many jurisdictions, lawsuit-worthy
- **Reporting inaccurate data** — direct FCRA violation, statutory damages
- **Failing to respond to disputes within 30 days** — FCRA violation
- **Insufficient consent capture** — PIPEDA / state-law violation
- **Cross-border data transfer without proper agreements** — Canadian privacy law issue

This is one area where moving slowly is the right move. The cost of getting it wrong dwarfs the cost of getting it right.

---

## Build phasing

### Phase 0 — Architecture in place (DONE — April 2026)

- Admin integration toggles surfaced
- `public.integrations` table with READING categories
- Manual mode is the default
- BRAIN architecture supports reading from bureaus when available

### Phase 1 — Vendor selection (next 90 days)

- Evaluate reseller partners (eCredable, Nova Credit, Boom, etc.)
- Initiate direct furnisher conversations with Equifax Canada, TransUnion Canada
- Get real pricing + timeline quotes
- Decision: Path 2A (direct), Path 2B (reseller), or hybrid
- This is **the most important business decision** of the next quarter

### Phase 2 — READING integration (3-4 months — contract gated)

- Sign first bureau contract (Equifax Canada most likely first)
- Implement OAuth + ingestion worker
- Add credit-side rules to BRAIN
- Soft launch to private beta — measure data quality, fix integration bugs
- Add second bureau (TransUnion Canada)
- Add third bureau (Equifax US or Experian US for US expansion)

### Phase 3 — REPORTING via reseller (parallel with Phase 2)

- Sign reseller contract
- Implement partner API integration
- User consent flow for reporting opt-in
- First test reporting cycle with employees / friends-and-family
- Verify with bureau pulls that test reports actually appear
- Public launch enabled

### Phase 4 — Direct furnisher status (ongoing, 12+ months)

- Submit applications to bureaus
- Build Metro 2 generation capability
- Set up dispute handling infrastructure
- Pass bureau audits
- Switch reporting toggle from reseller to direct
- Reseller relationship retained as fallback

### Phase 5 — Optimization (post-launch forever)

- Negotiate volume discounts on bureau pulls
- Improve dispute resolution time (target: <14 days)
- Add Experian (US) for full tri-bureau US coverage
- Expand to additional bureaus (Innovis in US?) if commercially relevant

---

## Open questions to resolve

- Direct furnisher vs reseller for v1? (Most important question of the quarter)
- Is the iBoost credit line a true revolving line, an installment line, or a charge-card-like product? (Affects what we can report)
- Canada-first vs US-first vs simultaneous launch? (Different vendor timelines)
- Who signs as the responsible party for FCRA compliance? (Likely Yan, but should be formalized)
- Errors & Omissions insurance carrier?
- Do we white-label the iBoost line through a banking-as-a-service partner (e.g., Synapse, Treasury Prime), or originate it ourselves?

---

## Cost summary

| Path | Monthly cost per user | Setup cost |
|---|---|---|
| READING only (3 bureaus blended) | ~$8 | Contract negotiation |
| REPORTING — reseller (Path 2B) | ~$1-5 | Contract + integration |
| REPORTING — direct (Path 2A) | ~$0.30-0.80 | $50-150K compliance setup |

At 46K users (Scenario C of financial model):

- READING: ~$3.5M/year
- REPORTING — reseller: ~$0.5-2.7M/year
- REPORTING — direct: ~$165-440K/year (after setup amortization)

Direct path saves ~$2M/year at this scale. **That's the case for moving from reseller to direct as scale justifies it.**

---

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Bureau contract negotiation slips 6+ months | Medium | High | Reseller path as bridge |
| FCRA compliance violation in production | Low | Catastrophic | Real lawyer review, dispute SLA, insurance |
| Reseller partner shutters / changes terms | Low | High | Multi-vendor strategy from day one |
| Data accuracy errors in reporting | Medium | High | Internal QA, sample-based monthly audits |
| User disputes a tradeline → can't investigate in 30 days | Medium | High | Admin tooling for disputes, headcount budget |
| Bureau API breaking changes mid-month | Low | Medium | Schema validation on ingestion, alert on shape changes |
| Cross-border data transfer (US user data flowing to CA infra) | High | Medium | Data residency review, possibly AWS Bedrock / Vertex AI for LLM portion |

---

## File pointer

When this gets built:

- Supabase migrations: 0014 already covers READING toggles. Add 0016+ for REPORTING toggles + tables (reporting_submissions, reporting_disputes)
- Backend: `/iboost-admin/src/lib/bureaus/` — per-bureau adapter modules (one file per bureau implementing read + report)
- Backend: `/iboost-admin/src/routes/bureaus.js` — admin endpoints (manually trigger pull, view submission status, manage disputes)
- Worker: separate process on Railway for bureau pulls (rate-limit-sensitive, distinct from main admin process)
- Frontend: Credit tab in `/credit/public/account.html` — render scores + tradelines + recommendations from BRAIN

---

## Re-orientation cheat sheet for future sessions

When picking up bureau work later, paste:

> "We're building credit bureau integrations per `docs/credit-bureau-integration.md`. Status: [reading: contracts signed / pending / which bureaus]. [Reporting: vendor selected / not yet / which path]. We're starting at [Phase X]."

---

## Related documents

- [`docs/brain-architecture.md`](./brain-architecture.md) — how the BRAIN consumes the READING side
- [`docs/budget-app-vision.md`](./budget-app-vision.md) — Budget tab integration
- Marketing copy on `pricing.html` — "Reports to all 3 bureaus" claim — must align with reporting capability before public launch

---

*This document captures the architecture as understood on April 24, 2026. The READING side is comparatively well-understood; the REPORTING side has the most strategic ambiguity remaining (direct vs reseller). Refresh after vendor evaluation phase.*
