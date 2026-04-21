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

  // ----- FAQ mini accordion (in intro column) -----
  // Self-contained; matches the behavior in signup.js so both auth pages
  // feel identical when users toggle the help panels.
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
  const pwInput = document.getElementById('password');
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
      // Keep focus on the input and place caret at end.
      pwInput.focus();
      const val = pwInput.value;
      pwInput.value = '';
      pwInput.value = val;
    });
  }

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
