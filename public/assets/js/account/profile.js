/**
 * Profile page — standalone page boot.
 *
 * Second per-tab page extracted from account.html (Phase D-1b of the
 * account-architecture refactor; see docs/account-architecture.md).
 *
 * Education (Phase C) was the smoke test — pure HTML/CSS, no
 * tab-specific JS. Profile is the real test: ~500 lines of carefully-
 * coupled rendering logic for the identity hero, info rows, credit-
 * goal editor, plan card, and plan-change history.
 *
 * Page boot:
 *   1. Wait for auth via iboostAuth (redirect to login if absent)
 *   2. Derive name/initials, populate top-bar via shell helpers
 *   3. Wire signout via shell helper
 *   4. Run initProfileTab(user, firstName) — the original Profile-tab
 *      init logic, byte-identical to what previously ran in account.js
 *
 * Notable: this page does NOT load shared/permissions-render.js
 * because the Profile panel HTML has zero [data-feature] attributes
 * (verified during extraction). It also doesn't load lib/permissions.js
 * because nothing in the Profile-tab JS actually calls iboostPermissions
 * — the Plan card reads profile.plan directly. If future Profile features
 * become tier-gated via the data-feature pattern OR start calling
 * iboostPermissions.getTier()/canAccess(), add the appropriate script
 * tags in profile.html.
 *
 * What's NOT here: the Welcome-tab KYC form (initProfileForm in
 * account.js). Despite the misleading name, that function targets
 * Welcome-tab DOM IDs (#profile-form, #profile-onfile-*, etc.) and
 * stays in the monolith until Welcome itself is extracted.
 */
