// Landing page controller.
// Handles: currency toggle (USD/CAD), FAQ accordion, auth-aware header CTA swap.

(function () {
  'use strict';

  // ----- Currency toggle -----
  // Elements with data-currency="usd" or data-currency="cad" are shown/hidden
  // based on the user's selection. Persisted in localStorage.

  const STORAGE_KEY = 'iboost.currency';

  function getSavedCurrency() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (_) {
      return null;
    }
  }

  function saveCurrency(c) {
    try {
      localStorage.setItem(STORAGE_KEY, c);
    } catch (_) {
      /* storage full or disabled — non-fatal */
    }
  }

  function applyCurrency(currency) {
    document.querySelectorAll('[data-currency]').forEach(function (el) {
      el.hidden = el.getAttribute('data-currency') !== currency;
    });
    document.querySelectorAll('[data-currency-toggle]').forEach(function (btn) {
      const active = btn.getAttribute('data-currency-toggle') === currency;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function guessDefaultCurrency() {
    // Best-effort default. User can override with the toggle anytime.
    // Prefer saved choice; else guess CAD for French pages and fr-CA locale.
    const saved = getSavedCurrency();
    if (saved === 'usd' || saved === 'cad') return saved;
    const htmlLang = (document.documentElement.lang || '').toLowerCase();
    if (htmlLang.startsWith('fr')) return 'cad';
    try {
      const lang = (navigator.language || '').toLowerCase();
      if (lang.includes('ca')) return 'cad';
    } catch (_) { /* ignore */ }
    return 'usd';
  }

  function initCurrency() {
    const toggles = document.querySelectorAll('[data-currency-toggle]');
    if (!toggles.length) return;

    applyCurrency(guessDefaultCurrency());

    toggles.forEach(function (btn) {
      btn.addEventListener('click', function () {
        const c = btn.getAttribute('data-currency-toggle');
        saveCurrency(c);
        applyCurrency(c);
      });
    });
  }

  // ----- FAQ accordion -----
  function initFaq() {
    document.querySelectorAll('.faq-question').forEach(function (btn) {
      btn.setAttribute('aria-expanded', 'false');
      const answer = btn.nextElementSibling;
      if (answer) answer.setAttribute('data-open', 'false');

      btn.addEventListener('click', function () {
        const open = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', open ? 'false' : 'true');
        if (answer) answer.setAttribute('data-open', open ? 'false' : 'true');
      });
    });
  }

  // ----- Header auth-aware CTA swap -----
  // When logged in:
  //   - swap [data-auth-swap] elements (e.g. "Sign in" -> "Account")
  //   - hide [data-auth-hide] elements (e.g. the "Get started" CTA)
  async function updateHeaderForAuth() {
    if (!window.iboostAuth) return;
    const { session } = await window.iboostAuth.getSession();
    if (!session) return;
    document.querySelectorAll('[data-auth-swap]').forEach(function (el) {
      const to = el.getAttribute('data-auth-to');
      const label = el.getAttribute('data-auth-label');
      if (to) el.setAttribute('href', to);
      if (label) el.textContent = label;
    });
    document.querySelectorAll('[data-auth-hide]').forEach(function (el) {
      el.hidden = true;
    });
  }

  // ----- Interactive hero score card -----
  // 12-month illustrative journey from 580 (Fair) to 666 (just crossing into Good).
  // Auto-plays once on load; slider lets users scrub through any month.
  // Respects prefers-reduced-motion by landing on month 12 with no animation.
  function initScoreCard() {
    const scoreEl   = document.getElementById('sc-score');
    const labelEl   = document.getElementById('sc-label');
    const monthEl   = document.getElementById('sc-month-label');
    const changeEl  = document.getElementById('sc-change');
    const markerEl  = document.getElementById('sc-marker');
    const tipWrap   = document.getElementById('sc-tip-wrap');
    const tipEl     = document.getElementById('sc-tip');
    const slider    = document.getElementById('sc-slider');
    const playBtn   = document.getElementById('sc-play');

    // If any critical element is missing, the hero was changed — bail quietly.
    if (!scoreEl || !slider || !playBtn) return;

    const MONTHS = [
      { score: 580, change: 0,  label: 'Fair', tip: 'Set up autopay so you never miss an iBoost payment.' },
      { score: 586, change: 6,  label: 'Fair', tip: 'First payment reported to the bureaus. Small bump expected in 2–3 weeks.' },
      { score: 594, change: 14, label: 'Fair', tip: 'Keep your utility card balance under 30% of the limit.' },
      { score: 604, change: 24, label: 'Fair', tip: 'Three on-time payments logged. Payment history is strengthening.' },
      { score: 614, change: 34, label: 'Fair', tip: "Don't close your oldest card — credit age matters more than you think." },
      { score: 625, change: 45, label: 'Fair', tip: 'Ask your oldest card for a limit increase. It improves your utilization ratio.' },
      { score: 636, change: 56, label: 'Fair', tip: "You're halfway. Dispute any inaccurate items — we'll help draft it." },
      { score: 647, change: 67, label: 'Fair', tip: 'Two more on-time months and you cross into Good.' },
      { score: 657, change: 77, label: 'Fair', tip: 'Almost there. Resist opening new credit in the last 3 months.' },
      { score: 664, change: 84, label: 'Fair', tip: 'Autopay + low utilization + on-time = the 3 habits keeping you climbing.' },
      { score: 668, change: 88, label: 'Fair', tip: 'One point away from Good. Stay the course.' },
      { score: 672, change: 92, label: 'Good', tip: "You crossed into Good. Lenders see your profile differently now." }
    ];

    // Trend chart constants (must match the SVG viewBox in index.html)
    const CHART_W = 300, CHART_H = 90;
    const MARGIN_L = 18, MARGIN_R = 8, MARGIN_T = 8, MARGIN_B = 8;
    const Y_MIN = 550, Y_MAX = 780;

    function xForMonth(m) {
      const plotW = CHART_W - MARGIN_L - MARGIN_R;
      return MARGIN_L + ((m - 1) / 11) * plotW;
    }
    function yForScore(score) {
      const plotH = CHART_H - MARGIN_T - MARGIN_B;
      const frac = (score - Y_MIN) / (Y_MAX - Y_MIN);
      return MARGIN_T + plotH - frac * plotH;
    }
    function buildPath(points) {
      if (!points.length) return '';
      return 'M ' + points.map(p => p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join(' L ');
    }

    const allPoints = MONTHS.map((d, i) => ({
      x: xForMonth(i + 1),
      y: yForScore(d.score)
    }));

    const futurePath   = document.getElementById('sc-trend-future');
    const traveledPath = document.getElementById('sc-trend-traveled');
    const dot          = document.getElementById('sc-trend-dot');
    const pulse        = document.getElementById('sc-trend-pulse');
    const milestoneG   = document.getElementById('sc-trend-milestones');

    // Precompute the complete (future) path and the Fair->Good crossover marker.
    if (futurePath) futurePath.setAttribute('d', buildPath(allPoints));

    if (milestoneG) {
      // Marker where the trajectory crosses Good (670). With the current
      // journey data the crossover happens at month 12 (score jumps from
      // 668 to 672), so the dot lands at the top-right of the chart.
      const threshIdx = MONTHS.findIndex(d => d.score >= 670);
      if (threshIdx > -1) {
        const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c.setAttribute('cx', String(allPoints[threshIdx].x));
        c.setAttribute('cy', String(allPoints[threshIdx].y));
        c.setAttribute('r', '3.5');
        c.setAttribute('fill', '#0f2e4d');
        c.setAttribute('stroke', '#2ECC71');
        c.setAttribute('stroke-width', '2');
        milestoneG.appendChild(c);
      }
    }

    let current = 1;
    let autoTimer = null;
    let isPlaying = false;

    function render(monthNum, animateTip) {
      const data = MONTHS[monthNum - 1];
      if (!data) return;

      scoreEl.textContent  = data.score;
      if (labelEl)  labelEl.textContent  = data.label;
      if (monthEl)  monthEl.textContent  = 'Month ' + monthNum + ' of 12';
      if (changeEl) changeEl.textContent = data.change;
      // Marker position on the 300-850 gauge, computed from score.
      if (markerEl) {
        const pct = Math.max(0, Math.min(100, ((data.score - 300) / 550) * 100));
        markerEl.style.left = pct.toFixed(1) + '%';
      }

      // Trend chart: update traveled stroke + current dot position
      if (traveledPath) {
        traveledPath.setAttribute('d', buildPath(allPoints.slice(0, monthNum)));
      }
      const pt = allPoints[monthNum - 1];
      if (dot) {
        dot.setAttribute('cx', String(pt.x));
        dot.setAttribute('cy', String(pt.y));
      }
      if (pulse) {
        pulse.setAttribute('cx', String(pt.x));
        pulse.setAttribute('cy', String(pt.y));
      }

      if (animateTip && tipWrap && tipEl) {
        tipWrap.style.opacity = '0';
        setTimeout(function () {
          tipEl.textContent = data.tip;
          tipWrap.style.opacity = '1';
        }, 180);
      } else if (tipEl) {
        tipEl.textContent = data.tip;
      }

      current = monthNum;
      slider.value = String(monthNum);
    }

    function stopAutoPlay() {
      if (autoTimer) {
        // autoTimer holds either an interval id (during step-advancing) or a
        // timeout id (during the end-of-cycle pause). Clearing both is safe:
        // browsers no-op the mismatched one.
        clearInterval(autoTimer);
        clearTimeout(autoTimer);
        autoTimer = null;
      }
      isPlaying = false;
      playBtn.textContent = '▶ Play';
      playBtn.setAttribute('aria-label', 'Play the 12-month journey');
    }

    // Timing (ms)
    const STEP_MS = 2400;      // each month transition (was 1600 — still felt rushed)
    const LOOP_REST_MS = 3500; // pause at month 12 before looping back to month 1

    function startAutoPlay() {
      stopAutoPlay();
      isPlaying = true;
      playBtn.textContent = '■ Stop';
      playBtn.setAttribute('aria-label', 'Stop playback');
      // Fresh start when called from month 12 (end of previous run) or the first time.
      let step = current >= 12 ? 1 : current;
      render(step, true);

      function tick() {
        step++;
        if (step > 12) {
          // Reached the end: sit on month 12 for a breath, then loop back.
          clearInterval(autoTimer);
          autoTimer = setTimeout(function () {
            if (!isPlaying) return;  // user stopped us during the rest
            step = 1;
            render(step, true);
            autoTimer = setInterval(tick, STEP_MS);
          }, LOOP_REST_MS);
          return;
        }
        render(step, true);
      }

      autoTimer = setInterval(tick, STEP_MS);
    }

    slider.addEventListener('input', function () {
      stopAutoPlay();
      render(parseInt(slider.value, 10), true);
    });

    playBtn.addEventListener('click', function () {
      if (isPlaying) { stopAutoPlay(); } else { startAutoPlay(); }
    });

    // Pause the loop when the tab isn't visible — saves CPU and avoids the
    // animation jumping in mid-cycle when users return. Resume automatically
    // on tab re-focus so the hero feels alive again without requiring a click.
    let wasPlayingBeforeHide = false;
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        wasPlayingBeforeHide = isPlaying;
        if (isPlaying) stopAutoPlay();
      } else if (wasPlayingBeforeHide) {
        startAutoPlay();
      }
    });

    // Start: render month 1 immediately, then kick off the looping autoplay.
    render(1, false);
    setTimeout(startAutoPlay, 500);
  }

  // ----- Boot -----
  document.addEventListener('DOMContentLoaded', function () {
    initCurrency();
    initFaq();
    initScoreCard();
    initBackToTop();
  });

  // Footer "Back to top" button
  function initBackToTop() {
    const buttons = document.querySelectorAll('[data-footer-totop]');
    buttons.forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
      });
    });
  }

  // If Supabase is loaded via defer, iboostAuth may not exist yet at DOMContentLoaded.
  // Poll briefly, then give up.
  let tries = 0;
  const t = setInterval(function () {
    if (window.iboostAuth) {
      clearInterval(t);
      updateHeaderForAuth();
    } else if (++tries > 20) {
      clearInterval(t);
    }
  }, 100);
})();
