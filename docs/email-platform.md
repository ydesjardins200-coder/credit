# iBoost Email Platform (Customer.io) — Architecture & Build Plan

> **Status:** Spec / pre-build (roadmap **Phase 3** — gated on real domain + Phases 1 & 2)
> **Owner:** Yan Desjardins
> **Last updated:** June 2, 2026
> **Source:** Captured from working session with Claude on June 2, 2026
> **Related:** [`docs/partner-platform.md`](./partner-platform.md), [`docs/credit-bureau-integration.md`](./credit-bureau-integration.md), [`docs/budget-app-vision.md`](./budget-app-vision.md), [`docs/LAUNCH_CHECKLIST.md`](./LAUNCH_CHECKLIST.md)

---

## North Star

iBoost sends **zero email today.** This spec captures the full future email surface and the platform that will run it: **Customer.io** (iBoost has been accepted into the Customer.io startup program).

Customer.io is the intended engine for **both** transactional and marketing/lifecycle email — it does event-triggered API sends, broadcast campaigns, and behavioral journeys. It is also the likely path for the inbound **catch-all → support case** feature.

This is **Phase 3** of the build roadmap (see `docs/README.md` → Build roadmap). It comes last on purpose — see Sequencing.

---

## Why email is built LAST (and why that's correct)

Email is deliberately the last of the three major initiatives, because **most of its triggers don't exist until the earlier phases ship:**

- **Banking alerts** need Flinks (Phase 1).
- **Credit bureau report** emails need Equifax reading/reporting (Phase 1).
- **Partner-lead outreach** needs the partner platform + its lead/attribution events (Phase 2).

Building the email engine first would mean wiring up triggers that fire on events that don't yet exist. Building it last means every event Customer.io needs to react to is already live. "Email last" is not deferring it — it's the only order where email has everything to talk to.

---

## Why NOT bind Customer.io now: the temporary-domain blocker

iBoost is on a **temporary domain** (`iboostcredit.netlify.app`). Binding Customer.io now would be wasted work at best, harmful at worst:

- **Email deliverability is built on domain reputation, and reputation does not transfer.** Authenticating sending (SPF/DKIM/DMARC) against the Netlify subdomain — a domain whose apex you don't control and won't keep — means starting reputation from scratch again after the move.
- Sending real email from a `netlify.app` subdomain tends to land in spam (the subdomain already trips Safe Browsing per the bureau/launch notes), which can **actively damage sender reputation before launch.**

**Correct sequence:** secure the real domain → set up Customer.io domain authentication (DKIM + DMARC, dedicated sending subdomain e.g. `mail.iboost.ca`) on it → warm the domain → then send. The startup-program credits are banked, so there is no cost to waiting.

> **Hard prerequisite:** no production email sends until the real domain is secured and authenticated. Target domain is **not yet chosen.**

---

## The two categories — transactional vs. marketing

The future email list splits into two categories with **different deliverability rules and different consent law.** This split is the key design decision.

### Transactional (service messages — the customer expects them, tied to account activity)
| Email | Trigger | Notes |
|---|---|---|
| **Welcome / verify** | Signup | Borderline-transactional; the first message. |
| **Invoices** | Stripe `invoice.payment_succeeded` | Often expected by customers; see near-term flag. |
| **Payment-failed notice** | Stripe `invoice.payment_failed` | iBoost already tracks `profiles.subscription_status` + `payment_failed_at`. |
| **Case-update notifications** | Support reply / resolve on a `support_cases` thread | Today the CS loop has no email — the customer must come back to see a reply. See near-term flag. |
| **Banking alerts** | Flinks-derived events (Phase 1) | e.g. low balance, unusual spend. |
| **Credit bureau report ready** | Equifax pull/report delivered (Phase 1) | "Your monthly report is ready." |
| **Password reset** | User request | Standard auth flow. |

### Marketing / lifecycle (promotional — require express consent under CASL)
| Email | Trigger | Notes |
|---|---|---|
| **Onboarding series** | Post-signup drip | First "welcome" is transactional; the multi-step nurture is marketing. |
| **Offers to enhance credit** | Campaign / behavioral | Promotional (affiliate offers, upsells) — full CASL consent territory. |
| **Partner-lead outreach** | Lead ingested (Phase 2) | "You were referred by [partner]…" — commercial; see `partner-platform.md`. |

**Customer.io handles both.** Open architectural question: keep **transactional on a separate, dedicated sending path/subdomain** to protect deliverability (so a marketing reputation issue can never delay an invoice or password reset), or run everything through one Customer.io setup. Decide at bind time. Recommended: separate subdomains for transactional vs. marketing under the same authenticated apex.

---

## CASL / consent flag (Canada-first — stricter than CAN-SPAM)

Because iBoost is **Canada-primary**, CASL governs commercial email and is stricter than the US CAN-SPAM:

