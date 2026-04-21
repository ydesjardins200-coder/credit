// Login page controller.

(function () {
  'use strict';

  const form = document.getElementById('login-form');
  const submitBtn = document.getElementById('submit-btn');
  const alertEl = document.getElementById('alert');

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
    if (session) window.location.replace('/account.html');
  })();

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    clearAlert();

    if (!window.iboostAuth) {
      showAlert('Auth is not configured. Please try again in a moment.', 'error');
      return;
    }

    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    if (!email || !password) {
      showAlert('Please enter your email and password.', 'error');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in…';

    const { error } = await window.iboostAuth.signInWithPassword({ email, password });

    submitBtn.disabled = false;
    submitBtn.textContent = 'Sign in';

    if (error) {
      showAlert(error.message || 'Sign-in failed. Please try again.', 'error');
      return;
    }

    window.location.replace('/account.html');
  });
})();
