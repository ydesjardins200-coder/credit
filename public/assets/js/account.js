// Account page controller.

(function () {
  'use strict';

  async function init() {
    if (!window.iboostAuth) {
      console.error('[account] iboostAuth missing');
      return;
    }

    const session = await window.iboostAuth.requireSession('/login.html');
    if (!session) return; // redirect already issued

    const emailEl = document.getElementById('user-email');
    if (emailEl) emailEl.textContent = session.user.email || '(no email)';

    const signoutBtn = document.getElementById('signout-btn');
    if (signoutBtn) {
      signoutBtn.addEventListener('click', async function () {
        signoutBtn.disabled = true;
        await window.iboostAuth.signOut();
        window.location.replace('/login.html');
      });
    }

    // Redirect on sign-out from another tab.
    window.iboostAuth.onAuthChange(function (event, s) {
      if (event === 'SIGNED_OUT' || !s) {
        window.location.replace('/login.html');
      }
    });
  }

  init();
})();
