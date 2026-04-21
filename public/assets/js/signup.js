// Signup page controller.

(function () {
  'use strict';

  const form = document.getElementById('signup-form');
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

  // If already signed in, bounce to account page.
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

    const fullName = document.getElementById('full_name').value.trim();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    if (!fullName || !email || password.length < 8) {
      showAlert('Please fill in all fields. Password must be at least 8 characters.', 'error');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating account…';

    const { data, error } = await window.iboostAuth.signUpWithPassword({
      email,
      password,
      fullName,
    });

    submitBtn.disabled = false;
    submitBtn.textContent = 'Create account';

    if (error) {
      showAlert(error.message || 'Sign-up failed. Please try again.', 'error');
      return;
    }

    // If email confirmation is required, session will be null here.
    if (data && data.session) {
      window.location.replace('/account.html');
      return;
    }

    showAlert(
      'Check your email to confirm your account, then sign in.',
      'success'
    );
    form.reset();
  });
})();
