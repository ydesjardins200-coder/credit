/**
 * Support widget — shared across all account pages.
 *
 * Injects into the account top bar (.dash-user):
 *   - a "Get help" button  → opens a modal to file a new case
 *   - an envelope icon      → opens the inbox (the caller's cases),
 *                             badged with the count of cases that have
 *                             an unread agent reply
 *
 * Also owns the modals: new-case form, inbox list, case thread (with a
 * reply box for the two-way conversation), and the post-resolution
 * star rating.
 *
 * One module, loaded on every account page, so the chrome is identical
 * everywhere (no per-page header duplication). Talks to the customer
 * support API (/api/support/*). All endpoints are auth-gated server-side;
 * here we attach the caller's bearer token.
 *
 * Convention: IIFE exposing window.iboostSupport, matching
 * window.iboostAccountShell etc.
 */
(function () {
  'use strict';

  function apiBase() {
    var cfg = window.IBOOST_CONFIG || {};
    return (cfg.API_BASE_URL || '').replace(/\/$/, '');
  }

  // ---- auth helper -------------------------------------------------------
  async function authedFetch(path, opts) {
    opts = opts || {};
    var token = null;
    try {
      if (window.iboostAuth && window.iboostAuth.getSessionSettled) {
        var s = await window.iboostAuth.getSessionSettled();
        token = s && s.session && s.session.access_token;
      }
    } catch (e) { /* fall through; server will 401 */ }

    var headers = Object.assign(
      { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      opts.headers || {}
    );
    if (token) headers.Authorization = 'Bearer ' + token;

    return fetch(apiBase() + path, Object.assign({}, opts, { headers: headers }));
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Escape first (safety), THEN turn http(s) URLs into clickable links.
  // Operating on already-escaped text means the URL chars are safe; we
  // only need to match the (escaped) URL substring. Trailing punctuation
  // is left out of the link. newlines -> <br> so multi-line bodies read.
  function linkify(s) {
    var escaped = esc(s);
    escaped = escaped.replace(
      /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])/g,
      function (url) {
        return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + '</a>';
      }
    );
    return escaped.replace(/\n/g, '<br>');
  }

  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('en-CA', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  // ---- state -------------------------------------------------------------
  var state = { unreadCount: 0 };

  // ---- chrome injection --------------------------------------------------
  function injectChrome() {
    var anchor = document.querySelector('.dash-user');
    if (!anchor || document.getElementById('support-help-btn')) return;

    // Envelope (inbox) — inserted before the user info block.
    var env = document.createElement('button');
    env.type = 'button';
    env.id = 'support-envelope-btn';
    env.className = 'support-envelope';
    env.setAttribute('aria-label', 'Your support messages');
    env.title = 'Your support messages';
    env.innerHTML =
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" ' +
        'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
        'stroke-linejoin="round" aria-hidden="true">' +
        '<rect x="2" y="4" width="20" height="16" rx="2"/>' +
        '<path d="m22 7-10 6L2 7"/>' +
      '</svg>' +
      '<span class="support-envelope-badge" id="support-envelope-badge" hidden></span>';

    // Get help button.
    var help = document.createElement('button');
    help.type = 'button';
    help.id = 'support-help-btn';
    help.className = 'support-help-btn';
    help.textContent = 'Get help';

    anchor.insertBefore(env, anchor.firstChild);
    anchor.insertBefore(help, anchor.firstChild);

    help.addEventListener('click', openNewCaseModal);
    env.addEventListener('click', openInbox);
  }

  function setBadge(n) {
    var newCount = n || 0;
    var prevCount = state.unreadCount || 0;
    state.unreadCount = newCount;
    var b = document.getElementById('support-envelope-badge');
    var env = document.getElementById('support-envelope-btn');
    if (!b) return;
    if (newCount > 0) {
      b.hidden = false;
      b.textContent = newCount > 9 ? '9+' : String(newCount);
    } else {
      b.hidden = true;
      b.textContent = '';
    }
    // Subtle pulse when the count goes UP — a new message arrived (not
    // on first load from 0, and not when it decreases because the user
    // read something). state._initialized guards the first paint.
    if (env && state._initialized && newCount > prevCount) {
      env.classList.remove('support-envelope-pulse');
      // Force reflow so re-adding the class restarts the animation.
      void env.offsetWidth;
      env.classList.add('support-envelope-pulse');
    }
  }

  async function refreshUnread() {
    try {
      // Cheap count-only endpoint — poll-friendly (index-only count),
      // not the full case list.
      var res = await authedFetch('/api/support/unread-count');
      if (!res.ok) return;
      var data = await res.json();
      setBadge(data.unread_count || 0);
      state._initialized = true; // subsequent increases may pulse
    } catch (e) { /* silent — badge is best-effort */ }
  }

  // ---- modal scaffolding -------------------------------------------------
  function makeModal(innerHtml) {
    var backdrop = document.createElement('div');
    backdrop.className = 'support-modal-backdrop';
    backdrop.innerHTML = '<div class="support-modal" role="dialog" aria-modal="true">' + innerHtml + '</div>';
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click', function (ev) {
      if (ev.target === backdrop) close();
    });
    function close() {
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    }
    return { backdrop: backdrop, close: close, root: backdrop.querySelector('.support-modal') };
  }

  // ---- new case ----------------------------------------------------------
  function openNewCaseModal() {
    var m = makeModal(
      '<h3 class="support-modal-title">Get help</h3>' +
      '<p class="support-modal-sub">Tell us what\u2019s going on and we\u2019ll get back to you. ' +
        'You\u2019ll see our reply in your messages (the envelope icon).</p>' +
      '<div class="support-field">' +
        '<label for="support-subject">Subject <span class="support-opt">(optional)</span></label>' +
        '<input type="text" id="support-subject" maxlength="200" placeholder="Short summary" />' +
      '</div>' +
      '<div class="support-field">' +
        '<label for="support-body">How can we help? <span class="support-req">*</span></label>' +
        '<textarea id="support-body" rows="5" maxlength="5000" ' +
          'placeholder="Describe your question or issue\u2026"></textarea>' +
      '</div>' +
      '<div id="support-alert"></div>' +
      '<div class="support-modal-actions">' +
        '<button type="button" class="support-btn-ghost" id="support-cancel">Cancel</button>' +
        '<button type="button" class="support-btn-primary" id="support-send">Send</button>' +
      '</div>'
    );

    var alertBox = m.root.querySelector('#support-alert');
    m.root.querySelector('#support-cancel').addEventListener('click', m.close);

    m.root.querySelector('#support-send').addEventListener('click', async function () {
      var subject = m.root.querySelector('#support-subject').value.trim();
      var body = m.root.querySelector('#support-body').value.trim();
      alertBox.innerHTML = '';
      if (!body) {
        alertBox.innerHTML = '<div class="support-alert-err">Please enter a message.</div>';
        return;
      }
      var btn = m.root.querySelector('#support-send');
      btn.disabled = true;
      btn.textContent = 'Sending\u2026';
      try {
        var res = await authedFetch('/api/support/cases', {
          method: 'POST',
          body: JSON.stringify({ subject: subject, body: body }),
        });
        var data = await res.json();
        if (!res.ok || !data.ok) throw new Error((data && data.error) || 'Could not send.');
        m.close();
        // Confirmation toast-ish modal.
        var c = makeModal(
          '<h3 class="support-modal-title">We\u2019ve got it</h3>' +
          '<p class="support-modal-sub">Your request is case <strong>#' + esc(data.case_number) +
            '</strong>. We\u2019ll reply soon \u2014 watch the envelope icon for our response.</p>' +
          '<div class="support-modal-actions">' +
            '<button type="button" class="support-btn-primary" id="support-ok">Done</button>' +
          '</div>'
        );
        c.root.querySelector('#support-ok').addEventListener('click', c.close);
        refreshUnread();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Send';
        alertBox.innerHTML = '<div class="support-alert-err">' + esc(err.message) + '</div>';
      }
    });
  }

  // ---- inbox -------------------------------------------------------------
  async function openInbox() {
    var m = makeModal(
      '<h3 class="support-modal-title">Your messages</h3>' +
      '<div id="support-inbox-list" class="support-inbox-list">' +
        '<div class="support-loading">Loading\u2026</div>' +
      '</div>' +
      '<div class="support-modal-actions">' +
        '<button type="button" class="support-btn-ghost" id="support-inbox-close">Close</button>' +
      '</div>'
    );
    m.root.querySelector('#support-inbox-close').addEventListener('click', m.close);

    var listEl = m.root.querySelector('#support-inbox-list');
    try {
      var res = await authedFetch('/api/support/cases/mine');
      if (!res.ok) throw new Error('Could not load your messages.');
      var data = await res.json();
      var cases = data.cases || [];
      setBadge(data.unread_count || 0);

      if (cases.length === 0) {
        listEl.innerHTML = '<div class="support-empty">No messages yet. ' +
          'Use \u201cGet help\u201d to start a conversation.</div>';
        return;
      }

      listEl.innerHTML = cases.map(function (c) {
        var statusClass = c.status === 'resolved' ? 'is-resolved' :
                          c.status === 'closed' ? 'is-closed' : 'is-open';
        return '<button type="button" class="support-case-item" data-caseid="' + esc(c.id) + '">' +
          (c.unread_by_customer ? '<span class="support-case-dot" aria-label="Unread"></span>' : '') +
          '<div class="support-case-main">' +
            '<div class="support-case-subject">' +
              esc(c.subject || ('Case #' + c.case_number)) +
            '</div>' +
            '<div class="support-case-meta">#' + esc(c.case_number) + ' \u00b7 ' +
              esc(fmtDate(c.created_at)) + '</div>' +
          '</div>' +
          '<span class="support-case-status ' + statusClass + '">' + esc(c.status) + '</span>' +
        '</button>';
      }).join('');

      listEl.querySelectorAll('.support-case-item').forEach(function (el) {
        el.addEventListener('click', function () {
          m.close();
          openCaseThread(el.getAttribute('data-caseid'));
        });
      });
    } catch (err) {
      listEl.innerHTML = '<div class="support-alert-err">' + esc(err.message) + '</div>';
    }
  }

  // ---- case thread -------------------------------------------------------
  async function openCaseThread(caseId) {
    var m = makeModal(
      '<div id="support-thread-head"></div>' +
      '<div id="support-thread" class="support-thread">' +
        '<div class="support-loading">Loading\u2026</div>' +
      '</div>' +
      '<div id="support-thread-foot"></div>' +
      '<div class="support-modal-actions">' +
        '<button type="button" class="support-btn-ghost" id="support-thread-close">Close</button>' +
      '</div>'
    );
    m.root.querySelector('#support-thread-close').addEventListener('click', function () {
      m.close();
      refreshUnread();
    });

    var threadEl = m.root.querySelector('#support-thread');
    var headEl = m.root.querySelector('#support-thread-head');
    var footEl = m.root.querySelector('#support-thread-foot');

    async function load() {
      try {
        var res = await authedFetch('/api/support/cases/' + encodeURIComponent(caseId));
        if (!res.ok) throw new Error('Could not load this case.');
        var data = await res.json();
        var c = data.case;
        var messages = data.messages || [];

        headEl.innerHTML =
          '<h3 class="support-modal-title">' +
            esc(c.subject || ('Case #' + c.case_number)) +
          '</h3>' +
          '<div class="support-modal-sub">#' + esc(c.case_number) + ' \u00b7 ' + esc(c.status) + '</div>';

        threadEl.innerHTML = messages.map(function (msg) {
          var side = msg.author_type === 'agent' ? 'agent' : 'customer';
          var who = side === 'agent' ? 'iBoost Support' : 'You';
          return '<div class="support-msg support-msg-' + side + '">' +
            '<div class="support-msg-who">' + esc(who) + '</div>' +
            '<div class="support-msg-body">' + linkify(msg.body) + '</div>' +
            '<div class="support-msg-time">' + esc(fmtDate(msg.created_at)) + '</div>' +
          '</div>';
        }).join('');
        threadEl.scrollTop = threadEl.scrollHeight;

        // Mark read (clears the customer-unread flag).
        if (c.unread_by_customer) {
          authedFetch('/api/support/cases/' + encodeURIComponent(caseId) + '/read', { method: 'POST' });
        }

        // Footer: reply box (if open) or rating (if resolved).
        if (c.status === 'resolved') {
          renderRating(c);
        } else if (c.status !== 'closed') {
          renderReply();
        } else {
          footEl.innerHTML = '<div class="support-empty">This case is closed.</div>';
        }
      } catch (err) {
        threadEl.innerHTML = '<div class="support-alert-err">' + esc(err.message) + '</div>';
      }
    }

    function renderReply() {
      footEl.innerHTML =
        '<div class="support-reply">' +
          '<textarea id="support-reply-body" rows="2" maxlength="5000" ' +
            'placeholder="Write a reply\u2026"></textarea>' +
          '<button type="button" class="support-btn-primary" id="support-reply-send">Send</button>' +
        '</div>' +
        '<div id="support-reply-alert"></div>';
      footEl.querySelector('#support-reply-send').addEventListener('click', async function () {
        var body = footEl.querySelector('#support-reply-body').value.trim();
        var alertBox = footEl.querySelector('#support-reply-alert');
        alertBox.innerHTML = '';
        if (!body) return;
        var btn = footEl.querySelector('#support-reply-send');
        btn.disabled = true;
        btn.textContent = '\u2026';
        try {
          var res = await authedFetch('/api/support/cases/' + encodeURIComponent(caseId) + '/messages', {
            method: 'POST',
            body: JSON.stringify({ body: body }),
          });
          var data = await res.json();
          if (!res.ok || !data.ok) throw new Error((data && data.error) || 'Could not send.');
          load(); // reload thread to show the new message + updated state
        } catch (err) {
          btn.disabled = false;
          btn.textContent = 'Send';
          alertBox.innerHTML = '<div class="support-alert-err">' + esc(err.message) + '</div>';
        }
      });
    }

    function renderRating(c) {
      var current = c.rating || 0;
      var stars = '';
      for (var i = 1; i <= 5; i++) {
        stars += '<button type="button" class="support-star' +
          (i <= current ? ' is-on' : '') + '" data-star="' + i + '" ' +
          'aria-label="' + i + ' star' + (i > 1 ? 's' : '') + '">\u2605</button>';
      }
      footEl.innerHTML =
        '<div class="support-rating">' +
          '<div class="support-rating-label">' +
            (current ? 'Your rating' : 'How was our support?') +
          '</div>' +
          '<div class="support-stars" id="support-stars">' + stars + '</div>' +
          '<textarea id="support-rating-comment" rows="2" maxlength="2000" ' +
            'placeholder="Anything you\u2019d like to add? (optional)">' +
            esc(c.rating_comment || '') +
          '</textarea>' +
          '<button type="button" class="support-btn-primary" id="support-rating-send">' +
            (current ? 'Update rating' : 'Submit rating') +
          '</button>' +
          '<div id="support-rating-alert"></div>' +
        '</div>';

      var picked = current;
      var starEls = footEl.querySelectorAll('.support-star');
      starEls.forEach(function (s) {
        s.addEventListener('click', function () {
          picked = parseInt(s.getAttribute('data-star'), 10);
          starEls.forEach(function (other) {
            var v = parseInt(other.getAttribute('data-star'), 10);
            other.classList.toggle('is-on', v <= picked);
          });
        });
      });

      footEl.querySelector('#support-rating-send').addEventListener('click', async function () {
        var alertBox = footEl.querySelector('#support-rating-alert');
        alertBox.innerHTML = '';
        if (!(picked >= 1 && picked <= 5)) {
          alertBox.innerHTML = '<div class="support-alert-err">Please pick 1\u20135 stars.</div>';
          return;
        }
        var comment = footEl.querySelector('#support-rating-comment').value.trim();
        var btn = footEl.querySelector('#support-rating-send');
        btn.disabled = true;
        try {
          var res = await authedFetch('/api/support/cases/' + encodeURIComponent(caseId) + '/rating', {
            method: 'POST',
            body: JSON.stringify({ rating: picked, comment: comment }),
          });
          var data = await res.json();
          if (!res.ok || !data.ok) throw new Error((data && data.error) || 'Could not save.');
          alertBox.innerHTML = '<div class="support-alert-ok">Thanks for the feedback!</div>';
          btn.textContent = 'Update rating';
          btn.disabled = false;
        } catch (err) {
          btn.disabled = false;
          alertBox.innerHTML = '<div class="support-alert-err">' + esc(err.message) + '</div>';
        }
      });
    }

    load();
  }

  // ---- background polling ------------------------------------------------
  // Poll the cheap unread-count every 45s so the envelope updates without
  // a page refresh. Load-safe: count-only query, paused while the tab is
  // hidden, and stopped entirely after ~15min of the tab being hidden
  // (resumes on focus). At realistic concurrency this is negligible DB
  // load even well past 1000 users.
  var POLL_MS = 45000;
  var IDLE_STOP_MS = 15 * 60 * 1000;
  var pollTimer = null;
  var hiddenSince = null;

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(function () {
      // Don't poll while hidden.
      if (document.hidden) {
        if (hiddenSince && (Date.now() - hiddenSince) > IDLE_STOP_MS) {
          stopPolling(); // gone too long — stop until they return
        }
        return;
      }
      refreshUnread();
    }, POLL_MS);
  }
  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function handleVisibility() {
    if (document.hidden) {
      hiddenSince = Date.now();
    } else {
      hiddenSince = null;
      // Returning to the tab: refresh immediately + ensure polling runs.
      refreshUnread();
      startPolling();
    }
  }

  // ---- boot --------------------------------------------------------------
  function init() {
    injectChrome();
    refreshUnread();
    document.addEventListener('visibilitychange', handleVisibility);
    startPolling();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.iboostSupport = { refreshUnread: refreshUnread, openInbox: openInbox };
})();
