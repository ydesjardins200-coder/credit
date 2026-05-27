/* =========================================================================
   checkout.js — Plan picker + real Stripe Checkout redirect (CAD v1)
   =========================================================================
   Powers /checkout.html. Stripe integration (replaces the prior visual
   mockup):

     1. Plan picker with three cards (Free / Essential / Complete). Click
        or keyboard-select a card to activate it. Default selection is
        Complete; ?plan=<key> URL override is honored.
     2. CAD-ONLY for v1. The US launch is undecided, so the currency
        toggle is hidden (see checkout.html) and all pricing/billing is
        CAD. When USD launches: unhide the toggle, add USD price IDs to
        the backend, and restore the currency branch here.
     3. Submit:
        - Free: no payment. Writes plan to the profile directly (as
          before) and redirects to /account.html?signup=success&plan=free.
        - Paid: calls the backend POST /api/checkout/create-session with
          the user's bearer token, receives a Stripe-hosted Checkout URL,
          and redirects the browser to it. Card data is collected ON
          STRIPE'S PAGE — never here. The plan is granted by the backend
          webhook (checkout.session.completed), not by the redirect back.

   Backend base URL comes from window.IBOOST_CONFIG.API_BASE_URL (generated
   at Netlify build time from the API_BASE_URL env var).
   ========================================================================= */

