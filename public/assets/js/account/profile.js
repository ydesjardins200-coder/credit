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
