# iBoost Budget App — Product Vision & Build Plan

> **Status:** Spec / pre-build
> **Owner:** Yan Desjardins
> **Last updated:** April 24, 2026
> **Source:** Captured from working session with Claude on April 24, 2026

---

## North Star

The iBoost budget app is a **QuickBooks-style ledger** for personal finance, purpose-built to support credit improvement. It is **not** a Monarch-style dashboard. The product is a workflow tool that ensures every transaction is categorized, every essential payment is tracked, and every dollar contributes to (or detracts from) the user's credit story.

If a user opens the budget tab and feels they've "fixed something," we win. If they feel like they're being entertained by charts, we've drifted from the vision.

---

## Mental model: review → categorize → reconcile → done

The core user loop, lifted from QuickBooks but adapted for personal credit:

1. **Review** — uncategorized transactions surface in an inbox-style queue
2. **Categorize** — one-click accept of suggested category, or quick override
3. **Reconcile** — at month-end, every transaction has a category; user marks the period closed
4. **Done** — empty inbox feeling. Same psychology as Inbox Zero.

This is fundamentally different from Monarch's "browse your finances" model. Monarch invites endless exploration. iBoost invites completion.

---

## Why QuickBooks-style is the right model for credit-improvement users

Credit-improvement users are not browsing their finances for fun. They're trying to fix something. They need:

- **Confidence that nothing is missed** — every transaction categorized, every dollar accounted for
- **Clear reconciliation** — books are "balanced," nothing left dangling
- **A workflow they can complete** — vs. an endless scroll of charts they never finish

QuickBooks nailed this for small businesses 25 years ago. The pattern still works, especially for users with anxiety about money — which is most credit-challenged users.

---

## Scope: what's in, what's out

### In scope (v1)

- Flinks bank connection (Canada-first; US later via Plaid or similar)
- Transaction display, search, filter
- Auto-categorization with learned rules (no ML)
- Manual categorization override + rule learning from corrections
- Custom user categories (create, rename, merge, mark as essential)
- Monthly reconciliation flow ("close the period")
- Recurring transaction detection (subscriptions, rent, salary)
- Subscription audit feature (find Netflix, gym, etc.)
- **The credit-budget bridge** — match transactions to credit accounts; treat debt payments as a first-class category; show utilization impact

### Out of scope (v1)

- Investment account integration (Flinks does some; defer)
- Crypto, real estate, complex assets
- Household / shared finances (one user = one budget for now)
- Net worth tracking with manual asset entry
- Mobile native apps (responsive web first)
- Cash flow forecasting
- Goal-based "spend less here to hit goal X" (becomes part of the BRAIN later)
- Spending insights / anomaly detection (BRAIN territory)

The narrow scope is the point. iBoost's budget app should be **80% of what a credit-improving user needs**, not 80% of what every personal finance user wants.

---

## The unique edge: the credit-budget bridge

This is the feature **only iBoost can build** because we have both sides of the data:

When a user makes a credit card payment, the budget app:

1. Detects it as a transfer to a known credit account (via Flinks data + matched amount)
2. Categorizes it as **Debt Payment** (not Spending — important distinction!)
3. Updates the user's known credit utilization in real-time (before bureau pulls confirm)
4. Surfaces the impact: "You paid $400 toward your Visa. Utilization just dropped from 80% to 53%. Pay another $200 to drop below 30% before your statement closes May 15."

This bridges Flinks data and bureau data into a single actionable insight. It is the foundation of the BRAIN's most powerful tip and the core differentiation vs Monarch / Mint / YNAB / QuickBooks.

---

## Data model sketch