- **Express consent** is required for commercial messages (the "offers" emails, the marketing onboarding/nurture, and the partner-lead outreach). Needs a tracked consent mechanism — e.g. a checkbox at signup, recorded against the profile, with timestamp/source.
- **Transactional messages** (invoices, case updates, bureau-report ready, password reset) are generally permitted as service messages.
- Every commercial message needs sender identification + a working unsubscribe.

This connects to the **partner-platform compliance gate** — lead-outreach emails are commercial and the consent-to-contact must be covered in the partner data agreement. **For Yan's CROA / PIPEDA / CASL legal review** — not a code decision.

---

## Catch-all inbox → support case (a clean reuse)

A catch-all address (e.g. `support@iboost.ca`) that **creates a support case the same way the contact form does.** The pattern already exists and is proven (the contact form's anonymous-case + silent-email-matching against `profiles`).

**Flow:** inbound email → inbound-parse webhook → an `/api/support/contact`-style handler → `support_cases` with `source='email'` (a new source value alongside `app` and `contact_form`). Silent-match the sender's email to an account (member case) or leave anonymous (with contact details) — identical to the contact-form logic.

**Open decision:** which inbound-parse provider — Customer.io if it supports inbound parse cleanly, or a dedicated transactional/inbound service (e.g. Postmark/SendGrid inbound). Low-effort to add once email infra exists; it's another `source` on the model already built.

---

## Near-term flag: two transactional emails may want to exist before Phase 3

Although the full Customer.io build is Phase 3 (post-Flinks/Equifax/partner), **two transactional emails arguably matter at/near launch:**

- **Invoices by email** — commonly expected; a customer with no emailed receipt has a rougher experience.
- **Case-update notifications** — today the CS loop is silent; a customer who gets a support reply has no way to know without returning to the site.

These don't reorder the roadmap, but they may justify a **minimal transactional email path early** (even via a simple sender), with the *full* Customer.io setup remaining the Phase-3 effort. **Yan's call** whether to pull these two forward when the time comes. Both still require the real domain to send well.

---

## Build phases (when Phase 3 arrives)

Prerequisites: real domain secured + authenticated; Phases 1 (Flinks/Equifax) and 2 (partner platform) live so triggers exist.

1. **Domain auth + warm-up.** DKIM/DMARC on the real domain, dedicated sending subdomain(s), reputation warm-up.
2. **Customer.io integration.** Connect iBoost backend events → Customer.io (identify users, track events). Decide transactional-vs-marketing path split.
3. **Transactional emails.** Invoices, payment-failed, case updates, bureau-report-ready, banking alerts, welcome/verify, password reset. (Invoices + case updates may already exist from the near-term path — migrate or keep.)
4. **Marketing / lifecycle.** Onboarding nurture, offers campaigns — gated on the CASL consent mechanism being live.
5. **Partner-lead outreach.** The partner-platform's CROA-compliant outreach campaigns (see `partner-platform.md` Phase 3). Gated on partner compliance clearance.
6. **Catch-all → case.** Inbound parse → `support_cases` with `source='email'`.

---

## Open questions / decisions deferred

| Question | Status | Notes |
|---|---|---|
| Target real domain | **Not chosen** | Hard prerequisite for everything here. |
| Transactional on a separate sending path? | **Decide at bind** | Recommended: separate subdomains under one authenticated apex. |
| Inbound-parse provider for catch-all | **Open** | Customer.io if clean, else Postmark/SendGrid inbound. |
| Pull invoices + case-update emails forward to near-term? | **Yan's call** | Two transactional emails that smell launch-relevant. |
| CASL consent mechanism design | **Pending legal** | Checkbox at signup + tracked consent; covers offers, marketing onboarding, partner outreach. |
| Onboarding = transactional or marketing? | **Split** | First welcome transactional; nurture series marketing (needs consent). |

---

## TL;DR for a future session

- **Customer.io** is the chosen email platform (startup program accepted). iBoost sends **zero email today.**
- **Not bound yet — deliberately — because of the temporary domain.** Reputation doesn't transfer; authenticate on the real domain first, then warm, then send.
- Future email splits into **transactional** (invoices, case updates, banking alerts, bureau-report-ready, payment-failed, welcome, password reset) and **marketing** (onboarding nurture, offers, partner outreach). Customer.io does both; consider separate sending paths.
- **CASL** (Canada-first) requires express consent for the commercial ones — tracked consent mechanism; part of legal review.
- **Catch-all → support case** reuses the contact-form/CS model as a new `source='email'`.
- **Roadmap Phase 3** — built LAST, after Flinks + Equifax (Phase 1) and the partner platform (Phase 2), because most email triggers don't exist until those ship.
- **Near-term exception:** invoices + case-update emails may be pulled forward to launch (Yan's call).
