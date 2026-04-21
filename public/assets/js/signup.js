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

  // ----- If already signed in, bounce to account page -----
  (async function redirectIfSignedIn() {
    if (!window.iboostAuth) return;
    const { session } = await window.iboostAuth.getSession();
    if (session) window.location.replace(t.accountPath);
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
      window.location.replace(t.accountPath);
      return;
    }

    showAlert(t.checkEmail, 'success');
    form.reset();
    renderCriteria(''); // reset criteria visuals
    updateSubmitState();
  });
})();
