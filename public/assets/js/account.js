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

  // Compute "day N of your credit-building journey" from the user's
  // signup timestamp, write it into the Welcome subtitle. Day 1 is the
  // signup day itself (inclusive) — "day 1 of your journey" means
  // "today is the first day".
  //
  // Uses UTC for both sides to avoid off-by-one near midnight local
  // time. Floors negative values (e.g. clock skew) to 1. Defensive on
  // missing/invalid created_at — falls back to day 1.
  function populateWelcomeDayCount(user) {
    var el = document.getElementById('welcome-day-count');
    var subtitleEl = document.getElementById('welcome-subtitle');
    if (!el) return;

    var days = 1;
    try {
      if (user && user.created_at) {
        var created = new Date(user.created_at);
        if (!isNaN(created.getTime())) {
          var now = new Date();
          // Normalize both to UTC midnight so we're counting whole days
          var createdUtcMs = Date.UTC(
            created.getUTCFullYear(), created.getUTCMonth(), created.getUTCDate()
          );
          var nowUtcMs = Date.UTC(
            now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()
          );
          var diffDays = Math.floor((nowUtcMs - createdUtcMs) / 86400000);
          days = Math.max(1, diffDays + 1); // +1 so signup day = day 1
        }
      }
    } catch (e) { /* fall through to days = 1 */ }

    el.textContent = String(days);

    // Subtitle copy adapts: day 1 gets a welcoming "Let's get started."
    // Days 2+ get the forward-looking "Here's what's next." (mirrors the
    // pre-Wave-1 copy for returning users).
    if (subtitleEl) {
      var suffix = days === 1 ? "Let's get started." : "Here's what's next.";
      subtitleEl.innerHTML =
        "You're on day <strong id=\"welcome-day-count\">" + days +
        "</strong> of your credit-building journey. " + suffix;
    }
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
  // Welcome tab — profile completion form
  // ---------------------------------------------------------------------
  //
  // Shape of the work:
  //   1. Fetch profile (phone, country + 8 KYC columns) via getProfile()
  //   2. Populate the read-only "on file" pill with phone + country
  //   3. If profile is already KYC-complete, show the success card and
  //      hide the form. Otherwise pre-fill any partially-filled values
  //      and wire up interactions.
  //   4. Country determines whether the region label is "Province" or
  //      "State" and the postal-code hint shape.
  //   5. Radio changes reveal/hide the optional "tell us more" textarea,
  //      and mark it required when kind='other'.
  //   6. Typing updates the X-of-7 progress bar live.
  //   7. Submit calls updateProfile(), flips to the success card on
  //      success, or shows an error in the alert div on failure.

  async function initProfileForm(user) {
    // Guard: form might not be on the page (e.g. if we later nuke it
    // via a different wave). All DOM reads below are null-safe.
    const formEl = document.getElementById('profile-form');
    const incompleteBlock = document.getElementById('profile-complete-incomplete');
    const successBlock = document.getElementById('profile-complete-success');
    if (!formEl || !incompleteBlock || !successBlock) return;

    // 1. Fetch profile
    var profile = null;
    try {
      const res = await window.iboostAuth.getProfile();
      profile = res && res.data ? res.data : null;
    } catch (e) {
      console.error('[account] getProfile error:', e);
    }

    // 2. On-file pill — phone + country readable display
    //    Phone: the stored value is +1XXXXXXXXXX (E.164). Format visually.
    const onfilePhone = document.getElementById('profile-onfile-phone');
    if (onfilePhone) {
      var rawPhone = (profile && profile.phone) || '';
      // Display as (XXX) XXX-XXXX if we recognize the NANP shape, else raw
      var display = rawPhone;
      var m = rawPhone.match(/^\+?1?(\d{3})(\d{3})(\d{4})$/);
      if (m) display = '(' + m[1] + ') ' + m[2] + '-' + m[3];
      onfilePhone.textContent = display || 'No phone on file';
    }

    const onfileCountry = document.getElementById('profile-onfile-country');
    const country = (profile && profile.country) || null;
    if (onfileCountry) {
      onfileCountry.textContent =
        country === 'CA' ? '🇨🇦 Canada' :
        country === 'US' ? '🇺🇸 United States' :
        'Country not set';
    }

    // 3. Already complete? Show success, hide form, we're done.
    if (window.iboostAuth.isProfileKycComplete && window.iboostAuth.isProfileKycComplete(profile)) {
      incompleteBlock.hidden = true;
      successBlock.hidden = false;
      return;
    }

    // 4. Country-aware labels + DOB max date
    const regionLabel = document.getElementById('profile-form-address-region-label');
    const postalLabel = document.getElementById('profile-form-address-postal-label');
    const regionInput = document.getElementById('profile-form-address-region');
    const postalInput = document.getElementById('profile-form-address-postal');

    if (country === 'US') {
      if (regionLabel) regionLabel.textContent = 'State';
      if (postalLabel) postalLabel.textContent = 'ZIP code';
      if (regionInput) regionInput.placeholder = 'NY';
      if (postalInput) postalInput.placeholder = '10001';
    } else {
      // CA is the default
      if (regionLabel) regionLabel.textContent = 'Province';
      if (postalLabel) postalLabel.textContent = 'Postal code';
      if (regionInput) regionInput.placeholder = 'QC';
      if (postalInput) postalInput.placeholder = 'H3Z 2Y7';
    }

    // DOB max = today (ISO). Prevents picking future dates in the picker.
    const dobInput = document.getElementById('profile-form-dob');
    if (dobInput) {
      var today = new Date();
      var isoToday =
        today.getFullYear() + '-' +
        String(today.getMonth() + 1).padStart(2, '0') + '-' +
        String(today.getDate()).padStart(2, '0');
      dobInput.max = isoToday;
    }

    // Pre-fill any partially-filled fields. Preserves work across
    // sessions — user filled 3 fields yesterday, finishes today.
    if (profile) {
      if (profile.date_of_birth && dobInput) dobInput.value = profile.date_of_birth;
      var fieldMap = {
        'profile-form-address-line1': profile.address_line1,
        'profile-form-address-line2': profile.address_line2,
        'profile-form-address-city':  profile.address_city,
        'profile-form-address-region': profile.address_region,
        'profile-form-address-postal': profile.address_postal,
        'profile-form-goal-detail':   profile.credit_goal_detail
      };
      Object.keys(fieldMap).forEach(function (id) {
        var el = document.getElementById(id);
        if (el && fieldMap[id]) el.value = fieldMap[id];
      });
      if (profile.credit_goal_kind) {
        var radio = formEl.querySelector('input[name="credit_goal_kind"][value="' + profile.credit_goal_kind + '"]');
        if (radio) radio.checked = true;
      }
    }

    // 5. Credit goal radio → reveal optional detail textarea
    const detailWrap = document.getElementById('profile-goal-detail-wrap');
    const detailLabelOptionality = document.getElementById('profile-goal-detail-optionality');
    const detailInput = document.getElementById('profile-form-goal-detail');

    function updateGoalDetailVisibility() {
      var checked = formEl.querySelector('input[name="credit_goal_kind"]:checked');
      if (!checked) {
        if (detailWrap) detailWrap.hidden = true;
        return;
      }
      if (detailWrap) detailWrap.hidden = false;
      if (checked.value === 'other') {
        if (detailLabelOptionality) detailLabelOptionality.textContent = '(required)';
        if (detailInput) detailInput.required = true;
      } else {
        if (detailLabelOptionality) detailLabelOptionality.textContent = '(optional)';
        if (detailInput) detailInput.required = false;
      }
    }
    formEl.querySelectorAll('input[name="credit_goal_kind"]').forEach(function (r) {
      r.addEventListener('change', function () {
        updateGoalDetailVisibility();
        updateProgress();
      });
    });
    updateGoalDetailVisibility();

    // 6. Progress calculation. 7 required fields:
    //    DOB, line1, city, region, postal, goal_kind + (goal_detail if other)
    //    We count goal_detail toward "fullness" only when kind='other'.
    const progressFilled = document.getElementById('profile-form-progress-filled');
    const progressFill   = document.getElementById('profile-form-progress-fill');
    const progressBarRole = document.getElementById('profile-form-progress-bar-role');

    function updateProgress() {
      var vals = readFormValues();
      var filled = 0;
      if (vals.date_of_birth) filled++;
      if (vals.address_line1) filled++;
      if (vals.address_city) filled++;
      if (vals.address_region && /^[A-Za-z]{2}$/.test(vals.address_region)) filled++;
      if (vals.address_postal) filled++;
      if (vals.credit_goal_kind) filled++;
      // 7th field: detail required only when kind='other'. Otherwise
      // we auto-count it as "not a blocker" toward 7.
      if (vals.credit_goal_kind === 'other') {
        if (vals.credit_goal_detail) filled++;
      } else if (vals.credit_goal_kind) {
        // Non-other goals get the 7th point automatically once a goal is chosen
        filled++;
      }
      filled = Math.min(filled, 7);
      if (progressFilled) progressFilled.textContent = String(filled);
      if (progressFill) progressFill.style.width = (filled / 7 * 100) + '%';
      if (progressBarRole) progressBarRole.setAttribute('aria-valuenow', String(filled));
    }

    function readFormValues() {
      function v(id) {
        var el = document.getElementById(id);
        return el ? el.value.trim() : '';
      }
      var checkedRadio = formEl.querySelector('input[name="credit_goal_kind"]:checked');
      return {
        date_of_birth:      v('profile-form-dob'),
        address_line1:      v('profile-form-address-line1'),
        address_line2:      v('profile-form-address-line2'),
        address_city:       v('profile-form-address-city'),
        address_region:     v('profile-form-address-region'),
        address_postal:     v('profile-form-address-postal'),
        credit_goal_kind:   checkedRadio ? checkedRadio.value : '',
        credit_goal_detail: v('profile-form-goal-detail')
      };
    }

    formEl.querySelectorAll('input, textarea').forEach(function (el) {
      el.addEventListener('input', updateProgress);
      el.addEventListener('change', updateProgress);
    });
    updateProgress();

    // 7. Submit handler
    const submitBtn = document.getElementById('profile-form-submit');
    const alertEl   = document.getElementById('profile-form-alert');

    formEl.addEventListener('submit', async function (ev) {
      ev.preventDefault();

      // Clear previous alerts
      if (alertEl) {
        alertEl.hidden = true;
        alertEl.textContent = '';
      }

      var vals = readFormValues();

      // Client-side validation
      if (!vals.date_of_birth) return showErr('Please enter your date of birth.');
      if (!vals.address_line1) return showErr('Please enter your street address.');
      if (!vals.address_city) return showErr('Please enter your city.');
      if (!/^[A-Za-z]{2}$/.test(vals.address_region)) {
        return showErr(
          country === 'US'
            ? 'Please enter your 2-letter state code (e.g. NY).'
            : 'Please enter your 2-letter province code (e.g. QC).'
        );
      }
      if (!vals.address_postal) return showErr('Please enter your postal/ZIP code.');
      if (!vals.credit_goal_kind) return showErr('Please choose a credit goal.');
      if (vals.credit_goal_kind === 'other' && !vals.credit_goal_detail) {
        return showErr('Please tell us about your goal in the text box.');
      }

      // DOB sanity: 18+
      try {
        var dob = new Date(vals.date_of_birth);
        var eighteen = new Date();
        eighteen.setFullYear(eighteen.getFullYear() - 18);
        if (dob > eighteen) {
          return showErr('You must be 18 or older to use iBoost.');
        }
      } catch (e) {
        return showErr('Please enter a valid date of birth.');
      }

      // Submit
      if (submitBtn) {
        submitBtn.classList.add('is-loading');
        submitBtn.disabled = true;
      }

      try {
        const res = await window.iboostAuth.updateProfile({
          dateOfBirth:      vals.date_of_birth,
          addressLine1:     vals.address_line1,
          addressLine2:     vals.address_line2 || null,
          addressCity:      vals.address_city,
          addressRegion:    vals.address_region,
          addressPostal:    vals.address_postal,
          creditGoalKind:   vals.credit_goal_kind,
          creditGoalDetail: vals.credit_goal_detail || null
        });
        if (res && res.error) {
          return showErr(res.error.message || 'Could not save your profile. Please try again.');
        }
        // Success — flip to success card
        incompleteBlock.hidden = true;
        successBlock.hidden = false;
        // Scroll the success card into view so the state change is visible
        try {
          successBlock.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (e) { /* older browsers */ }
      } catch (err) {
        console.error('[account] profile submit error:', err);
        showErr('Network error. Please try again.');
      } finally {
        if (submitBtn) {
          submitBtn.classList.remove('is-loading');
          submitBtn.disabled = false;
        }
      }
    });

    function showErr(msg) {
      if (alertEl) {
        alertEl.textContent = msg;
        alertEl.hidden = false;
        try { alertEl.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
      }
      if (submitBtn) {
        submitBtn.classList.remove('is-loading');
        submitBtn.disabled = false;
      }
    }
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

    // Day-since-signup counter + subtitle ("You're on day X of your
    // credit-building journey. Let's get started.").
    //
    // Source: auth.users.created_at, available on the session. For
    // Google OAuth users this is the first OAuth return; for password
    // users it's the signUp() call. Both are correct starting points
    // for "joined iBoost on this day."
    //
    // We count whole calendar days from signup-date to today in UTC to
    // avoid the off-by-one that local timezones introduce around
    // midnight. 1-based: the day they signed up IS day 1.
    populateWelcomeDayCount(user);

    // Initialize the profile-completion form on the Welcome tab.
    // Pulls current profile from Supabase, pre-fills existing values,
    // wires up the progress bar, radio show/hide logic, and submit
    // handler. Also flips between the incomplete/complete layouts
    // based on isProfileKycComplete().
    initProfileForm(user);

    // Sign out button
    const signoutBtn = document.getElementById('signout-btn');
    if (signoutBtn) {
      signoutBtn.addEventListener('click', async function () {
        signoutBtn.disabled = true;
        await window.iboostAuth.signOut();
        window.location.replace('/login.html');
      });
    }

    // Redirect on actual sign-out events from other tabs. Intentionally
    // NOT triggered on INITIAL_SESSION-with-null or other null-session
    // emissions — Supabase fires INITIAL_SESSION with session=null during
    // OAuth hash processing, and bouncing on that would break OAuth
    // returns. SIGNED_OUT is the only event that means "the user
    // deliberately ended their session."
    window.iboostAuth.onAuthChange(function (event, s) {
      if (event === 'SIGNED_OUT') {
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
