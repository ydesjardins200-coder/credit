# Tier feature matrix

**Status:** decided — 2026-04-27. Implementation pending.

This document records the per-tab, per-feature gating decisions for `/account.html`. It pairs with `pricing.html`'s plan promises and `plans-loader.js`'s seed data to define what each subscription tier actually unlocks.

## Tiers

| Tier | Price (USD/CAD) | Positioning |
|---|---|---|
| **Free** | $0 / $0 | Learn the system. Build the habits. Upgrade when ready. |
| **iBoost Essential** | $15 / $20 | Real credit work without the premium add-ons. |
| **iBoost Complete** | $30 / $40 | Everything we offer. Maximum score-building velocity. |

Existing seed in `assets/js/plans-loader.js` lines 47-100 carries the canonical perks per tier. This doc reflects how those perks express across the dashboard.

## Gating philosophy

**Hybrid model.** Three different gate styles based on what makes UX sense per tab:

- **Always visible, identical experience** — Welcome, Education, Profile (utility tabs)
- **Visible but locked** — Credit (visibility = aspirational sales tool for Free users)
- **Tier-adaptive content** — Budget (different version per tier, not locked), Offers (different curated content per tier, not locked)

Locked-tab implementation must be **per-feature data-driven from day one**, not per-tab hardcoded, so a future shift to per-card lock granularity is a config swap rather than a rewrite.

## The matrix

### Tab 1 — Welcome 🏠

| Element | Free | Essential | Complete |
|---|---|---|---|
| Greeting + streak banner | ✅ | ✅ | ✅ |
| Complete-your-profile card | ✅ (until profile complete) | ✅ (until profile complete) | ✅ (until profile complete) |
| Today's focus card | ✅ generic content for now; BRAIN-personalized later (Phase 2) | ✅ same | ✅ same |
| Milestones card | **Adaptive** — Free milestones | **Adaptive** — paid milestones | **Adaptive** — paid milestones |

**Adaptive milestones detail:**

- *Free*: "Profile complete" / "First budget entered" / "Completed first lesson" / "Upgraded to paid"
- *Essential / Complete*: "Profile complete" / "First payment" / "First bureau report" / "First score increase"

### Tab 2 — Credit 💳

**Visible-but-locked for Free.** Whole-panel lock overlay with single upgrade CTA.

| Element | Free | Essential | Complete |
|---|---|---|---|
| Score gauge + per-bureau breakdown | 🔒 Locked overlay | ✅ Updated **monthly** | ✅ Updated **weekly** |
| 6-month score graph | 🔒 Locked overlay | ✅ | ✅ |
| AI tip card (BRAIN output) | 🔒 Locked overlay | ✅ Monthly tip | ✅ Unlimited on-demand |
| This-month's-focus action items | 🔒 Locked overlay | ✅ 3 items | ✅ 3 items |
| Progress to Very Good | 🔒 Locked overlay | ✅ | ✅ |
| Credit utilization | 🔒 Locked overlay | ✅ | ✅ |
| Recent activity feed | 🔒 Locked overlay | ✅ | ✅ |
| **Dispute assistance** | ❌ | ❌ | ✅ Complete-only feature |

**Implementation note:** Even though all cards are locked together for Free today, the implementation must use per-feature gates (`credit.score_gauge`, `credit.score_graph`, etc.) keyed in a permissions module. The current "lock the whole panel" UX is one rule that gates the whole tab; switching to per-card requires a different gate scope (panel-level → card-level), but the underlying data structure is the same.

### Tab 3 — Offers 🎯

**Tier-adaptive content.** All tiers see the tab; Free sees a curated starter-offers subset.

| Element | Free | Essential | Complete |
|---|---|---|---|
| Profile match summary card | ❌ Hidden (no score = no match) | ✅ Personalized to score + utilization | ✅ same |
| "Best matches right now" featured row | ✅ **Curated starter offers** (different content + copy) | ✅ Score-matched offers | ✅ same |
| Featured row copy | "Popular with people building credit" | "Best matches right now" | same |
| Soft-pull pre-approval language | ❌ Removed | ✅ Shown | ✅ same |
| Category browsing (cards / loans / accounts / insurance) | ✅ Starter subset (~2 mini-cards per category) | ✅ Full catalog | ✅ same |
| Affiliate disclosure | ✅ Always shown | ✅ same | ✅ same |

**Strategic rationale:** Offers is iBoost's affiliate revenue line. Hiding it from Free would forfeit that revenue from price-sensitive users who are most likely to click through. Curating instead of hiding lets Free contribute affiliate income without cannibalizing the paid tier's score-matched experience.

**Data-model implication:** Each offer needs `tier_visibility: ['free', 'essential', 'complete']` or similar. Defer to whenever Offers gets built; do not need to ship infrastructure today.

**Marketing copy implication:** Add Offers (curated starter set) to the Free tier perks in `pricing.html`. Currently unmentioned.

### Tab 4 — Budget 💰

