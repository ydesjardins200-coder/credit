// Signup page controller.
// UI strings come from data attributes on the <body> so EN and FR pages
// share a single script.

(function () {
  'use strict';

  const form = document.getElementById('signup-form');
  const submitBtn = document.getElementById('submit-btn');
  const alertEl = document.getElementById('alert');

  const t = {
    fillFields: document.body.dataset.msgFillFields || 'Please fill in all fields. Password must be at least 8 characters.',
    authUnavailable: document.body.dataset.msgAuthUnavailable || 'Auth is not configured. Please try again in a moment.',
    creating: document.body.dataset.msgCreating || 'Creating account…',
    defaultSubmit: document.body.dataset.msgSubmit || 'Create account',
    genericError: document.body.dataset.msgGenericError || 'Sign-up failed. Please try again.',
    checkEmail: document.body.dataset.msgCheckEmail || 'Check your email to confirm your account, then sign in.',
    accountPath: document.body.dataset.accountPath || '/account.html',
  };

  function showAlert(message, kind) {
    alertEl.className = 'alert ' + (kind === 'success' ? 'alert-success' : 'alert-error');
    alertEl.textContent = message;
    alertEl.hidden = false;
  }

  function clearAlert() {
    alertEl.hidden = true;
    alertEl.textContent = '';
  }

  // If already signed in, bounce to account page.
  (async function redirectIfSignedIn() {
    if (!window.iboostAuth) return;
    const { session } = await window.iboostAuth.getSession();
    if (session) window.location.replace(t.accountPath);
  })();

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    clearAlert();

    if (!window.iboostAuth) {
      showAlert(t.authUnavailable, 'error');
      return;
    }

    const fullName = document.getElementById('full_name').value.trim();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    if (!fullName || !email || password.length < 8) {
      showAlert(t.fillFields, 'error');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = t.creating;

    const { data, error } = await window.iboostAuth.signUpWithPassword({
      email,
      password,
      fullName,
    });

    submitBtn.disabled = false;
    submitBtn.textContent = t.defaultSubmit;

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
  });
})();
