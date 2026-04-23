# iBoost Pre-Launch Checklist

This file tracks everything that needs to be done, verified, or replaced
before the public launch. Items are grouped by category; each one is a
line item that must be either **checked** (done) or **explicitly deferred**
with a note before launch day.

Last updated: 2026-04-23

---

## Assets to replace / source properly

- [x] **Hero background image** — DONE. Replaced the unlicensed wallpaper-site
      image with an AI-generated original at `public/assets/img/brand/hero-city.jpg`.
      Palette locked to brand (emerald + cyan + navy, no neon pink/orange).
      Composition matches our standardized hero system: bottom-weighted skyline,
      top negative space for H1, center cluster aligned with CSS emerald halo
      at 50%/75%. 960x540, 37 KB — consistent with sibling hero images
      (pricing/how-it-works/faq/about).

- [ ] **OG images / social share cards** — currently using the shield logo
      as OG image. Before launch, produce a proper social-sharing card
      (1200×630px) that shows iBoost branding + tagline.

- [ ] **Favicon suite** — confirmed favicon.ico + shield-32/192/512 are
      correct sizes and resolve crisply on retina displays.

- [x] **Dark-mode logo variants** — DONE. The site header swaps between
      two SVG logos depending on background:
        - `public/assets/img/brand/logo-horizontal-light.svg` (navy wordmark)
        - `public/assets/img/brand/logo-horizontal-dark.svg` (white wordmark)
      Both share the same shield path as the hero orb for brand consistency.
      If a bitmap version is ever needed (emails, OG images, favicons
      that need raster), export from the SVG at the target size.

---

## Legal pages

- [ ] **Privacy Policy** — `/privacy.html` is a placeholder with noindex.
      Replace with lawyer-reviewed content before launch.
- [ ] **Terms of Service** — `/terms.html` is a placeholder with noindex.
      Replace with lawyer-reviewed content before launch.
- [ ] **Disclosures** — `/disclosures.html` is a placeholder with noindex.
      Replace with lawyer-reviewed content covering:
        - Illustrative-projection disclaimer for the scorecard animation
        - "Not a lender, credit repair org, or financial advisor" language
        - Per-footnote legal language (1: +92 pts projection basis,
          2: star rating target, 3: billing terms, 4: reported credit line)

- [ ] **Footer "Coming soon" pages** — the footer Company column links
      to 4 pages marked "Soon" that don't exist yet:
        - `/about.html` — About us (founder story, mission, why-now)
        - `/contact.html` — Contact form + email + hours + optional phone
        - `/careers.html` — Job listings (or "we'll be hiring" landing)
        - `/press.html` — Press kit (logos, screenshots, fact sheet)
      Create these before launch, or decide which to keep as "Soon"
      badges and remove the rest. The `.footer-col-link-soon` CSS
      class shows the "Soon" badge automatically — when a page
      becomes real, just remove that class from the `<a>` tag in
      the footer of all 7 pages (index, how-it-works, pricing, faq,
      privacy, terms, disclosures).

- [ ] **Footer social media URLs** — currently 4 social icons in the
      footer (X/Twitter, Instagram, LinkedIn, Facebook) all have
      `href="#"` as placeholders. Before launch, either:
        - Create the accounts and replace with real URLs, OR
        - Remove the icons of accounts you don't plan to maintain.
      Better to have 1 active social than 4 dead links.

- [ ] **Footer support hours** — the footer shows "Mon–Fri, 9 am – 5 pm ET"
      as support hours. These are placeholder — either:
        - Staff a real support window that matches those hours, OR
        - Update to your actual hours before launch, OR
        - Remove the hours line entirely (`.footer-col-hours`).

- [ ] **Future `/budget.html` page** — the homepage originally had a
      "Budget app that actually helps" feature with a showcase of a
      transaction feed. That section was removed from the homepage on
      2026-04-22 because it wasn't tight enough to the core credit
      pitch, but the CSS was preserved at
      `public/assets/css/budget-showcase.css` (198 lines, includes
      `.budget-showcase`, `.budget-tx-*`, `.budget-progress-*`). When
      creating a dedicated `/budget.html` page, load this file via
      `<link rel="stylesheet" href="/assets/css/budget-showcase.css" />`
      and copy the HTML structure back from the git history (before
      commit that replaced feature 2 with the bureau dashboard).
