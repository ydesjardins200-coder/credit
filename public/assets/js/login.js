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

  // ----- Post-auth routing -----
  // Where does a successfully-authenticated user go from login?
  //   - Complete profile -> /account.html
  //   - Incomplete profile (OAuth user who never filled phone+country,
  //     or legacy password account from before 0003_phone applied)
  //     -> /complete-profile.html
  // Either way the gate on /account.html will enforce the same rule,
  // so this function is purely a UX optimization (go straight to the
  // right page instead of bouncing via /account.html first).
  async function getPostAuthPath() {
    if (!window.iboostAuth || !window.iboostAuth.getProfile) {
      return t.accountPath; // auth module incomplete — safe fallback
    }
    try {
      const profile = await window.iboostAuth.getProfile();
      if (!window.iboostAuth.isProfileComplete(profile)) {
        return '/complete-profile.html';
      }
    } catch (e) {
      // Profile fetch failed — fall through to account; the gate there
      // will re-evaluate and redirect correctly if needed.
    }
    return t.accountPath;
  }

  (async function redirectIfSignedIn() {
    if (!window.iboostAuth) return;
    // Use getSessionSettled (not getSession) so OAuth-returning users
    // whose URL still has a #access_token= are detected once Supabase
    // finishes parsing. Regular page loads skip the wait.
    const { session } = await window.iboostAuth.getSessionSettled();
    if (session) window.location.replace(await getPostAuthPath());
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

    window.location.replace(await getPostAuthPath());
  });

  // Read ?reason=... on load. Surfaced when the user was bounced here
  // from an expired / invalid session elsewhere in the app so they
  // don't wonder why they're suddenly logged out.
  try {
    var reason = new URLSearchParams(window.location.search).get('reason');
    if (reason === 'session_expired') {
      showAlert(
        'Your previous session is no longer valid. Please sign in again.',
        'error'
      );
    }
  } catch (e) { /* URL parsing doesn't block the page */ }
})();
