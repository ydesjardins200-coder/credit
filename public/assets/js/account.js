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

    // Lazy-init for tabs that need data fetching. Each tab's init
    // function is idempotent — safe to call multiple times.
    if (tabKey === 'budget') {
      // Fire-and-forget. Errors handled inside initBudgetTab.
      initBudgetTab();
    }

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

    // 1. Fetch profile. getProfile() returns the row directly (or null),
    // NOT a {data, error} envelope. (Inconsistent with updateProfile's
    // shape — something to normalize later when touching auth.js.)
    var profile = null;
    try {
      profile = await window.iboostAuth.getProfile();
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
      onfileCountry.textContent = country
        ? window.iboostLocale.getDisplayLabel(country)
        : 'Country not set';
    }

    // 3. Already complete? Show success, hide form, we're done.
    if (window.iboostAuth.isProfileKycComplete && window.iboostAuth.isProfileKycComplete(profile)) {
      incompleteBlock.hidden = true;
      successBlock.hidden = false;
      return;
    }

    // 4. Country-aware labels + DOB max date
    // Pulls labels and placeholders from iboostLocale (CA defaults if null).
    const regionLabel = document.getElementById('profile-form-address-region-label');
    const postalLabel = document.getElementById('profile-form-address-postal-label');
    const regionInput = document.getElementById('profile-form-address-region');
    const postalInput = document.getElementById('profile-form-address-postal');

    const labels = window.iboostLocale.getAddressLabels(country);
    const placeholders = window.iboostLocale.getAddressPlaceholders(country);
    if (regionLabel) regionLabel.textContent = labels.region;
    if (postalLabel) postalLabel.textContent = labels.postal;
    if (regionInput) regionInput.placeholder = placeholders.region;
    if (postalInput) postalInput.placeholder = placeholders.postal;

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
        const regionLabelLower = window.iboostLocale.getAddressLabels(country).region.toLowerCase();
        const regionExample = window.iboostLocale.getAddressPlaceholders(country).region;
        return showErr(
          'Please enter your 2-letter ' + regionLabelLower + ' code (e.g. ' + regionExample + ').'
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
  // Profile tab — identity hero + personal info + credit-goal editor
  // ---------------------------------------------------------------------
  //
  // Called from init() after the top-bar avatar is populated.
  // Responsibilities:
  //   1. Populate identity hero: full name, email, "Member since <Month YYYY>"
  //   2. Populate read-only rows: name, email, phone (formatted), address
  //      (joined), DOB (Month D, YYYY), credit goal (human text)
  //   3. Wire up the per-row credit-goal editor: Edit -> open inline form,
  //      Cancel -> close without save, Save -> updateProfile() -> refresh row

  const GOAL_LABELS = {
    buy_home:      'Buy a home',
    buy_car:       'Buy a car',
    rebuild:       'Rebuild after hardship',
    lower_rates:   'Lower my interest rates',
    business_loan: 'Qualify for a business loan',
    learning:      'Just learning',
    other:         'Other'
  };

  async function initProfileTab(user, firstName) {
    // 1. Identity hero — name + email + member-since
    const fullNameEl = document.getElementById('profile-full-name');
    const emailHeroEl = document.getElementById('profile-email-display');
    const memberSinceEl = document.getElementById('profile-member-since');

    if (fullNameEl) {
      var m = user.user_metadata || {};
      var fullName = m.full_name || m.name ||
        ((m.first_name || '') + ' ' + (m.last_name || '')).trim() ||
        firstName;
      fullNameEl.textContent = fullName;
    }

    if (emailHeroEl) emailHeroEl.textContent = user.email || '(no email)';

    if (memberSinceEl) {
      memberSinceEl.textContent = 'Member since ' + formatMonthYear(user.created_at);
    }

    // 2. Fetch profile for the info rows
    var profile = null;
    try {
      profile = await window.iboostAuth.getProfile();
    } catch (e) {
      console.error('[account] profile-tab getProfile error:', e);
    }

    // Row helpers — write text, leaving dash if value is empty
    function fillRow(id, val) {
      var el = document.getElementById(id);
      if (!el) return;
      el.textContent = (val && String(val).trim()) ? val : '—';
    }

    // Name (from metadata, same derivation as hero)
    (function () {
      var m = user.user_metadata || {};
      var fullName = m.full_name || m.name ||
        ((m.first_name || '') + ' ' + (m.last_name || '')).trim() ||
        firstName;
      fillRow('profile-row-name', fullName);
    })();

    // Email (from session)
    fillRow('profile-row-email', user.email || '');

    // Phone — display as (XXX) XXX-XXXX if NANP shape, else raw
    (function () {
      var raw = (profile && profile.phone) || '';
      var match = raw.match(/^\+?1?(\d{3})(\d{3})(\d{4})$/);
      var display = match ? '(' + match[1] + ') ' + match[2] + '-' + match[3] : raw;
      fillRow('profile-row-phone', display);
    })();

    // Address — joined into one string. Skips blank pieces.
    fillRow('profile-row-address', formatAddress(profile));

    // DOB — "Month D, YYYY"
    fillRow('profile-row-dob', formatLongDate(profile && profile.date_of_birth));

    // Credit goal read display
    renderGoalRead(profile);

    // 3. Wire up the credit-goal editor
    wireGoalEditor(profile);

    // 4. Plan card (migration 0009/0010 wired up at checkout). Populates
    // from profile.plan / plan_currency / plan_activated_at. If the user
    // somehow has no plan, we show a "No plan selected" state and CTA.
    // Awaited because plan metadata now comes from public.plans via
    // window.iboostPlans (migration 0012).
    await initPlanCard(profile);
  }

  // Format ISO date (YYYY-MM-DD or full ISO) as "Month YYYY".
  // Returns "—" if not parsable. Uses UTC so signup-day-boundary is
  // consistent with day-counter logic on Welcome.
  function formatMonthYear(iso) {
    if (!iso) return '—';
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return '—';
      var months = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'];
      return months[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
    } catch (e) {
      return '—';
    }
  }

  // Format YYYY-MM-DD as "Month D, YYYY"
  function formatLongDate(iso) {
    if (!iso) return '';
    try {
      var parts = String(iso).split('T')[0].split('-');
      if (parts.length !== 3) return '';
      var year = parseInt(parts[0], 10);
      var month = parseInt(parts[1], 10);
      var day = parseInt(parts[2], 10);
      if (!year || !month || !day) return '';
      var months = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'];
      return months[month - 1] + ' ' + day + ', ' + year;
    } catch (e) {
      return '';
    }
  }

  function formatAddress(profile) {
    if (!profile) return '';
    var line1 = profile.address_line1 || '';
    var line2 = profile.address_line2 || '';
    var city  = profile.address_city || '';
    var region = profile.address_region || '';
    var postal = profile.address_postal || '';
    var street = line1 + (line2 ? ', ' + line2 : '');
    var cityRegion = [city, region].filter(Boolean).join(', ');
    var tail = [cityRegion, postal].filter(Boolean).join(' ');
    return [street, tail].filter(Boolean).join(', ');
  }

  // Render the credit-goal row's read mode from the profile row. Handles
  // the "other" case where the detail text replaces the kind label as
  // the primary description.
  function renderGoalRead(profile) {
    var kindTextEl = document.getElementById('profile-row-goal-kind-text');
    var detailTextEl = document.getElementById('profile-row-goal-detail-text');
    var editBtn = document.getElementById('profile-goal-edit-btn');
    if (!kindTextEl || !detailTextEl || !editBtn) return;

    var kind = profile && profile.credit_goal_kind;
    var detail = (profile && profile.credit_goal_detail) || '';

    if (!kind) {
      kindTextEl.textContent = '—';
      detailTextEl.hidden = true;
      detailTextEl.textContent = '';
      editBtn.textContent = 'Set';
      return;
    }

    kindTextEl.textContent = GOAL_LABELS[kind] || kind;
    if (detail.trim()) {
      detailTextEl.textContent = '"' + detail.trim() + '"';
      detailTextEl.hidden = false;
    } else {
      detailTextEl.hidden = true;
      detailTextEl.textContent = '';
    }
    editBtn.textContent = 'Edit';
  }

  function wireGoalEditor(initialProfile) {
    const readEl    = document.querySelector('#profile-row-goal .profile-goal-read');
    const formWrap  = document.getElementById('profile-goal-edit-form');
    const editBtn   = document.getElementById('profile-goal-edit-btn');
    const form      = document.getElementById('profile-goal-form');
    const cancelBtn = document.getElementById('profile-goal-cancel-btn');
    const saveBtn   = document.getElementById('profile-goal-save-btn');
    const detailWrap = document.getElementById('profile-goal-edit-detail-wrap');
    const detailOptionality = document.getElementById('profile-goal-edit-detail-optionality');
    const detailInput = document.getElementById('profile-goal-edit-detail');
    const alertEl   = document.getElementById('profile-goal-edit-alert');

    if (!readEl || !formWrap || !editBtn || !form) return;

    // Current profile reference — updated on each successful save so
    // Cancel restores the LATEST saved values, not the first-load ones.
    var current = initialProfile;

    function enterEditMode() {
      // Pre-fill with current saved values
      prefillEditForm(current);
      readEl.hidden = true;
      editBtn.hidden = true;
      formWrap.hidden = false;
      updateDetailVisibility();
      if (alertEl) { alertEl.hidden = true; alertEl.textContent = ''; }
    }

    function exitEditMode() {
      readEl.hidden = false;
      editBtn.hidden = false;
      formWrap.hidden = true;
      if (alertEl) { alertEl.hidden = true; alertEl.textContent = ''; }
    }

    function prefillEditForm(profile) {
      var kind = profile && profile.credit_goal_kind;
      var detail = (profile && profile.credit_goal_detail) || '';
      // Clear all radios first
      form.querySelectorAll('input[name="credit_goal_kind"]').forEach(function (r) {
        r.checked = false;
      });
      if (kind) {
        var radio = form.querySelector('input[name="credit_goal_kind"][value="' + kind + '"]');
        if (radio) radio.checked = true;
      }
      if (detailInput) detailInput.value = detail;
    }

    function updateDetailVisibility() {
      var checked = form.querySelector('input[name="credit_goal_kind"]:checked');
      if (!checked) {
        if (detailWrap) detailWrap.hidden = true;
        return;
      }
      if (detailWrap) detailWrap.hidden = false;
      if (checked.value === 'other') {
        if (detailOptionality) detailOptionality.textContent = '(required)';
        if (detailInput) detailInput.required = true;
      } else {
        if (detailOptionality) detailOptionality.textContent = '(optional)';
        if (detailInput) detailInput.required = false;
      }
    }

    editBtn.addEventListener('click', enterEditMode);
    if (cancelBtn) cancelBtn.addEventListener('click', exitEditMode);

    form.querySelectorAll('input[name="credit_goal_kind"]').forEach(function (r) {
      r.addEventListener('change', updateDetailVisibility);
    });

    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();

      if (alertEl) { alertEl.hidden = true; alertEl.textContent = ''; }

      var checked = form.querySelector('input[name="credit_goal_kind"]:checked');
      if (!checked) return showGoalErr('Please choose a credit goal.');

      var kind = checked.value;
      var detail = (detailInput && detailInput.value || '').trim();
      if (kind === 'other' && !detail) {
        return showGoalErr('Please tell us about your goal in the text box.');
      }

      if (saveBtn) {
        saveBtn.classList.add('is-loading');
        saveBtn.disabled = true;
      }

      try {
        const res = await window.iboostAuth.updateProfile({
          creditGoalKind: kind,
          creditGoalDetail: detail || null
        });
        if (res && res.error) {
          return showGoalErr(res.error.message || 'Could not save. Please try again.');
        }

        // Update our in-memory profile + re-render read mode
        current = current || {};
        current.credit_goal_kind = kind;
        current.credit_goal_detail = detail || null;
        renderGoalRead(current);
        exitEditMode();
      } catch (err) {
        console.error('[account] goal save error:', err);
        showGoalErr('Network error. Please try again.');
      } finally {
        if (saveBtn) {
          saveBtn.classList.remove('is-loading');
          saveBtn.disabled = false;
        }
      }
    });

    function showGoalErr(msg) {
      if (alertEl) {
        alertEl.textContent = msg;
        alertEl.hidden = false;
      }
      if (saveBtn) {
        saveBtn.classList.remove('is-loading');
        saveBtn.disabled = false;
      }
    }
  }

  // ---------------------------------------------------------------------
  // Plan card (Profile tab)
  // ---------------------------------------------------------------------
  // Populates the "Current plan" card with data from profile.plan and
  // friends. Wires:
  //   - "Change plan" button -> /checkout.html?plan=<current>&mode=change
  //   - "View plan history" button -> expands a list from plan_changes
  //
  // Designed to be safe when profile.plan is null (edge case — users
  // who skipped checkout somehow). Shows a friendly "No plan selected"
  // state + CTA to finish signup.

  // PLAN_META used to be a hardcoded object with name/priceCad/priceUsd/
  // perks per plan. It's been replaced with public.plans via
  // window.iboostPlans (migration 0012 + admin edits). The loader has
  // a 24h sessionStorage cache so this page doesn't hammer the DB.
  //
  // Field-name mapping from old PLAN_META to DB shape:
  //   old.name        -> db.name
  //   old.priceCad    -> db.price_cad
  //   old.priceUsd    -> db.price_usd
  //   old.perks       -> db.perks (now array of {text, emphasized, muted})
  //
  // Old perks were strings. New ones are objects. The account page
  // rendering uses the .text field; emphasized/muted flags are ignored
  // here (account dash uses uniform checkmarks — only pricing.html and
  // the admin UI visually differentiate).

  async function initPlanCard(profile) {
    var card = document.getElementById('profile-plan-card');
    if (!card) return;

    var titleEl   = document.getElementById('profile-plan-title');
    var priceEl   = document.getElementById('profile-plan-price');
    var badgeEl   = document.getElementById('profile-plan-badge');
    var perksEl   = document.getElementById('profile-plan-perks');
    var changeBtn = document.getElementById('profile-plan-change-btn');
    var historyBtn= document.getElementById('profile-plan-history-btn');
    var historyEl = document.getElementById('profile-plan-history');
    var historyList = document.getElementById('profile-plan-history-list');

    var plan = (profile && profile.plan) || null;
    var currency = (profile && profile.plan_currency) || 'usd';

    // Fetch plans catalog from DB (with 24h cache). planMap is
    // { free: {...}, essential: {...}, complete: {...} }.
    // On fetch failure, window.iboostPlans falls back to hardcoded
    // FALLBACK_PLANS — account page won't break even if DB is unreachable.
    var planMap = {};
    try {
      if (window.iboostPlans) {
        planMap = await window.iboostPlans.getPlansMap();
      }
    } catch (e) {
      console.warn('[account] plans fetch failed, card will use empty map:', e);
    }

    var meta = plan ? planMap[plan] : null;

    // No plan case — user slipped through signup without checkout.
    // Should be rare (complete-profile now redirects to /checkout), but
    // we're defensive: show a clear "pick a plan" state rather than
    // rendering an empty card.
    if (!meta) {
      if (titleEl) titleEl.textContent = 'No plan selected';
      if (priceEl) priceEl.textContent = 'Finish signup to activate your subscription.';
      if (badgeEl) {
        badgeEl.textContent = 'Pending';
        badgeEl.style.background = '#fef3c7';
        badgeEl.style.color = '#92400e';
      }
      if (perksEl) perksEl.innerHTML = '';
      if (changeBtn) {
        changeBtn.textContent = 'Pick a plan';
        changeBtn.addEventListener('click', function () {
          window.location.href = '/checkout.html';
        });
      }
      if (historyBtn) historyBtn.style.display = 'none';
      return;
    }

    // Plan is set — render the real card.
    if (titleEl) titleEl.textContent = meta.name;

    if (priceEl) {
      var amount = currency === 'cad' ? meta.price_cad : meta.price_usd;
      var currencyLabel = currency === 'cad' ? 'CAD' : 'USD';
      var priceStr = amount === 0
        ? '<strong>Free</strong>'
        : '<strong>$' + amount + ' ' + currencyLabel + '/month</strong>';
      var activated = (profile && profile.plan_activated_at)
        ? formatLongDate(profile.plan_activated_at)
        : null;
      priceEl.innerHTML = priceStr + (activated ? ' · Active since ' + activated : '');
    }

    if (perksEl) {
      // perks is now an array of { text, emphasized, muted } objects.
      // Account dashboard renders all perks with uniform checkmarks,
      // skipping muted ones entirely (they're 'not included' markers
      // meant for comparing tiers on pricing.html, not useful on a
      // single-plan display where they'd look like misplaced negatives).
      var visible = (meta.perks || []).filter(function (p) {
        return p && p.text && !p.muted;
      });
      perksEl.innerHTML = visible.map(function (p) {
        return (
          '<li class="dash-plan-perk">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
              '<polyline points="20 6 9 17 4 12"/>' +
            '</svg>' +
            escapeHtml(p.text) +
          '</li>'
        );
      }).join('');
    }

    // Change/Upgrade plan button — content + destination differs by tier.
    //
    // Free users see "Upgrade plan" with an upward-arrow icon, linking
    // directly to the Essential checkout (the recommended next tier).
    // The visual emphasis matches the matrix doc's intent: Profile is
    // identical for all tiers, but Free's upgrade pathway is the most
    // important conversion surface in the dashboard, so the CTA is
    // tuned to feel like a meaningful action.
    //
    // Paid users see "Change plan" without an icon, linking to checkout
    // with mode=change so they can switch tiers (or downgrade). The
    // mode=change query param tells checkout.html to render the
    // "switching plans" flow rather than the new-signup flow.
    if (changeBtn) {
      var isFree = plan === 'free';

      if (isFree) {
        // Free user: upgrade-styled button with arrow icon
        changeBtn.classList.add('dash-plan-cta-upgrade');
        changeBtn.innerHTML =
          '<span>Upgrade plan</span>' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
                'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" ' +
                'aria-hidden="true" class="dash-plan-cta-icon">' +
            '<line x1="5" y1="12" x2="19" y2="12"/>' +
            '<polyline points="12 5 19 12 12 19"/>' +
          '</svg>';
        changeBtn.addEventListener('click', function () {
          window.location.href = '/checkout.html?plan=essential';
        });
      } else {
        // Paid user: standard "Change plan" CTA
        changeBtn.textContent = 'Change plan';
        changeBtn.addEventListener('click', function () {
          window.location.href = '/checkout.html?plan=' +
            encodeURIComponent(plan) + '&mode=change';
        });
      }
    }

    // View plan history — lazy-load on first click, toggle after that.
    var historyLoaded = false;
    if (historyBtn && historyEl) {
      historyBtn.addEventListener('click', async function () {
        var willShow = historyEl.hidden;
        historyEl.hidden = !willShow;
        historyBtn.setAttribute('aria-expanded', String(willShow));
        historyBtn.textContent = willShow ? 'Hide plan history' : 'View plan history';

        if (willShow && !historyLoaded) {
          historyLoaded = true;
          historyList.innerHTML =
            '<li class="dash-plan-history-empty">Loading…</li>';
          try {
            var res = await window.iboostAuth.getPlanHistory(20);
            if (res.error) throw new Error(res.error.message);
            renderPlanHistory(historyList, res.data);
          } catch (err) {
            historyList.innerHTML =
              '<li class="dash-plan-history-empty">Could not load history.</li>';
          }
        }
      });
    }
  }

  async function renderPlanHistory(listEl, rows) {
    if (!rows || !rows.length) {
      listEl.innerHTML =
        '<li class="dash-plan-history-empty">No plan changes yet.</li>';
      return;
    }

    // Plans catalog for pretty labels. Memory-cached by initPlanCard's
    // earlier call, so this is basically free. Fallback to raw plan_key
    // string if the map isn't available for any reason.
    var planMap = {};
    try {
      if (window.iboostPlans) {
        planMap = await window.iboostPlans.getPlansMap();
      }
    } catch (e) { /* fall through to key-as-label */ }

    function labelFor(key) {
      if (!key) return '(none)';
      return (planMap[key] && planMap[key].name) || key;
    }

    listEl.innerHTML = rows.map(function (r) {
      var fromLabel = labelFor(r.from_plan);
      var toLabel = labelFor(r.to_plan);
      var when = formatLongDate(r.changed_at) || '';
      var sourceHint = r.source === 'signup' ? ' · initial signup' : '';

      return (
        '<li class="dash-plan-history-item">' +
          '<span class="dash-plan-history-item-change">' +
            (r.from_plan
              ? escapeHtml(fromLabel) + ' → ' + escapeHtml(toLabel)
              : 'Signed up on ' + escapeHtml(toLabel)) +
          '</span>' +
          '<span class="dash-plan-history-item-when">' +
            escapeHtml(when) + escapeHtml(sourceHint) +
          '</span>' +
        '</li>'
      );
    }).join('');
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ---------------------------------------------------------------------
  // Permissions: tier-based feature gating
  //
  // Reads data-feature attributes on elements throughout account.html
  // and applies the right state based on the user's plan via
  // window.iboostPermissions:
  //
  //   'allowed'         -> leave element alone
  //   'locked-visible'  -> wrap element children in lock-host structure,
  //                        inject overlay with upgrade pitch
  //   'hidden'          -> set element.hidden = true
  //
  // Lock pattern (matches dash-iblock-locked-* CSS in account.css):
  //
  //   <element data-feature="...">                    <-- becomes lock-host
  //     <div class="dash-iblock-locked-content">      <-- wraps children
  //       ...original children, blurred...
  //     </div>
  //     <div class="dash-iblock-locked-overlay">      <-- injected
  //       <div class="dash-iblock-locked-card">
  //         icon + title + body + CTA
  //       </div>
  //     </div>
  //   </element>
  //
  // Idempotent: running this multiple times produces the same result.
  // Does NOT re-wrap an element that's already wrapped.
  // ---------------------------------------------------------------------

  function applyPermissions(profile, plansMap) {
    if (!window.iboostPermissions) {
      console.warn('[account] iboostPermissions missing — gating disabled');
      return;
    }
    var els = document.querySelectorAll('[data-feature]');
    els.forEach(function (el) {
      var key = el.getAttribute('data-feature');
      if (!key) return;
      var access = window.iboostPermissions.canAccess(key, profile);
      applyAccessToElement(el, key, access, profile, plansMap);
    });
  }

  function applyAccessToElement(el, featureKey, access, profile, plansMap) {
    if (access === 'allowed') {
      // Make sure no leftover lock state from a previous render
      removeLockOverlay(el);
      el.removeAttribute('data-locked');
      return;
    }

    if (access === 'hidden') {
      removeLockOverlay(el);
      el.hidden = true;
      el.setAttribute('data-locked', 'hidden');
      return;
    }

    if (access === 'locked-visible') {
      // Don't double-wrap if we've already locked this element.
      if (el.getAttribute('data-locked') === 'visible') return;

      var pitch = window.iboostPermissions.getPitch(featureKey, profile);
      if (!pitch) {
        // No pitch defined (e.g. score-gated feature). Caller should
        // handle these cases with custom rendering. For now, log and
        // skip — better than rendering an empty overlay.
        console.warn('[account] locked-visible but no pitch for:', featureKey);
        return;
      }
      wrapWithLockOverlay(el, featureKey, pitch, profile, plansMap);
      el.setAttribute('data-locked', 'visible');
    }
  }

  function wrapWithLockOverlay(el, featureKey, pitch, profile, plansMap) {
    // Move existing children into a content wrapper.
    var content = document.createElement('div');
    content.className = 'dash-iblock-locked-content';
    while (el.firstChild) {
      content.appendChild(el.firstChild);
    }

    // Compose the CTA dynamically from plansMap so admin price / name
    // changes flow through. The pitch only carries title + body —
    // price + plan name are NEVER hardcoded in copy. See permissions.js
    // LOCK_PITCHES comment for the contract.
    var recommendedTier = window.iboostPermissions.recommendedTier(featureKey, profile);
    var ctaText = composeCtaText(recommendedTier, profile, plansMap);

    var overlay = document.createElement('div');
    overlay.className = 'dash-iblock-locked-overlay';
    if (recommendedTier) overlay.setAttribute('data-recommended-tier', recommendedTier);

    overlay.innerHTML =
      '<div class="dash-iblock-locked-card">' +
        '<div class="dash-iblock-locked-icon" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
                'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
            '<rect x="3" y="11" width="18" height="11" rx="2"/>' +
            '<path d="M7 11V7a5 5 0 0 1 10 0v4"/>' +
          '</svg>' +
        '</div>' +
        '<h3 class="dash-iblock-locked-title">' + escapeHtml(pitch.title) + '</h3>' +
        '<p class="dash-iblock-locked-pitch">' + escapeHtml(pitch.body) + '</p>' +
        '<a href="/checkout.html?plan=' + encodeURIComponent(recommendedTier || 'essential') +
            '" class="btn btn-primary dash-iblock-locked-cta">' +
          escapeHtml(ctaText) +
        '</a>' +
        '<a href="/pricing.html" class="dash-iblock-locked-secondary">' +
          'See what\'s included' +
        '</a>' +
      '</div>';

    el.classList.add('dash-iblock-locked-host');
    el.appendChild(content);
    el.appendChild(overlay);
  }

  // Builds the CTA button text from the recommended tier's plan data,
  // respecting the user's billing currency. Falls back gracefully when
  // plans data isn't available (network failure, plans-loader disabled).
  //
  // Currency selection:
  //   - Use profile.plan_currency if set ('cad' | 'usd')
  //   - Otherwise default to 'usd' (matches checkout.js fallback)
  //
  // Output format: "Upgrade to {plan.name} — ${price}/mo"
  // Fallback (no plans data): "Upgrade to {Tier name}" (no price shown)
  function composeCtaText(recommendedTier, profile, plansMap) {
    if (!recommendedTier) return 'Upgrade';

    // Capitalized tier name as a final fallback ("essential" -> "Essential")
    var tierLabel = recommendedTier.charAt(0).toUpperCase() + recommendedTier.slice(1);

    if (!plansMap || !plansMap[recommendedTier]) {
      return 'Upgrade to ' + tierLabel;
    }

    var plan = plansMap[recommendedTier];
    var currency = (profile && profile.plan_currency === 'cad') ? 'cad' : 'usd';
    var price = currency === 'cad' ? plan.price_cad : plan.price_usd;

    // If price is missing/null/zero, skip the price portion. Free plan
    // has price_usd: 0 — would produce weird "Upgrade for $0/mo" copy
    // but that's not a real case (lock overlays never recommend Free).
    if (price == null) {
      return 'Upgrade to ' + (plan.name || tierLabel);
    }

    return 'Upgrade to ' + (plan.name || tierLabel) + ' — $' + price + '/mo';
  }

  function removeLockOverlay(el) {
    if (!el.classList.contains('dash-iblock-locked-host')) return;
    // Unwrap: move content children back up, remove overlay
    var content = el.querySelector(':scope > .dash-iblock-locked-content');
    var overlay = el.querySelector(':scope > .dash-iblock-locked-overlay');
    if (content) {
      while (content.firstChild) {
        el.insertBefore(content.firstChild, content);
      }
      content.remove();
    }
    if (overlay) overlay.remove();
    el.classList.remove('dash-iblock-locked-host');
  }

  // ---------------------------------------------------------------------
  // Budget tab — read path
  // ---------------------------------------------------------------------
  //
  // Phase 2 of the free-tier Budget tab implementation. Wires
  // lib/budget.js to the existing visual mock in account.html.
  //
  // States:
  //   1. LOADING — Mock HTML visible while data resolves (~100ms typical).
  //   2. EMPTY — Free user with no entries. All summary stats $0.
  //              Categories section shows "No entries yet". Recent entries
  //              shows empty state with "Add your first entry" CTA.
  //              Goals card hidden (no goals to show).
  //   3. POPULATED — User has entries. Real numbers populated.
  //
  // Lazy-init: this function is called the FIRST time the user activates
  // the Budget tab (not on page load). Tracked by budgetTabInitialized
  // module-level flag. Subsequent activations don't re-fetch — that's the
  // perf sweet spot. Adding entries does an optimistic UI update + targeted
  // refresh in Phase 3 (Add Entry modal).

  // Module-level state for the budget tab (so it's not re-fetched on
  // every activation).
  var budgetTabInitialized = false;
  var budgetCurrentMonthIso = null; // Set on first init; user can change later

  /**
   * Initialize the Budget tab. Idempotent — safe to call multiple times,
   * but only does real work on first call.
   */
  async function initBudgetTab() {
    if (budgetTabInitialized) return;
    budgetTabInitialized = true;

    if (!window.iboostBudget) {
      console.error('[account] iboostBudget lib missing');
      renderBudgetError('Budget data layer not loaded. Refresh the page.');
      return;
    }

    // Use today's date to determine the current month.
    var today = new Date();
    budgetCurrentMonthIso = window.iboostBudget.toMonthStart(today);

    // 1. Ensure the user has starter categories. Idempotent (only seeds
    // if user has zero categories). For a fresh Free user, this creates
    // 16 categories on first Budget tab visit.
    var seedResult = await window.iboostBudget.ensureSeeded();
    if (seedResult.error) {
      console.error('[account] budget seed failed:', seedResult.error);
      renderBudgetError('Failed to set up your budget. Try refreshing.');
      return;
    }

    // 2. Fetch entries + summary for the current month.
    var summaryResult = await window.iboostBudget.getMonthSummary(today);
    if (summaryResult.error) {
      console.error('[account] getMonthSummary failed:', summaryResult.error);
      renderBudgetError('Failed to load your budget data.');
      return;
    }

    // 3. Fetch goals for current month (separate query because UI shows
    // them differently — and a user can have goals without entries, or
    // entries without goals).
    var goalsResult = await window.iboostBudget.getGoalsForMonth(today);
    var goals = goalsResult.error ? [] : goalsResult.data;

    // 4. Render everything.
    renderBudgetSummary(summaryResult.data.summary);
    renderBudgetCategories(summaryResult.data.summary, summaryResult.data.entries);
    renderBudgetGoals(goals, summaryResult.data.summary);
    renderBudgetEntries(summaryResult.data.entries);

    // 5. Wire the "+ Add entry" CTA. The modal itself is Phase 3 work;
    // for now the CTA shows a "coming soon" toast or similar lightweight
    // indication.
    wireAddEntryCta();

    // 6. Wire the "Manage" link → Phase 4 takeover view.
    wireBudgetManageCta();
  }

  /**
   * Render a fatal error in the budget tab. Better than silent failure.
   * Replaces the categories container with an error message; leaves the
   * rest of the mock alone (since that's what's most useful for debugging).
   */
  function renderBudgetError(msg) {
    var catsEl = document.querySelector('[data-budget-categories]');
    if (catsEl) {
      catsEl.innerHTML =
        '<div style="padding:24px;color:#b91c1c;text-align:center;">' +
          '<strong>Budget temporarily unavailable</strong><br>' +
          '<span style="color:#64748b;font-size:0.9rem;">' + escapeHtml(msg) + '</span>' +
        '</div>';
    }
  }

  /**
   * Render the 4 summary cards. Updates textContent only — preserves
   * card structure + classes.
   */
  function renderBudgetSummary(summary) {
    var fmt = window.iboostBudget.formatCents;

    setText('[data-budget-income]', fmt(summary.income_cents));
    setText('[data-budget-spent]', fmt(summary.spent_cents));
    setText('[data-budget-available]', fmt(summary.available_cents));

    // Savings rate is shown as a whole number percentage (e.g., "32" with
    // the % symbol added by surrounding HTML). The lib gives us a 0..1
    // float; round to integer for display.
    var pct = Math.max(0, Math.round((summary.savings_rate || 0) * 100));
    setText('[data-budget-savings-rate]', String(pct));

    // Subtext under each summary number. Phase 2 keeps these static —
    // month-over-month deltas come later (Phase 4+) when we have prior
    // months' data to compare to.
    setText('[data-budget-income-sub]', 'This month');
    setText('[data-budget-spent-sub]', summary.spent_cents > 0 ? 'This month' : 'No spending logged yet');
    setText('[data-budget-available-sub]', summary.income_cents > 0 ? 'Income minus spending' : 'Add income to track');
    setText('[data-budget-savings-sub]', summary.income_cents > 0 ? 'Of income saved' : '—');
  }

  /**
   * Render the spending-by-category bars. Only spending categories
   * (fixed/variable/discretionary) — income and transfers excluded
   * (they're not "spending" in the usual sense).
   *
   * If user has no spending entries, shows an empty state.
   */
  function renderBudgetCategories(summary, entries) {
    var container = document.querySelector('[data-budget-categories]');
    if (!container) return;

    // Filter to spending categories only. Sort by total desc (biggest
    // first) — already done by summarize().
    var spendingCats = (summary.by_category || []).filter(function (c) {
      return c.kind === 'fixed' || c.kind === 'variable' || c.kind === 'discretionary';
    });

    if (spendingCats.length === 0) {
      container.innerHTML =
        '<div class="dash-cats-empty">' +
          '<div class="dash-cats-empty-title">No spending entries yet</div>' +
          '<div class="dash-cats-empty-sub">Add your first entry to see your spending breakdown.</div>' +
        '</div>';
      return;
    }

    // Total spending (denominator for percentages). Already in summary.
    var totalSpent = summary.spent_cents || 1; // avoid div-by-zero (1 cent is harmless visually)

    // Color palette for category bars. Cycles through if many categories.
    // Matches the existing mock palette (visual continuity).
    var COLORS = ['#2ECC71', '#0891b2', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#94a3b8'];

    var html = '';
    spendingCats.forEach(function (cat, idx) {
      var pct = Math.round((cat.total_cents / totalSpent) * 100);
      var color = COLORS[idx % COLORS.length];
      var entryWord = cat.entry_count === 1 ? 'entry' : 'entries';
      var emoji = cat.emoji ? '<span style="margin-right:6px;">' + cat.emoji + '</span>' : '';

      html +=
        '<div class="dash-cat">' +
          '<div class="dash-cat-row">' +
            '<span class="dash-cat-name">' +
              '<span class="dash-cat-dot" style="background:' + color + '"></span>' +
              emoji +
              escapeHtml(cat.category_name) +
            '</span>' +
            '<span class="dash-cat-val">' + window.iboostBudget.formatCents(cat.total_cents) + '</span>' +
          '</div>' +
          '<div class="dash-cat-bar">' +
            '<div class="dash-cat-fill" style="width:' + pct + '%; background:' + color + ';"></div>' +
          '</div>' +
          '<div class="dash-cat-pct">' + pct + '% · ' + cat.entry_count + ' ' + entryWord + '</div>' +
        '</div>';
    });

    container.innerHTML = html;
  }

  /**
   * Render goals card. If user has no goals, hide the entire card
   * (cleaner than showing an empty card with just a "Set a new goal"
   * button — that's discoverable from the main "Add entry" flow later).
   */
  function renderBudgetGoals(goals, summary) {
    var card = document.querySelector('[data-budget-goals-card]');
    var container = document.querySelector('[data-budget-goals]');
    if (!card || !container) return;

    if (!goals || goals.length === 0) {
      card.style.display = 'none';
      return;
    }

    card.style.display = '';

    // Build a per-category-id totals map from the summary for goal progress
    var totalsByCategory = {};
    (summary.by_category || []).forEach(function (c) {
      totalsByCategory[c.category_id] = c.total_cents;
    });

    var fmt = window.iboostBudget.formatCents;
    var html = '';

    goals.forEach(function (g) {
      var actual = totalsByCategory[g.category_id] || 0;
      var target = g.target_cents || 0;

      // Progress percentage — interpretation depends on goal_type.
      // For simplicity in Phase 2 we treat all goals the same: % of target.
      // Phase 5 will refine the visualization per goal_type.
      var pct = target > 0 ? Math.round((actual / target) * 100) : 0;
      var pctCapped = Math.min(100, pct); // bar fill capped at 100% visually

      // Goal status
      var statusClass, statusText;
      if (g.goal_type === 'spend_under') {
        if (pct > 100) { statusClass = 'dash-goal-alert'; statusText = pct + '% used'; }
        else if (pct > 80) { statusClass = ''; statusText = 'Close to limit'; }
        else { statusClass = 'dash-goal-ontrack'; statusText = 'On track'; }
      } else if (g.goal_type === 'save_at_least') {
        statusClass = pct >= 100 ? 'dash-goal-ontrack' : '';
        statusText = pct + '% done';
      } else {
        statusClass = '';
        statusText = pct + '% of target';
      }

      var catName = g.category && g.category.name ? g.category.name : 'Goal';
      var emoji = g.category && g.category.emoji ? g.category.emoji + ' ' : '';

      html +=
        '<div class="dash-goal ' + statusClass + '">' +
          '<div class="dash-goal-head">' +
            '<div class="dash-goal-name">' + emoji + escapeHtml(catName) + '</div>' +
            '<div class="dash-goal-pct">' + statusText + '</div>' +
          '</div>' +
          '<div class="dash-goal-bar"><div class="dash-goal-fill" style="width:' + pctCapped + '%"></div></div>' +
          '<div class="dash-goal-meta">' +
            '<span>' + fmt(actual) + ' ' + (g.goal_type === 'save_at_least' ? 'saved' : 'spent') + '</span>' +
            '<span>' + (g.goal_type === 'spend_under' ? 'Limit ' : 'Target ') + fmt(target) + '</span>' +
          '</div>' +
        '</div>';
    });

    // Keep the "Set a new goal" button at the bottom (UI from existing mock)
    html +=
      '<button type="button" class="dash-new-goal" data-budget-add-goal-cta>' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<line x1="12" y1="5" x2="12" y2="19"/>' +
          '<line x1="5" y1="12" x2="19" y2="12"/>' +
        '</svg>' +
        ' Set a new goal' +
      '</button>';

    container.innerHTML = html;
  }

  /**
   * Render the recent entries list (last 5). Empty state if none.
   */
  function renderBudgetEntries(entries) {
    var container = document.querySelector('[data-budget-tx-list]');
    if (!container) return;

    if (!entries || entries.length === 0) {
      // Empty state — friendly invite to add the first entry.
      container.innerHTML =
        '<div class="dash-tx-empty">' +
          '<div class="dash-tx-empty-title">No entries yet</div>' +
          '<div class="dash-tx-empty-sub">' +
            'Track spending to see how money flows. Manual entry only — your data stays private.' +
          '</div>' +
          '<button type="button" class="btn btn-primary" data-budget-add-entry-cta ' +
                  'style="padding:12px 24px;margin-top:16px;">' +
            '+ Add your first entry' +
          '</button>' +
        '</div>';
      return;
    }

    // Show last 5 entries (already sorted by entry_date desc + created_at desc
    // by lib/budget.js). Anything more should go to a "See all" view (future).
    var recent = entries.slice(0, 5);
    var fmt = window.iboostBudget.formatCents;
    var html = '';

    recent.forEach(function (e) {
      // Format entry_date as "Apr 27" style
      var d = new Date(e.entry_date + 'T00:00:00');
      var dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

      var catName = e.category && e.category.name ? e.category.name : 'Uncategorized';
      var emoji = e.category && e.category.emoji ? e.category.emoji : '💵';
      var note = e.note ? escapeHtml(e.note) : catName;
      var kind = e.category && e.category.kind ? e.category.kind : 'variable';

      // Color and sign based on kind
      var iconBg, iconColor, valPrefix, valColor;
      if (kind === 'income') {
        iconBg = '#dcfce7'; iconColor = '#15803d';
        valPrefix = '+ '; valColor = '#15803d';
      } else if (kind === 'transfer') {
        iconBg = '#dbeafe'; iconColor = '#1d4ed8';
        valPrefix = ''; valColor = '#1d4ed8';
      } else {
        iconBg = '#fef3c7'; iconColor = '#b45309';
        valPrefix = ''; valColor = '#0A2540';
      }

      html +=
        '<div class="dash-tx">' +
          '<div class="dash-tx-ico" style="background:' + iconBg + ';color:' + iconColor + ';font-size:1.2rem;">' +
            emoji +
          '</div>' +
          '<div class="dash-tx-body">' +
            '<div class="dash-tx-name">' + note + '</div>' +
            '<div class="dash-tx-sub">' + dateStr + ' · ' + escapeHtml(catName) + '</div>' +
          '</div>' +
          '<div class="dash-tx-val" style="color:' + valColor + ';">' +
            valPrefix + fmt(e.amount_cents) +
          '</div>' +
        '</div>';
    });

    container.innerHTML = html;
  }

  /**
   * Wire the "+ Add entry" CTAs. Phase 2 just shows a placeholder
   * notification — the actual modal comes in Phase 3.
   *
   * Multiple CTAs may exist on the page (header CTA + empty-state CTA).
   * Wire them all the same way.
   */
  // ---------------------------------------------------------------------
  // Add Entry modal (Phase 3 of Budget tab)
  //
  // Lifecycle:
  //   1. wireAddEntryCta() — runs after Budget tab inits. Wires every
  //      [data-budget-add-entry-cta] button to openAddEntryModal().
  //      Idempotent (data-cta-wired flag prevents re-wiring).
  //   2. wireAddEntryModal() — runs ONCE on first Budget init. Sets up
  //      the modal's internal handlers (close button, backdrop click,
  //      ESC key, form submit, smart-suggestion on note input).
  //   3. openAddEntryModal() — populates category list, resets form,
  //      shows the modal, focuses the amount input.
  //   4. closeAddEntryModal() — hides the modal. Form state is reset
  //      on next open.
  //   5. handleAddEntrySubmit() — validates, calls iboostBudget.addEntry(),
  //      refreshes the Budget tab so the new entry appears.
  //
  // Modal state lives on a module-level object addEntryModalState. We
  // track whether wireAddEntryModal() has already run (to avoid
  // re-wiring on every CTA click) and the cached category list.
  // ---------------------------------------------------------------------

  var addEntryModalState = {
    wired: false,                 // True after wireAddEntryModal() runs
    categoriesLoaded: false,      // True after first openAddEntryModal()
    submitting: false,            // True between submit click and result
    lastSuggestion: null,         // Last suggested category name (for hint)
  };

  function wireAddEntryCta() {
    var ctas = document.querySelectorAll('[data-budget-add-entry-cta]');
    ctas.forEach(function (btn) {
      // Avoid double-wiring on re-render. The Budget tab can re-render
      // when we refresh after a successful save — wireAddEntryCta()
      // gets called again, but every CTA already has its handler.
      if (btn.getAttribute('data-cta-wired') === 'true') return;
      btn.setAttribute('data-cta-wired', 'true');

      btn.addEventListener('click', function (e) {
        e.preventDefault();
        openAddEntryModal();
      });
    });

    // Set up the modal's internal handlers once (close button, backdrop,
    // ESC, form submit). Lazily — only after the user clicks an Add Entry
    // CTA do we actually wire the modal. Saves a few cycles for users
    // who never open it.
    if (!addEntryModalState.wired) {
      wireAddEntryModal();
    }
  }

  function wireAddEntryModal() {
    var modal = document.getElementById('add-entry-modal');
    if (!modal) {
      console.warn('[account] add-entry-modal element not found');
      return;
    }
    addEntryModalState.wired = true;

    // Close handlers — multiple targets all close
    modal.querySelectorAll('[data-add-entry-close]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        closeAddEntryModal();
      });
    });

    // Backdrop click closes modal
    var backdrop = modal.querySelector('[data-add-entry-backdrop]');
    if (backdrop) {
      backdrop.addEventListener('click', closeAddEntryModal);
    }

    // ESC key closes modal (only when modal is open)
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !modal.hasAttribute('hidden')) {
        closeAddEntryModal();
      }
    });

    // Smart category suggestion: as user types in note, scan for
    // known merchants and pre-select category. Override gracefully
    // (user can change the dropdown after the suggestion fires).
    var noteInput = document.getElementById('add-entry-note');
    if (noteInput) {
      noteInput.addEventListener('input', handleNoteInputForSuggestion);
    }

    // Form submit
    var form = document.getElementById('add-entry-form');
    if (form) {
      form.addEventListener('submit', handleAddEntrySubmit);
    }

    // Trap focus inside modal when open (basic accessibility — full
    // focus trap with all focusable elements is overkill for this
    // 4-input form; ESC + click-out cover most cases).
  }

  async function openAddEntryModal() {
    var modal = document.getElementById('add-entry-modal');
    if (!modal) return;

    // Reset form state
    var form = document.getElementById('add-entry-form');
    if (form) form.reset();

    // Reset error state
    hideAddEntryError();

    // Reset suggestion hint
    var hint = document.getElementById('add-entry-suggestion-hint');
    if (hint) hint.hidden = true;
    addEntryModalState.lastSuggestion = null;

    // Set date input to today
    var dateInput = document.getElementById('add-entry-date');
    if (dateInput) {
      dateInput.value = todayIsoDate();
    }

    // Populate category dropdown if not already populated
    if (!addEntryModalState.categoriesLoaded) {
      await loadAddEntryCategories();
    }

    // Show modal
    modal.removeAttribute('hidden');

    // Focus amount input. Small timeout because the modal animation
    // can interfere with focus on some browsers; 50ms is enough.
    setTimeout(function () {
      var amountInput = document.getElementById('add-entry-amount');
      if (amountInput) amountInput.focus();
    }, 50);

    // Prevent body scroll while modal is open (mobile especially)
    document.body.style.overflow = 'hidden';
  }

  function closeAddEntryModal() {
    var modal = document.getElementById('add-entry-modal');
    if (!modal) return;
    modal.setAttribute('hidden', '');
    document.body.style.overflow = '';
  }

  // Format a Date as YYYY-MM-DD in local time. The browser-native
  // <input type="date"> wants this exact format; toISOString() would
  // shift to UTC which is wrong for "today" semantics.
  function todayIsoDate() {
    var d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  async function loadAddEntryCategories() {
    var select = document.getElementById('add-entry-category');
    if (!select) return;

    if (!window.iboostBudget) {
      select.innerHTML = '<option value="">Categories unavailable</option>';
      return;
    }

    var result = await window.iboostBudget.getCategories();
    if (result.error) {
      console.error('[account] getCategories error:', result.error);
      select.innerHTML = '<option value="">Failed to load categories</option>';
      return;
    }

    var cats = result.data || [];
    if (!cats.length) {
      select.innerHTML = '<option value="">No categories available</option>';
      return;
    }

    // Group by kind for the optgroups. Kinds always render in this
    // order so the dropdown has a predictable structure.
    var KIND_ORDER = ['income', 'fixed', 'variable', 'discretionary', 'transfer'];
    var KIND_LABELS = {
      income: 'Income',
      fixed: 'Fixed expenses',
      variable: 'Variable expenses',
      discretionary: 'Discretionary',
      transfer: 'Transfers',
    };

    var byKind = {};
    cats.forEach(function (c) {
      if (!byKind[c.kind]) byKind[c.kind] = [];
      byKind[c.kind].push(c);
    });

    var html = '<option value="">Choose a category…</option>';
    KIND_ORDER.forEach(function (kind) {
      var group = byKind[kind];
      if (!group || !group.length) return;
      html += '<optgroup label="' + escapeHtml(KIND_LABELS[kind]) + '">';
      group.forEach(function (c) {
        var emoji = c.emoji ? c.emoji + ' ' : '';
        html += '<option value="' + escapeHtml(c.id) + '" data-cat-name="' +
          escapeHtml(c.name) + '">' +
          escapeHtml(emoji + c.name) + '</option>';
      });
      html += '</optgroup>';
    });

    select.innerHTML = html;
    addEntryModalState.categoriesLoaded = true;
  }

  function handleNoteInputForSuggestion() {
    if (!window.iboostMerchants) return;

    var noteEl = document.getElementById('add-entry-note');
    var hintEl = document.getElementById('add-entry-suggestion-hint');
    var selectEl = document.getElementById('add-entry-category');
    if (!noteEl || !selectEl) return;

    var noteValue = noteEl.value.trim();
    if (!noteValue) {
      // Note cleared — hide hint, but DON'T clear the user's category
      // selection (they may have manually picked something).
      if (hintEl) hintEl.hidden = true;
      addEntryModalState.lastSuggestion = null;
      return;
    }

    var suggestion = window.iboostMerchants.suggestCategory(noteValue);
    if (!suggestion || suggestion === addEntryModalState.lastSuggestion) return;

    // Find the matching category in the dropdown (by name)
    var matchedOption = null;
    var options = selectEl.querySelectorAll('option[data-cat-name]');
    options.forEach(function (opt) {
      if (opt.getAttribute('data-cat-name') === suggestion) {
        matchedOption = opt;
      }
    });

    if (matchedOption) {
      // Don't override if user has already picked something different
      // intentionally — only auto-fill if the dropdown is at default
      // empty state. Tracking via lastSuggestion: if the current
      // selection matches the LAST suggestion we made, we can update.
      // Otherwise, the user has overridden — leave alone.
      var currentValue = selectEl.value;
      var previousSuggestionId = addEntryModalState.lastSuggestionId || '';
      if (!currentValue || currentValue === previousSuggestionId) {
        selectEl.value = matchedOption.value;
        addEntryModalState.lastSuggestion = suggestion;
        addEntryModalState.lastSuggestionId = matchedOption.value;
        if (hintEl) hintEl.hidden = false;
      }
    }
  }

  async function handleAddEntrySubmit(e) {
    e.preventDefault();
    if (addEntryModalState.submitting) return; // double-submit guard

    var amountEl = document.getElementById('add-entry-amount');
    var dateEl = document.getElementById('add-entry-date');
    var categoryEl = document.getElementById('add-entry-category');
    var noteEl = document.getElementById('add-entry-note');
    var submitBtn = document.getElementById('add-entry-submit');

    hideAddEntryError();

    // Validate amount
    var amountStr = amountEl ? amountEl.value : '';
    var amountCents = window.iboostBudget.parseDollarsToCents(amountStr);
    if (amountCents == null || amountCents <= 0) {
      showAddEntryError('Enter a valid amount greater than $0.');
      if (amountEl) amountEl.focus();
      return;
    }

    // Validate date
    var dateStr = dateEl ? dateEl.value : '';
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      showAddEntryError('Pick a valid date.');
      if (dateEl) dateEl.focus();
      return;
    }

    // Validate category
    var categoryId = categoryEl ? categoryEl.value : '';
    if (!categoryId) {
      showAddEntryError('Pick a category.');
      if (categoryEl) categoryEl.focus();
      return;
    }

    // All good — save.
    addEntryModalState.submitting = true;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving…';
    }

    var result = await window.iboostBudget.addEntry({
      category_id: categoryId,
      entry_date: dateStr,
      amount_cents: amountCents,
      note: noteEl ? noteEl.value.trim() : '',
    });

    addEntryModalState.submitting = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Save entry';
    }

    if (result.error) {
      console.error('[account] addEntry error:', result.error);
      showAddEntryError(
        'Failed to save: ' + (result.error.message || 'Unknown error') + '. Please try again.'
      );
      return;
    }

    // Success! Close modal and refresh the Budget tab to show the new
    // entry. We refresh the whole tab rather than optimistically inject
    // the new row because:
    //   - Summary numbers need recalc (income/spent/available/savings rate)
    //   - Category bars need re-sort (this entry's category may have moved)
    //   - The new entry needs to appear in the recent-entries list
    // Doing a full re-fetch is simpler than 3 surgical updates and the
    // data is small (one DB query).
    closeAddEntryModal();
    refreshBudgetTab();
  }

  function showAddEntryError(msg) {
    var el = document.getElementById('add-entry-error');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
  }

  function hideAddEntryError() {
    var el = document.getElementById('add-entry-error');
    if (!el) return;
    el.textContent = '';
    el.hidden = true;
  }

  // Re-fetches budget data and re-renders the Budget tab. Called after
  // a successful entry save. Bypasses the budgetTabInitialized flag
  // (which prevents double-init on tab switching) — this is an
  // explicit refresh, not a re-init.
  async function refreshBudgetTab() {
    if (!window.iboostBudget) return;

    var today = new Date();
    var summaryResult = await window.iboostBudget.getMonthSummary(today);
    if (summaryResult.error) {
      console.error('[account] refresh getMonthSummary error:', summaryResult.error);
      return;
    }

    var goalsResult = await window.iboostBudget.getGoalsForMonth(today);
    var goals = goalsResult.error ? [] : goalsResult.data;

    renderBudgetSummary(summaryResult.data.summary);
    renderBudgetCategories(summaryResult.data.summary, summaryResult.data.entries);
    renderBudgetGoals(goals, summaryResult.data.summary);
    renderBudgetEntries(summaryResult.data.entries);

    // Re-wire CTAs in case the empty-state CTA got replaced by the
    // populated render. wireAddEntryCta is idempotent.
    wireAddEntryCta();
    wireBudgetManageCta();
  }

  // ---------------------------------------------------------------------
  // Phase 4: Manage categories view
  //
  // Full-screen takeover within the Budget tab. Main view (summary +
  // categories + goals + entries) hides; manage view (kind groups +
  // category rows) shows. Back button reverses.
  //
  // Lifecycle:
  //   wireBudgetManageCta()   — runs from initBudgetTab. Wires the
  //                             "Manage" link to openManageView.
  //                             Idempotent.
  //   openManageView()        — toggles visibility, fetches categories
  //                             (incl. archived), renders the list.
  //   closeManageView()       — reverses + calls refreshBudgetTab so
  //                             any rename/archive/reorder reflects
  //                             in the main Budget view.
  //   renderManageCategories  — builds the DOM for kind groups + rows.
  //                             Called by openManageView and after any
  //                             mutation (rename/archive/reorder/add).
  //
  // Per-row interactions wired by event delegation (single listener on
  // the list container, dispatches based on data-* attributes on the
  // clicked element). This avoids re-wiring 30+ listeners on every
  // re-render after a mutation.
  // ---------------------------------------------------------------------

  // Display order for kind groups. Patrick's order: income at top
  // (where money comes from), then fixed (what you must pay), then
  // variable (necessary but flexes), then discretionary (wants), then
  // transfers (financial moves, not consumption).
  var MANAGE_KIND_ORDER = ['income', 'fixed', 'variable', 'discretionary', 'transfer'];
  var MANAGE_KIND_LABELS = {
    income: 'Income',
    fixed: 'Fixed expenses',
    variable: 'Variable expenses',
    discretionary: 'Discretionary',
    transfer: 'Transfers',
  };
  var MANAGE_KIND_DESCRIPTIONS = {
    income: 'Money coming in',
    fixed: 'Predictable monthly bills',
    variable: 'Necessary but variable spending',
    discretionary: 'Wants, not needs',
    transfer: 'Savings + credit card payments',
  };

  // Kind → color. Used for the colored dot in each group header in
  // the manage view, and reusable for any future kind-based visual
  // indicator (Phase 5 goals will likely want this too).
  // Colors match the iBoost design palette and the existing
  // dash-cat-dot color choices for visual continuity.
  var BUDGET_KIND_COLORS = {
    income:        '#16a34a', // green — money in
    fixed:         '#2ECC71', // emerald — committed monthly bills
    variable:      '#0891b2', // cyan — necessary but variable
    discretionary: '#f59e0b', // amber — wants
    transfer:      '#8b5cf6', // purple — savings/CC payments
  };

  // Module-level flag — true if manage view is currently active.
  // Used by wireBudgetManageCta to know whether to re-wire
  // (idempotency check).
  var manageViewActive = false;
  // True once event delegation is set up on the manage list container
  var manageListWired = false;

  function wireBudgetManageCta() {
    var ctas = document.querySelectorAll('[data-budget-manage-cta]');
    ctas.forEach(function (btn) {
      if (btn.getAttribute('data-cta-wired') === 'true') return;
      btn.setAttribute('data-cta-wired', 'true');
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        openManageView();
      });
    });

    var backBtn = document.querySelector('[data-budget-manage-back]');
    if (backBtn && backBtn.getAttribute('data-cta-wired') !== 'true') {
      backBtn.setAttribute('data-cta-wired', 'true');
      backBtn.addEventListener('click', function (e) {
        e.preventDefault();
        closeManageView();
      });
    }
  }

  async function openManageView() {
    var mainView = document.querySelector('[data-budget-main-view]');
    var manageView = document.querySelector('[data-budget-manage-view]');
    if (!mainView || !manageView) return;

    mainView.setAttribute('hidden', '');
    manageView.removeAttribute('hidden');
    manageViewActive = true;

    // Render the list. This handles fetching categories.
    await renderManageCategoriesView();
  }

  async function closeManageView() {
    var mainView = document.querySelector('[data-budget-main-view]');
    var manageView = document.querySelector('[data-budget-manage-view]');
    if (!mainView || !manageView) return;

    manageView.setAttribute('hidden', '');
    mainView.removeAttribute('hidden');
    manageViewActive = false;

    // Refresh main view in case categories changed (rename/archive/
    // reorder/add all affect the main category bars + recent entries
    // category labels).
    refreshBudgetTab();
  }

  async function renderManageCategoriesView() {
    var listEl = document.querySelector('[data-budget-manage-list]');
    if (!listEl) return;

    if (!window.iboostBudget) {
      listEl.innerHTML = '<p class="dash-manage-loading">Budget library not loaded.</p>';
      return;
    }

    // Fetch ALL categories including archived. Users want to see what
    // they archived (greyed out + striked through) — gives them context
    // and makes the management feel honest.
    var result = await window.iboostBudget.getCategories({ includeArchived: true });
    if (result.error) {
      console.error('[account] manage view getCategories error:', result.error);
      listEl.innerHTML = '<p class="dash-manage-loading">Failed to load categories. Please refresh.</p>';
      return;
    }

    var cats = result.data || [];

    // Group by kind. Within each kind, sort by display_order then by
    // is_archived (active first, archived at bottom of group).
    var byKind = {};
    cats.forEach(function (c) {
      if (!byKind[c.kind]) byKind[c.kind] = [];
      byKind[c.kind].push(c);
    });
    Object.keys(byKind).forEach(function (kind) {
      byKind[kind].sort(function (a, b) {
        if (a.is_archived !== b.is_archived) {
          return a.is_archived ? 1 : -1;
        }
        return (a.display_order || 0) - (b.display_order || 0);
      });
    });

    // Build the HTML. Empty groups (no categories of this kind) still
    // get rendered — empty state inside the group with an Add button,
    // so the user has a path to create their first category of that kind.
    var html = MANAGE_KIND_ORDER.map(function (kind) {
      var group = byKind[kind] || [];
      var activeCount = group.filter(function (c) { return !c.is_archived; }).length;
      var color = BUDGET_KIND_COLORS[kind] || '#94a3b8';

      var groupHtml = '<section class="dash-manage-group" data-manage-kind="' + escapeHtml(kind) + '">' +
        '<div class="dash-manage-group-head">' +
          '<h3 class="dash-manage-group-title">' +
            '<span class="dash-manage-group-dot" style="background:' + color + '"></span>' +
            escapeHtml(MANAGE_KIND_LABELS[kind]) +
            '<span class="dash-manage-group-count">· ' + activeCount + ' active' +
              (group.length > activeCount ? ' · ' + (group.length - activeCount) + ' archived' : '') +
            '</span>' +
          '</h3>' +
        '</div>' +
        '<div class="dash-manage-group-body" data-manage-group-body>';

      if (!group.length) {
        groupHtml += '<div class="dash-manage-empty">No ' + escapeHtml(kind) + ' categories yet.</div>';
      } else {
        // Find the indices of first/last active rows in this group, so
        // we can disable the up/down arrows correctly. Archived rows
        // can't reorder.
        var activeRows = group.filter(function (c) { return !c.is_archived; });
        var firstActiveId = activeRows.length ? activeRows[0].id : null;
        var lastActiveId = activeRows.length ? activeRows[activeRows.length - 1].id : null;

        group.forEach(function (cat) {
          groupHtml += renderManageRow(cat, firstActiveId, lastActiveId);
        });
      }

      groupHtml += '<button type="button" class="dash-manage-add-btn" data-manage-add="' + escapeHtml(kind) + '">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<line x1="12" y1="5" x2="12" y2="19"/>' +
          '<line x1="5" y1="12" x2="19" y2="12"/>' +
        '</svg>' +
        'Add ' + escapeHtml(kind) + ' category' +
      '</button>';

      groupHtml += '</div></section>';
      return groupHtml;
    }).join('');

    listEl.innerHTML = html;

    // Wire up event delegation once. Every row interaction goes through
    // a single listener on the list container, dispatched by data-action
    // attributes. This means re-rendering after a mutation doesn't
    // need to re-wire individual buttons.
    if (!manageListWired) {
      wireManageListDelegation(listEl);
      manageListWired = true;
    }
  }

  // Render a single category row — display state by default. Edit state
  // is built dynamically by enterEditMode (avoids carrying around
  // unused DOM).
  function renderManageRow(cat, firstActiveId, lastActiveId) {
    var emoji = cat.emoji || '•';
    var isFirst = cat.id === firstActiveId;
    var isLast = cat.id === lastActiveId;
    var archivedClass = cat.is_archived ? ' is-archived' : '';

    return '<div class="dash-manage-row' + archivedClass + '" data-cat-id="' + escapeHtml(cat.id) + '">' +
      '<span class="dash-manage-row-emoji">' + escapeHtml(emoji) + '</span>' +
      '<span class="dash-manage-row-name">' + escapeHtml(cat.name) + '</span>' +
      '<span class="dash-manage-archived-tag">Archived</span>' +
      (cat.is_archived ? '' :
        '<div class="dash-manage-row-reorder">' +
          '<button type="button" class="dash-manage-arrow-btn" data-action="move-up" ' +
            (isFirst ? 'disabled' : '') + ' aria-label="Move up" title="Move up">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
              '<polyline points="18 15 12 9 6 15"/>' +
            '</svg>' +
          '</button>' +
          '<button type="button" class="dash-manage-arrow-btn" data-action="move-down" ' +
            (isLast ? 'disabled' : '') + ' aria-label="Move down" title="Move down">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
              '<polyline points="6 9 12 15 18 9"/>' +
            '</svg>' +
          '</button>' +
        '</div>'
      ) +
      '<div class="dash-manage-row-actions">' +
        (cat.is_archived ? '' :
          '<button type="button" class="dash-manage-action-btn" data-action="edit" aria-label="Rename" title="Rename">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
              '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>' +
              '<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>' +
            '</svg>' +
          '</button>' +
          '<button type="button" class="dash-manage-action-btn is-danger" data-action="archive" aria-label="Archive" title="Archive">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
              '<polyline points="21 8 21 21 3 21 3 8"/>' +
              '<rect x="1" y="3" width="22" height="5"/>' +
              '<line x1="10" y1="12" x2="14" y2="12"/>' +
            '</svg>' +
          '</button>'
        ) +
      '</div>' +
    '</div>';
  }

  // Single delegated listener on the list container. Dispatches based
  // on which data-action element was clicked. Built once.
  function wireManageListDelegation(listEl) {
    listEl.addEventListener('click', async function (e) {
      // Closest button with a data-action — handles cases where user
      // clicks the SVG inside the button.
      var actionEl = e.target.closest('[data-action]');
      var addEl = e.target.closest('[data-manage-add]');

      if (actionEl) {
        var action = actionEl.getAttribute('data-action');
        var row = actionEl.closest('[data-cat-id]');
        if (!row) return;
        var catId = row.getAttribute('data-cat-id');

        if (action === 'edit') {
          enterEditMode(row, catId);
        } else if (action === 'archive') {
          await handleArchive(row, catId);
        } else if (action === 'move-up') {
          await handleReorder(catId, 'up');
        } else if (action === 'move-down') {
          await handleReorder(catId, 'down');
        } else if (action === 'edit-save') {
          await handleEditSave(row, catId);
        } else if (action === 'edit-cancel') {
          // Just re-render the row (or the whole view if simpler).
          renderManageCategoriesView();
        } else if (action === 'add-save') {
          var addKind = row.getAttribute('data-adding-kind');
          await handleAddSave(row, addKind);
        } else if (action === 'add-cancel') {
          // Re-render whole view to drop the add-row
          renderManageCategoriesView();
        }
        return;
      }

      if (addEl) {
        var kind = addEl.getAttribute('data-manage-add');
        enterAddMode(addEl, kind);
      }
    });

    // Keyboard: Enter inside an edit input saves; Escape cancels.
    listEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.target.classList.contains('dash-manage-row-edit-name') || e.target.classList.contains('dash-manage-row-edit-emoji'))) {
        e.preventDefault();
        var row = e.target.closest('[data-cat-id]') || e.target.closest('[data-adding-kind]');
        if (!row) return;
        if (row.hasAttribute('data-adding-kind')) {
          handleAddSave(row, row.getAttribute('data-adding-kind'));
        } else {
          handleEditSave(row, row.getAttribute('data-cat-id'));
        }
      } else if (e.key === 'Escape' && (e.target.classList.contains('dash-manage-row-edit-name') || e.target.classList.contains('dash-manage-row-edit-emoji'))) {
        e.preventDefault();
        renderManageCategoriesView();
      }
    });
  }

  // Swap a display-state row to edit-state. Replaces the row's HTML
  // with edit inputs + Save/Cancel buttons. The row keeps its data-cat-id.
  function enterEditMode(row, catId) {
    if (!row) return;
    // Find the category data — we re-fetch from DOM rather than
    // keeping a JS map (simpler, single source of truth).
    var emoji = row.querySelector('.dash-manage-row-emoji').textContent.trim();
    var name = row.querySelector('.dash-manage-row-name').textContent.trim();
    if (emoji === '•') emoji = ''; // placeholder, not real emoji

    row.classList.add('is-editing');
    row.innerHTML =
      '<input type="text" class="dash-manage-row-edit-emoji" maxlength="4" placeholder="🛒" value="' + escapeHtml(emoji) + '" aria-label="Emoji">' +
      '<input type="text" class="dash-manage-row-edit-name" maxlength="60" placeholder="Category name" value="' + escapeHtml(name) + '" aria-label="Category name">' +
      '<div class="dash-manage-edit-actions">' +
        '<button type="button" class="dash-manage-edit-cancel" data-action="edit-cancel">Cancel</button>' +
        '<button type="button" class="dash-manage-edit-save" data-action="edit-save">Save</button>' +
      '</div>';

    // Focus the name input — most common edit
    var nameInput = row.querySelector('.dash-manage-row-edit-name');
    if (nameInput) {
      nameInput.focus();
      nameInput.select();
    }
  }

  async function handleEditSave(row, catId) {
    if (!row) return;
    var nameInput = row.querySelector('.dash-manage-row-edit-name');
    var emojiInput = row.querySelector('.dash-manage-row-edit-emoji');
    var saveBtn = row.querySelector('[data-action="edit-save"]');

    var newName = nameInput ? nameInput.value.trim() : '';
    var newEmoji = emojiInput ? emojiInput.value.trim() : '';

    if (!newName) {
      // Could surface a tiny error — for now just shake or reset focus
      if (nameInput) nameInput.focus();
      return;
    }

    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
    }

    var result = await window.iboostBudget.updateCategory(catId, {
      name: newName,
      emoji: newEmoji || null,
    });

    if (result.error) {
      console.error('[account] updateCategory error:', result.error);
      // Show a brief inline error then re-render
      alert('Failed to save: ' + (result.error.message || 'Unknown error'));
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
      }
      return;
    }

    // Re-render the whole view (simpler than surgical row update;
    // rendering 30 rows is trivial DOM work).
    await renderManageCategoriesView();
  }

  async function handleArchive(row, catId) {
    if (!row) return;
    var name = row.querySelector('.dash-manage-row-name').textContent.trim();

    var ok = window.confirm(
      'Archive "' + name + '"?\n\n' +
      'It will be hidden from new entries, but past entries in this category will keep their history.'
    );
    if (!ok) return;

    var result = await window.iboostBudget.archiveCategory(catId);
    if (result.error) {
      console.error('[account] archiveCategory error:', result.error);
      alert('Failed to archive: ' + (result.error.message || 'Unknown error'));
      return;
    }

    // Re-render — archived row will appear at bottom of group, greyed.
    await renderManageCategoriesView();
  }

  // Reorder a category up or down within its kind group. We compute
  // the new display_order by swapping with the neighbor.
  //
  // Implementation note: rather than re-numbering every row in the
  // group, we just swap the two display_order values. Cheaper, fewer
  // writes, no risk of overflow.
  async function handleReorder(catId, direction) {
    var listEl = document.querySelector('[data-budget-manage-list]');
    if (!listEl) return;

    console.log('[reorder] DEBUG start. catId=', catId, 'direction=', direction);

    // Re-fetch to get current state. Cheap, ensures correctness if
    // the user has been making rapid changes.
    var result = await window.iboostBudget.getCategories({ includeArchived: false });
    if (result.error) {
      console.error('[account] getCategories error:', result.error);
      return;
    }

    var cats = result.data || [];
    var current = cats.find(function (c) { return c.id === catId; });
    if (!current) {
      console.warn('[reorder] DEBUG: current category not found in fetch result');
      return;
    }
    console.log('[reorder] DEBUG: current=', current.name, 'kind=', current.kind, 'display_order=', current.display_order);

    // Find siblings in same kind, sorted by display_order
    var siblings = cats
      .filter(function (c) { return c.kind === current.kind; })
      .sort(function (a, b) { return (a.display_order || 0) - (b.display_order || 0); });

    console.log('[reorder] DEBUG: siblings (sorted)=',
      siblings.map(function (s) { return s.name + '(order=' + s.display_order + ')'; }).join(', '));

    var idx = siblings.findIndex(function (c) { return c.id === catId; });
    var swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    console.log('[reorder] DEBUG: idx=', idx, 'swapIdx=', swapIdx);

    if (swapIdx < 0 || swapIdx >= siblings.length) {
      console.log('[reorder] DEBUG: at edge, no-op');
      return;
    }

    var swapWith = siblings[swapIdx];
    console.log('[reorder] DEBUG: swapWith=', swapWith.name, 'display_order=', swapWith.display_order);

    // Swap their display_order values. Both must be unique enough not
    // to collide. We use the existing values directly.
    var currentOrder = current.display_order;
    var swapOrder = swapWith.display_order;

    // If the two have the SAME display_order (rare but possible — seed
    // sets all to spaced values, but a user could create a new category
    // with default 99 that ties with another), nudge them apart first.
    if (currentOrder === swapOrder) {
      console.log('[reorder] DEBUG: same display_order, nudging apart');
      currentOrder = swapOrder + (direction === 'up' ? -1 : 1);
    }

    console.log('[reorder] DEBUG: about to update', current.name, 'to display_order=', swapOrder);
    console.log('[reorder] DEBUG: about to update', swapWith.name, 'to display_order=', currentOrder);

    // Two updates. We could parallelize via Promise.all but sequential
    // is safer if one fails (we won't end up with half-swapped state).
    var r1 = await window.iboostBudget.updateCategory(catId, { display_order: swapOrder });
    if (r1.error) {
      console.error('[account] reorder updateCategory error (1):', r1.error);
      alert('Failed to reorder: ' + (r1.error.message || 'Unknown error'));
      return;
    }
    console.log('[reorder] DEBUG: r1 success, returned data=', r1.data);

    var r2 = await window.iboostBudget.updateCategory(swapWith.id, { display_order: currentOrder });
    if (r2.error) {
      console.error('[account] reorder updateCategory error (2):', r2.error);
      alert('Reorder partially failed. Refresh the page.');
      return;
    }
    console.log('[reorder] DEBUG: r2 success, returned data=', r2.data);

    console.log('[reorder] DEBUG: re-rendering view');
    await renderManageCategoriesView();
    console.log('[reorder] DEBUG: re-render complete');
  }

  // Show an "add new category" row at the bottom of a kind group.
  // The row uses similar inputs to the edit-state row but doesn't
  // have a data-cat-id (no row exists yet) — it has data-adding-kind.
  function enterAddMode(addBtnEl, kind) {
    // Find the group body containing this Add button
    var groupBody = addBtnEl.closest('[data-manage-group-body]');
    if (!groupBody) return;

    // If already in add-mode for this group, do nothing
    if (groupBody.querySelector('.is-adding')) return;

    // Default emoji per kind — gentle nudge so users don't have to
    // pick one if they don't care
    var DEFAULT_EMOJIS = {
      income: '💵',
      fixed: '🏷️',
      variable: '🛍️',
      discretionary: '🎉',
      transfer: '🔁',
    };
    var defaultEmoji = DEFAULT_EMOJIS[kind] || '•';

    // Build add-row HTML
    var addRow = document.createElement('div');
    addRow.className = 'dash-manage-row is-adding is-editing';
    addRow.setAttribute('data-adding-kind', kind);
    addRow.innerHTML =
      '<input type="text" class="dash-manage-row-edit-emoji" maxlength="4" placeholder="🛒" value="' + escapeHtml(defaultEmoji) + '" aria-label="Emoji">' +
      '<input type="text" class="dash-manage-row-edit-name" maxlength="60" placeholder="New ' + escapeHtml(kind) + ' category" aria-label="Category name">' +
      '<div class="dash-manage-edit-actions">' +
        '<button type="button" class="dash-manage-edit-cancel" data-action="add-cancel">Cancel</button>' +
        '<button type="button" class="dash-manage-edit-save" data-action="add-save">Add</button>' +
      '</div>';

    // Insert right before the "+ Add" button
    groupBody.insertBefore(addRow, addBtnEl);

    // Focus the name input
    var nameInput = addRow.querySelector('.dash-manage-row-edit-name');
    if (nameInput) nameInput.focus();
  }

  async function handleAddSave(row, kind) {
    if (!row) return;
    var nameInput = row.querySelector('.dash-manage-row-edit-name');
    var emojiInput = row.querySelector('.dash-manage-row-edit-emoji');
    var saveBtn = row.querySelector('[data-action="add-save"]');

    var name = nameInput ? nameInput.value.trim() : '';
    var emoji = emojiInput ? emojiInput.value.trim() : '';

    if (!name) {
      if (nameInput) nameInput.focus();
      return;
    }

    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Adding…';
    }

    // Compute a display_order at the END of the kind group. Fetch
    // existing to find max, add 10. Spacing of 10 leaves room for
    // future inserts via reorder without renumbering.
    var existingResult = await window.iboostBudget.getCategories({ includeArchived: false });
    var existing = existingResult.data || [];
    var sameKind = existing.filter(function (c) { return c.kind === kind; });
    var maxOrder = sameKind.reduce(function (m, c) {
      return Math.max(m, c.display_order || 0);
    }, 0);
    var newOrder = maxOrder + 10;

    var result = await window.iboostBudget.addCategory({
      name: name,
      kind: kind,
      emoji: emoji || null,
      display_order: newOrder,
    });

    if (result.error) {
      console.error('[account] addCategory error:', result.error);
      alert('Failed to add: ' + (result.error.message || 'Unknown error'));
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Add';
      }
      return;
    }

    await renderManageCategoriesView();
  }

  /**
   * Tiny helper: set textContent on an element matched by selector.
   * No-op if element not found (defensive — partial DOM updates won't
   * crash the whole render).
   */
  function setText(selector, text) {
    var el = document.querySelector(selector);
    if (el) el.textContent = text;
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

    // Fetch profile + plansMap once and apply tier-based permissions
    // BEFORE any tab content can render. Free users must never see
    // locked content un-overlaid, even briefly. profile fetched here
    // is shared with initProfileTab/initProfileForm later (they
    // re-fetch internally because they're stable functions — small
    // duplication, low cost).
    //
    // plansMap feeds the lock overlay's CTA composition (price + plan
    // name come from public.plans, admin-managed). Use {fresh: true}
    // for the overlay because seeing a stale price after admin edits
    // would silently break the conversion funnel — not worth the
    // 24h cache savings here. The dashboard plan card (initPlanCard)
    // still uses the cache for its own render.
    //
    // If profile fetch fails (network blip, RLS issue), we log + apply
    // permissions with null profile (treats user as Free, locks everything
    // gated). If plansMap fetch fails, the lock overlay's CTA falls
    // back to "Upgrade to Essential" without a price — degraded but
    // not broken. Both fallbacks logged.
    let earlyProfile = null;
    try {
      earlyProfile = await window.iboostAuth.getProfile();
    } catch (e) {
      console.error('[account] early profile fetch failed:', e);
    }
    let earlyPlansMap = null;
    try {
      if (window.iboostPlans) {
        earlyPlansMap = await window.iboostPlans.getPlansMap({ fresh: true });
      }
    } catch (e) {
      console.error('[account] early plans fetch failed:', e);
    }
    applyPermissions(earlyProfile, earlyPlansMap);

    // Email in top bar
    const emailEl = document.getElementById('user-email');
    if (emailEl) emailEl.textContent = user.email || '(no email)';

    // Display name in top bar
    const nameEl = document.getElementById('user-name');
    if (nameEl) nameEl.textContent = firstName;

    // Avatar initials
    const avatarEl = document.getElementById('user-avatar');
    if (avatarEl) avatarEl.textContent = initials;

    // Profile tab (tab 6) — populate identity hero + personal info rows
    // with real data from profiles + session. Credit goal is per-row
    // editable. All other rows are read-only for this wave. See
    // initProfileTab() definition above for details.
    //
    // Runs AFTER the top-bar/avatar population so profileAvatarEl can
    // pick up the initials we derived at the top of init().
    const profileAvatarEl = document.getElementById('profile-avatar');
    if (profileAvatarEl) profileAvatarEl.textContent = initials;

    initProfileTab(user, firstName);

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
