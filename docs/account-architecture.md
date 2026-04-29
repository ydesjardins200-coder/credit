# Account Page Architecture — Refactor Plan

**Status:** Active refactor, started Apr 29, 2026. In progress.
**Owners:** Yan Desjardins
**Related:** `docs/budget-app-vision.md`, `docs/tier-feature-matrix.md`, `docs/brain-architecture.md`

---

## 1. Why this exists

`public/account.html` has grown into a monolithic SPA-like single file that hosts
six distinct tabs: Welcome, Credit, Offers, Budget, Education, Profile. As of
Phase 5o (Apr 28, 2026), the combined size is:

| File                              | Lines  |
| --------------------------------- | ------ |
| `public/account.html`             | 2,470  |
| `public/assets/js/account.js`     | 5,429  |
| `public/assets/css/account.css`   | 5,814  |
| **Total**                         | 13,713 |

This is sustainable today but compounds with every new feature. Concrete pains
already visible:

- **Initial load is heavy.** Every account page render loads JS + CSS for all
  six tabs even though the user opens only one.
- **Cross-tab coupling risk.** A bug in Budget tab JS can crash Profile tab
  rendering. CSS classes added for one tab can leak.
- **Code review wall.** Reviewing a 5,400-line JS file is hard. New
  contributors (future Yan, contractors, hires) face a steep onboarding climb.
- **No URL bookmarking per tab.** The current implementation uses
  `?tab=budget` query params. This works but isn't semantic; users can't
  bookmark "Budget" naturally and links read awkwardly in shared contexts.
- **Deployment surface.** A typo in Welcome tab can break the deploy for the
  whole account experience.

This is normal startup architectural debt. It's also the kind of debt that
gets exponentially harder to pay off as the codebase grows. We're paying it
now while it's still tractable.

## 2. Target architecture

### 2.1 URL structure

We're splitting the single `/account.html` page into per-tab URLs:

```
Current:                     Future:
/account.html?tab=welcome  → /account/welcome  (and /account/ as default)
/account.html?tab=credit   → /account/credit
/account.html?tab=offers   → /account/offers
/account.html?tab=budget   → /account/budget
/account.html?tab=education → /account/education
/account.html?tab=profile  → /account/profile
```

These are **real URLs**, not just hash fragments. Refresh works. Bookmarks
work. Direct links work. Browser back button moves between tabs naturally.

The tab navigation bar becomes regular `<a href>` links across pages instead
of JS-driven tab switches.

### 2.2 Co-mingled with marketing site

The app and the marketing site stay on a single Netlify deploy under
`iboostcredit.netlify.app`. Reasons:

- One repo, one deploy, one domain — simpler ops
- Auth state can be checked uniformly
- Brand cohesion (no jarring transition between marketing and product)

We're NOT splitting to `app.iboostcredit.netlify.app`. If we ever need to
(scale, deploy independence, separate teams) the per-page structure makes it
easy to re-route later.

### 2.3 Folder layout

Target structure:

```
public/
  index.html                      # Marketing home (unchanged)
  about.html, faq.html, ...       # Marketing pages (unchanged)
  login.html, signup.html         # Auth pages (unchanged)

  account/
    index.html                    # Default → redirects to welcome
    welcome.html                  # /account/welcome
    credit.html                   # /account/credit
    offers.html                   # /account/offers
    budget.html                   # /account/budget
    education.html                # /account/education
    profile.html                  # /account/profile

  assets/
    css/
      shared/
        tokens.css                # Design tokens (colors, spacing, fonts)
        layout.css                # Header, footer, page shell
        components.css            # Buttons, cards, modals shared across pages
        forms.css                 # Form styles shared across pages
      account/
        shell.css                 # Account-page header, tab nav, common chrome
        welcome.css               # Welcome-tab-only
        credit.css                # Credit-tab-only
        offers.css                # Offers-tab-only
        budget.css                # Budget-tab-only
        education.css             # Education-tab-only
        profile.css               # Profile-tab-only
      main.css                    # Marketing site (unchanged)
      ...

    js/
      shared/
        supabase-client.js        # Single source of truth for Supabase config
        auth.js                   # Session check, redirect logic
        formatters.js             # formatCents, escapeHtml, date helpers
        dom-helpers.js            # Common DOM utilities
        toast.js                  # Notification component
        modal.js                  # Modal component infrastructure
      account/
        shell.js                  # Header, tab nav highlighting, page-level boot
        welcome.js                # Welcome-tab logic
        credit.js                 # Credit-tab logic
        offers.js                 # Offers-tab logic
        budget.js                 # Budget-tab logic (will be the biggest file)
        education.js              # Education-tab logic
        profile.js                # Profile-tab logic
      lib/                        # Existing — stays for now
        budget.js                 # Stays here; budget data layer (read/write)
        budget-seed.js
        csv-import.js
        csv-presets.js
        locale.js
        merchant-categories.js
        permissions.js
      auth.js                     # Existing auth on auth pages — unchanged
      main.js                     # Marketing site — unchanged
      ...
```

