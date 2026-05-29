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
  // Tab list: keep in sync with HTML data-tab attributes.
  //
  // After Phase D-4, only Welcome remains in the monolith. The tab nav
  // is mostly anchor links to per-tab pages; the Welcome tab is the only
  // <button> remaining (it's the default landing). The tab-switching
  // JS still handles the welcome <button> for keyboard navigation but
  // there's effectively only one tab to switch to in the monolith.
  // Phase D-5 (or Phase E) will decide whether to extract Welcome into
  // its own page or keep it as the post-signup landing experience.
  // ---------------------------------------------------------------------
  const VALID_TABS = ['welcome'];
  const DEFAULT_TAB = 'welcome';

  // ---------------------------------------------------------------------
  // Personalization helpers
  // ---------------------------------------------------------------------

  // deriveFirstName + deriveInitials — delegated to shared/account-shell.js
  // (Phase B of account architecture refactor; see
  // docs/account-architecture.md). The implementations previously lived
  // inline here; they're now in window.iboostAccountShell so future
  // per-tab pages can reuse them. We keep local aliases so existing
  // call sites don't have to change.
  function deriveFirstName(user) {
    return window.iboostAccountShell.deriveFirstName(user);
  }
  function deriveInitials(user) {
    return window.iboostAccountShell.deriveInitials(user);
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

    if (el) el.textContent = String(days);

    // Day-aware greeting headline. Day 1 leads with arrival; returning
    // users get "Welcome back". Uses the first name stashed by
    // personalizeGreeting (falls back to no-name if unavailable).
    var greetingEl = document.getElementById('greeting');
    if (greetingEl) {
      var fn = '';
      try { fn = window.__iboostFirstName || ''; } catch (e) { fn = ''; }
      var suffix = fn ? (', ' + fn + '.') : '.';
      greetingEl.textContent = (days === 1 ? "You're in" : "Welcome back") + suffix;
    }

    // Copy adapts to tenure:
    //   Day 1   — lead with arrival/reassurance, not a hollow "day 1".
    //             The greeting (#greeting) becomes "You're in, [Name]."
    //             (see personalizeGreeting), and the subtitle orients.
    //   Day 2+  — the day-counter becomes meaningful; show the
    //             forward-looking journey line.
    if (subtitleEl) {
      if (days === 1) {
        subtitleEl.innerHTML =
          "Welcome to iBoost. Here\u2019s how we\u2019ll build your credit together \u2014 " +
          "it starts with a few quick details.";
      } else {
        subtitleEl.innerHTML =
          "You're on day <strong id=\"welcome-day-count\">" + days +
          "</strong> of your credit-building journey. Here's what's next.";
      }
    }

    // Expose tenure for the greeting personalizer (day-1 vs returning).
    try { window.__iboostDays = days; } catch (e) { /* noop */ }
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

    // Lazy-init for tabs that need data fetching is no longer needed —
    // Budget (the only tab that needed it) became a standalone page in
    // Phase D-3c. The Budget page does its own initBudgetTab on page
    // load. If a future tab needs lazy data fetching while still in
    // the monolith, add a tabKey check here.

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
    var journeyEl = document.getElementById('welcome-journey');
    if (window.iboostAuth.isProfileKycComplete && window.iboostAuth.isProfileKycComplete(profile)) {
      incompleteBlock.hidden = true;
      successBlock.hidden = false;
      if (journeyEl) journeyEl.setAttribute('data-profile-state', 'complete');
      return;
    }
    if (journeyEl) journeyEl.setAttribute('data-profile-state', 'incomplete');

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

    // DOB dropdowns (day / month / year). Populate options, keep the
    // day count in sync with the selected month/year, and assemble the
    // chosen date back into the hidden #profile-form-dob as an ISO
    // YYYY-MM-DD string so readFormValues() + the save are unchanged.
    const dobInput = document.getElementById('profile-form-dob'); // hidden
    const dobDay = document.getElementById('profile-form-dob-day');
    const dobMonth = document.getElementById('profile-form-dob-month');
    const dobYear = document.getElementById('profile-form-dob-year');

    function daysInMonth(month, year) {
      // month is 1-12. If year unknown, assume a leap year so Feb shows
      // 29 (we don't want to hide a valid day before the year is picked).
      if (!month) return 31;
      var y = year || 2000; // 2000 is a leap year
      return new Date(y, month, 0).getDate(); // day 0 of next month
    }

    function populateDobDays() {
      if (!dobDay) return;
      var prev = dobDay.value;
      var month = parseInt(dobMonth && dobMonth.value, 10) || 0;
      var year = parseInt(dobYear && dobYear.value, 10) || 0;
      var max = daysInMonth(month, year);
      // Rebuild options 1..max, preserving the prior selection if still valid.
      var html = '<option value="">Day</option>';
      for (var d = 1; d <= max; d++) {
        html += '<option value="' + d + '">' + d + '</option>';
      }
      dobDay.innerHTML = html;
      if (prev && parseInt(prev, 10) <= max) dobDay.value = prev;
    }

    function populateDobYears() {
      if (!dobYear) return;
      var nowYear = new Date().getFullYear();
      var maxYear = nowYear - 18; // must be 18+
      var minYear = nowYear - 100;
      var html = '<option value="">Year</option>';
      for (var y = maxYear; y >= minYear; y--) {
        html += '<option value="' + y + '">' + y + '</option>';
      }
      dobYear.innerHTML = html;
    }

    // Sync the hidden ISO input from the three selects. Empty unless all
    // three are chosen — so the existing "please enter your DOB"
    // validation fires naturally when incomplete.
    function syncDobHidden() {
      if (!dobInput) return;
      var d = parseInt(dobDay && dobDay.value, 10) || 0;
      var m = parseInt(dobMonth && dobMonth.value, 10) || 0;
      var y = parseInt(dobYear && dobYear.value, 10) || 0;
      if (d && m && y) {
        dobInput.value = y + '-' +
          String(m).padStart(2, '0') + '-' +
          String(d).padStart(2, '0');
      } else {
        dobInput.value = '';
      }
    }

    populateDobYears();
    populateDobDays();

    if (dobMonth) dobMonth.addEventListener('change', function () {
      populateDobDays(); // month changed → adjust day count
      syncDobHidden();
      updateProgress();
    });
    if (dobYear) dobYear.addEventListener('change', function () {
      populateDobDays(); // year changed → Feb 28/29 correctness
      syncDobHidden();
      updateProgress();
    });
    if (dobDay) dobDay.addEventListener('change', function () {
      syncDobHidden();
      updateProgress();
    });

    // Pre-fill any partially-filled fields. Preserves work across
    // sessions — user filled 3 fields yesterday, finishes today.
    if (profile) {
      // DOB: split a saved ISO date (YYYY-MM-DD) back into the three
      // selects, then sync the hidden input.
      if (profile.date_of_birth) {
        var dobParts = String(profile.date_of_birth).split('-');
        if (dobParts.length === 3) {
          var py = parseInt(dobParts[0], 10);
          var pm = parseInt(dobParts[1], 10);
          var pd = parseInt(dobParts[2], 10);
          if (dobYear && py) dobYear.value = String(py);
          if (dobMonth && pm) dobMonth.value = String(pm);
          populateDobDays(); // rebuild days for the prefilled month/year
          if (dobDay && pd) dobDay.value = String(pd);
          syncDobHidden();
        }
      }
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

    // Submit button + alert element — declared here (before the step
    // controller) because the controller references them in showStep().
    const submitBtn = document.getElementById('profile-form-submit');
    const alertEl   = document.getElementById('profile-form-alert');

    // ---- Step controller (Typeform-style one-step-at-a-time) ----------
    // Reuses readFormValues() + the same validation rules as submit; it
    // only changes PRESENTATION (which fieldset is visible) and gates
    // the final submit behind reaching the last step. Three steps map to
    // the three fieldsets tagged data-step 0/1/2 (DOB / address / goal).
    var stepPanels = Array.prototype.slice.call(
      formEl.querySelectorAll('.profile-step-panel')
    );
    var backBtn = document.getElementById('profile-step-back');
    var nextBtn = document.getElementById('profile-step-next');
    var stepCurrentEl = document.getElementById('profile-step-current');
    var stepDots = Array.prototype.slice.call(
      document.querySelectorAll('[data-step-dot]')
    );
    var TOTAL_STEPS = stepPanels.length; // 3
    var currentStep = 0;

    // Per-step validation. Returns an error string, or null if valid.
    // Mirrors the submit-handler rules exactly, partitioned by step.
    function validateStep(step) {
      var vals = readFormValues();
      if (step === 0) {
        if (!vals.date_of_birth) return 'Please enter your date of birth.';
        try {
          var dob = new Date(vals.date_of_birth);
          var eighteen = new Date();
          eighteen.setFullYear(eighteen.getFullYear() - 18);
          if (dob > eighteen) return 'You must be 18 or older to use iBoost.';
        } catch (e) {
          return 'Please enter a valid date of birth.';
        }
      } else if (step === 1) {
        if (!vals.address_line1) return 'Please enter your street address.';
        if (!vals.address_city) return 'Please enter your city.';
        if (!/^[A-Za-z]{2}$/.test(vals.address_region)) {
          var rl = window.iboostLocale.getAddressLabels(country).region.toLowerCase();
          var rex = window.iboostLocale.getAddressPlaceholders(country).region;
          return 'Please enter your 2-letter ' + rl + ' code (e.g. ' + rex + ').';
        }
        if (!vals.address_postal) return 'Please enter your postal/ZIP code.';
      } else if (step === 2) {
        if (!vals.credit_goal_kind) return 'Please choose a credit goal.';
        if (vals.credit_goal_kind === 'other' && !vals.credit_goal_detail) {
          return 'Please tell us about your goal in the text box.';
        }
      }
      return null;
    }

    function showStep(step) {
      currentStep = step;
      stepPanels.forEach(function (panel, i) {
        panel.hidden = (i !== step);
      });
      // Indicator
      if (stepCurrentEl) stepCurrentEl.textContent = String(step + 1);
      stepDots.forEach(function (dot, i) {
        dot.classList.toggle('is-active', i === step);
        dot.classList.toggle('is-done', i < step);
      });
      // Buttons: Back hidden on first step; Continue vs Save on last.
      if (backBtn) backBtn.hidden = (step === 0);
      var isLast = (step === TOTAL_STEPS - 1);
      if (nextBtn) nextBtn.hidden = isLast;
      if (submitBtn) submitBtn.hidden = !isLast;
      // Clear any stale error when changing step.
      if (alertEl) { alertEl.hidden = true; alertEl.textContent = ''; }
      // Focus the first input of the step for keyboard flow.
      try {
        var firstInput = stepPanels[step].querySelector('input, textarea, select');
        if (firstInput && firstInput.type !== 'radio') firstInput.focus();
      } catch (e) { /* noop */ }
    }

    function goNext() {
      var err = validateStep(currentStep);
      if (err) { showErr(err); return; }
      if (currentStep < TOTAL_STEPS - 1) showStep(currentStep + 1);
    }
    function goBack() {
      if (currentStep > 0) showStep(currentStep - 1);
    }

    if (nextBtn) nextBtn.addEventListener('click', goNext);
    if (backBtn) backBtn.addEventListener('click', goBack);

    // Enter key on a typed field advances (but not in the textarea,
    // where Enter should insert a newline).
    formEl.querySelectorAll('input').forEach(function (inp) {
      inp.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          if (currentStep < TOTAL_STEPS - 1) goNext();
          else if (submitBtn) submitBtn.click();
        }
      });
    });

    // Goal grid auto-advances: picking a goal moves toward submit. But
    // if 'other' is picked (detail required), DON'T auto-advance — the
    // user needs to type in the revealed textarea first.
    formEl.querySelectorAll('input[name="credit_goal_kind"]').forEach(function (r) {
      r.addEventListener('change', function () {
        // updateGoalDetailVisibility already ran (wired earlier).
        // Goal is the last step, so there's no "advance" — instead we
        // surface the Save button prominence. No auto-submit (the user
        // may want to add detail). Nothing to do here beyond what the
        // existing change handler does; kept for clarity/future tweak.
      });
    });

    // Start at step 0.
    showStep(0);

    // ---- Inline per-field validation (green check / red border) -------
    // On blur: mark a field valid (green border + checkmark) or invalid
    // (red border). Rules mirror the step/submit validation. A field is
    // only marked invalid once TOUCHED (blurred) — untouched empty
    // fields stay neutral, so the form isn't a wall of red on load.
    // Optional fields (address line 2) get no state. Toggles .is-valid /
    // .is-invalid on the .profile-form-field wrapper; CSS does the rest.
    function fieldWrap(el) {
      return el ? el.closest('.profile-form-field') : null;
    }
    function setFieldState(wrap, state) {
      if (!wrap) return;
      wrap.classList.toggle('is-valid', state === 'valid');
      wrap.classList.toggle('is-invalid', state === 'invalid');
    }
    // Validate a single text/textarea field by id against a test fn.
    // emptyOk=true means empty is neutral (not invalid) even when touched.
    function wireFieldValidation(id, isValid, emptyOk) {
      var el = document.getElementById(id);
      if (!el) return;
      var wrap = fieldWrap(el);
      function evaluate() {
        var val = el.value.trim();
        if (!val) {
          setFieldState(wrap, emptyOk ? 'neutral' : 'invalid');
          return;
        }
        setFieldState(wrap, isValid(val) ? 'valid' : 'invalid');
      }
      el.addEventListener('blur', evaluate);
      // Once a field is valid, keep it updating live so a correction
      // clears red immediately (only after it's been touched once).
      el.addEventListener('input', function () {
        if (wrap && (wrap.classList.contains('is-valid') || wrap.classList.contains('is-invalid'))) {
          evaluate();
        }
      });
    }

    var nonEmpty = function (v) { return !!v; };
    var twoLetter = function (v) { return /^[A-Za-z]{2}$/.test(v); };

    wireFieldValidation('profile-form-address-line1', nonEmpty, false);
    wireFieldValidation('profile-form-address-city', nonEmpty, false);
    wireFieldValidation('profile-form-address-region', twoLetter, false);
    wireFieldValidation('profile-form-address-postal', nonEmpty, false);
    // Goal detail: only validated as required when kind='other'; handled
    // in the goal-state evaluator below, not as a standalone field.

    // DOB group: one combined state on the DOB row. Valid when all three
    // selects are chosen AND the date is 18+. Evaluated on change (selects
    // don't blur like inputs).
    var dobWrap = dobDay ? dobDay.closest('.profile-form-field') : null;
    function evaluateDob() {
      if (!dobWrap) return;
      var d = parseInt(dobDay && dobDay.value, 10) || 0;
      var m = parseInt(dobMonth && dobMonth.value, 10) || 0;
      var y = parseInt(dobYear && dobYear.value, 10) || 0;
      if (!d || !m || !y) {
        // Partial selection: neutral until all three chosen (don't scold
        // mid-selection), unless they've completed then cleared one.
        setFieldState(dobWrap, 'neutral');
        return;
      }
      // 18+ check
      var ok = true;
      try {
        var dob = new Date(y, m - 1, d);
        var eighteen = new Date();
        eighteen.setFullYear(eighteen.getFullYear() - 18);
        ok = dob <= eighteen;
      } catch (e) { ok = false; }
      setFieldState(dobWrap, ok ? 'valid' : 'invalid');
    }
    [dobDay, dobMonth, dobYear].forEach(function (sel) {
      if (sel) sel.addEventListener('change', evaluateDob);
    });

    // Goal group: green-check when a valid goal is chosen (and, for
    // 'other', the detail is filled). Evaluated on radio change + detail
    // input.
    var goalWrap = null;
    var firstGoalInput = formEl.querySelector('input[name="credit_goal_kind"]');
    if (firstGoalInput) {
      // The goal grid isn't a .profile-form-field; mark the grid itself.
      goalWrap = formEl.querySelector('.profile-goal-grid');
    }
    function evaluateGoal() {
      if (!goalWrap) return;
      var checked = formEl.querySelector('input[name="credit_goal_kind"]:checked');
      if (!checked) { goalWrap.classList.remove('is-valid', 'is-invalid'); return; }
      var ok = true;
      if (checked.value === 'other') {
        var detail = document.getElementById('profile-form-goal-detail');
        ok = !!(detail && detail.value.trim());
      }
      goalWrap.classList.toggle('is-valid', ok);
      goalWrap.classList.toggle('is-invalid', !ok);
    }
    formEl.querySelectorAll('input[name="credit_goal_kind"]').forEach(function (r) {
      r.addEventListener('change', evaluateGoal);
    });
    var goalDetailEl = document.getElementById('profile-form-goal-detail');
    if (goalDetailEl) {
      goalDetailEl.addEventListener('blur', evaluateGoal);
      goalDetailEl.addEventListener('input', evaluateGoal);
    }

    // Pre-filled fields (returning user): evaluate once so already-valid
    // values show green immediately.
    if (profile) {
      ['profile-form-address-line1', 'profile-form-address-city',
       'profile-form-address-region', 'profile-form-address-postal'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el && el.value.trim()) el.dispatchEvent(new Event('blur'));
      });
      evaluateDob();
      evaluateGoal();
    }

    // 7. Submit handler
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

  // escapeHtml — delegated to shared/dom-utils.js (Phase A of the
  // account architecture refactor; see docs/account-architecture.md).
  // The function previously lived inline here AND in checkout.js as
  // byte-identical duplicates. Now there's one source of truth in
  // window.iboostShared.escapeHtml. We keep a local alias so the many
  // existing call sites don't have to change.
  function escapeHtml(s) {
    return window.iboostShared.escapeHtml(s);
  }

  // ---------------------------------------------------------------------
  // Permissions: tier-based feature gating
  //
  // Logic lives in lib/permissions.js (window.iboostPermissions).
  // DOM rendering (apply gates to all [data-feature] elements) lives
  // in shared/permissions-render.js (window.iboostPermissionsRender).
  // The thin wrapper below keeps the existing boot-time call working
  // without forcing every caller to know the new module name.
  // ---------------------------------------------------------------------

  function applyPermissions(profile, plansMap) {
    // Delegated to shared/permissions-render.js (Phase D-1a of account
    // architecture refactor; see docs/account-architecture.md). The
    // helpers that previously lived inline here (applyAccessToElement,
    // wrapWithLockOverlay, composeCtaText, removeLockOverlay) are now
    // private inside the shared module — only `apply` is exposed since
    // that's the only function called from outside the module.
    //
    // We keep this thin wrapper named applyPermissions so the existing
    // boot-time call site (in init() below) doesn't have to change.
    // Future per-tab pages will call iboostPermissionsRender.apply()
    // directly without needing this wrapper.
    if (window.iboostPermissionsRender) {
      window.iboostPermissionsRender.apply(profile, plansMap);
    } else {
      console.warn('[account] iboostPermissionsRender missing — gating disabled');
    }
  }

  // BUDGET-TAB CODE EXTRACTED — Phase D-3c of account-architecture
  // refactor. The Budget tab JS (~4,000 lines: initBudgetTab,
  // refreshBudgetTab, all the renderers, modal systems, manage
  // categories view, CSV import wizard) now lives in
  // public/assets/js/account/budget.js and is loaded only by the
  // /account/budget page. The 5 modal blocks that lived at body-level
  // in account.html have moved with it. See
  // docs/account-architecture.md for the full plan.

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
    // is shared with initProfileForm later (which re-fetches internally
    // because it's a stable function — small duplication, low cost).
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

    // Top-bar user info — delegated to shell (Phase B). Populates
    // #user-email, #user-name, #user-avatar atomically. The shell
    // version is defensive against missing elements (e.g., a future
    // minimal page without an avatar would still work).
    window.iboostAccountShell.populateUserInfo(user, firstName, initials);

    // Profile tab init removed — Profile is now a standalone page at
    // /account/profile (Phase D-1b of account-architecture refactor).
    // The Profile page does its own initProfileTab + identity-avatar
    // population in account/profile.js. The monolith no longer has a
    // #profile-avatar element to populate.

    // Personalize the Welcome tab greeting. The exact wording (day-1
    // "You're in, X." vs returning "Welcome back, X.") is decided in
    // populateWelcomeDayCount where tenure is known; here we just stash
    // the first name for it to use. Fallback: if the day function
    // somehow doesn't run, set a sensible default now.
    const greetingEl = document.getElementById('greeting');
    if (greetingEl) {
      try { window.__iboostFirstName = firstName; } catch (e) { /* noop */ }
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

    // Sign-out button + cross-tab SIGNED_OUT redirect — delegated to
    // shell (Phase B). The shell version preserves the same behavior:
    // click → disable button → signOut → redirect; SIGNED_OUT events
    // (and only those, not INITIAL_SESSION-with-null) trigger a
    // redirect to /login.html. Idempotent.
    window.iboostAccountShell.wireSignout();

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
