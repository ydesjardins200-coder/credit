// iBoost — /complete-profile.html controller.
//
// Runs the "finish your profile" gate. Reached by authenticated users
// who haven't yet provided phone + country + consent (typically OAuth
// signups — Google hands us email and full_name but nothing else).
//
// Flow:
//   1. Require a valid session. If none -> redirect to /login.html.
//   2. Fetch current profile. If already complete -> redirect forward
//      (this page is idempotent; re-rendering on a complete profile
//      just bounces the user to wherever they should go next).
//   3. Pre-fill first_name / last_name by splitting the user_metadata
//      full_name on the first space. User can edit.
//   4. Wire up live phone formatting + NANP validation, submit gate.
//   5. On submit, call iboostAuth.updateProfile() and go to /account.html.

(function () {
  'use strict';

  const form = document.getElementById('complete-profile-form');
  const submitBtn = document.getElementById('submit-btn');
  const alertEl = document.getElementById('alert');

  const firstNameInput = document.getElementById('first_name');
  const lastNameInput = document.getElementById('last_name');
  const phoneInput = document.getElementById('phone');
  const consentBox = document.getElementById('consent');

  const t = {
    fillFields: document.body.dataset.msgFillFields || 'Please fill in all fields.',
    authUnavailable: document.body.dataset.msgAuthUnavailable || 'Auth is not configured. Please try again in a moment.',
    saving: document.body.dataset.msgSaving || 'Saving…',
    defaultSubmit: document.body.dataset.msgSubmit || 'Continue',
    genericError: document.body.dataset.msgGenericError || 'Something went wrong. Please try again.',
  };

  // ----- Phone formatting + validation (mirror of signup.js) -----

  function formatPhoneLive(rawValue) {
    var digits = (rawValue || '').replace(/\D/g, '').slice(0, 10);
    if (digits.length === 0) return '';
    if (digits.length < 4)  return '(' + digits;
    if (digits.length < 7)  return '(' + digits.slice(0, 3) + ') ' + digits.slice(3);
    return '(' + digits.slice(0, 3) + ') ' + digits.slice(3, 6) + '-' + digits.slice(6, 10);
  }

  var PHONE_VALID_RE = /^\([2-9]\d{2}\)\s\d{3}-\d{4}$/;
  function isPhoneValid(value) {
    return PHONE_VALID_RE.test((value || '').trim());
  }

  if (phoneInput) {
    phoneInput.addEventListener('input', function () {
      var formatted = formatPhoneLive(phoneInput.value);
      if (phoneInput.value !== formatted) phoneInput.value = formatted;
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

  // ----- Country selector (radio group "country") -----
  function getSelectedCountry() {
    const checked = form.querySelector('input[name="country"]:checked');
    return checked ? checked.value : null;
  }

  // ----- Submit gate -----
  function updateSubmitState() {
    const firstOk = firstNameInput.value.trim().length > 0;
    const lastOk = lastNameInput.value.trim().length > 0;
    const phoneOk = isPhoneValid(phoneInput.value);
    const countryOk = !!getSelectedCountry();
    const consentOk = consentBox.checked;
    submitBtn.disabled = !(firstOk && lastOk && phoneOk && countryOk && consentOk);
  }

  [firstNameInput, lastNameInput, phoneInput].forEach(function (el) {
    el.addEventListener('input', updateSubmitState);
  });
  form.querySelectorAll('input[name="country"]').forEach(function (el) {
    el.addEventListener('change', updateSubmitState);
  });
  consentBox.addEventListener('change', updateSubmitState);

  // ----- Name pre-fill helper -----
  // Split a "Yan Desjardins"-style string on the first space:
  //   "Yan Desjardins" -> { first: "Yan", last: "Desjardins" }
  //   "Madonna"        -> { first: "Madonna", last: "" }
  //   "María del Carmen Torres" -> { first: "María", last: "del Carmen Torres" }
  // User can edit after pre-fill — this is a UX helper, not truth.
  function splitFullName(full) {
    if (!full) return { first: '', last: '' };
    var trimmed = String(full).trim();
    var idx = trimmed.indexOf(' ');
    if (idx < 0) return { first: trimmed, last: '' };
    return {
      first: trimmed.slice(0, idx),
      last: trimmed.slice(idx + 1),
    };
  }

  // ----- Init: gate + pre-fill -----
  async function init() {
    if (!window.iboostAuth) {
      showAlert(t.authUnavailable, 'error');
      return;
    }

    // Require a session. If there isn't one, user shouldn't even be
    // on this page — bounce to login.
    const session = await window.iboostAuth.requireSession('/login.html');
    if (!session) return; // redirect already issued

    // If the profile is already complete, this page has no business
    // being rendered — send the user forward. Idempotent safety net
    // in case a stale link or manual URL visit lands here.
    //
    // Where "forward" goes depends on whether they've already picked
    // a plan: complete profile + no plan -> /checkout (they still
    // need to finish signup); complete profile + plan -> /account
    // (fully set up, go home).
    const profile = await window.iboostAuth.getProfile();
    if (window.iboostAuth.isProfileComplete(profile)) {
      if (profile && profile.plan) {
        window.location.replace('/account.html');
      } else {
        window.location.replace('/checkout.html');
      }
      return;
    }

    // Pre-fill first/last from existing data, preferring profile.full_name
    // (if the user has one from a prior partial fill) over user_metadata.
    var meta = (session.user && session.user.user_metadata) || {};
    var sourceName =
      (profile && profile.full_name) ||
      meta.full_name ||
      meta.name ||
      '';
    var split = splitFullName(sourceName);

    // Only pre-fill if the user hasn't already typed something (e.g.
    // browser autofill happened to beat us to it).
    if (!firstNameInput.value && split.first) firstNameInput.value = split.first;
    if (!lastNameInput.value && split.last) lastNameInput.value = split.last;

    // Pre-fill country radio if the profile already has one (partial fill).
    if (profile && profile.country) {
      const match = form.querySelector('input[name="country"][value="' + profile.country + '"]');
      if (match) match.checked = true;
    }

    // Pre-fill phone if the profile already has it (partial fill).
    if (profile && profile.phone) {
      phoneInput.value = profile.phone;
    }

    updateSubmitState();
  }

  // ----- Submit handler -----
  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    clearAlert();

    if (!window.iboostAuth) {
      showAlert(t.authUnavailable, 'error');
      return;
    }

    const firstName = firstNameInput.value.trim();
    const lastName = lastNameInput.value.trim();
    const phone = phoneInput.value.trim();
    const country = getSelectedCountry();
    const consentOk = consentBox.checked;

    if (!firstName || !lastName || !isPhoneValid(phone) || !country || !consentOk) {
      showAlert(t.fillFields, 'error');
      return;
    }

    submitBtn.disabled = true;
    const originalText = submitBtn.textContent;
    submitBtn.textContent = t.saving;

    const { error } = await window.iboostAuth.updateProfile({
      firstName,
      lastName,
      phone,
      country,
    });

    if (error) {
      submitBtn.textContent = originalText || t.defaultSubmit;
      updateSubmitState();
      showAlert(error.message || t.genericError, 'error');
      return;
    }

    // Success. Profile is now complete — next stop is /checkout.html
    // where the user picks a plan. From there, submit writes the plan
    // to the DB and redirects to /account.html.
    window.location.replace('/checkout.html');
  });

  // Kick things off.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
