# iBoost Pre-Launch Checklist

This file tracks everything that needs to be done, verified, or replaced
before the public launch. Items are grouped by category; each one is a
line item that must be either **checked** (done) or **explicitly deferred**
with a note before launch day.

Last updated: 2026-04-21

---

## Assets to replace / source properly

- [ ] **Hero background image** — currently using `public/assets/img/brand/hero-city.jpg`
      which is a stylized urban skyline illustration sourced from a wallpaper
      site (not licensed for commercial use). Must be replaced before launch
      with either:
        - a licensed equivalent (Unsplash / Pexels / paid stock),
        - a commissioned custom illustration in the same style,
        - or a pure-CSS/SVG generative background with no image asset.
      **Owner:** Yan. Similar aesthetic is fine; palette should lean navy +
      emerald (less pink/orange neon than the current placeholder).

- [ ] **Plexus image** — the previous test image at `hero-plexus.jpg` (35KB)
      is still in the repo but no longer referenced. Delete it when the
      final hero image decision is made, or decide if it's a useful fallback.

- [ ] **OG images / social share cards** — currently using the shield logo
      as OG image. Before launch, produce a proper social-sharing card
      (1200×630px) that shows iBoost branding + tagline.

- [ ] **Favicon suite** — confirmed favicon.ico + shield-32/192/512 are
      correct sizes and resolve crisply on retina displays.

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
- [ ] Backend Railway deployment (`server/` folder is scaffolded but not
      deployed). Decide if launch requires it or if Netlify Functions +
      Supabase Edge Functions cover the MVP.
- [ ] Password reset flow — `/forgot-password.html` + email template.
- [ ] Facebook OAuth — blocked on Privacy Policy being live + Meta App Review.

---

## Conversion / product

- [ ] Stripe subscriptions wired up (currently no billing integration).
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

- [ ] Lawyer review of the `#trust` section on the homepage
- [ ] Lawyer review of `/privacy.html`, `/terms.html`, `/disclosures.html`
- [ ] Lawyer review of any marketing claims ("+92 pts in 12 months",
      "reports to all 3 bureaus", etc.) — ensure they match what the
      product actually delivers at launch.

---

## Monitoring / ops

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
