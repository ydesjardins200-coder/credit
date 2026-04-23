// Account page controller.
//
// Handles:
//   - Session gating (redirects unauthenticated users to /login.html)
//   - User personalization (name in top bar, avatar initials, greeting)
//   - Sign out (button + cross-tab SIGNED_OUT events)
//   - Tab switching between Welcome / Credit / Budget / Education
//   - URL sync via ?tab= query param (shareable, bookmarkable, history-friendly)
//   - Keyboard navigation (left/right arrow keys cycle tabs)
//   - data-goto-tab handler for CTAs inside panels that jump to another tab

(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // Tab list: keep in sync with HTML data-tab attributes. "welcome" is
  // the default when no tab or an unknown tab is specified in the URL.
  // ---------------------------------------------------------------------
  const VALID_TABS = ['welcome', 'credit', 'offers', 'budget', 'education', 'profile'];
  const DEFAULT_TAB = 'welcome';

  // ---------------------------------------------------------------------
  // Personalization helpers
  // ---------------------------------------------------------------------

  // Derive a display name from Supabase session metadata.
  // Falls back: first_name -> full_name -> name -> email prefix -> "there".
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
    var source =
      m.full_name ||
      m.name ||
      ((m.first_name || '') + ' ' + (m.last_name || '')).trim() ||
      user.email ||
      '';
    var parts = source.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    if (parts.length === 1 && parts[0].length >= 2) {
      return parts[0].substring(0, 2).toUpperCase();
    }
    if (parts.length === 1) {
      return parts[0][0].toUpperCase();
    }
    return '·';
  }

  // ---------------------------------------------------------------------
  // Tab switching
  // ---------------------------------------------------------------------

  function getTabFromUrl() {
    try {
      var params = new URLSearchParams(window.location.search);
      var t = (params.get('tab') || '').toLowerCase();
      return VALID_TABS.indexOf(t) >= 0 ? t : DEFAULT_TAB;
    } catch (e) {
      return DEFAULT_TAB;
    }
  }

  function setUrlTab(tabKey) {
    if (!window.history || !window.history.replaceState) return;
    try {
      var params = new URLSearchParams(window.location.search);
      if (tabKey === DEFAULT_TAB) {
        // Clean URL when on default tab — looks nicer
        params.delete('tab');
      } else {
        params.set('tab', tabKey);
      }
      var qs = params.toString();
      var newUrl = '/account.html' + (qs ? '?' + qs : '');
      window.history.replaceState({}, '', newUrl);
    } catch (e) { /* non-fatal */ }
  }

  function activateTab(tabKey) {
    if (VALID_TABS.indexOf(tabKey) < 0) tabKey = DEFAULT_TAB;

    var buttons = document.querySelectorAll('.dash-tab');
    var panels = document.querySelectorAll('.dash-panel');

    buttons.forEach(function (btn) {
      var isActive = btn.getAttribute('data-tab') === tabKey;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      btn.setAttribute('tabindex', isActive ? '0' : '-1');
    });

    panels.forEach(function (panel) {
      var isActive = panel.getAttribute('data-tab-panel') === tabKey;
      if (isActive) {
        panel.removeAttribute('hidden');
      } else {
        panel.setAttribute('hidden', '');
      }
    });

    setUrlTab(tabKey);

    // Scroll to top when switching tabs so users don't land mid-content
    if (window.scrollY > 80) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function initTabs() {
    var buttons = Array.prototype.slice.call(document.querySelectorAll('.dash-tab'));
    if (!buttons.length) return;

    // Click handler on each tab button
    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tabKey = btn.getAttribute('data-tab');
        if (tabKey) activateTab(tabKey);
      });
    });

    // Keyboard: left/right arrows cycle through tabs, Home/End jump to first/last
    document.addEventListener('keydown', function (e) {
      // Only respond if focus is on a tab button (not on form inputs etc.)
      var active = document.activeElement;
      if (!active || !active.classList || !active.classList.contains('dash-tab')) return;

      var currentIndex = buttons.indexOf(active);
      if (currentIndex < 0) return;

      var nextIndex = -1;
      if (e.key === 'ArrowRight') {
        nextIndex = (currentIndex + 1) % buttons.length;
      } else if (e.key === 'ArrowLeft') {
        nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
      } else if (e.key === 'Home') {
        nextIndex = 0;
      } else if (e.key === 'End') {
        nextIndex = buttons.length - 1;
      }

      if (nextIndex >= 0) {
        e.preventDefault();
        var nextBtn = buttons[nextIndex];
        var tabKey = nextBtn.getAttribute('data-tab');
        if (tabKey) activateTab(tabKey);
        nextBtn.focus();
      }
    });

    // CTA buttons inside panels can jump to a specific tab via data-goto-tab.
    // e.g. "Go to Credit tab →" button on Welcome tab.
    document.addEventListener('click', function (e) {
      var target = e.target.closest('[data-goto-tab]');
      if (!target) return;
      e.preventDefault();
      var tabKey = target.getAttribute('data-goto-tab');
      if (tabKey) activateTab(tabKey);
    });

    // Handle browser back/forward if someone uses replaceState and then
    // navigates. (We use replaceState so back button exits the dashboard,
    // which is actually the desired behavior — no history noise.)
    // If ever we switch to pushState, uncomment:
    // window.addEventListener('popstate', function () {
    //   activateTab(getTabFromUrl());
    // });

    // Activate whichever tab the URL asks for (or default)
    activateTab(getTabFromUrl());
  }

  // ---------------------------------------------------------------------
  // Main init
  // ---------------------------------------------------------------------

  async function init() {
    if (!window.iboostAuth) {
      console.error('[account] iboostAuth missing');
      return;
    }

    const session = await window.iboostAuth.requireCompleteProfile({
      loginPath: '/login.html',
      completePath: '/complete-profile.html',
    });
    if (!session) return; // redirect already issued (to login OR complete-profile)

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

    // Profile tab: populate the big identity avatar, full name, and email
    // so the Profile view reflects the real logged-in user — the other
    // data (phone, address, SIN) stays as mockup placeholders for now.
    const profileAvatarEl = document.getElementById('profile-avatar');
    if (profileAvatarEl) profileAvatarEl.textContent = initials;

    const profileFullNameEl = document.getElementById('profile-full-name');
    if (profileFullNameEl) {
      var m = user.user_metadata || {};
      var fullName = m.full_name || m.name ||
        ((m.first_name || '') + ' ' + (m.last_name || '')).trim() ||
        firstName;
      profileFullNameEl.textContent = fullName;
    }

    const profileEmailDisplay = document.getElementById('profile-email-display');
    if (profileEmailDisplay) profileEmailDisplay.textContent = user.email || '(no email)';

    const profileEmailDetail = document.getElementById('profile-email-detail');
    if (profileEmailDetail) profileEmailDetail.textContent = user.email || '(no email)';

    // Personalize the Welcome tab greeting.
    // The inline script in account.html already set "Welcome back." —
    // we replace it with "Welcome back, Marcus."
    const greetingEl = document.getElementById('greeting');
    if (greetingEl) {
      // Replace any trailing period with ", firstName."
      greetingEl.textContent = greetingEl.textContent.replace(/\.$/, ', ' + firstName + '.');
    }

    // Sign out button
    const signoutBtn = document.getElementById('signout-btn');
    if (signoutBtn) {
      signoutBtn.addEventListener('click', async function () {
        signoutBtn.disabled = true;
        await window.iboostAuth.signOut();
        window.location.replace('/login.html');
      });
    }

    // Redirect on sign-out from another tab
    window.iboostAuth.onAuthChange(function (event, s) {
      if (event === 'SIGNED_OUT' || !s) {
        window.location.replace('/login.html');
      }
    });

    // Initialize tab switching (separate from auth so tabs work even if
    // auth resolves late — the panel structure is already in the DOM)
  }

  // Run tab init immediately — doesn't need to wait for auth.
  // Auth-dependent things (name, avatar, etc.) run in init().
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTabs);
  } else {
    initTabs();
  }

  init();
})();
