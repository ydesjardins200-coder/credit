// Account page controller.

(function () {
  'use strict';

  // Derive a display name from session metadata.
  // Falls back gracefully: first_name -> full_name -> email prefix -> "there".
  function deriveFirstName(user) {
    if (!user) return 'there';
    var m = user.user_metadata || {};
    if (m.first_name) return m.first_name;
    if (m.full_name) return m.full_name.split(' ')[0];
    if (m.name) return m.name.split(' ')[0];
    if (user.email) return user.email.split('@')[0];
    return 'there';
  }

  // Derive 1-2 letter initials for the avatar circle.
  function deriveInitials(user) {
    if (!user) return '·';
    var m = user.user_metadata || {};
    var source = m.full_name || m.name || ((m.first_name || '') + ' ' + (m.last_name || '')).trim() || user.email || '';
    var parts = source.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    if (parts.length === 1 && parts[0].length >= 2) {
      // If only 1 word (e.g. email prefix), take first 2 letters
      return parts[0].substring(0, 2).toUpperCase();
    }
    if (parts.length === 1) {
      return parts[0][0].toUpperCase();
    }
    return '·';
  }

  async function init() {
    if (!window.iboostAuth) {
      console.error('[account] iboostAuth missing');
      return;
    }

    const session = await window.iboostAuth.requireSession('/login.html');
    if (!session) return; // redirect already issued

    const user = session.user;
    const firstName = deriveFirstName(user);
    const initials = deriveInitials(user);

    // Email in top bar
    const emailEl = document.getElementById('user-email');
    if (emailEl) emailEl.textContent = user.email || '(no email)';

    // Display name in top bar
    const nameEl = document.getElementById('user-name');
    if (nameEl) nameEl.textContent = firstName;

    // Avatar initials
    const avatarEl = document.getElementById('user-avatar');
    if (avatarEl) avatarEl.textContent = initials;

    // Personalize greeting: "Good afternoon, Marcus."
    const greetingEl = document.getElementById('greeting');
    if (greetingEl) {
      greetingEl.textContent = greetingEl.textContent.replace(/\.$/, ', ' + firstName + '.');
    }

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