(function () {
  'use strict';

  var planMap = null;

  function adaptPlan(row) {
    if (!row) return null;
    var includes = (row.perks || [])
      .slice(0, 5)
      .map(function (p) {
        if (p.muted) return { text: p.text, muted: true };
        if (p.emphasized) return '<strong>' + escapeHtml(p.text) + '</strong>';
        return p.text;
      });
    return {
      name: row.name,
      amountCad: row.price_cad,
      isFree: row.price_cad === 0,
      includes: includes,
    };
  }

  function escapeHtml(s) {
    return window.iboostShared.escapeHtml(s);
  }

  function syncPlanRowPrices() {
    if (!planMap) return;
    ['free', 'essential', 'complete'].forEach(function (key) {
      var row = document.querySelector('.plan-row[data-plan="' + key + '"]');
      var plan = planMap[key];
      if (!row || !plan) return;

      var nameEl = row.querySelector('.plan-row-name');
      if (nameEl) nameEl.textContent = plan.name;

      var amountCad = row.querySelector('.plan-row-amount[data-currency="cad"]');
      if (amountCad) {
        amountCad.textContent = '$' + plan.amountCad;
      } else {
        var amountAny = row.querySelector('.plan-row-amount');
        if (amountAny) {
          amountAny.textContent = plan.amountCad === 0 ? '$0' : ('$' + plan.amountCad);
        }
      }
    });
  }

  var state = {
    planKey: 'complete',
    // Active payment processor: 'stripe' (real billing), 'manual' (dev
    // mode — writes profile directly, no Stripe), or null while
    // resolving / on unknown providers. The submit handler still works
    // for stripe AND manual; only unknown values disable paid checkout.
    paymentProvider: null,
  };

  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function getParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  function formatMoney(amount) {
    return '$' + amount + '.00 CAD';
  }

  function apiBase() {
    var cfg = window.IBOOST_CONFIG || {};
    return (cfg.API_BASE_URL || '').replace(/\/$/, '');
  }

  // Fetch the active provider per integrations category from the backend.
  // Public endpoint, no auth. Failure-mode: returns null so we degrade
  // gracefully — paid checkout will still attempt, the backend's
  // requireProvider middleware is the real authority.
  async function fetchAvailability() {
    try {
      var base = apiBase();
      if (!base) return null;
      var resp = await fetch(base + '/api/integrations/availability', {
        method: 'GET',
        headers: { accept: 'application/json' },
      });
      if (!resp.ok) return null;
      return await resp.json();
    } catch (e) {
      return null;
    }
  }

  // Apply the current paymentProvider state to the UI:
  //   - 'stripe': normal behavior, no notice.
  //   - 'manual': paid plans selectable, dev-mode notice shown.
  //   - anything else: paid plans disabled, "unavailable" notice shown,
  //     selection forced to free.
  function applyPaymentProvider() {
    var noticeId = 'payment-provider-notice';
    var existing = document.getElementById(noticeId);
    if (existing) existing.remove();

    var paidUnavailable =
      state.paymentProvider !== null &&
      state.paymentProvider !== 'stripe' &&
      state.paymentProvider !== 'manual';

    // Reset paid row state — every render starts from "selectable" and
    // only disables when paidUnavailable is true. This lets a flip
    // back to stripe re-enable rows without a page reload.
    $$('.plan-row[data-plan]').forEach(function (row) {
      var key = row.getAttribute('data-plan');
      if (key !== 'essential' && key !== 'complete') return;
      var radio = row.querySelector('.plan-picker-radio');
      if (paidUnavailable) {
        row.classList.add('is-unavailable');
        row.setAttribute('aria-disabled', 'true');
        if (radio) radio.disabled = true;
      } else {
        row.classList.remove('is-unavailable');
        row.removeAttribute('aria-disabled');
        if (radio) radio.disabled = false;
      }
    });

    if (paidUnavailable) {
      if (state.planKey === 'essential' || state.planKey === 'complete') {
        selectPlan('free');
      }
    }

    // Notice text per state. Manual notice is dev-only signage so you
    // don't forget the switch is flipped when testing.
    var noticeText = null;
    var noticeClass = 'alert alert-info';
    if (state.paymentProvider === 'manual') {
      noticeText =
        'Dev mode: paid plans are activated instantly without payment. ' +
        'Switch payment_processor to "stripe" in admin to enable real billing.';
    } else if (paidUnavailable) {
      noticeText =
        'Paid subscriptions are temporarily unavailable. ' +
        'You can still activate a Free plan and upgrade later.';
    }

    if (noticeText) {
      var heading = document.querySelector('.checkout-plans-heading');
      if (heading && heading.parentNode) {
        var note = document.createElement('div');
        note.id = noticeId;
        note.className = noticeClass;
        note.style.marginBottom = '12px';
        note.textContent = noticeText;
        heading.parentNode.insertBefore(note, heading.nextSibling);
      }
    }
  }

  (function initPlanFromQuery() {
    var qp = (getParam('plan') || '').toLowerCase();
    if (qp === 'free' || qp === 'essential' || qp === 'complete') {
      state.planKey = qp;
    }
  })();

  var isChangeMode = (getParam('mode') || '') === 'change';
  if (isChangeMode) {
    (function applyChangeModeCopy() {
      var eyebrow = document.getElementById('checkout-hero-eyebrow');
      var title = document.getElementById('checkout-hero-title');
      var lead = document.getElementById('checkout-hero-lead');
      if (eyebrow) eyebrow.textContent = 'Change plan';
      if (title) title.textContent = 'Choose a new plan.';
      if (lead) {
        lead.textContent =
          'Pick a different tier below. Paid plans take you to our secure ' +
          'Stripe checkout to set up billing.';
      }
    })();
  }

  function selectPlan(planKey) {
    if (planKey !== 'free' && planKey !== 'essential' && planKey !== 'complete') return;
    state.planKey = planKey;

    var radio = document.querySelector('.plan-picker-radio[value="' + planKey + '"]');
    if (radio) radio.checked = true;

    $$('.plan-row[data-plan]').forEach(function (row) {
      row.classList.toggle('is-selected', row.getAttribute('data-plan') === planKey);
    });

    renderIncludes();
    updateSummaryAndSubmit();
  }

  function renderIncludes() {
    var list = $('#plan-includes-list');
    if (!list || !planMap) return;
    var plan = planMap[state.planKey];
    var items = (plan && plan.includes) || [];
    var html = '';
    items.forEach(function (item) {
      if (typeof item === 'string') {
        html += '<li>' + item + '</li>';
      } else if (item && item.text) {
        var cls = item.muted ? ' class="plan-includes-item-muted"' : '';
        html += '<li' + cls + '>' + item.text + '</li>';
      }
    });
    list.innerHTML = html;
  }

  function updateSummaryAndSubmit() {
    if (!planMap) return;
    var plan = planMap[state.planKey];
    if (!plan) return;

    var labelEl = $('#checkout-submit-label');
    if (labelEl) {
      if (plan.isFree) {
        labelEl.textContent = 'Activate Free plan';
      } else {
        labelEl.innerHTML =
          'Continue to payment \u2014 <span id="pay-amount">' +
          formatMoney(plan.amountCad) + '</span>';
      }
    }

    var legalEl = $('#checkout-submit-legal');
    if (legalEl) {
      if (plan.isFree) {
        legalEl.textContent =
          'By continuing, you activate your free iBoost account. No card ' +
          'is charged. Upgrade to a paid plan anytime from your dashboard.';
      } else {
        legalEl.textContent =
          'You\u2019ll be taken to our secure Stripe checkout to enter your ' +
          'card. By subscribing you authorize iBoost to charge your card ' +
          'monthly until you cancel. Cancel anytime from your dashboard.';
      }
    }
  }

  function wireSubmit() {
    var submitBtn = $('#checkout-submit');
    var alertEl = $('#checkout-alert');
    if (!submitBtn) return;

    function showAlert(message) {
      if (!alertEl) return;
      alertEl.textContent = message;
      alertEl.hidden = false;
      alertEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    async function handle(e) {
      if (e) e.preventDefault();
      if (alertEl) alertEl.hidden = true;

      if (!planMap) {
        return showAlert('Plans still loading. Please wait a moment.');
      }
      var plan = planMap[state.planKey];
      if (!plan) {
        return showAlert('Please choose a plan.');
      }
      if (!window.iboostAuth) {
        return showAlert('Auth not loaded. Please refresh the page.');
      }

      submitBtn.classList.add('is-processing');
      submitBtn.disabled = true;

      // ---- FREE PLAN: no Stripe. ----
      if (plan.isFree) {
        try {
          var profileF = await window.iboostAuth.getProfile();
          var fromPlanF = (profileF && profileF.plan) || null;
          var upF = await window.iboostAuth.updateProfile({
            plan: 'free',
            planCurrency: 'cad',
          });
          if (upF.error) {
            if (upF.error.code === 'session_zombie') {
              showAlert('Your session is no longer valid. Logging you out\u2026');
              setTimeout(async function () {
                try {
                  if (window.iboostAuth.signOut) await window.iboostAuth.signOut();
                } catch (e) { /* best effort */ }
                window.location.replace('/login.html?reason=session_expired');
              }, 1500);
              return;
            }
            throw new Error(upF.error.message || 'Could not activate free plan.');
          }
          var srcF = fromPlanF ? 'self_change' : 'signup';
          await window.iboostAuth.recordPlanChange(fromPlanF, 'free', srcF);
          setTimeout(function () {
            window.location.href = '/account.html?signup=success&plan=free';
          }, 500);
        } catch (errF) {
          submitBtn.classList.remove('is-processing');
          submitBtn.disabled = false;
          return showAlert(errF.message || 'Something went wrong. Try again.');
        }
        return;
      }

      // ---- PAID PLAN: Stripe Checkout Session via backend. ----
      try {
        var base = apiBase();
        if (!base) {
          throw new Error(
            'Checkout is not configured (missing API URL). Please contact support.'
          );
        }
        var settled = await window.iboostAuth.getSessionSettled();
        var session = settled && settled.session;
        var token = session && session.access_token;
        if (!token) {
          throw new Error('You must be signed in to subscribe. Please log in again.');
        }

        var resp = await fetch(base + '/api/checkout/create-session', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + token,
          },
          body: JSON.stringify({ planKey: state.planKey }),
        });

        var data = null;
        try { data = await resp.json(); } catch (e) { /* non-JSON */ }

        if (!resp.ok) {
          // Special-case: backend says paid checkout is currently
          // disabled (admin flipped payment_processor away from stripe
          // between page load and this click). Surface a user-friendly
          // message AND apply the unavailable UI so the page reflects
          // the new reality.
          if (resp.status === 503 && data && data.reason === 'provider_not_active') {
            state.paymentProvider = (data && data.current_provider) || 'unknown';
            applyPaymentProvider();
            throw new Error(
              'Paid subscriptions are temporarily unavailable. ' +
              'You can activate a Free plan and upgrade later.'
            );
          }
          var msg = (data && data.error) || ('Checkout failed (HTTP ' + resp.status + ').');
          throw new Error(msg);
        }
        if (!data || !data.url) {
          throw new Error('Checkout session did not return a URL. Try again.');
        }

        window.location.href = data.url;
      } catch (err) {
        submitBtn.classList.remove('is-processing');
        submitBtn.disabled = false;
        return showAlert(err.message || 'Something went wrong starting checkout.');
      }
    }

    submitBtn.addEventListener('click', handle);
    var form = $('#checkout-form');
    if (form) form.addEventListener('submit', handle);
  }

  async function prefillEmail() {
    try {
      if (!window.iboostAuth) return;
      var res = await window.iboostAuth.getSessionSettled();
      var session = res && res.session;
      if (session && session.user && session.user.email) {
        var emailEl = $('#checkout-email');
        if (emailEl) emailEl.value = session.user.email;
      }
    } catch (e) { /* non-fatal */ }
  }

  async function init() {
    $$('.plan-picker-radio').forEach(function (radio) {
      radio.addEventListener('change', function () {
        if (radio.checked) selectPlan(radio.value);
      });
    });

    wireSubmit();
    prefillEmail();

    var rawPlans = [];
    var availabilityResp = null;
    try {
      // Run plans + availability in parallel; both are independent reads.
      var results = await Promise.all([
        window.iboostPlans ? window.iboostPlans.getPlans({ fresh: true }) : Promise.resolve([]),
        fetchAvailability(),
      ]);
      rawPlans = results[0] || [];
      availabilityResp = results[1];
    } catch (e) {
      console.warn('[checkout] plans/availability fetch failed:', e);
    }

    planMap = {};
    rawPlans.forEach(function (row) {
      planMap[row.plan_key] = adaptPlan(row);
    });

    // Resolve active payment provider from the availability response.
    // If we couldn't read it, leave as null (paid plans render normally;
    // backend is the real gatekeeper and will return an error on submit
    // if something's truly off).
    if (availabilityResp && availabilityResp.providers) {
      state.paymentProvider =
        availabilityResp.providers.payment_processor || null;
    }

    syncPlanRowPrices();
    selectPlan(state.planKey);
    applyPaymentProvider();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