```sql
-- User's category list. Starts with iBoost defaults, user can edit.
categories (
  id uuid pk,
  user_id uuid,
  name text,                     -- "Groceries"
  icon text,                     -- emoji or named icon
  color text,                    -- hex
  parent_id uuid nullable,       -- for sub-categories: "Food > Groceries"
  is_essential bool,             -- credit-relevant flag: rent, debt payments, utilities
  display_order int
)

-- Auto-categorization rules. Built up from user actions over time.
category_rules (
  id uuid pk,
  user_id uuid,
  match_type text,               -- 'merchant_exact', 'merchant_contains', 'amount_range'
  match_value text,              -- "STARBUCKS"
  category_id uuid,
  confidence numeric,            -- learned over time
  created_from text,             -- 'user_correction', 'iboost_default', 'pattern_detected'
  created_at timestamptz
)

-- Each transaction gets a category. Soft-link so categories can be
-- renamed/merged without orphaning data.
transactions (
  id uuid pk,
  user_id uuid,
  flinks_transaction_id text,
  account_id uuid,
  date date,
  amount numeric,
  raw_description text,
  cleaned_merchant text nullable,
  category_id uuid nullable,     -- null = needs review
  categorization_source text,    -- 'rule', 'user', 'manual_default'
  is_transfer bool,              -- detected internal transfers
  is_split bool,                 -- has been split into multiple categories
  notes text,
  created_at timestamptz,
  updated_at timestamptz
)

-- For the QuickBooks-style "this month is closed" feeling
period_reconciliations (
  id uuid pk,
  user_id uuid,
  period_start date,
  period_end date,
  closed_at timestamptz nullable,  -- non-null when user marks "done"
  notes text
)
```

The model is intentionally boring. CRUD plus a rules engine. **The intelligence is in the auto-categorization rules learning from corrections.**

---

## Auto-categorization architecture (no ML required)

A three-layer rule system that feels magical without machine learning:

### Layer 1: Built-in merchant patterns (ships with iBoost)

```javascript
const DEFAULT_RULES = [
  { match: /loblaws|metro|sobeys|iga|provigo/i, category: 'groceries' },
  { match: /tim hortons|starbucks|second cup/i, category: 'coffee' },
  { match: /uber eats|skipthedishes|doordash|foodora/i, category: 'food_delivery' },
  { match: /esso|petro-canada|shell|ultramar|husky/i, category: 'gas' },
  { match: /netflix|spotify|disney|crave|amazon prime/i, category: 'subscriptions' },
  // ... 100-200 of these covering top Canadian/US merchants
];
```

This alone gets ~60% accuracy on day one. User connects bank, sees most transactions already categorized correctly. Wow factor.

### Layer 2: User-specific learned rules

When user changes "AMZN MKTP CA" from "Shopping" to "Household", create a rule:

```sql
insert into category_rules (user_id, match_type, match_value, category_id, created_from)
values ('uuid', 'merchant_contains', 'AMZN MKTP', 'household_uuid', 'user_correction')
```

Next time an Amazon transaction appears for THIS user, it auto-categorizes as Household. Their categorization gets smarter as they use it. **This is what feels magical.**

### Layer 3: Conflict resolution

User changes their mind. Two weeks ago they marked Amazon as Household. Today they mark it as Office Supplies. Don't immediately overwrite the rule — ask:

> "You usually categorize Amazon as Household. Is this Amazon purchase different, or do you want to change all future Amazon purchases?"

Three options:

