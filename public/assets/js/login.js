// Login page controller. Strings come from data attributes on <body>.

(function () {
  'use strict';

  const form = document.getElementById('login-form');
  const submitBtn = document.getElementById('submit-btn');
  const alertEl = document.getElementById('alert');

  const t = {
    enterCreds: document.body.dataset.msgEnterCreds || 'Please enter your email and password.',
    authUnavailable: document.body.dataset.msgAuthUnavailable || 'Auth is not configured. Please try again in a moment.',
    signingIn: document.body.dataset.msgSigningIn || 'Signing in…',
    defaultSubmit: document.body.dataset.msgSubmit || 'Sign in',
    genericError: document.body.dataset.msgGenericError || 'Sign-in failed. Please try again.',
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

    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    if (!email || !password) {
      showAlert(t.enterCreds, 'error');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = t.signingIn;

    const { error } = await window.iboostAuth.signInWithPassword({ email, password });

    submitBtn.disabled = false;
    submitBtn.textContent = t.defaultSubmit;

    if (error) {
      showAlert(error.message || t.genericError, 'error');
      return;
    }

    window.location.replace(t.accountPath);
  });
})();
