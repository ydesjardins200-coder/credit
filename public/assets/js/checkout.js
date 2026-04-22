/* =========================================================================
   checkout.js — Visual-only payment mockup (NO real Stripe integration)
   =========================================================================
   This script powers the /checkout.html page, which is a DEV-MODE visual
   stand-in for the eventual Stripe Checkout integration. Its job:

     1. Read ?plan= from the URL and populate the plan summary
     2. Format the card-number input (space every 4 digits)
     3. Format the expiry input (auto-insert " / " between MM and YY)
     4. Handle the "Pay" submit — show spinner for ~1.8s, then redirect
        to /account.html
     5. NO validation of actual card numbers, NO API calls, NO charges

   When we integrate real Stripe later, this file becomes the handler
   that exchanges card details for a Stripe token and calls the backend
   to create a subscription. Until then, it's purely illustrative.
   ========================================================================= */

(function () {
  'use strict';

  // -------- Plan catalog --------
  // Kept in sync with the prices shown on /pricing.html. When we update
  // pricing, update this object too.
  var PLANS = {
    free: {
      name: 'Free',
      tagline: 'Learn the system. Build the habits. Upgrade when you\u2019re ready.',
      amountUsd: 0,
      amountCad: 0,
      includes: [
        'Full budget app (manual entry)',
        'Complete education library',
        'Monthly credit tips newsletter'
      ]
    },
    essential: {
      name: 'iBoost Essential',
      tagline: 'Real credit work without the premium add-ons.',
      amountUsd: 15,
      amountCad: 20,
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
      tagline: 'Everything we offer. Maximum score-building velocity.',
      amountUsd: 30,
      amountCad: 40,
      includes: [
        '$2,000 reported credit line',
        'Weekly score refresh',
        'Unlimited on-demand AI advice',
        'Dispute assistance for report errors',
        'Priority support, 7 days a week'
      ]
    }
  };

  // -------- Read query params --------
  function getParam(name) {
    var params = new URLSearchParams(window.location.search);
    return params.get(name);
  }

  var planKey = (getParam('plan') || 'essential').toLowerCase();
  var plan = PLANS[planKey] || PLANS.essential;

  // Currency defaults to USD unless persisted as CAD from the pricing page.
  // The landing.js stores the currency choice in localStorage.
  var currency = 'usd';
  try {
    var saved = localStorage.getItem('iboost.currency');
    if (saved === 'cad') currency = 'cad';
  } catch (e) { /* storage disabled — fall through to USD */ }

  var amount = (currency === 'cad') ? plan.amountCad : plan.amountUsd;
  var currencyLabel = (currency === 'cad') ? 'CAD' : 'USD';

  // -------- Populate the plan summary on the left column --------
  function populateSummary() {
    var nameEl = document.getElementById('plan-name');
    var amountEl = document.getElementById('plan-amount');
    var currencyEl = document.getElementById('plan-currency');
    var taglineEl = document.getElementById('plan-tagline');
    var includesEl = document.getElementById('plan-includes');
    var billedTodayEl = document.getElementById('billed-today-amount');
    var payAmountEl = document.getElementById('pay-amount');

    if (nameEl) nameEl.textContent = plan.name;
    if (amountEl) amountEl.textContent = '$' + amount;
    if (currencyEl) currencyEl.textContent = currencyLabel;
    if (taglineEl) taglineEl.textContent = plan.tagline;

    if (includesEl) {
      includesEl.innerHTML = '';
      plan.includes.forEach(function (item) {
        var li = document.createElement('li');
        li.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg><span>' + escapeHtml(item) + '</span>';
        includesEl.appendChild(li);
      });
    }

    var amountWithCents = '$' + amount.toFixed(2);
    if (billedTodayEl) billedTodayEl.textContent = amountWithCents;
    if (payAmountEl) payAmountEl.textContent = amountWithCents;
  }

  function escapeHtml(str) {
    var d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  populateSummary();

  // If it's a Free plan, there's no payment to process. Skip the form
  // entirely and send the user straight to their account.
  if (planKey === 'free' || amount === 0) {
    window.location.replace('/account.html');
    return;
  }

  // -------- Prefill email if we can find it from a previous session --------
  // (Nothing to do here yet since signup flow doesn't persist email to
  // localStorage, but leaving the hook so future sessions could.)
  try {
    var savedEmail = localStorage.getItem('iboost.pendingSignupEmail');
    if (savedEmail) {
      var emailEl = document.getElementById('checkout-email');
      if (emailEl) emailEl.value = savedEmail;
    }
  } catch (e) { /* storage disabled */ }

  // -------- Card number formatting: space every 4 digits --------
  var cardNumInput = document.getElementById('checkout-card-number');
  if (cardNumInput) {
    cardNumInput.addEventListener('input', function (e) {
      var raw = e.target.value.replace(/\D/g, '').slice(0, 16);
      var formatted = raw.replace(/(.{4})/g, '$1 ').trim();
      e.target.value = formatted;
    });
  }

  // -------- Expiry formatting: auto-insert " / " between MM and YY --------
  var expiryInput = document.getElementById('checkout-expiry');
  if (expiryInput) {
    expiryInput.addEventListener('input', function (e) {
      var raw = e.target.value.replace(/\D/g, '').slice(0, 4);
      if (raw.length >= 3) {
        e.target.value = raw.slice(0, 2) + ' / ' + raw.slice(2);
      } else {
        e.target.value = raw;
      }
    });
  }

  // -------- CVC: numeric only --------
  var cvcInput = document.getElementById('checkout-cvc');
  if (cvcInput) {
    cvcInput.addEventListener('input', function (e) {
      e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
    });
  }

  // -------- Postal: strip most special chars, keep alphanumerics and spaces --------
  var postalInput = document.getElementById('checkout-postal');
  if (postalInput) {
    postalInput.addEventListener('input', function (e) {
      e.target.value = e.target.value.replace(/[^A-Za-z0-9 ]/g, '').slice(0, 10);
    });
  }

  // -------- Form submit: show spinner, then redirect --------
  // In the real implementation this will call Stripe.js to tokenize the
  // card and POST to the backend. For the mockup we just simulate the
  // async wait and go.
  var form = document.getElementById('checkout-form');
  var submitBtn = document.getElementById('checkout-submit');
  var alertEl = document.getElementById('checkout-alert');

  if (form && submitBtn) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();

      // Minimal mock validation — user must have typed SOMETHING in the
      // card number and expiry fields. This is purely visual; no real
      // Luhn check or expiry validation.
      var cardRaw = cardNumInput ? cardNumInput.value.replace(/\D/g, '') : '';
      var expiryRaw = expiryInput ? expiryInput.value.replace(/\D/g, '') : '';
      var cvcRaw = cvcInput ? cvcInput.value : '';

      if (cardRaw.length < 12 || expiryRaw.length < 4 || cvcRaw.length < 3) {
        showAlert('Please fill in all card details to continue.');
        return;
      }

      clearAlert();

      // Lock the button and show spinner
      submitBtn.classList.add('is-loading');
      submitBtn.disabled = true;

      // Simulate Stripe processing delay (1.5-2s feels realistic)
      setTimeout(function () {
        // In real integration: on success, redirect to account.
        // On failure, show error and re-enable button.
        window.location.replace('/account.html?signup=success&plan=' + encodeURIComponent(planKey));
      }, 1800);
    });
  }

  function showAlert(msg) {
    if (!alertEl) return;
    alertEl.textContent = msg;
    alertEl.hidden = false;
  }

  function clearAlert() {
    if (!alertEl) return;
    alertEl.hidden = true;
    alertEl.textContent = '';
  }
})();