1. Just this one (don't update rule)
2. All future ones (update rule)
3. All past + future (re-categorize history too)

That's QuickBooks-quality UX in three buttons.

---

## Build plan: 12 weeks to a usable v1

### Week 1-2 — Connect & display
- Flinks OAuth integration
- User clicks "Connect bank," accounts appear
- Transaction list: clean, filterable, searchable
- No categorization yet — just "look, your data is here"

### Week 3-4 — Default categorization + manual override
- Rules-based auto-categorization (Layer 1 patterns)
- User can change any category in one click
- Categorization "sticks" via learned rules (Layer 2)

### Week 5-6 — The review queue + monthly close
- Uncategorized transactions float to top of inbox
- "All caught up" empty state with subtle celebration
- Monthly reconciliation: "Close period" workflow
- Period-close summary: spending by category, comparison to last month

### Week 7-8 — Categories management
- Users can create / rename / merge their own categories
- Drag to reorder
- Mark categories as "essential" (rent, utilities, debt) vs discretionary
- Sub-category support if needed (Food > Groceries, Food > Restaurants)

### Week 9-10 — The credit-budget bridge
- Match transactions to credit accounts (matched-amount + opposite-sign + date proximity)
- "Debt Payment" as a first-class category (not Spending)
- Show utilization impact when payments hit
- This is THE thing only iBoost can do — the unique differentiation

### Week 11-12 — Recurring detection + subscription audit
- Find Netflix, gym, rent, salary via date+amount pattern matching across 3+ months
- Dedicated "Subscriptions" view
- "I want to cancel this" workflow with deep-links where available

### Beyond v1 (iteration phase)
- Better merchant cleaning / canonicalization
- Insights as data accumulates
- Mobile-first responsive polish
- The 10,000 small things that turn "useful" into "loved"

---

## UX principles (these matter as much as the code)

The single biggest failure mode of QuickBooks-style apps is **categorization feeling like work**. A small business owner is willing to do bookkeeping. A stressed credit-improvement user is not.

The cure: make every action feel like progress, not chore.

- **Always show progress** ("8 of 24 transactions reviewed")
- **Celebrate completion** (small dopamine hit when you reach zero, like Inbox Zero)
- **Never punish — only suggest** (no red warnings, no "you're behind on categorization")
- **Tie back to credit constantly** ("You've categorized $1,200 in essential payments — that's 4% of your utilization story")
- **Keyboard-driven categorization** — power users want to fly through this. Y to accept, then category-letter shortcut to override. Build the UI fast first.

This is a writing/design challenge as much as a code challenge.

---

## Hard problems to expect (forewarned is forearmed)

These won't show up in initial estimates but will absolutely happen with real data:

- **Merchant name chaos** — same Starbucks appears as 6 different strings. Need a cleaning pipeline.
- **Pending vs cleared transactions** — same purchase appears twice. Must merge.
- **Internal transfers detection** — moving $500 from chequing to savings is not income or spending. Heuristic matching required.
- **Refunds and adjustments** — original $50, $0.05 reversal, $2.40 reward credit. Three rows, one logical event.
- **Category opinion drift** — Costco gas: Auto or Wholesale? No right answer; must be configurable per user.
- **Flinks connection drops** — banks change OAuth flows; tokens expire. Need graceful "reconnect your bank" UX.
- **Limited historical data** — most banks give 90 days only. Set expectations: value compounds over time.
- **Real-time isn't real-time** — transactions appear 1-3 days after they happen. Don't promise instant alerts.

---

## Integration with The BRAIN

The budget app and the BRAIN share the same data pipeline:

- Both consume Flinks transactions
- Both populate `financial_snapshots`
- Both depend on clean categorization
- Budget app exposes raw + categorized data to the user
- BRAIN reads the same data and emits monthly recommendations

**Build the ingestion + categorization once; both features benefit.** This is a real architectural win.

The credit-budget bridge specifically (matching transactions to credit accounts) feeds directly into BRAIN rules like:

```
IF user just made a credit card payment >= $X
AND new utilization will drop below threshold T
AND statement closes within Y days
THEN suggest: "Pay $Z more before statement closes to maximize score impact"
```

---

## What "done" looks like for v1

A user can:

- Connect their bank in under 60 seconds
- See all transactions categorized correctly out of the gate (~60% accuracy)
- Recategorize any transaction in one click; iBoost remembers
- Reach "all caught up" within 2 minutes per month after first connection
- See a monthly summary by category
- See subscription audit
- Match credit card payments to their credit accounts
- See utilization impact of each payment

A user does NOT need to:

- Fight with the UI to categorize
- Manually enter any transactions
- See ML / AI / "intelligence" anywhere — categorization just feels right

---

## File pointer

When this gets built, key code lives in:

- `/public/account.html` — Budget tab UI
- `/public/assets/js/budget.js` — categorization logic, rule engine, reconciliation
- `/public/assets/js/flinks-loader.js` — to be created, mirrors plans-loader pattern
- Supabase migrations: 0015+ for budget tables (categories, category_rules, transactions, period_reconciliations)
- Backend ingestion worker on Railway (separate process from admin)

---

## Open questions to resolve before building

- Flinks contract terms — what's the per-connection cost? Need real number.
- US expansion: Plaid or stay Flinks-only? Flinks does limited US coverage.
- How aggressive on the keyboard-driven UI? Power users will love it, casual users may need traditional buttons too.
- Should the "Close period" feeling be automatic at month-end, or strictly user-triggered?
- Multi-account households: defer entirely or design data model to support it later without rewrites?

---

*This document captures the spec as understood on April 24, 2026. Refresh when scope changes.*
