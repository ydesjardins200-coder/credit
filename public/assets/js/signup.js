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
  const phoneInput = document.getElementById('phone');

  const t = {
    fillFields: document.body.dataset.msgFillFields || 'Please fill in all fields and meet the password requirements.',
    authUnavailable: document.body.dataset.msgAuthUnavailable || 'Auth is not configured. Please try again in a moment.',
    creating: document.body.dataset.msgCreating || 'Creating account…',
    defaultSubmit: document.body.dataset.msgSubmit || 'Create my account',
    genericError: document.body.dataset.msgGenericError || 'Sign-up failed. Please try again.',
    checkEmail: document.body.dataset.msgCheckEmail || 'Check your email to confirm your account, then sign in.',
    accountPath: document.body.dataset.accountPath || '/account.html',
  };

  // ----- Post-signup routing -----
  // As of the capture-lead-first refactor: plan selection has moved off
  // the signup page entirely. Every successful signup — free or paid —
  // now lands on /checkout.html where the user picks a plan and (for
  // paid tiers) enters payment details.
  //
  // Plan-forwarding: if the user arrived on /signup.html with a ?plan=
  // query (e.g. they clicked 'Start Essential' on /pricing.html), we
  // carry that hint through to /checkout.html?plan=... so their choice
  // is pre-selected in the picker. Accepted values: free, essential,
  // complete (matching checkout.js's PLANS catalog). Invalid values
  // are dropped silently — checkout falls back to its default (complete).

  function getPostSignupPath() {
    var target = '/checkout.html';
    try {
      var qp = (new URLSearchParams(window.location.search).get('plan') || '').toLowerCase();
      if (qp === 'free' || qp === 'essential' || qp === 'complete') {
        target += '?plan=' + qp;
      }
    } catch (e) { /* URL APIs unavailable — fall through to unparameterized target */ }
    return target;
  }

  // ----- Phone formatting + validation -----
  // NANP phone numbers (Canada + US, both use country code +1).
  // We collect ONLY the 10-digit local portion — users don't type the +1.
  //
  // Live-format the input as the user types so it visually becomes
  //   (555) 123-4567
  // regardless of whether they pasted, typed slowly, typed fast,
  // used parentheses or didn't. The stored value on submit is the
  // formatted string.
  //
  // Validation (on submit): must match (NXX) NXX-XXXX where N is 2-9.
  // The HTML `pattern` attribute also enforces this as a last line
  // of defense in case JS is disabled — browser will block submit.

  function formatPhoneLive(rawValue) {
    // Strip everything non-digit, then re-format what remains.
    var digits = (rawValue || '').replace(/\D/g, '').slice(0, 10);
    if (digits.length === 0) return '';
    if (digits.length < 4)  return '(' + digits;
    if (digits.length < 7)  return '(' + digits.slice(0, 3) + ') ' + digits.slice(3);
    return '(' + digits.slice(0, 3) + ') ' + digits.slice(3, 6) + '-' + digits.slice(6, 10);
  }

  // Strict validator — only valid NANP (area code + exchange 2-9)
  var PHONE_VALID_RE = /^\([2-9]\d{2}\)\s\d{3}-\d{4}$/;

  function isPhoneValid(value) {
    return PHONE_VALID_RE.test((value || '').trim());
  }

  // Live-format as user types. Keeping caret handling simple: after
  // reformat, we set the caret to the end of the value. For a short
  // field like (###) ###-#### this is imperceptibly different from
  // preserving caret position mid-string, and avoids the bug-prone
  // caret math that full-featured phone libraries carry.
  if (phoneInput) {
    phoneInput.addEventListener('input', function () {
      var formatted = formatPhoneLive(phoneInput.value);
      if (phoneInput.value !== formatted) {
        phoneInput.value = formatted;
      }
    });
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
    const phoneOk = phoneInput ? isPhoneValid(phoneInput.value) : true;
    // Country radios are optional in the DOM: gate only fires when they exist.
    const countryOk = !form.querySelector('input[name="country"]') || !!getSelectedCountry();

    submitBtn.disabled = !(pwOk && consentOk && firstOk && lastOk && emailOk && phoneOk && countryOk);
  }

  // Bind listeners
  if (pwInput) pwInput.addEventListener('input', updateSubmitState);
  if (consentBox) consentBox.addEventListener('change', updateSubmitState);
  [firstNameInput, lastNameInput, emailInput, phoneInput].forEach((el) => {
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
      if (phoneInput) phoneInput.value = '(514) 555-0100';

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
  // Where does a signed-in user hitting /signup.html go next?
  //   1. Profile incomplete (OAuth signups that never filled phone/country,
  //      or any legacy account with NULLs) -> /complete-profile.html
  //   2. Profile complete -> /checkout.html (the phase 1 post-signup target)
  // We check profile completeness FIRST because a user who can't complete
  // checkout (missing phone) should finish their profile, not be sent in
  // circles. -----
  async function getForwardPath() {
    if (window.iboostAuth && window.iboostAuth.getProfile && window.iboostAuth.isProfileComplete) {
      try {
        const profile = await window.iboostAuth.getProfile();
        if (!window.iboostAuth.isProfileComplete(profile)) {
          return '/complete-profile.html';
        }
      } catch (e) {
        // Fall through to checkout; gate on /account.html will re-check.
      }
    }
    return getPostSignupPath();
  }

  (async function redirectIfSignedIn() {
    if (!window.iboostAuth) return;
    // getSessionSettled handles the OAuth-hash race the same way
    // requireSession does on gated pages.
    const { session } = await window.iboostAuth.getSessionSettled();
    if (session) window.location.replace(await getForwardPath());
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
    const phone = phoneInput ? phoneInput.value.trim() : '';
    const password = pwInput.value;
    const country = getSelectedCountry();
    const countryRequired = !!form.querySelector('input[name="country"]');

    // Double-check everything server-side-ish before calling Supabase
    const { allMet } = evaluatePassword(password);
    const consentOk = consentBox ? consentBox.checked : true;
    const phoneOk = phoneInput ? isPhoneValid(phone) : true;
    if (!firstName || !lastName || !email || !phoneOk || !allMet || !consentOk ||
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
      phone,   // NEW: formatted '(NXX) NXX-XXXX' — stored in auth.users
               // raw_user_meta_data until a profiles schema migration adds it
               // to public.profiles
      country,  // null if the field is absent (FR page today)
    });

    submitBtn.textContent = originalSubmitText || t.defaultSubmit;
    updateSubmitState(); // will re-enable if still valid

    if (error) {
      showAlert(error.message || t.genericError, 'error');
      return;
    }

    if (data && data.session) {
      // Profile should be complete because the form just captured phone +
      // country. But check anyway — cheap and catches the case where the
      // trigger hasn't fired yet or a field was somehow dropped.
      window.location.replace(await getForwardPath());
      return;
    }

    showAlert(t.checkEmail, 'success');
    form.reset();
    renderCriteria(''); // reset criteria visuals
    updateSubmitState();
  });
})();