- [ ] **Offers tab — affiliate partnerships & accuracy**
      The Offers tab currently shows fake bank logos (RBC, TD, BMO, Scotia,
      CIBC, Tangerine, Koho, Borrowell, Fairstone, Square One, Ladder) with
      fake APRs, fees, and min-score requirements. Before this tab can be
      shown to real users:
        - Sign affiliate partnerships with each lender shown (direct or
          via networks like Ratehub, Rakuten, Commission Junction)
        - Replace static card data with feed-driven real-time rates
          (misrepresenting an APR is a federal Truth-in-Lending violation
          in the US and Consumer Protection Act violation in CA)
        - Replace placeholder logos with licensed assets
        - Add jurisdictional filtering (some lenders operate only in
          select provinces/states)
        - Verify min-score thresholds with each lender (incorrect
          thresholds that lead to denials could expose iBoost to
          "false representation" claims)
      Until all of the above is done, the Offers tab must remain behind
      the dev-mode banner or be hidden from production users entirely.
- [ ] **Cookie banner / consent** — evaluate if Quebec Law 25 / GDPR /
      CCPA apply given the CA+US market. If yes, implement a compliant
      banner.

---

## Email aliases

- [ ] `hello@iboost.com` — general inquiries
- [ ] `privacy@iboost.com` — privacy/data requests
- [ ] `legal@iboost.com` — legal/disclosure requests
      All three are linked from the footer. Must be configured in the
      domain MX / forwarding before launch.

---

## Supabase / backend

- [ ] Run `supabase/migrations/0002_profile_metadata.sql` in the Supabase
      SQL editor to enable country persistence on signup.
- [ ] **Email confirmation re-enabled in Supabase** — if disabled during
      pre-launch demos (partner walkthroughs, UX testing), re-enable
      before public launch. Auth > Providers > Email > "Confirm email".
      Required to:
        - Prevent account creation with someone else's email
        - Block spam bots from flooding the DB with fake signups
        - Meet YMYL fintech regulatory expectations (email ownership
          proof is standard in CA and US consumer protection law)
      Expected cost: slightly higher friction in the signup funnel,
      but non-negotiable for a real credit-building service.
- [ ] **Google OAuth consent screen branding** — currently the Google
      sign-in dialog shows `wwsnywzeorisuvolvbjh.supabase.co` as the
      app name, which looks unprofessional. Fix in Google Cloud Console:
        - OAuth consent screen -> App name: "iBoost"
        - Upload 120×120 iBoost logo
        - Set Home page, Privacy policy, and Terms URLs to iboost.com
          (or iboostcredit.netlify.app for pre-launch testing)
        - Add authorized domain
        - For pre-launch demos: add partner/tester emails to Test users
          (avoids waiting for Google verification)
        - Before public launch: submit to Google verification — takes
          2-6 weeks, requires live privacy/terms pages + domain proof
- [ ] Backend Railway deployment (`server/` folder is scaffolded but not
      deployed). Decide if launch requires it or if Netlify Functions +
      Supabase Edge Functions cover the MVP.
- [ ] Password reset flow — `/forgot-password.html` + email template.
- [ ] Facebook OAuth — blocked on Privacy Policy being live + Meta App Review.

---

## Conversion / product

- [ ] Stripe subscriptions wired up (currently no billing integration).
      **Current state:** visual-only mockup exists at `/checkout.html`
      with a clear "Development preview" banner. Users can walk the
      full signup -> checkout -> account flow but no real payment is
      processed. Before launch:
        - Create Stripe account (business info required)
        - Configure 6 prices: Essential USD/CAD, Complete USD/CAD
          (Free tier bypasses Stripe entirely)
        - Deploy Railway backend (currently scaffolded but not deployed)
        - Replace `checkout.js` mock logic with real Stripe.js
          (either Stripe Elements or redirect to Stripe Checkout hosted)
        - Wire webhooks to update Supabase `subscriptions` table
        - Remove the amber `.checkout-dev-banner` from checkout.html
        - Remove the amber `.dash-dev-banner` from account.html
        - Replace all fake dashboard data across ALL 6 tabs:
          - Welcome: streak counter, milestones, onboarding completion
          - Credit: score 678, +14 pts, Visa 4242, bureau scores,
            graph data points, AI tip, action items, activity feed
          - Offers: bank logos & names, APRs, min scores, cash-back
            percentages (ALL offers must come from real affiliate
            feeds before launch to avoid misrepresentation liability)
          - Budget: income, expenses, categories, transactions,
            goals, savings rate
          - Education: lesson titles, durations, progress, curriculum
          - Profile: name, phone, address, DOB, SIN masked, invoice
            history, payment method
          (The only REAL data today is: email + initials + plan pill
          if arriving from checkout ?plan= param)
        - Remove the `#checkout-fill-dummy` button from checkout.html
          and its handler + CSS from checkout.js / main.css
        - Replace the `setTimeout` mock in checkout.js with real
          Stripe.js tokenization + backend call
        - Test the full flow with Stripe test cards (4242 4242 4242 4242)
        - Submit for Stripe account activation review (requires live
          legal pages + business registration)
