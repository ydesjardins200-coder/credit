/* =========================================================================
   checkout.js — Plan picker + visual-only payment mockup
   =========================================================================
   Powers /checkout.html. Phase 2 rewrite:

     1. Plan picker with three cards (Free / Essential / Complete). Click
        or keyboard-select a card to activate it. Default selection is
        Complete; ?plan=<key> URL override is honored.
     2. Currency toggle (USD / CAD). Persists to localStorage so the
        choice survives across the pricing page and checkout.
     3. Payment fields collapse when Free is selected; the submit button
        label + legal copy swap to match. Paid plans show the card form.
     4. Submit:
        - Free: no card validation, redirect to
          /account.html?signup=success&plan=free
        - Paid: show spinner ~1.8s then redirect with
          /account.html?signup=success&plan=<essential|complete>
     5. No real Stripe integration. Validation is shape-only (is there
        some content in each required field) — client-side niceties only.

   When Stripe integration happens later, the paid-plan submit branch is
   the hook: replace the setTimeout with a real Stripe.js confirmCardPayment
   (or whatever API we use). The picker + currency logic doesn't need to
   change.
   ========================================================================= */

(function () {
  'use strict';

  // -------- Plan catalog --------
  // Kept in sync with /pricing.html. If pricing changes, update both.
  // 'includes' is trimmed to the top ~5 bullets so it fits the narrow
  // left column without scrolling.
  var PLANS = {
    free: {
      name: 'Free',
      amountUsd: 0,
      amountCad: 0,
      isFree: true,
      includes: [
        'Full budget app (manual entry)',
        'Complete education library',
        'Monthly credit tips newsletter',
        { text: 'No bureau reporting', muted: true },
        { text: 'No AI guidance', muted: true }
      ]
    },
    essential: {
      name: 'iBoost Essential',
      amountUsd: 15,
      amountCad: 20,
      isFree: false,
      includes: [
        '$750 reported credit line',
        'Monthly reporting to all major bureaus',
        'Monthly score refresh',
        'Monthly AI credit tip',
        'Complete education library'
      ]
    },
    complete: {
      name: 'iBoost Complete',
      amountUsd: 30,
      amountCad: 40,
      isFree: false,
      includes: [
        '<strong>$2,000 reported credit line</strong>',
        '<strong>Weekly</strong> score refresh',
        '<strong>Unlimited on-demand AI advice</strong>',
        '<strong>Dispute assistance for report errors</strong>',
        '<strong>Priority support, 7 days a week</strong>'
      ]
    }
  };

  // -------- State --------
  // Defaults: Complete plan, USD currency (or whatever localStorage says).
  // Overridable at load time by ?plan= in the URL.
  var state = {
    planKey: 'complete',
    currency: 'usd'
  };

  // -------- Utilities --------
  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  function getParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  function formatMoney(amount, currency) {
    // Simple formatter — whole-dollar amounts only (our plans have no
    // cents). Prepend $ and append '.00' so the UI feels like a real
    // checkout receipt.
    var code = currency === 'cad' ? 'CAD' : 'USD';
    return '$' + amount + '.00 ' + code;
  }

  // -------- Initial state setup --------
  // Pre-select a plan card from ?plan= (falls back to state default).
  (function initPlanFromQuery() {
    var qp = (getParam('plan') || '').toLowerCase();
    if (PLANS[qp]) state.planKey = qp;
  })();

  // mode=change: user arrived from /account.html's "Change plan" button.
  // Swap the hero copy so it reads as a plan change rather than new
  // signup. The submit-handler source detection (signup vs self_change)
  // is based on profile.plan existence, independent of this flag, so
  // this is a pure UX rewording.
  var isChangeMode = (getParam('mode') || '') === 'change';
  if (isChangeMode) {
    (function applyChangeModeCopy() {
      var eyebrow = document.getElementById('checkout-hero-eyebrow');
      var title   = document.getElementById('checkout-hero-title');
      var lead    = document.getElementById('checkout-hero-lead');
      if (eyebrow) eyebrow.textContent = 'Change plan';
      if (title)   title.textContent = 'Choose a new plan.';
      if (lead) {
        lead.textContent =
          'Pick a different tier below. Your change takes effect ' +
          'immediately (no proration — we\u2019ll add real billing later).';
      }
    })();
  }

  // Pull currency preference from localStorage (set by /pricing.html's
  // landing.js when the user toggles there).
  try {
    var saved = localStorage.getItem('iboost.currency');
    if (saved === 'cad') state.currency = 'cad';
  } catch (e) { /* storage disabled — default USD */ }

  // -------- Plan selection --------
  // Mark the right <input type="radio"> as checked and sync UI.
  function selectPlan(planKey) {
    if (!PLANS[planKey]) return;
    state.planKey = planKey;

    // Sync the radio (might already be checked if this came from a click).
    var radio = document.querySelector('.plan-picker-radio[value="' + planKey + '"]');
    if (radio) radio.checked = true;

    // Visual: add .is-selected to the chosen row, remove from others.
    $$('.plan-row[data-plan]').forEach(function (row) {
      if (row.getAttribute('data-plan') === planKey) {
        row.classList.add('is-selected');
      } else {
        row.classList.remove('is-selected');
      }
    });

    renderIncludes();
    updateSummaryAndSubmit();
    updatePaymentFieldsVisibility();
  }

  // -------- What's-included list --------
  // Renders the selected plan's feature bullets into the left column.
  // Each entry is either a string or { text, muted } — muted items get
  // a line-through-ish "not included" visual treatment.
  function renderIncludes() {
    var list = $('#plan-includes-list');
    if (!list) return;
    var plan = PLANS[state.planKey];
    var items = (plan && plan.includes) || [];

    // Build HTML string rather than DOM nodes — simpler, and the list
    // re-renders often enough that perf doesn't matter.
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

  // -------- Summary + submit label --------
  function updateSummaryAndSubmit() {
    var plan = PLANS[state.planKey];
    var amount = state.currency === 'cad' ? plan.amountCad : plan.amountUsd;

    // Plan name in summary
    var planNameEl = $('#summary-plan-name');
    if (planNameEl) planNameEl.textContent = plan.name;

    // Billed today
    var billedEl = $('#billed-today-amount');
    if (billedEl) {
      billedEl.textContent = plan.isFree ? 'Free' : formatMoney(amount, state.currency);
    }

    // Renews row: hide for Free (nothing renews)
    var renewsRow = $('#summary-renews-row');
    if (renewsRow) renewsRow.hidden = plan.isFree;

    // Submit button label
    var labelEl = $('#checkout-submit-label');
    if (labelEl) {
      if (plan.isFree) {
        labelEl.textContent = 'Activate Free plan';
      } else {
        labelEl.innerHTML =
          'Pay <span id="pay-amount">' + formatMoney(amount, state.currency) + '</span>';
      }
    }

    // Legal copy
    var legalEl = $('#checkout-submit-legal');
    if (legalEl) {
      if (plan.isFree) {
        legalEl.textContent =
          'By continuing, you activate your free iBoost account. No card ' +
          'is charged. Upgrade to a paid plan anytime from your dashboard.';
      } else {
        legalEl.textContent =
          'By confirming your subscription, you authorize iBoost to charge ' +
          'your card monthly until you cancel. Cancel anytime from your ' +
          'account dashboard.';
      }
    }

    // Stripe-secured badge: hide for Free
    var poweredByEl = $('#checkout-powered-by');
    if (poweredByEl) poweredByEl.style.display = plan.isFree ? 'none' : '';
  }

  // -------- Payment fields visibility --------
  // Collapse the card-form block when Free is chosen. We toggle a body
  // class rather than directly hiding the element so CSS transitions
  // can style the collapse however it wants.
  function updatePaymentFieldsVisibility() {
    var plan = PLANS[state.planKey];
    if (plan.isFree) {
      document.body.classList.add('is-free-selected');
    } else {
      document.body.classList.remove('is-free-selected');
    }
  }

  // -------- Currency toggle --------
  function setCurrency(newCurrency) {
    if (newCurrency !== 'usd' && newCurrency !== 'cad') return;
    state.currency = newCurrency;

    // Persist the choice so /pricing.html picks it up on the next visit
    try { localStorage.setItem('iboost.currency', newCurrency); } catch (e) { /* ok */ }

    // Sync the toggle buttons' state. Set both aria-pressed (for a11y)
    // AND toggle .active class (matches landing.js's pattern on the
    // pricing page, and activates the .active CSS hook).
    $$('.currency-toggle button[data-currency-toggle]').forEach(function (btn) {
      var match = btn.getAttribute('data-currency-toggle') === newCurrency;
      btn.setAttribute('aria-pressed', match ? 'true' : 'false');
      btn.classList.toggle('active', match);
    });

    // Swap visible price/currency spans on the cards
    $$('[data-currency]').forEach(function (el) {
      el.hidden = el.getAttribute('data-currency') !== newCurrency;
    });

    updateSummaryAndSubmit();
  }

  // -------- Input formatters (card/expiry) --------
  // Card number: digits only, space every 4. Max 16 digits => 19 chars
  // including spaces. Matches the maxlength on the input.
  function formatCardNumber(raw) {
    var digits = raw.replace(/\D/g, '').slice(0, 16);
    var parts = [];
    for (var i = 0; i < digits.length; i += 4) {
      parts.push(digits.slice(i, i + 4));
    }
    return parts.join(' ');
  }

  // Expiry: MM / YY (2 digits, slash, 2 digits). Auto-insert the slash
  // after the first 2 digits.
  function formatExpiry(raw) {
    var digits = raw.replace(/\D/g, '').slice(0, 4);
    if (digits.length <= 2) return digits;
    return digits.slice(0, 2) + ' / ' + digits.slice(2);
  }

  function wireInputFormatters() {
    var cardInput = $('#checkout-card-number');
    if (cardInput) {
      cardInput.addEventListener('input', function (e) {
        e.target.value = formatCardNumber(e.target.value);
      });
    }
    var expiryInput = $('#checkout-expiry');
    if (expiryInput) {
      expiryInput.addEventListener('input', function (e) {
        e.target.value = formatExpiry(e.target.value);
      });
    }
    var cvcInput = $('#checkout-cvc');
    if (cvcInput) {
      cvcInput.addEventListener('input', function (e) {
        e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
      });
    }
  }

  // -------- Dummy-fill button (DEV MODE) --------
  function wireDummyFill() {
    var btn = $('#checkout-fill-dummy');
    if (!btn) return;
    btn.addEventListener('click', function () {
      $('#checkout-card-number').value = '4242 4242 4242 4242';
      $('#checkout-expiry').value = '12 / 29';
      $('#checkout-cvc').value = '123';
      $('#checkout-cardholder').value = 'Test User';
      $('#checkout-postal').value = '12345';
    });
  }

  // -------- Email prefill from Supabase session --------
  // Run once iboostAuth is available (script load order guarantees it,
  // but we defend anyway). Non-blocking — if session isn't available,
  // email stays as the placeholder and user can still proceed.
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

  // -------- Submit handler --------
  function wireSubmit() {
    var form = $('#checkout-form');
    var submitBtn = $('#checkout-submit');
    var alertEl = $('#checkout-alert');
    if (!form || !submitBtn) return;

    // The submit button lives outside the form but uses form="checkout-form",
    // so submit events fire on the form. Both Free and paid go through here.
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (alertEl) alertEl.hidden = true;

      var plan = PLANS[state.planKey];

      // Paid plan: shape-validate the card fields. No real validation
      // because there is no real payment processor — just make sure
      // the user typed something sensible-shaped.
      if (!plan.isFree) {
        var cardNumber = ($('#checkout-card-number').value || '').replace(/\s/g, '');
        var expiry = ($('#checkout-expiry').value || '').replace(/\s/g, '');
        var cvc = $('#checkout-cvc').value || '';
        var cardholder = ($('#checkout-cardholder').value || '').trim();
        var postal = ($('#checkout-postal').value || '').trim();

        if (cardNumber.length < 13 || cardNumber.length > 16) {
          return showAlert('Enter a valid card number.');
        }
        if (!/^\d{2}\/\d{2}$/.test(expiry)) {
          return showAlert('Enter expiration as MM / YY.');
        }
        if (cvc.length < 3) {
          return showAlert('Enter your card\u2019s CVC.');
        }
        if (!cardholder) {
          return showAlert('Enter the name on your card.');
        }
        if (!postal) {
          return showAlert('Enter your postal / ZIP code.');
        }
      }

      // Spinner on. Duration logic unchanged — Free feels instant-ish,
      // paid simulates a card processor.
      submitBtn.classList.add('is-processing');
      submitBtn.disabled = true;
      var uiDelay = plan.isFree ? 600 : 1800;

      // Persist plan choice. We need to:
      //   1. Look up the user's current plan (for from/to history)
      //   2. Write plan + plan_currency to profiles
      //   3. Insert a plan_changes row (source depends on whether
      //      this is first signup or a later change)
      // If anything fails we bail early, restore the button, show alert.
      // If everything succeeds we run the fake-delay THEN redirect, so
      // the UX feels the same as before.
      try {
        if (!window.iboostAuth) {
          throw new Error('Auth not loaded. Refresh the page.');
        }

        var profile = await window.iboostAuth.getProfile();
        var fromPlan = (profile && profile.plan) || null;
        var toPlan = state.planKey;

        var up = await window.iboostAuth.updateProfile({
          plan: toPlan,
          planCurrency: state.currency,
        });
        if (up.error) {
          // Zombie session: user_id from session doesn't exist in
          // auth.users. Only clean recovery is log out + bounce to
          // login. Keep the button disabled so they can't click again.
          if (up.error.code === 'session_zombie') {
            showAlert('Your session is no longer valid. Logging you out…');
            // Small delay so they can read the message.
            setTimeout(async function () {
              try {
                if (window.iboostAuth && window.iboostAuth.signOut) {
                  await window.iboostAuth.signOut();
                }
              } catch (e) { /* best-effort */ }
              window.location.replace('/login.html?reason=session_expired');
            }, 1500);
            return; // Don't fall through to the success redirect
          }
          throw new Error(up.error.message || 'Could not save plan.');
        }

        // History row. If the user had no prior plan, this is their
        // signup-time pick. If they had one, it's a self-change.
        // recordPlanChange skips the insert if fromPlan === toPlan
        // (no-op change) — still counts as success.
        var source = fromPlan ? 'self_change' : 'signup';
        var ch = await window.iboostAuth.recordPlanChange(fromPlan, toPlan, source);
        if (ch.error) {
          // Non-fatal: the plan is set on profiles, history just won't
          // record. Log but continue — missing history < missing plan.
          console.warn('[checkout] plan_changes insert failed:', ch.error);
        }
      } catch (err) {
        submitBtn.classList.remove('is-processing');
        submitBtn.disabled = false;
        return showAlert(err.message || 'Something went wrong. Try again.');
      }

      // Success — run the UX delay then redirect.
      setTimeout(function () {
        var qs = 'signup=success&plan=' + encodeURIComponent(state.planKey);
        window.location.href = '/account.html?' + qs;
      }, uiDelay);
    });

    function showAlert(message) {
      if (!alertEl) return;
      alertEl.textContent = message;
      alertEl.hidden = false;
      alertEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  // -------- Wire it all up --------
  function init() {
    // Currency toggle buttons
    $$('.currency-toggle button[data-currency-toggle]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var c = btn.getAttribute('data-currency-toggle');
        setCurrency(c);
      });
    });

    // Plan-picker cards. We listen to `change` on the radio so keyboard
    // and click both work via native <label for="..."> semantics.
    $$('.plan-picker-radio').forEach(function (radio) {
      radio.addEventListener('change', function () {
        if (radio.checked) selectPlan(radio.value);
      });
    });

    // Apply initial state (default Complete, or ?plan= override, and the
    // currency from localStorage).
    setCurrency(state.currency);
    selectPlan(state.planKey);

    wireInputFormatters();
    wireDummyFill();
    wireSubmit();
    prefillEmail();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
