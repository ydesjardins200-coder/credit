# iBoost BRAIN — Architecture & Build Plan

> **Status:** Spec / pre-build
> **Owner:** Yan Desjardins
> **Last updated:** April 24, 2026
> **Source:** Captured from working session with Claude on April 24, 2026

---

## North Star

The BRAIN is iBoost's **monthly intelligence pipeline**: it ingests each user's banking data (Flinks) and credit bureau data (Equifax / TransUnion / Experian), runs it through a deterministic rules engine that distills credit-improvement expertise, and emits personalized actionable recommendations rendered in the Credit and Budget tabs.

It is the platform's eventual moat. Not because of AI hype — because the **rules engine is years of credit-domain knowledge encoded as testable, auditable code**. A thin GPT wrapper cannot replicate it.

---

## The single most important architectural principle

**The rules engine is the product. The LLM is a rephrasing layer.**

Read that twice. Every architectural decision flows from it.

- ✅ Rules engine = deterministic JavaScript. Numbers, thresholds, formulas. THIS is the moat.
- ✅ LLM = takes structured rule output, makes it sound human. Numbers come from rules; LLM only rephrases.
- ❌ Never let the LLM originate financial advice
- ❌ Never let the LLM generate or modify numbers
- ❌ Never send raw transactions, balances, or PII to the LLM

If we ever drift toward "let the AI figure out what advice to give" — that's the trap. Stop and refactor.

---

## Why this architecture

**Regulatory:** Telling a user "pay $X by date Y" enters FCRA / CFPB territory in the US and provincial consumer-protection territory in Canada. A deterministic rules engine produces auditable, explainable, defensible recommendations. An LLM-originated recommendation cannot be defended in court when something goes wrong.

**Accuracy:** LLMs hallucinate ~0.1-5% of the time. For credit advice, a hallucinated number could hurt a user's score. Hallucinated advice could expose iBoost to liability. The architecture eliminates the failure mode by never letting the LLM near the numbers.

**Cost:** Rules engine runs in ~10ms of CPU per user. Free. LLM polish at Haiku 4.5 with batch + caching costs ~$0.003 per user per month. Both costs are dwarfed by bureau pulls (~$8/user) and Flinks ($1/user).

**IP defensibility:** Rules engine = proprietary code that compounds over time. Each rule is testable, versioned, and explainable. This is what protects iBoost from competitors. The LLM provider (Anthropic, OpenAI, etc.) is interchangeable infrastructure.

---

## Four-layer architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Layer 4: PRESENTATION                                           │
│  account.html → Credit tab + Budget tab                          │
│  Reads brain_recommendations rows. Dumb display layer.           │
└─────────────────────────────────────────────────────────────────┘
                              ▲
┌─────────────────────────────────────────────────────────────────┐
│  Layer 3: GENERATION                                             │
│  Monthly scheduled job. For each user:                           │
│    1. Read snapshot from Layer 2                                 │
│    2. Run rules engine (deterministic, ~30 rules)                │
│    3. (Optional) polish phrasing via LLM                         │
│    4. Validate LLM output against schema + numeric integrity     │
│    5. Write brain_recommendations rows                           │
└─────────────────────────────────────────────────────────────────┘
                              ▲
┌─────────────────────────────────────────────────────────────────┐
│  Layer 2: SNAPSHOT                                               │
│  Monthly snapshot per user. Frozen, immutable, deterministic.    │
│  Every recommendation is traceable to the exact data it was      │
│  generated from. Supports auditing, debugging, regulatory        │
│  inquiries.                                                      │
└─────────────────────────────────────────────────────────────────┘
                              ▲
┌─────────────────────────────────────────────────────────────────┐
│  Layer 1: INGESTION                                              │
│  Flinks (banking data) + bureau APIs (credit data) → normalized  │
│  Supabase tables. Continuous, runs daily/weekly per cadence.     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Layer 1 — Ingestion

### Flinks (banking)

- OAuth user authorization, then poll daily/weekly
- Pulls accounts, balances, transactions across linked institutions
- Coverage: strong on Big 6 Canadian banks + Tangerine + Simplii + Desjardins
- Cost: ~$0.50-1.50/active connection/month
- Limited historical data: typically 90 days at first connection, then forward-looking