**Tier-adaptive content.** All tiers see the tab; Free uses manual entry, paid uses Flinks-fed automation. No Essential vs Complete differentiation within Budget.

| Element | Free | Essential | Complete |
|---|---|---|---|
| Month selector | ✅ Same UI | ✅ same | ✅ same |
| Summary stats (Income / Spent / Available / Savings rate) | ✅ Manually entered | ✅ Auto-computed from Flinks | ✅ same |
| Connected accounts list | "Add account manually" CTA + "Connect bank — upgrade" CTA | ✅ Flinks Connect, multiple accounts | ✅ same |
| Spending by category | ✅ From manual entries | ✅ Auto-categorized via `docs/budget-app-vision.md` rules engine | ✅ same |
| Goals | ✅ Same UI | ✅ same | ✅ same |
| Recent transactions | "Add transaction" entry mode + **Level-1 smart category suggestions** | ✅ Auto-imported, review-queue UX | ✅ same |
| Smart category suggestions (manual entry) | ✅ Static merchant lookup table (`lib/merchant-categories.js`) | n/a (auto-categorized) | n/a (auto-categorized) |

**Smart category suggestions detail (Free only):**

- Static merchant lookup table — ~100-200 common Canadian + US merchants
- When user types merchant name, pre-fills Category dropdown with best guess
- User can override suggestion
- Same data file feeds Layer 1 of the paid tier's categorization rules engine — built once, reused

**Strategic rationale:** Manual entry without suggestions is genuinely tedious. Suggestions cut friction, demonstrate paid tier's auto-categorization value, and the work directly feeds paid tier infrastructure — no throwaway code.

**Open dependency:** Yan to share Excel budget template that informs the Free manual-budget UI design.

### Tab 5 — Education 📚

**Identical for all tiers.** All lessons free, all tiers see the same library.

| Element | Free | Essential | Complete |
|---|---|---|---|
| Progress overview | ✅ | ✅ | ✅ |
| Continue where you left off | ✅ | ✅ | ✅ |
| Recommended for you | ✅ Personalized by goal + completion + country | ✅ same | ✅ same |
| Foundations chapter (Ch 1) | ✅ | ✅ | ✅ |
| Building chapter (Ch 2) | ✅ | ✅ | ✅ |
| Advanced chapter (Ch 3) | ✅ | ✅ | ✅ |
| Mortgage Readiness chapter (Ch 4) | 🔒 **Score-gated** at 700 | 🔒 **Score-gated** at 700 | 🔒 **Score-gated** at 700 |

**Strategic rationale:** Every credit education site offers free education (Credit Karma, Borrowell, NerdWallet). Tier-gating it would put iBoost in competition with the free-content world rather than differentiating against it. The paid moat is bureau reporting + AI guidance + dispute help, not lessons. Existing `pricing.html` already promises "Complete education library" to all three tiers — keep that promise.

**Note:** Chapter 4's lock is **score-based**, not tier-based. A Free user who somehow reaches a 700 score sees it; a Complete user at 650 doesn't. Different gating axis.

### Tab 6 — Profile 👤

**Identical for all tiers.** All sections work for everyone. The upgrade flow lives here.

| Element | Free | Essential | Complete |
|---|---|---|---|
| Identity hero (avatar / name / email / member-since) | ✅ | ✅ | ✅ |
| Personal info card (read-only) | ✅ | ✅ | ✅ |
| Credit goal (editable inline) | ✅ | ✅ | ✅ |
| Plan & billing card | ✅ Shows Free + "Upgrade" CTA | ✅ Shows Essential + "Change plan" CTA | ✅ Shows Complete + "Change plan" CTA |
| Plan history | ✅ | ✅ | ✅ |
| Payment method (currently hidden) | n/a until Stripe | unhide when Stripe integrated | unhide when Stripe integrated |
| Invoice history (currently hidden) | n/a until Stripe | unhide when Stripe integrated | unhide when Stripe integrated |
| Notifications preferences (currently hidden) | unhide when `user_preferences` table built | same | same |
| Delete account / Danger zone (currently hidden) | unhide when delete-cascade flow built | same | same |

**Strategic rationale:** Profile is account-management utility. Free users need access to all of it — especially the "Change plan" upgrade pathway. The hidden preview-only sections are gated by **feature availability** (Stripe? user_preferences table? cascade flow?) not by **subscription tier**.

## Cross-tier behaviors

A few patterns worth calling out that span multiple tabs:

### Score refresh frequency

Per the existing `plans-loader.js` seed, this is the canonical Essential vs Complete differentiator inside Credit:

- **Essential:** Monthly score refresh (matches monthly bureau reporting)
- **Complete:** Weekly score refresh

Implementation: bureau pulls happen weekly for Complete users, monthly for Essential users, never for Free users.

### AI guidance volume

