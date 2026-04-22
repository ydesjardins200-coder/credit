// Signup page controller.
//
// Responsibilities:
//   - Read UI strings from data-* attributes on <body> so one script
//     serves both EN and FR pages.
//   - Live password-strength check against 5 criteria.
//   - Keep the submit button disabled until password passes all criteria
//     AND the consent checkbox is checked.
//   - Handle Supabase signup + surface confirmation message.

(function () {
  'use strict';

  const form = document.getElementById('signup-form');
  if (!form) return;

  const submitBtn = document.getElementById('submit-btn');
  const alertEl = document.getElementById('alert');
  const pwInput = document.getElementById('password');
  const consentBox = document.getElementById('consent');
  const firstNameInput = document.getElementById('first_name');
  const lastNameInput = document.getElementById('last_name');
  const emailInput = document.getElementById('email');

  const t = {
    fillFields: document.body.dataset.msgFillFields || 'Please fill in all fields and meet the password requirements.',
    authUnavailable: document.body.dataset.msgAuthUnavailable || 'Auth is not configured. Please try again in a moment.',
    creating: document.body.dataset.msgCreating || 'Creating account…',
    defaultSubmit: document.body.dataset.msgSubmit || 'Create my account',
    genericError: document.body.dataset.msgGenericError || 'Sign-up failed. Please try again.',
    checkEmail: document.body.dataset.msgCheckEmail || 'Check your email to confirm your account, then sign in.',
    accountPath: document.body.dataset.accountPath || '/account.html',
  };

  // ----- Plan routing + selector wiring -----
  // The signup page has an inline plan selector (3 mini-cards: Free,
  // Essential, Complete) visible above the OAuth buttons. This replaces
  // the previous "force redirect to pricing if no plan" behavior:
  // users without a plan param can now pick inline, and users who
  // arrived with ?plan=X see their choice pre-selected and can still
  // change it without leaving the page.
  //
  // Flow:
  //   1. On load: read ?plan= (if any), set pendingPlan, sync selector UI.
  //   2. User clicks a card: update pendingPlan + UI + URL.
  //   3. On submit: post-signup path uses whatever pendingPlan is now.

  function getUrlParam(name) {
    try {
      return new URLSearchParams(window.location.search).get(name);
    } catch (e) {
      return null;
    }
  }

  // Plan catalog — kept in sync with pricing page
  var PLAN_AMOUNTS = {
    free:      { usd: 0,  cad: 0  },
    essential: { usd: 15, cad: 20 },
    complete:  { usd: 30, cad: 40 }
  };
  var VALID_PLANS = ['free', 'essential', 'complete'];

  // Mutable state: the currently-selected plan. Starts from URL param
  // or defaults to essential. Lowercased + validated against VALID_PLANS.
  var urlPlan = (getUrlParam('plan') || '').toLowerCase();
  var pendingPlan = VALID_PLANS.indexOf(urlPlan) >= 0 ? urlPlan : 'essential';

  // Read currency preference from localStorage (set by landing.js on pricing)
  var currency = 'usd';
  try {
    var saved = localStorage.getItem('iboost.currency');
    if (saved === 'cad') currency = 'cad';
  } catch (e) { /* storage disabled */ }

  // Sync the selector UI and the amount labels to match pendingPlan
  // and the current currency. Called once on load and again every
  // time the user clicks a different card.
  function syncPlanSelectorUI() {
    var cards = document.querySelectorAll('.signup-plan-card');
    cards.forEach(function (card) {
      var planKey = card.getAttribute('data-plan');
      var isSelected = planKey === pendingPlan;
      card.classList.toggle('is-selected', isSelected);
      card.setAttribute('aria-checked', isSelected ? 'true' : 'false');
    });

    // Update the amount shown on each card per current currency
    var amountEls = document.querySelectorAll('[data-plan-amount]');
    amountEls.forEach(function (el) {
      var planKey = el.getAttribute('data-plan-amount');
      if (PLAN_AMOUNTS[planKey]) {
        el.textContent = '$' + PLAN_AMOUNTS[planKey][currency];
      }
    });

    // Update the "Prices shown in USD/CAD" note
    var label = document.getElementById('signup-plan-currency-label');
    if (label) label.textContent = currency.toUpperCase();
  }

  // Wire up click handlers on the 3 mini-cards
  function initPlanSelector() {
    var cards = document.querySelectorAll('.signup-plan-card');
    cards.forEach(function (card) {
      card.addEventListener('click', function () {
        var planKey = card.getAttribute('data-plan');
        if (VALID_PLANS.indexOf(planKey) < 0) return;
        pendingPlan = planKey;
        syncPlanSelectorUI();

        // Update the URL so refresh preserves the choice and so the
        // user can share the URL with their plan embedded
        if (window.history && window.history.replaceState) {
          var newUrl = window.location.pathname + '?plan=' + encodeURIComponent(planKey) + window.location.hash;
          window.history.replaceState({}, '', newUrl);
        }
      });
    });
  }

  // Initial sync + wiring
  syncPlanSelectorUI();
  initPlanSelector();

  // Compute where the user should land after signup succeeds.
  //   Free -> /account.html (no payment step)
  //   Paid -> /checkout.html?plan=X (visual payment mockup for now)
  // Uses pendingPlan's CURRENT value (updated by the selector),
  // not whatever was in the URL at page load.
  function getPostSignupPath() {
    if (pendingPlan === 'free') {
      return t.accountPath;
    }
    return '/checkout.html?plan=' + encodeURIComponent(pendingPlan);
  }

  // ----- Alerts -----
  function showAlert(message, kind) {
    alertEl.className = 'alert ' + (kind === 'success' ? 'alert-success' : 'alert-error');
    alertEl.textContent = message;
    alertEl.hidden = false;
  }

  function clearAlert() {
    alertEl.hidden = true;
    alertEl.textContent = '';
  }

  // ----- Password criteria -----
  // Each rule maps to a <li data-rule="..."> in the DOM.
  const rules = {
    length: (pw) => pw.length >= 8,
    uppercase: (pw) => /[A-Z]/.test(pw),
    lowercase: (pw) => /[a-z]/.test(pw),
    number: (pw) => /[0-9]/.test(pw),
    special: (pw) => /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(pw),
  };

  function evaluatePassword(pw) {
    const results = {};
    let metCount = 0;
    for (const key in rules) {
      const met = rules[key](pw);
      results[key] = met;
      if (met) metCount++;
    }
    return { results, allMet: metCount === Object.keys(rules).length };
  }

  function renderCriteria(pw) {
    const { results, allMet } = evaluatePassword(pw);
    document.querySelectorAll('.password-criteria li[data-rule]').forEach((li) => {
      const key = li.getAttribute('data-rule');
      li.setAttribute('data-met', results[key] ? 'true' : 'false');
    });
    return allMet;
  }

  // Country is captured via a radio group named "country" with values "CA"
  // or "US". Returns null if no radio is selected yet.
  function getSelectedCountry() {
    const checked = form.querySelector('input[name="country"]:checked');
    return checked ? checked.value : null;
  }

  // ----- Overall form-can-submit gate -----
  function updateSubmitState() {
    const pwOk = pwInput.value ? renderCriteria(pwInput.value) : false;
    const consentOk = consentBox ? consentBox.checked : true;
    const firstOk = firstNameInput ? firstNameInput.value.trim().length > 0 : true;
    const lastOk = lastNameInput ? lastNameInput.value.trim().length > 0 : true;
    const emailOk = emailInput ? /\S+@\S+\.\S+/.test(emailInput.value.trim()) : true;
    // Country radios are optional in the DOM: gate only fires when they exist.
    const countryOk = !form.querySelector('input[name="country"]') || !!getSelectedCountry();

    submitBtn.disabled = !(pwOk && consentOk && firstOk && lastOk && emailOk && countryOk);
  }

  // Bind listeners
  if (pwInput) pwInput.addEventListener('input', updateSubmitState);
  if (consentBox) consentBox.addEventListener('change', updateSubmitState);
  [firstNameInput, lastNameInput, emailInput].forEach((el) => {
    if (el) el.addEventListener('input', updateSubmitState);
  });
  form.querySelectorAll('input[name="country"]').forEach((el) => {
    el.addEventListener('change', updateSubmitState);
  });

  // Set initial state
  updateSubmitState();

  // ----- DEV-MODE: "Fill with dummy data" button -----
  // Populates every signup field with placeholder values. The email gets
  // a timestamp suffix so each click produces a unique email — avoids
  // Supabase "user already exists" errors on repeated demo runs.
  //
  // After fill we also trigger the password criteria update + submit
  // state check so the form is immediately submittable without the user
  // having to touch it.
  var fillDummyBtn = document.getElementById('signup-fill-dummy');
  if (fillDummyBtn) {
    fillDummyBtn.addEventListener('click', function () {
      var ts = Date.now().toString(36); // base36 timestamp, shortish

      if (firstNameInput) firstNameInput.value = 'Demo';
      if (lastNameInput) lastNameInput.value = 'User';
      if (emailInput) emailInput.value = 'demo+' + ts + '@iboost.test';

      // US is already the default checked radio — make sure it stays
      var usRadio = document.getElementById('country-us');
      if (usRadio) usRadio.checked = true;

      // Password that passes all 5 criteria: 8+ chars, uppercase,
      // lowercase, number, special char
      if (pwInput) {
        pwInput.value = 'Demo123!';
        // Fire input event so the live criteria checker + submit
        // enablement logic both see the new value
        pwInput.dispatchEvent(new Event('input', { bubbles: true }));
      }

      // Tick the consent box
      if (consentBox) consentBox.checked = true;

      // Update submit state since we bypassed the 'input' listeners
      // on the text fields
      updateSubmitState();
    });
  }

  // ----- If already signed in, bounce forward.
  // If they came with ?plan=X from /pricing.html, honor that and send
  // them to checkout (or account for Free). Otherwise, plain account
  // redirect. Previously this ALWAYS went to /account.html, which
  // silently ignored the plan selection — a signed-in user clicking
  // a pricing CTA would never reach the checkout. -----
  (async function redirectIfSignedIn() {
    if (!window.iboostAuth) return;
    const { session } = await window.iboostAuth.getSession();
    if (session) window.location.replace(getPostSignupPath());
  })();

  // ----- FAQ mini accordion (in signup intro column) -----
  // Kept here rather than loading landing.js, because landing.js has unrelated
  // currency-toggle + header-swap logic that doesn't apply on auth pages.
  document.querySelectorAll('.faq-mini-question').forEach(function (btn) {
    btn.setAttribute('aria-expanded', 'false');
    const answer = btn.nextElementSibling;
    if (answer) answer.setAttribute('data-open', 'false');

    btn.addEventListener('click', function () {
      const open = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', open ? 'false' : 'true');
      if (answer) answer.setAttribute('data-open', open ? 'false' : 'true');
    });
  });

  // ----- Password show/hide toggle -----
  // The button lives inside .password-wrap next to the input. Pressing it
  // swaps input type between 'password' and 'text', and updates the
  // aria-label + aria-pressed so screen readers announce the new state.
  const pwToggle = document.getElementById('password-toggle');
  if (pwToggle && pwInput) {
    pwToggle.addEventListener('click', function () {
      const isHidden = pwInput.type === 'password';
      pwInput.type = isHidden ? 'text' : 'password';
      pwToggle.setAttribute('aria-pressed', isHidden ? 'true' : 'false');
      const label = isHidden
        ? (pwToggle.dataset.labelHide || 'Hide password')
        : (pwToggle.dataset.labelShow || 'Show password');
      pwToggle.setAttribute('aria-label', label);
      // Keep focus on the input so typing can continue seamlessly. Moving
      // focus to the input also puts the caret at the end of the current value.
      pwInput.focus();
      const val = pwInput.value;
      pwInput.value = '';
      pwInput.value = val;
    });
  }

  // ----- Submit -----
  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    clearAlert();

    if (!window.iboostAuth) {
      showAlert(t.authUnavailable, 'error');
      return;
    }

    const firstName = firstNameInput ? firstNameInput.value.trim() : '';
    const lastName = lastNameInput ? lastNameInput.value.trim() : '';
    const fullName = (firstName + ' ' + lastName).trim();
    const email = emailInput.value.trim();
    const password = pwInput.value;
    const country = getSelectedCountry();
    const countryRequired = !!form.querySelector('input[name="country"]');

    // Double-check everything server-side-ish before calling Supabase
    const { allMet } = evaluatePassword(password);
    const consentOk = consentBox ? consentBox.checked : true;
    if (!firstName || !lastName || !email || !allMet || !consentOk ||
        (countryRequired && !country)) {
      showAlert(t.fillFields, 'error');
      return;
    }

    submitBtn.disabled = true;
    const originalSubmitText = submitBtn.textContent;
    submitBtn.textContent = t.creating;

    const { data, error } = await window.iboostAuth.signUpWithPassword({
      email,
      password,
      fullName,
      country,  // null if the field is absent (FR page today)
    });

    submitBtn.textContent = originalSubmitText || t.defaultSubmit;
    updateSubmitState(); // will re-enable if still valid

    if (error) {
      showAlert(error.message || t.genericError, 'error');
      return;
    }

    if (data && data.session) {
      window.location.replace(getPostSignupPath());
      return;
    }

    showAlert(t.checkEmail, 'success');
    form.reset();
    renderCriteria(''); // reset criteria visuals
    updateSubmitState();
  });
})();