Tables populated:

```sql
accounts (id, user_id, institution, account_type, mask, currency, ...)
balances (id, account_id, as_of_date, available, current, limit, ...)
transactions (id, account_id, date, amount, raw_description, ...)
```

### Credit bureaus

- Soft pull, monthly cadence (does not affect user's score)
- Each bureau is a separate contract + integration
- Cost: ~$1-5 per bureau per user per pull, $8 blended for all 3
- 6-12 month contract negotiation timeline before APIs become available

Tables populated:

```sql
credit_scores (id, user_id, bureau, score, score_date, model_version, ...)
tradelines (id, user_id, bureau, creditor, type, balance, limit,
            open_date, payment_status, ...)
inquiries (id, user_id, bureau, inquiry_date, inquirer, ...)
```

### Failure modes to handle

- **Flinks connection drops** — banks change OAuth periodically. Need graceful "reconnect" UX.
- **Bureau API timeouts** — retries with exponential backoff. Stale snapshot data is preferable to no snapshot.
- **Partial data** — user has Flinks but no bureau yet. BRAIN rules must degrade gracefully (suggest credit-side rules only when credit data exists).

---

## Layer 2 — Snapshot (the critical trick)

This is where most teams screw up. They run rules directly against live ingested data. That's wrong because:

- Raw data churns daily; a recommendation generated Tuesday might be invalid Wednesday
- Audit trails matter — "you told me X on Oct 15 and it hurt me" requires we can reproduce what we knew
- Debugging is impossible on live data

### Solution: monthly immutable snapshots

On each user's reporting day, freeze their financial picture. Never mutate. Recommendations always reference a specific snapshot.

```sql
financial_snapshots (
  id uuid primary key,
  user_id uuid references auth.users,
  snapshot_date date not null,

  -- ============ Frozen derived metrics (computed at snapshot time) ============

  -- Banking side (from Flinks)
  total_balance_cad integer,
  total_balance_usd integer,
  monthly_income_avg_cad integer,    -- 3-month trailing avg
  monthly_spending_avg_cad integer,
  monthly_essential_spending integer, -- rent + utilities + debt payments
  on_time_payments_6m integer,
  late_payments_6m integer,
  nsf_events_6m integer,

  -- Credit side (from bureaus)
  equifax_score integer,
  transunion_score integer,
  experian_score integer,
  total_credit_limit integer,
  total_credit_balance integer,
  utilization_pct numeric(5,2),       -- 0.00 to 100.00
  oldest_tradeline_age_months integer,
  tradeline_count integer,
  inquiries_6m integer,

  -- ============ Raw data pinned for auditability ============
  raw_bureau_data jsonb,              -- full bureau response, frozen
  raw_flinks_summary jsonb,           -- Flinks summary, frozen

  -- ============ Audit ============
  created_at timestamptz default now(),

  unique(user_id, snapshot_date)
);
```

**Every snapshot is immutable.** The BRAIN only ever reads snapshots, never live data. You can regenerate a recommendation from a 6-month-old snapshot and get the same answer. Debuggable, auditable, deterministic.

---

## Layer 3 — Generation

### Rules engine (80% of value)

Each rule is a small, testable function that examines the snapshot and emits a candidate recommendation or nothing.

```javascript
const RULES = [
  {
    id: 'high_utilization',
    evaluate: (snapshot) => {
      if (snapshot.utilization_pct > 30) {
        return {
          priority: 'high',
          impact_points: estimateUtilizationImpact(snapshot),
          category: 'utilization',
          target_account: findHighestUtilAccount(snapshot),
          paydown_needed: calculatePaydown(snapshot, 28),  // target 28%
          deadline: nextStatementDate(snapshot),
        };
      }
      return null;
    }
  },

  {
    id: 'old_account_protect',
    evaluate: (snapshot) => {
      if (snapshot.oldest_tradeline_age_months > 60 &&
          recentlyClosedAccounts(snapshot).length > 0) {
        return {
          priority: 'warning',
          impact_points: -15,
          message: 'oldest_account_just_closed',
          oldest_account_name: snapshot.oldest_account_name,
          oldest_account_age_years: snapshot.oldest_account_age_months / 12,
        };
      }
      return null;
    }
  },

  {
    id: 'inquiry_cooling',
    evaluate: (snapshot) => {
      if (snapshot.inquiries_6m >= 3) {
        return {
          priority: 'medium',
          inquiries_count: snapshot.inquiries_6m,
          recommended_wait_months: 6,
        };
      }
      return null;
    }
  },

  // ... 30+ more rules over time
];
```

**These rules are the product.** Every rule is:

- **Deterministic** — same input = same output
- **Auditable** — we can show exactly why a recommendation was generated
- **Testable** — unit test per rule with example snapshots
- **Versioned** — rule_id includes a version (e.g., `high_utilization_v2`) so we can evolve logic without breaking history
- **Explainable** — the candidate's structured fields name every input that drove it

### Versioning policy

- Rule logic changes get a new version: `high_utilization` → `high_utilization_v2`
- Old rules stay available for re-running historical snapshots
- `brain_recommendations` rows store the rule_id including version
- Deprecation policy: keep old versions readable for 24 months minimum

### LLM polish layer

Once rules emit candidates, the LLM does ONE thing: **make the phrasing sound human**.

```
Per-user prompt to api.anthropic.com:

  "You are formatting credit-improvement tips for a user named {first_name}.

  Rules:
    1. Use ALL numbers, dates, and account names EXACTLY as given.
       Do not round, reword, or paraphrase any number.
    2. Tone: warm, direct, like a knowledgeable friend.
       Use second-person ('you').
    3. No financial advice disclaimers. No 'consider' or 'you might
       want to' hedging — give the action clearly.
    4. Each tip: one sentence (max two) for the action, one sentence
       for why it helps.
    5. Output JSON array: [{ rule_id, title, body }]

  Candidates:
    {structured_candidates_json}"
```

The LLM gets structured candidates in, returns polished text out. Numbers are immutable. The LLM never invents anything — it only reformats.

### Output validation (critical)

Every LLM response MUST be validated before storing:

1. **Schema check** — JSON parses, required fields present
2. **Rule_id integrity** — every returned rule_id must match one we sent
3. **Number integrity** — extract numbers from polished text via regex; confirm each appears in the original candidate's structured fields. If LLM made up a number, reject the response.
4. **Length sanity** — body fields under 300 characters
5. **Fallback on failure** — if validation fails, store the raw rule output (uglier text but safe) and log for review

```javascript
function validatePolishedRecommendation(polished, original) {
  if (polished.rule_id !== original.rule_id) return false;
  const numbersInPolished = extractNumbers(polished.body);
  const numbersInOriginal = extractNumbers(JSON.stringify(original));
  return numbersInPolished.every(n => numbersInOriginal.includes(n));
}
```

This is the safety net that makes the architecture defensible.

---

## Layer 4 — Presentation

```sql
brain_recommendations (
  id uuid primary key,
  user_id uuid,
  snapshot_id uuid references financial_snapshots,
  rule_id text,                       -- includes version, e.g., 'high_utilization_v2'
  priority text check in ('high', 'medium', 'warning', 'opportunity', 'info'),
  category text,                      -- 'utilization' | 'age' | 'inquiries' | 'budget' | ...
  title text,
  body text,
  target_account_id uuid nullable,    -- optional: which account this references
  estimated_impact_points integer nullable,
  status text default 'active',       -- 'active' | 'dismissed' | 'completed' | 'expired'
  raw_candidate jsonb,                -- the structured candidate before LLM polish
  generated_by text,                  -- 'rules_only' | 'rules+llm'
  created_at timestamptz,
  expires_at timestamptz              -- typically next snapshot date
);
```

The Credit/Budget tabs query:

```sql
SELECT * FROM brain_recommendations
WHERE user_id = ?
  AND status = 'active'
  AND expires_at > now()
ORDER BY priority_rank, created_at;
```

Dumb display. No logic at the edge. User interactions (dismiss, mark complete) just update `status`.

### User feedback loop

Track which recommendations users:

- Dismiss (signal: not relevant or already known)
- Mark complete (signal: useful enough to act on)
- Ignore (no action either way)

This data eventually feeds rule effectiveness measurement: "high_utilization_v2 is dismissed 40% of the time when paydown_needed > $1000 — too aggressive?" Iterate.

---

## Monthly cadence — how it actually runs

### Per-user reporting day

Each user has their own monthly reporting day (e.g., always the 15th of the month, or aligned to their statement cycle). This staggers load across the month so:

- LLM costs are smooth, not spiky
- Bureau-pull costs are smooth (some bureaus rate-limit; staggering avoids contention)
- A single cron worker can process the daily batch without overwhelming downstream APIs

### The job

```
Every day at 3am EST, on Railway cron:

  for each user where next_snapshot_date = today:
    1. Pull fresh Flinks data        → ingestion tables
    2. Pull fresh bureau data        → ingestion tables
    3. Compute snapshot              → financial_snapshots row
    4. Run rules engine              → array of candidates
    5. (If candidates non-empty)
       Send to Anthropic Batch API   → polished recommendations
    6. Validate response             → reject + fallback if invalid
    7. Insert brain_recommendations  → user sees in Credit/Budget tabs
    8. Mark prior snapshot's recs as expired
```

### Failure handling

- **Bureau API down** → use last cached score, log degraded snapshot, continue
- **Flinks connection broken** → snapshot tagged as `incomplete: true`, skip rules requiring banking signals
- **LLM API down or rate-limited** → fall back to raw rule output, store with `generated_by: 'rules_only'`
- **Validation fails** → same fallback path as LLM down
- **Cron misses a user's day** → catch-up job runs them next day, no data loss

---

## Cost economics (full stack)

For a single user per month:

| Component | Cost |
|---|---|
| Bureau pulls (3 bureaus blended) | ~$8.00 |
| Flinks active connection | ~$1.00 |
| LLM polish (Haiku 4.5 + batch + caching) | ~$0.003 |
| Compute (rules engine + snapshot build) | <$0.001 |
| **Per-user-per-month total** | **~$9.00** |

The LLM is a rounding error. **Bureau pulls dominate.** This is the single biggest lever for margin improvement at scale — bureau contracts routinely drop from $8/user blended to $3-4/user at enterprise volume.

---

## Build phasing

### Phase 1 — Rules engine, mocked snapshots (3 weeks)

- Build `financial_snapshots` table schema
- Hand-craft 3-5 mock snapshots representing realistic user personas
- Implement 5-10 starter rules
- Unit tests per rule
- Admin tool: "show recommendations for user X" (renders raw rule output)
- **NO real Flinks data, NO real bureau data, NO LLM yet**

This phase proves the product logic works before any external data costs. Cheap to iterate.

### Phase 2 — Flinks ingestion (4 weeks)

- Sign Flinks contract
- Implement OAuth + ingestion worker
- Populate banking half of `financial_snapshots`
- Add banking-side rules (cash flow, NSF events, payment patterns)
- Roll out to private beta users
- Tell users "credit half coming soon"

### Phase 3 — Bureau ingestion (3-4 months — contract-gated)

- Negotiate bureau contracts (Equifax, TransUnion, eventually Experian for US)
- Each bureau is a separate integration project
- Add credit-side rules
- Snapshots become complete; full rules engine engages

### Phase 4 — LLM polish layer (1-2 weeks once Phases 1-3 are done)

- Wire Anthropic API call after rules emission
- Implement output validation
- A/B test: does LLM-polished text drive better engagement than raw rule output?
- Measure: dismissal rates, completion rates, retention

### Phase 5 — Rule library growth (ongoing forever)

- Start with 10 rules
- Add 2-5 per quarter based on user feedback, support tickets, observed behavior
- Each new rule = its own pull request, tests, deployment, A/B test if uncertain

---

## Regulatory positioning

The phrasing of recommendations is the difference between informational content and regulated credit advice. Examples:

| Phrasing | Risk profile |
|---|---|
| "Pay $400 to your Visa by Oct 15 to lift your score" | Highest — directive financial advice |
| "Paying $400 to your Visa by Oct 15 would lift your utilization below 30%, typically improving scores" | Medium — informational with action |
| "Your utilization is 80%; below 30% is generally optimal" | Lowest — pure information |

**Pre-launch legal review is non-negotiable.** A real credit-industry lawyer reviews the prompt template + 30 sample outputs before any user sees a BRAIN recommendation in production.

iBoost's positioning to settle on (working draft):

> "iBoost provides educational guidance derived from your own financial data. It is not a substitute for professional financial advice."

Phrasing tweaks per provincial / state requirements as needed.

---

## Privacy & data minimization

Send only what the LLM needs to phrase recommendations. Never send raw transactions, full credit reports, account numbers, or PII beyond first name.

Allowed in LLM prompt:
- ✅ User's first name (for personalization)
- ✅ Specific numbers from rules engine output
- ✅ Last-4 of card / account name as user-visible identifier
- ✅ Dates from rules engine output

NOT allowed:
- ❌ Full name, email, phone, address, DOB, SIN/SSN
- ❌ Account numbers (full)
- ❌ Raw transaction history
- ❌ Other accounts' balances beyond what the rule references
- ❌ Full credit report

This is the **data minimization principle** — relevant to PIPEDA (Canada) and FCRA (US). Less data sent = less liability if anything goes wrong.

### Anthropic API specifics

- API calls are not used to train models by default
- Can sign BAA for healthcare-grade compliance if ever needed
- Can route via AWS Bedrock or Google Vertex AI if compliance ever requires data stay within those clouds

---

## What this does NOT do

- ❌ Real-time recommendations (monthly cadence by design — bureau data only updates monthly anyway)
- ❌ Autonomous actions on user's behalf (no auto-payments, no auto-disputes — surface recommendations only)
- ❌ Predictions ("your score will be X in 6 months") — not credible, regulatory minefield
- ❌ Comparisons to other users ("you're in the top 20% for utilization") — privacy concerns, motivation issues

---

## Integration points

### With the Budget app

- Both share `financial_snapshots` table
- Both consume Flinks transactions
- Budget app surfaces categorization to user; BRAIN reads categorized data to detect patterns
- Credit-budget bridge feature in Budget app feeds BRAIN rules:
  - "User just paid $X to Visa → utilization dropped → if statement closes within Y days, suggest paying $Z more before close"

### With the Admin

- Admin Settings > APIs already shows the integration architecture (Equifax, TransUnion, Experian, Flinks toggles)
- Admin tool to manually trigger BRAIN run for a user (testing + customer support)
- Admin view of a user's snapshot history + recommendations

---

## Open questions to resolve before building

- Bureau partnership path: direct furnisher vs reseller (eCredable, Nova Credit, etc.)?
- US vs Canada-first? Bureau ecosystems are very different.
- Cron infrastructure: Railway cron, Supabase Edge Functions, or dedicated worker process?
- Snapshot history retention: keep all forever, or roll up after 24 months?
- Recommendation expiration: auto-expire on next snapshot, or user-driven only?
- Should users be able to see a "history" of all past recommendations they completed/dismissed?

---

## Success metrics for v1

A user can:

- See 3-7 personalized recommendations within 5 minutes of completing iBoost setup (with mocked snapshot during Phase 1, with real data Phase 2+)
- Dismiss or mark complete in one click
- Trust the recommendations (no obvious errors, no hallucinated numbers)

iBoost can:

- Generate recommendations for a user at <$0.01 LLM cost
- Trace any recommendation back to the exact snapshot + rule that produced it
- A/B test rule changes safely (versioning + history preservation)
- Defend any recommendation in a regulatory inquiry (rules engine output is the audit trail)

---

## File pointer

When this gets built, key code lives in:

- Supabase migrations: 0015+ for BRAIN tables (financial_snapshots, brain_recommendations)
- Backend ingestion worker on Railway: separate cron-driven process
- `/iboost-admin/src/lib/brain/` — rules engine + LLM polish layer
- `/iboost-admin/src/routes/brain.js` — admin endpoints (trigger run, view snapshots)
- Frontend rendering in `/credit/public/account.html` — Credit tab + Budget tab

---

## Re-orientation cheat sheet for future sessions

When picking this work up later, paste:

> "We're building the iBoost BRAIN per `docs/brain-architecture.md` in the credit repo. Read it first. We're starting at [Phase X]. Status: [Flinks done / not done], [Bureau contract status], [Rules implemented so far]."

That's all I need to be back up to speed in 5 minutes.

---

*This document captures the architecture as understood on April 24, 2026. Refresh when scope or design decisions change. The rules-engine-as-moat principle is non-negotiable — anything else is open to revision.*
