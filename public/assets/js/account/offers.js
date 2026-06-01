/**
 * Offers page — now DB-backed.
 *
 * Fetches published offers from GET /api/offers and renders:
 *   - a "Best matches right now" featured row (offers with is_featured),
 *     full cards with specs.
 *   - "Browse by category" blocks (credit cards / personal loans / bank
 *     accounts / insurance), each a row of mini cards.
 *
 * Offers carry an affiliate_link; cards link out to it (new tab, rel
 * noopener sponsored) when present, falling back to a non-navigating card
 * if not. Category counts are the REAL count per category (no more
 * hardcoded "12 offers available").
 *
 * Auth + topbar are delegated to the shared shell, as before.
 */
(function () {
  'use strict';

  var CATEGORY_META = {
    credit_card:   { label: 'Credit cards',   icon: '<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>', cls: '' },
    personal_loan: { label: 'Personal loans', icon: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>', cls: 'dash-offer-cat-ico-loans' },
    bank_account:  { label: 'Bank accounts',  icon: '<path d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3"/>', cls: 'dash-offer-cat-ico-banks' },
    insurance:     { label: 'Insurance',      icon: '<path d="M12 22s-8-4-8-12V5l8-3 8 3v5c0 8-8 12-8 12z"/>', cls: 'dash-offer-cat-ico-ins' }
  };

  var ARROW_SM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
  var ARROW_CTA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function apiBase() {
    var cfg = window.IBOOST_CONFIG || {};
    return (cfg.API_BASE_URL || '').replace(/\/$/, '');
  }

  function logoMarkup(o) {
    var cls = 'dash-offer-logo' + (o.logo_class ? ' ' + o.logo_class : '');
    var style = (!o.logo_class && o.logo_color) ? ' style="background:' + esc(o.logo_color) + '"' : '';
    return '<div class="' + cls + '"' + style + '>' + esc(o.logo_text) + '</div>';
  }

  // The card element: an <a> when there's an affiliate link, else a
  // non-navigating <button> (keeps the look, no dead link).
  function openTag(o, classes) {
    if (o.affiliate_link) {
      return '<a class="' + classes + '" href="' + esc(o.affiliate_link) + '" target="_blank" rel="noopener noreferrer sponsored">';
    }
    return '<button type="button" class="' + classes + '">';
  }
  function closeTag(o) { return o.affiliate_link ? '</a>' : '</button>'; }

  function featuredCard(o) {
    var specs = (o.specs || []).map(function (sp) {
      return '<div class="dash-offer-spec"><span class="dash-offer-spec-label">' + esc(sp.label) +
        '</span><span class="dash-offer-spec-val">' + esc(sp.val) + '</span></div>';
    }).join('');
    return openTag(o, 'dash-offer dash-offer-featured') +
        '<div class="dash-offer-head">' +
          logoMarkup(o) +
          '<div><p class="dash-offer-lender">' + esc(o.lender) + '</p>' +
          '<p class="dash-offer-name">' + esc(o.name) + '</p></div>' +
        '</div>' +
        (o.highlight ? '<div class="dash-offer-highlight">' + esc(o.highlight) + '</div>' : '') +
        (specs ? '<div class="dash-offer-specs">' + specs + '</div>' : '') +
        '<div class="dash-offer-cta">Check pre-approval ' + ARROW_CTA + '</div>' +
      closeTag(o);
  }

  function miniCard(o) {
    return openTag(o, 'dash-offer-mini') +
        logoMarkup(o) +
        '<div class="dash-offer-mini-body">' +
          '<p class="dash-offer-mini-lender">' + esc(o.lender) + '</p>' +
          '<p class="dash-offer-mini-name">' + esc(o.name) + '</p>' +
          (o.hook ? '<p class="dash-offer-mini-hook">' + esc(o.hook) + '</p>' : '') +
        '</div>' +
        '<span class="dash-offer-mini-arrow" aria-hidden="true">' + ARROW_SM + '</span>' +
      closeTag(o);
  }

  function render(root, data) {
    var html = '';

    if (data.featured && data.featured.length) {
      html += '<div class="dash-offer-sect"><h2>Best matches right now</h2>' +
        '<span class="dash-offer-sect-sub">Soft-pull pre-approval \u00b7 No impact on score</span></div>';
      html += '<div class="dash-offer-feat-row">' + data.featured.map(featuredCard).join('') + '</div>';
    }

    var cats = data.categories || [];
    var anyCategory = cats.some(function (c) { return (data.byCategory[c] || []).length; });
    if (anyCategory) {
      html += '<div class="dash-offer-sect"><h2>Browse by category</h2>' +
        '<span class="dash-offer-sect-sub">Explore all available offers</span></div>';
      cats.forEach(function (cat) {
        var list = data.byCategory[cat] || [];
        if (!list.length) return;
        var meta = CATEGORY_META[cat] || { label: cat, icon: '', cls: '' };
        var count = list.length + ' offer' + (list.length === 1 ? '' : 's') + ' available';
        html += '<div class="dash-offer-cat-block">' +
            '<div class="dash-offer-cat-header">' +
              '<div class="dash-offer-cat-ico ' + meta.cls + '">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + meta.icon + '</svg>' +
              '</div>' +
              '<h3>' + esc(meta.label) + '</h3>' +
              '<span class="dash-offer-cat-sub">' + count + '</span>' +
            '</div>' +
            '<div class="dash-offer-cat-row">' + list.map(miniCard).join('') + '</div>' +
          '</div>';
      });
    }

    if (!html) {
      html = '<div class="dash-offer-loading">No offers are available right now. Check back soon.</div>';
    }
    root.innerHTML = html;
  }

  async function boot() {
    if (!window.iboostAuth || !window.iboostAuth.getSessionSettled) {
      console.error('[offers] iboostAuth missing — script load order issue?');
      return;
    }
    var settled;
    try { settled = await window.iboostAuth.getSessionSettled(); }
    catch (e) { window.location.replace('/login.html'); return; }
    var session = settled && settled.session;
    var user = session && session.user;
    if (!user) { window.location.replace('/login.html'); return; }

    var firstName = window.iboostAccountShell.deriveFirstName(user);
    var initials = window.iboostAccountShell.deriveInitials(user);
    window.iboostAccountShell.populateUserInfo(user, firstName, initials);
    window.iboostAccountShell.wireSignout();

    var root = document.getElementById('offers-root');
    if (!root) return;

    try {
      var token = session && session.access_token;
      var resp = await fetch(apiBase() + '/api/offers', {
        headers: { 'Accept': 'application/json', 'Authorization': token ? ('Bearer ' + token) : '' }
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      var data = await resp.json();
      render(root, data);
    } catch (e) {
      console.error('[offers] load failed:', e);
      root.innerHTML = '<div class="dash-offer-loading">We couldn\u2019t load offers right now. Please refresh in a moment.</div>';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