- [ ] `/account.html` dashboard — currently placeholder.
- [ ] `signup.js` plan preselection — read `?plan=` query param and
      pre-select the plan on the signup form.
- [ ] Hero CTA copy — currently reads "Start for $30 / month" but pricing
      is now three-tier (Free / Essential $15/$20 / Complete $30/$40).
      Decide if the CTA should reflect the new structure or stay as-is
      with the cheapest paid tier pricing.

---

## SEO / meta

- [ ] Sitemap.xml
- [ ] robots.txt — currently defaulting to allow-all. Confirm this is
      what we want once legal pages have real content.
- [ ] Canonical URLs are correct on every page (already done on index.html,
      signup.html, how-it-works.html — verify the rest).
- [ ] French (fr-CA) versions — deferred until product messaging is
      stable. Add hreflang tags when those pages exist.

---

## Design / polish (post-launch iteration is fine, but these are nice)

- [ ] Hero image replaced with licensed or custom asset (see Assets section)
- [ ] Mobile hero hub-and-spokes — verify on real devices, not just
      DevTools emulator
- [ ] Loading states / skeleton screens for Supabase auth flows
- [ ] Error states / empty states across the app

---

## Trust / compliance

- [ ] **Create dedicated `/trust.html` page** — the Trust & Compliance
      section was removed from the homepage on 2026-04-22 (it was
      crowding the homepage). The full content was preserved:
        - HTML template: `docs/trust-section-template.html` (253 lines)
        - CSS stylesheet: `public/assets/css/trust-section.css` (270 lines,
          not loaded anywhere yet)
      All footer links across 7 pages (index, how-it-works, pricing,
      faq, privacy, terms, disclosures) now point to `/trust.html`
      which doesn't exist yet — it will 404 until the page is built.
      Priority: create this page BEFORE the footer goes live with
      links to it (or remove the footer link until then).

- [ ] **Lawyer review of the Trust & Compliance page content** — three
      sections (Laws, Encryption/Infrastructure, Privacy/Incident
      Response) with 9 accordion items total. All are currently
      populated with plausible framing but need legal validation
      before launch.
- [ ] Lawyer review of `/privacy.html`, `/terms.html`, `/disclosures.html`
- [ ] Lawyer review of any marketing claims ("+92 pts in 12 months",
      "reports to all 3 bureaus", etc.) — ensure they match what the
      product actually delivers at launch.

---

## Monitoring / ops

- [ ] **Cache strategy before launch** — `netlify.toml` currently
      disables ALL caching (`Cache-Control: no-store`) across the whole
      site because we were iterating heavily and hard-refresh was
      getting annoying for Yan. Before public launch, replace the
      wholesale `no-cache` headers in `netlify.toml` with per-asset-type
      caching:
        - HTML (`/*.html` or default): short cache (`max-age=0` or
          `must-revalidate`) so new deploys are seen quickly
        - Versioned assets (`/assets/*` if we start using cache-busted
          filenames): long cache (`max-age=31536000, immutable`)
        - Un-versioned assets (current state — plain filenames like
          `/assets/css/main.css`): medium cache (`max-age=3600` or
          similar) OR add cache-busting query strings/hashes during build
        - Images: `max-age=31536000` is fine since they rarely change
      Without this, production will re-download the full CSS/JS bundle
      on every page view, inflating bandwidth and slowing first-contentful
      paint.
- [ ] Error tracking (Sentry, or equivalent)
- [ ] Basic analytics (Plausible, Fathom, or Umami — privacy-friendly
      option given the YMYL context)
- [ ] Uptime monitoring for Netlify + Supabase + (eventually) Railway
- [ ] Domain + SSL — iboost.com (or chosen domain) configured and verified

---

## Later / post-launch

- [ ] Plaid (US) + Flinks (CA) integration for budget feature connections.
      Defer until 200-300 paid users validate the business model.
- [ ] Mobile app (React Native or Capacitor wrapper). Defer until web
      MVP is validated and there is traction.
- [ ] French bilingual support across all pages.
