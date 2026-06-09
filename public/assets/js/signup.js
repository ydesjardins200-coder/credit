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

  // Capture a partner referral code (?ref=ib_...) as early as possible and
  // stash it, so it survives even if the visitor browses before signing up
  // or goes through email confirmation. Read back at attribution time.
  try {
    var _ref = (new URLSearchParams(window.location.search).get('ref') || '').trim();
    if (_ref) { try { window.localStorage.setItem('iboost_ref', _ref); } catch (e) {} }
  } catch (e) { /* URL APIs unavailable */ }

  // Top-of-funnel click tracking: when the visitor lands with ?ref=ib_…,
  // fire one best-effort beacon per browser per ref code (deduped via a
  // localStorage flag, so refreshes don't inflate the count). Fire-and-
  // forget — never blocks or delays the page. Reads API base lazily.
  (function trackReferralClick() {
    try {
      var ref = (new URLSearchParams(window.location.search).get('ref') || '').trim();
      if (!/^ib_[a-f0-9]{6,}$/.test(ref)) return;
      var dedupeKey = 'iboost_click_' + ref;
      if (window.localStorage.getItem(dedupeKey)) return; // already counted in this browser

      // Stable-ish per-browser token (non-PII) for coarse distinct counting.
      var token = window.localStorage.getItem('iboost_click_token');
      if (!token) {
        token = 'c_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        try { window.localStorage.setItem('iboost_click_token', token); } catch (e) {}
      }

      var cfg = window.IBOOST_CONFIG || {};
      var base = (cfg.API_BASE_URL || '').replace(/\/$/, '');
      if (!base) return;

      fetch(base + '/api/partners/click', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: ref, token: token }),
        keepalive: true,
      }).then(function () {
        try { window.localStorage.setItem(dedupeKey, '1'); } catch (e) {}
      }).catch(function () { /* best-effort */ });
    } catch (e) { /* never block the page */ }
  })();

  const form = document.getElementById('signup-form');
  if (!form) return;

  const submitBtn = document.getElementById('submit-btn');
  const alertEl = document.getElementById('alert');
  const pwInput = document.getElementById('password');
  const consentBox = document.getElementById('consent');
  const firstNameInput = document.getElementById('first_name');
  const lastNameInput = document.getElementById('last_name');
  const emailInput = document.getElementById('email');

  // If the visitor arrived via a partner referral link (?ref=ib_...), the
  // lead's email/name are already known — pre-fill the form so they don't
  // retype what the partner already sent. Best-effort: silent on any error,
  // never blocks the page. Reads the API base lazily (config.js is deferred).
  (async function prefillFromReferral() {
    try {
      var ref = getRefCode();
      if (!ref) return;
      var cfg = window.IBOOST_CONFIG || {};
      var base = (cfg.API_BASE_URL || '').replace(/\/$/, '');
      if (!base) return;
      var resp = await fetch(base + '/api/partners/prefill?ref=' + encodeURIComponent(ref), {
        headers: { Accept: 'application/json' },
      });
      if (!resp.ok) return;
      var data = await resp.json();
      if (!data) return;
      // Only fill empty fields — never clobber something the user typed.
      if (data.email && emailInput && !emailInput.value) {
        emailInput.value = data.email;
        emailInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (data.full_name && firstNameInput && !firstNameInput.value) {
        var parts = String(data.full_name).trim().split(/\s+/);
        firstNameInput.value = parts[0] || '';
        if (lastNameInput && !lastNameInput.value && parts.length > 1) {
          lastNameInput.value = parts.slice(1).join(' ');
        }
        firstNameInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      // Phone: look it up directly (the phoneInput const is declared later
      // in this IIFE). Dispatch 'input' so the live formatter normalizes it.
      var phoneEl = document.getElementById('phone');
      if (data.phone && phoneEl && !phoneEl.value) {
        phoneEl.value = data.phone;
        phoneEl.dispatchEvent(new Event('input', { bubbles: true }));
      }
    } catch (e) { /* best-effort */ }
  })();
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

  // Best-effort partner attribution. If the signup URL carried ?ref=ib_...
  // (a partner referral link), capture it and tell the backend to link this
  // account to the referring lead. Falls back silently — attribution must
  // never affect the signup outcome. Reads the API base lazily (config.js
  // loads deferred, so don't read it at parse time).
  function getRefCode() {
    try {
      var r = (new URLSearchParams(window.location.search).get('ref') || '').trim();
      if (r) {
        // Persist so it survives an email-confirmation round trip (where
        // there's no session at signup time and the URL param is lost).
        try { window.localStorage.setItem('iboost_ref', r); } catch (e) {}
        return r;
      }
      try { return (window.localStorage.getItem('iboost_ref') || '').trim() || null; } catch (e) { return null; }
    } catch (e) { return null; }
  }

  async function attributePartnerReferral() {
    var cfg = window.IBOOST_CONFIG || {};
    var base = (cfg.API_BASE_URL || '').replace(/\/$/, '');
    if (!base) return;
    var ref = getRefCode();
    var settled = await window.iboostAuth.getSessionSettled();
    var session = settled && settled.session;
    var token = session && session.access_token;
    if (!token) return;
    // Marketing consent (CASL) + first name for the nurture campaign. Read
    // straight from the form at submit time. Consent box is checked by
    // default; first name personalizes campaign email.
    var mcEl = document.getElementById('marketing_consent');
    var marketingConsent = !!(mcEl && mcEl.checked);
    var fnEl = document.getElementById('first_name');
    var firstName = ((fnEl && fnEl.value) || '').trim();
    // Fire the attribution. Email-match fallback runs server-side even when
    // ref is null, so we call regardless of whether a ref code is present.
    await fetch(base + '/api/partners/attribute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      body: JSON.stringify({ ref: ref, marketing_consent: marketingConsent, first_name: firstName }),
    }).catch(function () { /* best-effort */ });
  }

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
  // showAlert / clearAlert — delegated to shared/dom-utils.js (Phase A
  // of account architecture refactor; see docs/account-architecture.md).
  function showAlert(message, kind) {
    window.iboostShared.showAlert(alertEl, message, kind);
  }

  function clearAlert() {
    window.iboostShared.clearAlert(alertEl);
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

  // Country is bound to a hidden input (value "CA") for the Canada-only
  // launch; historically it was a CA/US radio group. Read by value so it
  // works for both a hidden input and a (future) checked radio. Returns
  // null only if the field is absent entirely.
  function getSelectedCountry() {
    const checked = form.querySelector('input[name="country"]:checked');
    if (checked) return checked.value;
    const hidden = form.querySelector('input[name="country"]');
    return hidden ? hidden.value || null : null;
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

      // Country is a hidden CA input now (Canada-only launch) — nothing
      // to set; it submits CA automatically.

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
      // Best-effort partner attribution: if the user arrived via a partner
      // referral link (?ref=ib_...), tell the backend to link this new
      // account to that lead. Never blocks or errors the signup flow.
      try { await attributePartnerReferral(); } catch (e) { /* non-fatal */ }

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