- **Free:** None
- **Essential:** Monthly tip (1/month, generated by BRAIN's monthly cron)
- **Complete:** Unlimited on-demand via the AI tip card's "Ask another question" CTA (per BRAIN spec — Phase 2+)

The "monthly cron" delivers Essential's tip and Complete's primary tip. The on-demand path is Complete-only.

### Dispute assistance (Credit tab)

- **Free / Essential:** No dispute assistance
- **Complete:** "Dispute assistance for report errors" per pricing seed. This is a meaningful Complete-only feature that hasn't been built yet — needs its own card on the Credit tab when implemented.

### Reporting credit limit ($750 / $2,000)

This is a Stripe + bureau-integration-dependent feature, not a UI gating decision. Captured here for completeness:

- **Free:** No reporting at all
- **Essential:** $750 reported credit line
- **Complete:** $2,000 reported credit line

The dollar amount is what gets reported to bureaus as the user's iBoost line of credit. Affects how the user shows up in their credit file. Real-world Stripe + bureau-integration work.

## Implementation plan

### Phase 1 — Permissions module (today / next session)

Build `public/assets/js/lib/permissions.js`. Same shape as `lib/locale.js`:

```javascript
const FEATURE_GATES = {
  // Welcome
  'welcome.tab': { minTier: 'free' },
  'welcome.adaptive_milestones': { minTier: 'free' }, // adaptive content

  // Credit (locked at panel level today; per-card gates pre-defined for future)
  'credit.tab': { minTier: 'free', mode: 'visible-locked' },
  'credit.panel_unlock': { minTier: 'essential' },
  'credit.score_gauge': { minTier: 'essential' },
  'credit.score_graph': { minTier: 'essential' },
  'credit.ai_tip': { minTier: 'essential' },
  'credit.action_items': { minTier: 'essential' },
  'credit.progress': { minTier: 'essential' },
  'credit.utilization': { minTier: 'essential' },
  'credit.recent_activity': { minTier: 'essential' },
  'credit.dispute_assistance': { minTier: 'complete' },

  // Offers
  'offers.tab': { minTier: 'free' },
  'offers.score_match_card': { minTier: 'essential' },
  'offers.full_catalog': { minTier: 'essential' },

  // Budget
  'budget.tab': { minTier: 'free' },
  'budget.flinks_connection': { minTier: 'essential' },
  'budget.smart_suggestions': { minTier: 'free', maxTier: 'free' }, // Free-only (paid is auto)

  // Education — all free
  'education.tab': { minTier: 'free' },
  'education.chapter_mortgage': { scoreGate: 700 }, // not tier-based

  // Profile — all free
  'profile.tab': { minTier: 'free' },
  'profile.upgrade_cta': { minTier: 'free' }, // shown more prominently to Free
};

window.iboostPermissions = {
  canAccess(featureKey, profile) { ... },
  // Returns: 'allowed' | 'locked-visible' | 'hidden'
};
```

The `mode` field handles the visible-locked-vs-hidden distinction: `'visible-locked'` shows the UI with an overlay; default mode hides the element entirely.

### Phase 2 — Lock overlay component

Single reusable component that works at any container size (panel-sized today, card-sized for future per-card mode):

```html
<div class="iboost-lock-overlay" data-recommended-tier="essential">
  <h3>Unlock with iBoost Essential</h3>
  <p>Real bureau reporting. Monthly score updates. Personalized AI guidance.</p>
  <a href="/checkout.html?plan=essential" class="btn btn-primary">Upgrade to Essential</a>
</div>
```

`data-recommended-tier` attribute lets per-feature recommendations differ — e.g., dispute-assistance overlay would set `data-recommended-tier="complete"`.

### Phase 3 — Wire into account.html

Add `data-feature="..."` attributes to every gated element. account.js applies the permissions module on render: each element gets allowed / locked-visible / hidden treatment based on the user's profile.plan.

### Phase 4 — Adaptive content

For tabs where content differs (Welcome milestones, Offers curation, Budget version, Recommended education) — adaptive logic dispatches to the right rendering function based on tier. Not gating, just content selection.

### Phase 5 — Pricing.html copy update

Update Free tier perks in `pricing.html` to mention "Curated starter offers" — currently unmentioned.

## Open follow-ups

| Item | Blocked by | Notes |
|---|---|---|
| Free-tier manual budget UI | Yan's Excel template | Will inform card layout, field set, default categories |
| Stripe-dependent Profile sections | Stripe integration | Payment method, Invoice history — unhide post-Stripe |
| Notifications preferences | `user_preferences` table | Schema decision needed |
| Delete account flow | Cascade design decision | What gets deleted vs anonymized? PIPEDA implications |
| Smart category suggestions list | Curation work | ~100-200 merchants, Canadian + US |
| Score-matched Offers content | Bureau integration + offer-data model | Real personalization needs real score data |
| BRAIN-powered Today's Focus | BRAIN Phase 2 | Currently generic content |

---

*Last updated: 2026-04-27. Update when tier promises in `pricing.html` or `plans-loader.js` change.*