**Naming convention:**
- `shared/` = used across multiple pages (account, marketing, auth)
- `account/` = used across the account experience but not outside it
- `lib/` = internal libraries with their own tests (CSV parser, presets, etc.) — already exists, expanded

### 2.4 Routing

Netlify supports clean URLs natively via `netlify.toml` redirects or via the
file structure itself.

- `public/account/budget.html` → served at `/account/budget` automatically
  (Netlify's pretty URL handling strips `.html`)
- `public/account/index.html` → served at `/account/` and acts as the
  default landing (redirects logged-in users to the right tab, redirects
  logged-out users to /login)

We'll add explicit redirect rules in `netlify.toml` for backward
compatibility with the old URLs:

```toml
[[redirects]]
  from = "/account.html"
  to = "/account/welcome"
  status = 301

[[redirects]]
  from = "/account.html?tab=:tab"
  to = "/account/:tab"
  status = 301
```

This handles users with bookmarks, search-engine indexed links, and our own
internal hardcoded URLs we forgot about.

### 2.5 Data sharing across pages

This is the architectural question that matters most. When a user navigates
from `/account/welcome` to `/account/budget`, what happens?

**Today (monolith):** Tab switch is JS-only. No page reload. The `budgetProfile`
cache, the `currentMonth` state, etc. all live in the same JS context.

**Future (per-page):** Real page navigation. JS context is destroyed and
recreated.

Solutions, in order of complexity:

1. **Re-fetch on every page load.** Simplest. Every page that needs profile
   data fetches it from Supabase. Cost: ~100ms latency per page load.
2. **Cache in `sessionStorage`.** Profile/permissions cached for the session.
   Each page reads from cache, falls back to fetch on miss. Invalidation
   happens on logout or explicit refresh.
3. **Service Worker pre-fetch.** Premature for our scale.

**Decision:** Start with #1, upgrade to #2 if/when latency becomes user-visible.

The exception is auth state — we already handle that via Supabase session,
which is automatically persisted in localStorage by the Supabase client.

### 2.6 What stays in the URL

- The active tab → URL path (`/account/budget`)
- Budget month being viewed → query param (`?month=2026-04`)
- All Entries modal filter (date or category) → URL fragment or query param
  if we want share/bookmark, otherwise component-local state

## 3. Migration order

Refactors fail when too much changes at once. We're doing this in
**discrete, shippable phases** where each phase leaves the app in a working
state. We can stop at any phase boundary without leaving partial work.

### Phase A — Shared utility extraction *(today, low risk)*

Goal: Pull common utilities out of `account.js` into `shared/` modules
**without changing behavior**. The monolith still works exactly as it did;
it just imports its utilities from a shared location.

Steps:
- Create `public/assets/js/shared/` directory
- Extract `formatCents`, `escapeHtml`, date helpers, etc. into
  `shared/formatters.js`
- Extract Supabase client initialization into `shared/supabase-client.js`
  (currently spread across multiple files)
- Update `account.js` to load shared utilities first
- Update other pages (`auth.js`, `signup.js`, etc.) that have duplicated
  utility code to also use the shared modules
- Run full test suite: 272/272 should still pass

Deliverable: a shared/ layer that exists and is in use, with no user-visible
changes.

**This is the only phase being executed today.**

### Phase B — Account page shell extraction *(future session)*

Goal: Extract the header, tab navigation, and page-level boot into a shared
account shell. Each tab's HTML and JS still lives in the monolith for now,
but the shell is reusable.

Steps:
- Create `assets/css/account/shell.css` from the shell-related rules in
  `account.css`
- Create `assets/js/account/shell.js` with the tab navigation logic
- The monolith continues to work but uses these shared shell modules

Deliverable: shell can be reused by future per-tab pages without rebuilding.

### Phase C — Single tab extraction (Profile first) *(future session)*

Goal: Take the SMALLEST tab that's also relatively self-contained, extract
it into its own page, prove the per-page pattern works end-to-end.

Why Profile first?
- Smallest tab by HTML size after Welcome (which is special — it's the
  first-time profile-completion form)
- Self-contained: doesn't pull data from Budget, Credit, etc.
- High-traffic: changes here are easy to test
- Real users can give feedback even mid-refactor since the page renders
  identically

Steps:
- Create `public/account/profile.html` with the Profile tab's HTML
- Create `assets/js/account/profile.js` and `assets/css/account/profile.css`
- Update tab navigation to link to `/account/profile` for the Profile tab
- Other tabs still use the monolith (`account.html?tab=...`) until their
  turn
- Add Netlify redirects for backward compatibility
- Test end-to-end: user logs in, lands on Welcome (still monolith), clicks
  Profile (lands on new page), clicks Budget (returns to monolith)

Deliverable: profile lives at `/account/profile` and works.

### Phase D — Remaining tabs *(several future sessions, one tab per session)*

In recommended order:
1. **Education** (smallest, most static)
2. **Offers** (medium, mostly read-only)
3. **Credit** (paid-tier, can be developed with mock data alongside the
   real Bureau integration work)
4. **Budget** (biggest, most complex, do last when pattern is proven)
5. **Welcome** (special — it's the post-signup form, may need to stay as
   a wizard)

Each tab gets its own session. Each session ships a working app at the end.

### Phase E — Cleanup and decommission *(after Phase D complete)*

- Delete `account.html` (now unused)
- Delete the monolithic sections of `account.js` and `account.css`
- Remove the legacy `?tab=` query param redirects
- Update internal links to use canonical paths
- Final regression sweep

## 4. Risks and mitigations

| Risk | Mitigation |
| ---- | ---------- |
| Cross-page state expectations broken (e.g., user expects toast from previous page to persist) | Audit all toast/notification flows; route through `sessionStorage` if needed |
| Auth session check duplicated and inconsistent across pages | Centralize in `shared/auth.js`; every account page calls the same boot routine |
| CSS specificity bugs from extracting shared rules | Phase A doesn't touch CSS. Phase B does the shell extraction carefully with explicit before/after diffs |
| User has both old monolith AND new page open in different tabs during deploy | Acceptable transient — Supabase auth state is shared via localStorage so they don't desync |
| Search engines index new URLs while old ones still exist | 301 redirects handle this; Google and Bing follow 301s within days |
| New contributor opens repo and is confused about where things live | This document IS the answer; root README links to it |

## 5. Out of scope

Things this refactor explicitly does NOT do:

- **No framework migration.** We're not switching to React, Vue, Svelte,
  or anything else. The whole point of this refactor is to make the plain
  HTML/CSS/JS approach scale better, not to abandon it.
- **No build pipeline.** No webpack, no rollup, no esbuild. Files are
  loaded directly by the browser. If we eventually need bundling, it's
  a separate decision.
- **No design system overhaul.** Tokens get extracted to `shared/tokens.css`
  but the actual values don't change.
- **No server-side rendering.** Pages remain static HTML with JS-driven
  data fetching.
- **No PWA / Service Worker work.** Out of scope.

## 6. Success criteria

This refactor is "done" when:

- [ ] All six account tabs are individual URLs under `/account/*`
- [ ] `account.html` is deleted
- [ ] No JS file in `account/` directory exceeds 1,500 lines
- [ ] No CSS file in `account/` directory exceeds 1,500 lines
- [ ] Shared utilities are in `shared/` and used by 2+ pages
- [ ] Old URLs (`/account.html?tab=...`) redirect to new URLs
- [ ] Test suite still passes (the budget-related suites continue to
      validate the same behavior)
- [ ] No user-visible regression (manual smoke test against a checklist)

## 7. Operational notes

- **Branch strategy:** Each phase merges to `main` after passing tests.
  Phases are small enough that no long-lived feature branches are needed.
- **Deploy strategy:** Each phase deploys to production via the standard
  Netlify auto-deploy. Pre-launch this is fine; post-launch we may want
  to feature-flag riskier phases.
- **Rollback plan:** `git revert` of the phase commit. Because each phase
  leaves the app working, rollback is always to a known-good state.
