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
  // Budget tab: read path
  //
  // Reads from public.budget_categories / budget_entries / budget_goals
  // (migration 0016) via window.iboostBudget. Replaces the mocked
  // values in the Budget tab markup with real data.
  //
  // Flow on init:
  //   1. ensureSeeded() — if user has 0 categories, creates the 16
  //      starter set (idempotent).
  //   2. getMonthSummary(today) — fetches current month entries +
  //      computes summary stats client-side.
  //   3. Render summary cards, category bars, goals, recent entries.
  //
  // Empty-state handling: if user has no entries this month, the
  // summary cards show $0 and the lists show "Get started" placeholders.
  // The "+ Add entry" button stays visible (Phase 3 wires it up).
  //
  // Defensive design: if any step fails (network error, RLS misconfig,
  // libs not loaded), we log and leave the mock content in place rather
  // than blanking the tab. Mock content is still informative — better
  // than an empty page if data is broken.
  // ---------------------------------------------------------------------

  // Color per category kind. Stable, semantic — reinforces Patrick's
  // 5-kind structural insight (different KINDS of money flow get
  // different colors so users can read the bars at a glance).
  const BUDGET_KIND_COLORS = {
    income:        '#16a34a', // green — money in
    fixed:         '#2ECC71', // emerald — committed monthly
    variable:      '#0891b2', // cyan — necessary but variable
    discretionary: '#f59e0b', // amber — wants
    transfer:      '#8b5cf6', // purple — savings/CC payments
  };

  async function initBudgetTab() {
    if (!window.iboostBudget) {
      console.warn('[account] iboostBudget not loaded — budget tab will show mock data');
      return;
    }

    // 1. Seed if needed. Idempotent — if user already has categories,
    // this is a no-op. New users get the 16 starter categories silently.
    try {
      await window.iboostBudget.ensureSeeded();
    } catch (e) {
      console.error('[account] budget seed failed:', e);
      // Fall through — we can still try to render whatever they have.
    }

    // 2. Fetch entries + summary for the current month.
    const today = new Date();
    const { data, error } = await window.iboostBudget.getMonthSummary(today);
    if (error) {
      console.error('[account] getMonthSummary error:', error);
      return; // leave mock content in place
    }
    if (!data) return;

    const { entries, summary } = data;

    // 3. Render the four pieces.
    renderBudgetSummary(summary);
    renderBudgetCategories(summary.by_category);
    renderBudgetGoals(today); // async — fetches goals separately
    renderBudgetRecentEntries(entries);

    // 4. Wire up the "+ Add entry" CTA (Phase 3 will replace the
    // placeholder click handler with a real modal). For now: tells
    // the user the feature is coming.
    wireBudgetAddEntryCta();
  }

  function renderBudgetSummary(summary) {
    const fmt = window.iboostBudget.formatCents;

    setText('[data-budget-income]', fmt(summary.income_cents));
    setText('[data-budget-spent]', fmt(summary.spent_cents));
    setText('[data-budget-available]', fmt(summary.available_cents));
    setText('[data-budget-savings-rate]', Math.round(summary.savings_rate * 100));

    // Make the "Available" card flip to negative styling if the user
    // overspent (income - spent - transfers < 0). Subtle — most users
    // will be in the green most of the time.
    const availEl = document.querySelector('[data-budget-available]');
    if (availEl) {
      availEl.classList.toggle('dash-sum-val-positive', summary.available_cents >= 0);
      availEl.classList.toggle('dash-sum-val-negative', summary.available_cents < 0);
    }

    // Empty-state copy on subtitles. If income is zero, encourage
    // adding a first entry. Otherwise the default "This month" labels
    // are fine.
    if (summary.income_cents === 0 && summary.spent_cents === 0) {
      setText('[data-budget-income-sub]', 'Add your first entry');
      setText('[data-budget-spent-sub]', 'Add your first entry');
      setText('[data-budget-available-sub]', '—');
      setText('[data-budget-savings-sub]', '—');
    }
  }

  function renderBudgetCategories(byCategory) {
    const container = document.querySelector('[data-budget-categories]');
    if (!container) return;

    // Filter out income/transfer kinds — the "Spending by category" bar
    // chart is for outflows only. Income shows in the summary; transfers
    // are tracked separately.
    const spendCats = (byCategory || []).filter(function (c) {
      return c.kind === 'fixed' || c.kind === 'variable' || c.kind === 'discretionary';
    });

    if (!spendCats.length) {
      container.innerHTML =
        '<div class="dash-cats-empty">' +
          '<p class="dash-cats-empty-title">No spending entries yet</p>' +
          '<p class="dash-cats-empty-sub">' +
            'Tap <strong>+ Add entry</strong> to start tracking your spending.' +
          '</p>' +
        '</div>';
      return;
    }

    // Find the highest spending total — used to scale bar widths so
    // the largest category fills 100% and others scale proportionally.
    var maxTotal = spendCats[0].total_cents;
    var grandTotal = spendCats.reduce(function (sum, c) {
      return sum + c.total_cents;
    }, 0);

    container.innerHTML = spendCats.map(function (cat) {
      var color = BUDGET_KIND_COLORS[cat.kind] || '#94a3b8';
      var barWidth = maxTotal > 0
        ? Math.max(2, Math.round((cat.total_cents / maxTotal) * 100))
        : 0;
      var pctOfTotal = grandTotal > 0
        ? Math.round((cat.total_cents / grandTotal) * 100)
        : 0;
      var emoji = cat.emoji ? cat.emoji + ' ' : '';
      return (
        '<div class="dash-cat">' +
          '<div class="dash-cat-row">' +
            '<span class="dash-cat-name">' +
              '<span class="dash-cat-dot" style="background:' + color + '"></span>' +
              escapeHtml(emoji + cat.category_name) +
            '</span>' +
            '<span class="dash-cat-val">' + window.iboostBudget.formatCents(cat.total_cents) + '</span>' +
          '</div>' +
          '<div class="dash-cat-bar">' +
            '<div class="dash-cat-fill" style="width:' + barWidth + '%; background:' + color + '"></div>' +
          '</div>' +
          '<div class="dash-cat-pct">' + pctOfTotal + '% of spending · ' + cat.entry_count + ' ' +
            (cat.entry_count === 1 ? 'entry' : 'entries') +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  async function renderBudgetGoals(today) {
    const container = document.querySelector('[data-budget-goals]');
    if (!container) return;

    var goalsResult;
    try {
      goalsResult = await window.iboostBudget.getGoalsForMonth(today);
    } catch (e) {
      console.error('[account] getGoalsForMonth error:', e);
      return;
    }
    if (goalsResult.error) {
      console.error('[account] getGoalsForMonth error:', goalsResult.error);
      return;
    }

    var goals = goalsResult.data || [];

    if (!goals.length) {
      container.innerHTML =
        '<div class="dash-goals-empty">' +
          '<p class="dash-goals-empty-title">No goals set</p>' +
          '<p class="dash-goals-empty-sub">' +
            'Set monthly targets like "Spend under $300 on dining" to ' +
            'stay on track.' +
          '</p>' +
        '</div>' +
        '<button type="button" class="dash-new-goal" disabled title="Coming soon">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
                'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" ' +
                'aria-hidden="true">' +
            '<line x1="12" y1="5" x2="12" y2="19"/>' +
            '<line x1="5" y1="12" x2="19" y2="12"/>' +
          '</svg>' +
          'Set a new goal' +
        '</button>';
      // TODO(phase5): wire up the "Set a new goal" button to a goal-edit modal.
      return;
    }

    // Render goals. For now this is a minimal render — future work
    // (Phase 5) will compute progress against actual spending.
    container.innerHTML = goals.map(function (g) {
      var typeLabel = g.goal_type === 'spend_under' ? 'Stay under' :
                      g.goal_type === 'save_at_least' ? 'Save at least' :
                      'Spend exactly';
      var emoji = g.category && g.category.emoji ? g.category.emoji + ' ' : '';
      var catName = g.category ? g.category.name : '(category)';
      return (
        '<div class="dash-goal">' +
          '<div class="dash-goal-head">' +
            '<div class="dash-goal-name">' +
              escapeHtml(emoji + typeLabel + ' ' +
                window.iboostBudget.formatCents(g.target_cents) +
                ' on ' + catName) +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }).join('') +
    '<button type="button" class="dash-new-goal" disabled title="Coming soon">' +
      'Set a new goal' +
    '</button>';
  }

  function renderBudgetRecentEntries(entries) {
    const container = document.querySelector('[data-budget-tx-list]');
    if (!container) return;

    if (!entries || !entries.length) {
      container.innerHTML =
        '<div class="dash-tx-empty">' +
          '<p class="dash-tx-empty-title">No entries yet</p>' +
          '<p class="dash-tx-empty-sub">' +
            'Your recent spending and income will show up here.' +
          '</p>' +
        '</div>';
      return;
    }

    // Show the 5 most recent entries.
    const recent = entries.slice(0, 5);
    container.innerHTML = recent.map(function (e) {
      var kind = (e.category && e.category.kind) || 'variable';
      var color = BUDGET_KIND_COLORS[kind] || '#94a3b8';
      // Background tint = lightened version of color (12% alpha-ish via hex)
      var bgColor = color + '22'; // append low alpha
      var isIncome = kind === 'income';
      var sign = isIncome ? '+' : '−';
      var amountClass = isIncome ? 'dash-tx-amount dash-tx-amount-income' : 'dash-tx-amount';
      var emoji = e.category && e.category.emoji ? e.category.emoji : '•';
      var catName = e.category ? e.category.name : '(uncategorized)';
      var dateStr = formatEntryDate(e.entry_date);
      var label = e.note ? escapeHtml(e.note) : escapeHtml(catName);

      return (
        '<div class="dash-tx">' +
          '<div class="dash-tx-ico" style="background:' + bgColor + '; color:' + color + '; font-size:1.15rem;">' +
            escapeHtml(emoji) +
          '</div>' +
          '<div class="dash-tx-body">' +
            '<div class="dash-tx-merchant">' + label + '</div>' +
            '<div class="dash-tx-meta">' +
              '<span>' + escapeHtml(catName) + '</span>' +
              '<span>·</span>' +
              '<span>' + dateStr + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="' + amountClass + '">' +
            sign + window.iboostBudget.formatCents(e.amount_cents).replace(/^\$/, '$') +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  // Format YYYY-MM-DD as "Today" / "Yesterday" / "Apr 14" / "Mar 22, 2025"
  // depending on how recent. Compact, friendly.
  function formatEntryDate(isoDate) {
    if (!isoDate) return '—';
    var entry = new Date(isoDate + 'T00:00:00');
    if (isNaN(entry.getTime())) return isoDate;

    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    if (entry.getTime() === today.getTime()) return 'Today';
    if (entry.getTime() === yesterday.getTime()) return 'Yesterday';

    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var dayLabel = months[entry.getMonth()] + ' ' + entry.getDate();
    if (entry.getFullYear() !== today.getFullYear()) {
      dayLabel += ', ' + entry.getFullYear();
    }
    return dayLabel;
  }

  function wireBudgetAddEntryCta() {
    // Phase 3 will replace this with a real modal. For now we wire a
    // placeholder that shows a friendly "coming soon" alert — better
    // than a dead button. Idempotent: if already wired, skip.
    var btns = document.querySelectorAll('[data-budget-add-entry-cta]');
    btns.forEach(function (btn) {
      if (btn.getAttribute('data-wired') === 'true') return;
      btn.setAttribute('data-wired', 'true');
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        // TODO(phase3): open the Add Entry modal here. Stub for now.
        alert('The "Add entry" form is coming in the next update.\n\n' +
              'Soon you\'ll be able to log spending and income directly from this tab.');
      });
    });
  }

  // Helper: set text on the first element matching a selector. Silent
  // no-op if element isn't found (some markup is wave-gated and may
  // not be present at all).
  function setText(selector, value) {
    var el = document.querySelector(selector);
    if (el) el.textContent = String(value);
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
  function wireAddEntryCta() {
    var ctas = document.querySelectorAll('[data-budget-add-entry-cta]');
    ctas.forEach(function (btn) {
      // Avoid double-wiring on re-render
      if (btn.getAttribute('data-cta-wired') === 'true') return;
      btn.setAttribute('data-cta-wired', 'true');

      btn.addEventListener('click', function () {
        // TODO(phase-3): open the Add Entry modal.
        // For now, show a placeholder so users know the button works.
        alert('Add Entry coming in the next update! Phase 3 wires the modal.');
      });
    });
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

    // Budget tab — populates summary cards, category bars, goals,
    // recent entries from public.budget_* tables (migration 0016).
    // Eagerly initialized (matches Profile tab pattern). Seeds the
    // 16 starter categories on first visit (idempotent).
    initBudgetTab();

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