(function () {
  'use strict';

  // Local alias so the code below can keep using `escapeHtml(...)` —
  // unchanged from when it lived inside account.js's IIFE. The shared
  // version lives at window.iboostShared.escapeHtml.
  function escapeHtml(s) {
    return window.iboostShared.escapeHtml(s);
  }

  // ===================================================================
  // Profile tab — identity hero + personal info + credit-goal editor
  // ===================================================================
  //
  // Surfaces:
  //   - Identity hero card (avatar + name + email + member-since)
  //   - Info rows (name/email/phone/address/DOB) — read-only
  //   - Credit goal row — per-row inline editor
  //      Edit -> form swaps in, Cancel -> close without save,
  //      Save -> updateProfile() -> refresh row content
  //   - Plan card — current plan + benefits + change-plan CTA
  //   - Plan change history (expandable)

  // Credit-goal labels — maps the DB-stored kind to the human-readable
  // string we show in the read-mode goal display. Used by renderGoalRead
  // when displaying a user's saved goal. The Welcome-tab KYC form
  // (account.js's initProfileForm) doesn't need these labels — its
  // goal radios are labeled directly in the HTML markup.
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

    // 3b. Wire up the phone + address inline editors. Both follow the
    // goal-editor pattern (Edit -> form -> Save -> updateProfile ->
    // refresh row). The @iboost.test clear-affordance lives inside them.
    wirePhoneEditor(user, profile);
    wireAddressEditor(user, profile);

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

  // Is this a dummy/test account? Test users (@iboost.test) are allowed
  // to CLEAR required fields, which re-triggers the Welcome KYC — a
  // re-test affordance, NOT a real feature. This is a client-side
  // convenience only (not server-enforced); real users can't blank
  // required fields through the UI. Clearly intentional for dev data.
  function isTestUser(user) {
    var email = (user && user.email ? String(user.email) : '').toLowerCase();
    return email.endsWith('@iboost.test');
  }

  // Live NANP phone formatter + validator — mirrors signup.js so the
  // stored format (formatted '(NXX) NXX-XXXX' string) round-trips.
  function formatPhoneLive(rawValue) {
    var digits = (rawValue || '').replace(/\D/g, '').slice(0, 10);
    if (digits.length === 0) return '';
    if (digits.length < 4)  return '(' + digits;
    if (digits.length < 7)  return '(' + digits.slice(0, 3) + ') ' + digits.slice(3);
    return '(' + digits.slice(0, 3) + ') ' + digits.slice(3, 6) + '-' + digits.slice(6, 10);
  }
  var PHONE_VALID_RE = /^\([2-9]\d{2}\)\s\d{3}-\d{4}$/;

  // ---- Phone editor ----------------------------------------------------
  function wirePhoneEditor(user, initialProfile) {
    var rowVal   = document.getElementById('profile-row-phone');
    var editBtn  = document.getElementById('profile-phone-edit-btn');
    var formWrap = document.getElementById('profile-phone-edit-form');
    var form     = document.getElementById('profile-phone-form');
    var input    = document.getElementById('profile-phone-input');
    var cancelBtn= document.getElementById('profile-phone-cancel-btn');
    var saveBtn  = document.getElementById('profile-phone-save-btn');
    var alertEl  = document.getElementById('profile-phone-edit-alert');
    var hintEl   = document.getElementById('profile-phone-hint');
    if (!rowVal || !editBtn || !form || !input) return;

    var current = initialProfile || {};
    var testUser = isTestUser(user);

    if (hintEl && testUser) {
      hintEl.textContent = 'Test account: you may clear this to re-trigger sign-up checks.';
    }

    // Live formatting as the user types.
    input.addEventListener('input', function () {
      var f = formatPhoneLive(input.value);
      if (input.value !== f) input.value = f;
    });

    function display(raw) {
      var m = (raw || '').match(/^\+?1?(\d{3})(\d{3})(\d{4})$/);
      return m ? '(' + m[1] + ') ' + m[2] + '-' + m[3] : (raw || '');
    }

    function enter() {
      input.value = display(current.phone || '');
      rowVal.hidden = true; editBtn.hidden = true; formWrap.hidden = false;
      if (alertEl) { alertEl.hidden = true; alertEl.textContent = ''; }
      input.focus();
    }
    function exit() {
      rowVal.hidden = false; editBtn.hidden = false; formWrap.hidden = true;
      if (alertEl) { alertEl.hidden = true; alertEl.textContent = ''; }
    }
    function err(msg) {
      if (alertEl) { alertEl.textContent = msg; alertEl.hidden = false; }
      if (saveBtn) { saveBtn.classList.remove('is-loading'); saveBtn.disabled = false; }
    }

    editBtn.addEventListener('click', enter);
    if (cancelBtn) cancelBtn.addEventListener('click', exit);

    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      if (alertEl) { alertEl.hidden = true; alertEl.textContent = ''; }
      var val = input.value.trim();

      if (!val) {
        // Empty: allowed only for test users (clears phone).
        if (!testUser) return err('Please enter a phone number.');
      } else if (!PHONE_VALID_RE.test(val)) {
        return err('Please enter a valid phone number, e.g. (514) 555-0100.');
      }

      if (saveBtn) { saveBtn.classList.add('is-loading'); saveBtn.disabled = true; }
      try {
        // updateProfile only writes phone when truthy; to CLEAR it for a
        // test user we must write null explicitly via a direct field.
        var payload = { phone: val || null };
        var res = await window.iboostAuth.updateProfile(payload);
        if (res && res.error) return err(res.error.message || 'Could not save. Please try again.');
        current.phone = val || null;
        rowVal.textContent = val ? display(val) : '—';
        exit();
      } catch (e) {
        console.error('[profile] phone save error:', e);
        err('Network error. Please try again.');
      } finally {
        if (saveBtn) { saveBtn.classList.remove('is-loading'); saveBtn.disabled = false; }
      }
    });
  }

  // ---- Address editor --------------------------------------------------
  function wireAddressEditor(user, initialProfile) {
    var rowVal   = document.getElementById('profile-row-address');
    var editBtn  = document.getElementById('profile-address-edit-btn');
    var formWrap = document.getElementById('profile-address-edit-form');
    var form     = document.getElementById('profile-address-form');
    var cancelBtn= document.getElementById('profile-address-cancel-btn');
    var saveBtn  = document.getElementById('profile-address-save-btn');
    var alertEl  = document.getElementById('profile-address-edit-alert');
    if (!rowVal || !editBtn || !form) return;

    var line1 = document.getElementById('profile-address-line1');
    var line2 = document.getElementById('profile-address-line2');
    var city  = document.getElementById('profile-address-city');
    var region= document.getElementById('profile-address-region');
    var postal= document.getElementById('profile-address-postal');
    var regionLabel = document.getElementById('profile-address-region-label');
    var postalLabel = document.getElementById('profile-address-postal-label');

    var current = initialProfile || {};
    var testUser = isTestUser(user);
    var country = current.country || null;

    // Country-aware labels/placeholders (same source as the KYC).
    try {
      var labels = window.iboostLocale.getAddressLabels(country);
      var ph = window.iboostLocale.getAddressPlaceholders(country);
      if (regionLabel) regionLabel.textContent = labels.region;
      if (postalLabel) postalLabel.textContent = labels.postal;
      if (region) region.placeholder = ph.region;
      if (postal) postal.placeholder = ph.postal;
    } catch (e) { /* locale module optional; defaults in HTML */ }

    function enter() {
      if (line1) line1.value = current.address_line1 || '';
      if (line2) line2.value = current.address_line2 || '';
      if (city)  city.value  = current.address_city || '';
      if (region) region.value = current.address_region || '';
      if (postal) postal.value = current.address_postal || '';
      rowVal.hidden = true; editBtn.hidden = true; formWrap.hidden = false;
      if (alertEl) { alertEl.hidden = true; alertEl.textContent = ''; }
      if (line1) line1.focus();
    }
    function exit() {
      rowVal.hidden = false; editBtn.hidden = false; formWrap.hidden = true;
      if (alertEl) { alertEl.hidden = true; alertEl.textContent = ''; }
    }
    function err(msg) {
      if (alertEl) { alertEl.textContent = msg; alertEl.hidden = false; }
      if (saveBtn) { saveBtn.classList.remove('is-loading'); saveBtn.disabled = false; }
    }

    editBtn.addEventListener('click', enter);
    if (cancelBtn) cancelBtn.addEventListener('click', exit);

    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      if (alertEl) { alertEl.hidden = true; alertEl.textContent = ''; }

      var v = {
        line1: (line1 && line1.value.trim()) || '',
        line2: (line2 && line2.value.trim()) || '',
        city:  (city && city.value.trim()) || '',
        region:(region && region.value.trim()) || '',
        postal:(postal && postal.value.trim()) || ''
      };

      // Determine if the form is entirely blank (test-user clear case).
      var allBlank = !v.line1 && !v.city && !v.region && !v.postal && !v.line2;

      if (testUser && allBlank) {
        // Allowed: clears the address, re-triggering Welcome KYC.
      } else {
        // Normal update path: required fields must be valid.
        if (!v.line1) return err('Please enter your street address.');
        if (!v.city)  return err('Please enter your city.');
        if (!/^[A-Za-z]{2}$/.test(v.region)) {
          var rl = 'region', rex = 'QC';
          try {
            rl = window.iboostLocale.getAddressLabels(country).region.toLowerCase();
            rex = window.iboostLocale.getAddressPlaceholders(country).region;
          } catch (e) {}
          return err('Please enter your 2-letter ' + rl + ' code (e.g. ' + rex + ').');
        }
        if (!v.postal) return err('Please enter your postal/ZIP code.');
      }

      if (saveBtn) { saveBtn.classList.add('is-loading'); saveBtn.disabled = true; }
      try {
        var res = await window.iboostAuth.updateProfile({
          addressLine1: v.line1 || null,
          addressLine2: v.line2 || null,
          addressCity:  v.city || null,
          addressRegion: v.region || null,
          addressPostal: v.postal || null
        });
        if (res && res.error) return err(res.error.message || 'Could not save. Please try again.');

        current.address_line1 = v.line1 || null;
        current.address_line2 = v.line2 || null;
        current.address_city  = v.city || null;
        current.address_region= v.region || null;
        current.address_postal= v.postal || null;
        rowVal.textContent = formatAddress(current) || '—';
        exit();
      } catch (e) {
        console.error('[profile] address save error:', e);
        err('Network error. Please try again.');
      } finally {
        if (saveBtn) { saveBtn.classList.remove('is-loading'); saveBtn.disabled = false; }
      }
    });
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
    var currency = (profile && profile.plan_currency) || 'cad';

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
        // Paid user: open the inline change/cancel modal (schedules via
        // /api/billing/change-plan or cancels via /api/billing/cancel —
        // both effective next cycle, no proration). This REPLACES the old
        // /checkout.html?mode=change redirect, which created drift by
        // writing the DB without touching Stripe.
        changeBtn.textContent = 'Change plan';
        changeBtn.addEventListener('click', function () {
          openPlanChangeModal(profile, planMap);
        });
      }
    }

    // Pending scheduled plan-change banner (paid->paid). Mirrors the
    // cancel banner. Shown when a change is scheduled for the next cycle.
    var pendingBanner = document.getElementById('profile-plan-pending-banner');
    if (!pendingBanner && card && profile && profile.pending_plan) {
      // The HTML may not have this element yet; create it inline above the
      // perks so it shows regardless of template version.
      pendingBanner = document.createElement('div');
      pendingBanner.id = 'profile-plan-pending-banner';
      pendingBanner.className = 'dash-plan-banner dash-plan-banner-info';
      var pendMeta = planMap[profile.pending_plan];
      var pendLabel = (pendMeta && pendMeta.name) || profile.pending_plan;
      var pendDate = profile.pending_plan_effective_at
        ? formatLongDate(profile.pending_plan_effective_at)
        : (profile.next_billing_date ? formatLongDate(profile.next_billing_date) : null);
      pendingBanner.innerHTML =
        '<strong>Changing to ' + escapeHtml(pendLabel) +
          (pendDate ? ' on ' + escapeHtml(pendDate) : ' next cycle') + '</strong>' +
        '<span>Your current plan continues until then. The new price applies at your next renewal.</span>' +
        '<button type="button" class="dash-banner-undo" id="profile-cancel-scheduled">Cancel this change</button>';
      var anchor = document.getElementById('profile-plan-perks');
      if (anchor && anchor.parentNode) {
        anchor.parentNode.insertBefore(pendingBanner, anchor);
      } else {
        card.appendChild(pendingBanner);
      }
      var undoBtn = document.getElementById('profile-cancel-scheduled');
      if (undoBtn) {
        undoBtn.addEventListener('click', async function () {
          undoBtn.disabled = true; undoBtn.textContent = 'Cancelling…';
          var r = await postBilling('/api/billing/cancel-scheduled-change', {});
          if (!r.ok) {
            undoBtn.disabled = false; undoBtn.textContent = 'Cancel this change';
            alert(r.error || 'Could not cancel the scheduled change.');
            return;
          }
          window.location.reload();
        });
      }
    }

    // Past-due banner: card failing renewal. Higher urgency than the
    // cancel banner. The fix is the user updating their card — for now
    // we direct them to support (Customer Portal link can replace this
    // copy later without other changes).
    var pastDueBanner = document.getElementById('profile-plan-pastdue-banner');
    var pastDueSub = document.getElementById('profile-plan-pastdue-banner-sub');
    if (pastDueBanner && profile && profile.subscription_status === 'past_due') {
      if (pastDueSub) {
        pastDueSub.textContent =
          'We couldn\u2019t process your latest payment. Use the ' +
          '\u201cUpdate payment method\u201d button below to fix it and ' +
          'keep your subscription active.';
      }
      pastDueBanner.hidden = false;
    }

    // Pending-cancel banner: shown only when the user has a scheduled
    // cancellation on their subscription. The user has a right to see
    // this — it's their account, their billing.
    var cancelBanner = document.getElementById('profile-plan-cancel-banner');
    var cancelBannerSub = document.getElementById('profile-plan-cancel-banner-sub');
    var cancelBannerTitle = document.getElementById('profile-plan-cancel-banner-title');
    if (cancelBanner && profile && profile.cancel_at_period_end) {
      var endDate = profile.next_billing_date
        ? formatLongDate(profile.next_billing_date)
        : null;
      if (cancelBannerTitle) {
        cancelBannerTitle.textContent = endDate
          ? 'Your subscription ends ' + endDate
          : 'Your subscription is scheduled to end';
      }
      if (cancelBannerSub) {
        cancelBannerSub.textContent =
          'You\u2019ll keep access until then. To continue with iBoost, ' +
          'contact support before this date.';
      }
      cancelBanner.hidden = false;
    }

    // Update payment method — opens the Stripe Customer Portal. Shown
    // only when the user has a Stripe customer (paid via Stripe). Free
    // and manual-grant users have no card to update, so it stays hidden.
    var billingBtn = document.getElementById('profile-plan-billing-btn');
    if (billingBtn && profile && profile.stripe_customer_id) {
      billingBtn.hidden = false;
      // Give past-due users a stronger nudge — relabel + emphasize.
      if (profile.subscription_status === 'past_due') {
        billingBtn.textContent = 'Update payment method';
        billingBtn.classList.add('dash-plan-cta-primary');
      }
      billingBtn.addEventListener('click', async function () {
        var base = getApiBase();
        if (!base) return;
        var settled = await window.iboostAuth.getSessionSettled();
        var session = settled && settled.session;
        if (!session || !session.access_token) {
          window.location.href = '/login.html';
          return;
        }
        var original = billingBtn.textContent;
        billingBtn.disabled = true;
        billingBtn.textContent = 'Opening…';
        try {
          var resp = await fetch(base + '/api/billing/portal-session', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer ' + session.access_token,
            },
          });
          var data = await resp.json();
          if (!resp.ok || !data.url) {
            throw new Error((data && data.error) || 'Could not open billing portal.');
          }
          // Redirect to the Stripe-hosted portal. Returns to
          // /account/profile via the return_url set server-side.
          window.location.href = data.url;
        } catch (err) {
          billingBtn.disabled = false;
          billingBtn.textContent = original;
          alert(err.message || 'Could not open the billing portal. Please try again.');
        }
      });
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
            renderPlanHistory(historyList, res.pending || [], res.history || []);
          } catch (err) {
            historyList.innerHTML =
              '<li class="dash-plan-history-empty">Could not load history.</li>';
          }
        }
      });
    }
  }

  // ===================================================================
  // Customer self-service plan change + cancel (with retention).
  // Paid<->paid -> POST /api/billing/change-plan (schedule next cycle).
  // Paid->free  -> retention flow -> POST /api/billing/cancel.
  // No card data here; Stripe Hosted Checkout handled free->paid already.
  // ===================================================================

  async function postBilling(path, payload) {
    var base = getApiBase();
    var settled = await window.iboostAuth.getSessionSettled();
    var session = settled && settled.session;
    if (!session || !session.access_token) {
      window.location.href = '/login.html';
      return { ok: false, error: 'Not signed in' };
    }
    try {
      var resp = await fetch(base + path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + session.access_token,
        },
        body: JSON.stringify(payload || {}),
      });
      var data = await resp.json().catch(function () { return {}; });
      if (!resp.ok) return { ok: false, error: data.error || ('HTTP ' + resp.status), data: data };
      return { ok: true, data: data };
    } catch (err) {
      return { ok: false, error: err.message || 'Network error' };
    }
  }

  function closeModal(backdrop) {
    if (backdrop && backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
  }

  function buildModal(innerHtml, maxWidth) {
    var backdrop = document.createElement('div');
    backdrop.className = 'dash-modal-backdrop';
    backdrop.innerHTML = '<div class="dash-modal" role="dialog" aria-modal="true" style="max-width:' +
      (maxWidth || 480) + 'px;">' + innerHtml + '</div>';
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click', function (ev) { if (ev.target === backdrop) closeModal(backdrop); });
    return backdrop;
  }

  // The two paid plans, in order, for "switch to the other one".
  var PAID_PLANS = ['essential', 'complete'];

  function openPlanChangeModal(profile, planMap) {
    var current = profile.plan;
    var other = PAID_PLANS.filter(function (p) { return p !== current; })[0];
    var curMeta = planMap[current] || {};
    var otherMeta = planMap[other] || {};
    var cur = profile.plan_currency || 'cad';
    var price = function (m) {
      var a = cur === 'cad' ? m.price_cad : m.price_usd;
      return a == null ? '' : '$' + a + ' ' + cur.toUpperCase() + '/mo';
    };
    var isUpgrade = other === 'complete';

    var backdrop = buildModal(
      '<h3 class="dash-modal-title">Change your plan</h3>' +
      '<p class="dash-modal-sub">Changes take effect at your next billing date — ' +
        'no proration, no partial refund. You keep your current plan until then.</p>' +
      '<div class="dash-plan-switch">' +
        '<div class="dash-plan-switch-current">' +
          '<span class="dash-plan-switch-label">Current</span>' +
          '<strong>' + escapeHtml(curMeta.name || current) + '</strong>' +
          '<span class="dash-plan-switch-price">' + escapeHtml(price(curMeta)) + '</span>' +
        '</div>' +
        '<div class="dash-plan-switch-arrow">\u2192</div>' +
        '<div class="dash-plan-switch-target">' +
          '<span class="dash-plan-switch-label">' + (isUpgrade ? 'Upgrade to' : 'Switch to') + '</span>' +
          '<strong>' + escapeHtml(otherMeta.name || other) + '</strong>' +
          '<span class="dash-plan-switch-price">' + escapeHtml(price(otherMeta)) + '</span>' +
        '</div>' +
      '</div>' +
      '<div id="dash-plan-alert"></div>' +
      '<div class="dash-modal-actions">' +
        '<button type="button" class="dash-btn-ghost" id="dash-plan-cancel-sub">Cancel subscription</button>' +
        '<div style="flex:1"></div>' +
        '<button type="button" class="dash-btn-ghost" id="dash-plan-close">Not now</button>' +
        '<button type="button" class="dash-btn-primary" id="dash-plan-confirm">' +
          (isUpgrade ? 'Upgrade' : 'Switch') + ' to ' + escapeHtml(otherMeta.name || other) + '</button>' +
      '</div>',
      520
    );

    var alertEl = backdrop.querySelector('#dash-plan-alert');
    backdrop.querySelector('#dash-plan-close').addEventListener('click', function () { closeModal(backdrop); });

    // Cancel subscription -> retention flow.
    backdrop.querySelector('#dash-plan-cancel-sub').addEventListener('click', function () {
      closeModal(backdrop);
      openCancelRetentionModal(profile, planMap);
    });

    backdrop.querySelector('#dash-plan-confirm').addEventListener('click', async function () {
      var btn = this;
      btn.disabled = true; btn.textContent = 'Scheduling…';
      alertEl.innerHTML = '';
      var r = await postBilling('/api/billing/change-plan', { target_plan: other });
      if (!r.ok) {
        btn.disabled = false; btn.textContent = (isUpgrade ? 'Upgrade' : 'Switch');
        alertEl.innerHTML = '<div class="dash-alert-error">' + escapeHtml(r.error) + '</div>';
        return;
      }
      alertEl.innerHTML = '<div class="dash-alert-success">Done — your plan changes to ' +
        escapeHtml(otherMeta.name || other) + ' at your next billing date.</div>';
      btn.style.display = 'none';
      backdrop.querySelector('#dash-plan-cancel-sub').style.display = 'none';
      backdrop.querySelector('#dash-plan-close').textContent = 'Done';
      // Reload the card after a beat so the pending banner shows.
      setTimeout(function () { window.location.reload(); }, 1400);
    });
  }

  // Retention: reason -> one tier-aware save-offer -> cancel anyway.
  function openCancelRetentionModal(profile, planMap) {
    var current = profile.plan;
    var curMeta = planMap[current] || {};
    var REASONS = [
      { v: 'too_expensive', t: 'It\u2019s too expensive' },
      { v: 'not_using', t: 'I\u2019m not using it' },
      { v: 'no_results', t: 'I\u2019m not seeing results' },
      { v: 'other', t: 'Another reason' },
    ];
    var backdrop = buildModal(
      '<h3 class="dash-modal-title">Before you go</h3>' +
      '<p class="dash-modal-sub">Tell us why you\u2019re cancelling — it helps us improve, ' +
        'and we may be able to help.</p>' +
      '<div class="dash-reason-list">' +
        REASONS.map(function (r) {
          return '<label class="dash-reason"><input type="radio" name="cancel-reason" value="' +
            r.v + '"> <span>' + escapeHtml(r.t) + '</span></label>';
        }).join('') +
      '</div>' +
      '<div id="dash-retention-offer"></div>' +
      '<div id="dash-cancel-alert"></div>' +
      '<div class="dash-modal-actions">' +
        '<button type="button" class="dash-btn-ghost" id="dash-cancel-close">Keep my plan</button>' +
        '<div style="flex:1"></div>' +
        '<button type="button" class="dash-btn-danger" id="dash-cancel-proceed" disabled>Continue</button>' +
      '</div>',
      520
    );

    var offerEl = backdrop.querySelector('#dash-retention-offer');
    var alertEl = backdrop.querySelector('#dash-cancel-alert');
    var proceedBtn = backdrop.querySelector('#dash-cancel-proceed');
    var chosenReason = null;

    backdrop.querySelector('#dash-cancel-close').addEventListener('click', function () { closeModal(backdrop); });

    backdrop.querySelectorAll('input[name="cancel-reason"]').forEach(function (radio) {
      radio.addEventListener('change', function () {
        chosenReason = radio.value;
        proceedBtn.disabled = false;
        renderOffer(chosenReason);
      });
    });

    function renderOffer(reason) {
      // Tier-aware save offer.
      if (reason === 'too_expensive' && current === 'complete') {
        offerEl.innerHTML =
          '<div class="dash-offer">' +
            '<strong>Keep your progress for less</strong>' +
            '<p>Switch to Essential instead of cancelling — you keep your core ' +
              'features at a lower price, effective next cycle.</p>' +
            '<button type="button" class="dash-btn-primary" id="dash-offer-downgrade">Switch to Essential</button>' +
          '</div>';
        backdrop.querySelector('#dash-offer-downgrade').addEventListener('click', async function () {
          this.disabled = true; this.textContent = 'Scheduling…';
          var r = await postBilling('/api/billing/change-plan', { target_plan: 'essential' });
          if (!r.ok) { this.disabled = false; this.textContent = 'Switch to Essential';
            alertEl.innerHTML = '<div class="dash-alert-error">' + escapeHtml(r.error) + '</div>'; return; }
          offerEl.innerHTML = '<div class="dash-alert-success">Switched to Essential at your next billing date.</div>';
          proceedBtn.style.display = 'none';
          backdrop.querySelector('#dash-cancel-close').textContent = 'Done';
          setTimeout(function () { window.location.reload(); }, 1400);
        });
      } else if (reason === 'not_using' || reason === 'no_results') {
        offerEl.innerHTML =
          '<div class="dash-offer">' +
            '<strong>Let us help you get results</strong>' +
            '<p>A quick call with a specialist can get you back on track. ' +
              'Want us to reach out?</p>' +
            '<a class="dash-btn-primary" href="/account.html#welcome">Book a call</a>' +
          '</div>';
      } else {
        offerEl.innerHTML =
          '<div class="dash-offer dash-offer-muted">' +
            '<strong>If you cancel, you\u2019ll lose</strong>' +
            '<p>Access to your ' + escapeHtml(curMeta.name || current) +
              ' features and monthly credit insights at your next billing date. ' +
              'You can re-subscribe any time.</p>' +
          '</div>';
      }
    }

    proceedBtn.addEventListener('click', async function () {
      if (!chosenReason) return;
      proceedBtn.disabled = true; proceedBtn.textContent = 'Cancelling…';
      alertEl.innerHTML = '';
      var r = await postBilling('/api/billing/cancel', { reason: chosenReason });
      if (!r.ok) {
        proceedBtn.disabled = false; proceedBtn.textContent = 'Continue';
        alertEl.innerHTML = '<div class="dash-alert-error">' + escapeHtml(r.error) + '</div>';
        return;
      }
      offerEl.innerHTML = '';
      alertEl.innerHTML = '<div class="dash-alert-success">Your subscription will end at your ' +
        'next billing date. You\u2019ll keep access until then.</div>';
      proceedBtn.style.display = 'none';
      backdrop.querySelector('#dash-cancel-close').textContent = 'Done';
      setTimeout(function () { window.location.reload(); }, 1600);
    });
  }

  async function renderPlanHistory(listEl, pending, history) {
    pending = pending || [];
    history = history || [];

    if (pending.length === 0 && history.length === 0) {
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

    function renderRow(r, isPending) {
      var fromLabel = labelFor(r.from_plan);
      var toLabel = labelFor(r.to_plan);
      var isRescinded = !!r.cancelled_at;

      var whenStr, sourceHint;
      if (isPending && r.effective_at) {
        whenStr = formatLongDate(r.effective_at) || '';
        sourceHint = ' \u00b7 scheduled';
      } else {
        whenStr = formatLongDate(r.changed_at) || '';
        sourceHint = (
          r.source === 'signup'         ? ' \u00b7 initial signup' :
          r.source === 'admin_cancel'   ? ' \u00b7 canceled' :
          r.source === 'admin_resume'   ? ' \u00b7 resumed' :
          r.source === 'stripe_webhook' ? ' \u00b7 via Stripe' :
          ''
        );
      }

      var changeLine;
      if (r.source === 'admin_resume') {
        changeLine = 'Subscription resumed';
      } else if (r.from_plan) {
        changeLine = escapeHtml(fromLabel) + ' \u2192 ' + escapeHtml(toLabel);
      } else {
        changeLine = 'Signed up on ' + escapeHtml(toLabel);
      }

      var itemClasses = 'dash-plan-history-item';
      if (isPending) itemClasses += ' dash-plan-history-item-pending';
      if (isRescinded) itemClasses += ' dash-plan-history-item-rescinded';

      return (
        '<li class="' + itemClasses + '">' +
          '<span class="dash-plan-history-item-change">' + changeLine + '</span>' +
          '<span class="dash-plan-history-item-when">' +
            escapeHtml(whenStr) + escapeHtml(sourceHint) +
          '</span>' +
        '</li>'
      );
    }

    var html = '';
    if (pending.length > 0) {
      html += '<li class="dash-plan-history-section">Pending</li>';
      html += pending.map(function (r) { return renderRow(r, true); }).join('');
    }
    if (history.length > 0) {
      if (pending.length > 0) {
        html += '<li class="dash-plan-history-section">History</li>';
      }
      html += history.map(function (r) { return renderRow(r, false); }).join('');
    }
    listEl.innerHTML = html;
  }

  // ===================================================================
  // Page boot
  // ===================================================================

  // -------- Invoice history (Stage 2 of invoices feature) --------
  //
  // Fetches GET /api/invoices/mine, renders a list into the card on the
  // profile page. The card itself is hidden in the HTML by default and
  // we only unhide it once we know the user has invoices to show.
  //
  // Failure mode: card stays hidden. We log to console but never
  // surface errors to the user — invoice history is a nice-to-have on
  // this page, not the main content.

  function getApiBase() {
    var cfg = window.IBOOST_CONFIG || {};
    return (cfg.API_BASE_URL || '').replace(/\/$/, '');
  }

  // Format a unix-seconds timestamp as "Apr 12, 2026". Locale-aware via
  // Intl but in a stable English form so the layout doesn't shift by locale.
  function fmtInvoiceDate(unixSeconds) {
    if (!unixSeconds && unixSeconds !== 0) return '';
    try {
      var d = new Date(unixSeconds * 1000);
      return d.toLocaleDateString('en-CA', {
        year: 'numeric', month: 'short', day: 'numeric',
      });
    } catch (e) {
      return '';
    }
  }

  // Format an amount in the smallest currency unit (cents) as a display
  // string with currency code. e.g. (4000, 'cad') -> "$40.00 CAD".
  function fmtInvoiceAmount(amountInCents, currency) {
    var cur = String(currency || 'cad').toUpperCase();
    var dollars = (Number(amountInCents) || 0) / 100;
    return '$' + dollars.toFixed(2) + ' ' + cur;
  }

  // Render the human description for an invoice. We don't have a clean
  // "plan name" on the invoice itself, so the period range (when paid
  // for) is the most honest label. Falls back to the invoice number.
  function fmtInvoiceDesc(inv) {
    if (inv.period_start && inv.period_end) {
      var start = fmtInvoiceDate(inv.period_start);
      var end = fmtInvoiceDate(inv.period_end);
      return 'Subscription period: ' + start + ' — ' + end;
    }
    return inv.number ? ('Invoice ' + inv.number) : 'Invoice';
  }

  // Map Stripe status to a short label + CSS modifier. 'paid' is the
  // happy path; the others render with a subdued tone so they read as
  // "needs attention" without being alarmist.
  function statusLabel(status) {
    if (status === 'paid')          return { text: 'Paid',          mod: 'paid' };
    if (status === 'open')          return { text: 'Open',          mod: 'open' };
    if (status === 'draft')         return { text: 'Draft',         mod: 'draft' };
    if (status === 'void')          return { text: 'Void',          mod: 'void' };
    if (status === 'uncollectible') return { text: 'Uncollectible', mod: 'fail' };
    return { text: String(status || ''), mod: '' };
  }

  function renderInvoiceRow(inv) {
    var dateStr = fmtInvoiceDate(inv.created);
    var titleStr = inv.number || inv.id;
    var subStr = fmtInvoiceDesc(inv);
    var amountStr = fmtInvoiceAmount(inv.amount_paid || inv.amount_due, inv.currency);
    var s = statusLabel(inv.status);

    // The download icon button links out to Stripe's hosted invoice page
    // (which has a Download PDF button + the line items + payment status).
    // We prefer hosted_invoice_url because it works for any status; the
    // direct invoice_pdf URL exists only after finalize.
    var linkUrl = inv.hosted_invoice_url || inv.invoice_pdf || '';
    var linkAttrs = linkUrl
      ? ' href="' + escapeHtml(linkUrl) + '" target="_blank" rel="noopener noreferrer"'
      : ' aria-disabled="true"';

    return (
      '<div class="dash-invoice" data-invoice-id="' + escapeHtml(inv.id) + '">' +
        '<div class="dash-invoice-date">' + escapeHtml(dateStr) + '</div>' +
        '<div class="dash-invoice-desc">' +
          '<p class="dash-invoice-desc-title">' + escapeHtml(titleStr) +
            ' <span class="dash-invoice-status dash-invoice-status-' + s.mod + '">' +
              escapeHtml(s.text) +
            '</span>' +
          '</p>' +
          '<p class="dash-invoice-desc-sub">' + escapeHtml(subStr) + '</p>' +
        '</div>' +
        '<div class="dash-invoice-amount">' + escapeHtml(amountStr) + '</div>' +
        '<a class="dash-invoice-dl"' + linkAttrs +
          ' aria-label="View invoice ' + escapeHtml(titleStr) + ' on Stripe">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
            '<polyline points="7 10 12 15 17 10"/>' +
            '<line x1="12" y1="15" x2="12" y2="3"/>' +
          '</svg>' +
        '</a>' +
      '</div>'
    );
  }

  async function initInvoiceHistory(session) {
    var card = document.getElementById('invoice-history-card');
    var list = document.getElementById('invoice-history-list');
    if (!card || !list) return;

    var apiBase = getApiBase();
    if (!apiBase) {
      // Missing config — nothing we can do. Card stays hidden.
      console.warn('[profile] no API_BASE_URL — skipping invoice history');
      return;
    }
    if (!session || !session.access_token) {
      return; // boot() already redirected to /login on this path
    }

    var resp;
    try {
      resp = await fetch(apiBase + '/api/invoices/mine', {
        headers: { Authorization: 'Bearer ' + session.access_token },
      });
    } catch (e) {
      console.warn('[profile] invoice fetch network error:', e);
      return; // card stays hidden
    }

    if (!resp.ok) {
      console.warn('[profile] invoice fetch HTTP ' + resp.status);
      return;
    }

    var data;
    try { data = await resp.json(); } catch (e) { return; }

    // No Stripe customer = Free / manual-grant. Keep the card hidden;
    // there's nothing useful to show. Avoids a confusing "No invoices"
    // empty state that would imply "you're paying but nothing rendered."
    if (!data.has_stripe_customer) {
      return;
    }

    var invoices = (data && data.invoices) || [];
    if (invoices.length === 0) {
      // Stripe customer exists but no invoices returned (rare — perhaps
      // a freshly-created subscription that hasn't been billed yet).
      // Show the card with an honest message.
      list.innerHTML =
        '<div class="dash-invoice-empty" style="padding: 14px 4px; color: var(--color-text-muted);">' +
          'No invoices yet. Your first invoice will appear after your next billing cycle.' +
        '</div>';
      card.hidden = false;
      return;
    }

    list.innerHTML = invoices.map(renderInvoiceRow).join('');
    card.hidden = false;
  }

  async function boot() {
    if (!window.iboostAuth || !window.iboostAuth.getSessionSettled) {
      console.error('[profile] iboostAuth missing — script load order issue?');
      return;
    }

    var settled;
    try {
      settled = await window.iboostAuth.getSessionSettled();
    } catch (e) {
      console.error('[profile] session fetch failed:', e);
      window.location.replace('/login.html');
      return;
    }

    var session = settled && settled.session;
    var user = session && session.user;

    if (!user) {
      window.location.replace('/login.html');
      return;
    }

    // Top-bar via shell helpers (same pattern as Education page)
    var firstName = window.iboostAccountShell.deriveFirstName(user);
    var initials = window.iboostAccountShell.deriveInitials(user);
    window.iboostAccountShell.populateUserInfo(user, firstName, initials);
    window.iboostAccountShell.wireSignout();

    // Profile-tab-specific: the identity hero has its own avatar
    // element (different from the topbar avatar) that uses the same
    // initials. Populate it before initProfileTab runs so the avatar
    // is ready when the rest of the hero renders.
    var profileAvatarEl = document.getElementById('profile-avatar');
    if (profileAvatarEl) profileAvatarEl.textContent = initials;

    // Run the Profile-tab init logic (byte-identical to what previously
    // ran in account.js's init()). Awaited because initPlanCard does
    // an async iboostPlans.getPlansMap() fetch internally.
    try {
      await initProfileTab(user, firstName);
    } catch (e) {
      console.error('[profile] initProfileTab failed:', e);
    }

    // Invoice history — best-effort, non-blocking. Card stays hidden
    // if the user has no Stripe customer (Free / manual-grant users)
    // or if the fetch fails. We deliberately don't surface errors —
    // a missing invoice list shouldn't make the rest of the page feel
    // broken.
    try {
      await initInvoiceHistory(session);
    } catch (e) {
      console.error('[profile] initInvoiceHistory failed:', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
