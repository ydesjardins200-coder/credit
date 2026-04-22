// Site header controller.
//
// Handles:
//   - Scroll detection: toggles .is-scrolled class on <header> when user
//     scrolls past ~60px (header flips from transparent to solid white)
//   - Mega menu dropdowns (desktop): open on hover, focus, or click.
//     Only one menu open at a time. Closes on Escape, outside click,
//     or blur-away.
//   - Mobile drawer: hamburger opens a right-side drawer with accordion
//     sections. Locks body scroll, traps focus, closes on Escape or
//     scrim click.
//   - Accordion (inside drawer): one section open at a time.
//   - Keyboard a11y: arrow keys, Tab, Escape all behave predictably.
//
// Loads on all pages that have <header data-header> + <div.site-drawer>.
// Gracefully no-ops if those elements aren't present.

(function () {
  'use strict';

  const SCROLL_THRESHOLD = 60; // px past which the header flips to solid

  // ---------------------------------------------------------------------
  // SCROLL DETECTION
  // ---------------------------------------------------------------------

  function initScrollState() {
    const header = document.querySelector('[data-header]');
    if (!header) return;

    let ticking = false;

    function update() {
      if (window.scrollY > SCROLL_THRESHOLD) {
        header.classList.add('is-scrolled');
      } else {
        header.classList.remove('is-scrolled');
      }
      ticking = false;
    }

    function onScroll() {
      if (!ticking) {
        window.requestAnimationFrame(update);
        ticking = true;
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    update(); // Run once on load in case page loads scrolled
  }

  // ---------------------------------------------------------------------
  // DESKTOP MEGA MENU
  // ---------------------------------------------------------------------

  function initMegaMenu() {
    const menus = document.querySelectorAll('.site-nav-item[data-menu]');
    if (!menus.length) return;

    // Track currently open menu so we can close it when opening another
    let openMenu = null;

    function openMenuItem(item) {
      if (openMenu && openMenu !== item) {
        closeMenuItem(openMenu);
      }
      item.classList.add('is-open');
      const trigger = item.querySelector('.site-nav-trigger');
      if (trigger) trigger.setAttribute('aria-expanded', 'true');
      openMenu = item;
    }

    function closeMenuItem(item) {
      item.classList.remove('is-open');
      const trigger = item.querySelector('.site-nav-trigger');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
      if (openMenu === item) openMenu = null;
    }

    function closeAll() {
      menus.forEach(closeMenuItem);
    }

    // Hover behavior with slight grace delay so users can diagonal-move
    // from trigger to menu without the menu closing mid-move
    let hoverTimeout = null;

    menus.forEach(function (item) {
      const trigger = item.querySelector('.site-nav-trigger');

      // Mouse enter -> open (cancel any pending close)
      item.addEventListener('mouseenter', function () {
        if (hoverTimeout) {
          clearTimeout(hoverTimeout);
          hoverTimeout = null;
        }
        openMenuItem(item);
      });

      // Mouse leave -> close with 120ms grace
      item.addEventListener('mouseleave', function () {
        hoverTimeout = setTimeout(function () {
          closeMenuItem(item);
        }, 120);
      });

      // Click toggles (for touch/keyboard users who don't hover)
      if (trigger) {
        trigger.addEventListener('click', function (e) {
          e.preventDefault();
          if (item.classList.contains('is-open')) {
            closeMenuItem(item);
          } else {
            openMenuItem(item);
          }
        });

        // Keyboard: Enter/Space toggles, Escape closes, ArrowDown opens
        trigger.addEventListener('keydown', function (e) {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            openMenuItem(item);
            // Focus first menu item
            const firstItem = item.querySelector('.site-mega-item');
            if (firstItem) firstItem.focus();
          } else if (e.key === 'Escape') {
            closeMenuItem(item);
            trigger.focus();
          }
        });
      }

      // Escape inside menu body closes and refocuses trigger
      item.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          closeMenuItem(item);
          if (trigger) trigger.focus();
        }
      });
    });

    // Close on outside click
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.site-nav-item')) {
        closeAll();
      }
    });

    // Close on outside focus (Tab out of the last menu item)
    document.addEventListener('focusin', function (e) {
      if (openMenu && !openMenu.contains(e.target)) {
        closeMenuItem(openMenu);
      }
    });
  }

  // ---------------------------------------------------------------------
  // MOBILE DRAWER
  // ---------------------------------------------------------------------

  function initDrawer() {
    const drawer = document.getElementById('site-drawer');
    const openBtn = document.querySelector('[data-drawer-open]');
    if (!drawer || !openBtn) return;

    const closeTriggers = drawer.querySelectorAll('[data-drawer-close]');
    const panel = drawer.querySelector('.site-drawer-panel');
    const accordions = drawer.querySelectorAll('.site-acc[data-acc]');

    let lastFocused = null;

    function openDrawer() {
      lastFocused = document.activeElement;
      drawer.hidden = false;
      drawer.setAttribute('aria-hidden', 'false');
      // Defer the class toggle by one frame so CSS transitions play
      requestAnimationFrame(function () {
        drawer.classList.add('is-open');
      });
      document.body.classList.add('site-drawer-open');
      openBtn.setAttribute('aria-expanded', 'true');

      // Focus the close button for immediate keyboard accessibility
      const firstCloseBtn = drawer.querySelector('.site-drawer-close');
      if (firstCloseBtn) {
        setTimeout(function () { firstCloseBtn.focus(); }, 100);
      }
    }

    function closeDrawer() {
      drawer.classList.remove('is-open');
      document.body.classList.remove('site-drawer-open');
      openBtn.setAttribute('aria-expanded', 'false');
      drawer.setAttribute('aria-hidden', 'true');

      // Hide after transition completes so tab-through can't reach it
      setTimeout(function () {
        drawer.hidden = true;
      }, 280);

      // Return focus to whatever triggered the drawer
      if (lastFocused && typeof lastFocused.focus === 'function') {
        lastFocused.focus();
      }
    }

    // Open
    openBtn.addEventListener('click', openDrawer);

    // Close triggers (X button + scrim)
    closeTriggers.forEach(function (btn) {
      btn.addEventListener('click', closeDrawer);
    });

    // Escape closes
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !drawer.hidden && drawer.classList.contains('is-open')) {
        closeDrawer();
      }
    });

    // Accordion behavior: click head toggles; one open at a time
    accordions.forEach(function (acc) {
      const head = acc.querySelector('.site-acc-head');
      if (!head) return;

      head.addEventListener('click', function () {
        const isOpen = acc.classList.contains('is-open');

        // Close all others
        accordions.forEach(function (other) {
          if (other !== acc) {
            other.classList.remove('is-open');
            const otherHead = other.querySelector('.site-acc-head');
            if (otherHead) otherHead.setAttribute('aria-expanded', 'false');
          }
        });

        // Toggle this one
        if (isOpen) {
          acc.classList.remove('is-open');
          head.setAttribute('aria-expanded', 'false');
        } else {
          acc.classList.add('is-open');
          head.setAttribute('aria-expanded', 'true');
        }
      });
    });

    // Close drawer when any link inside is clicked (so navigation works
    // cleanly — otherwise the drawer sits open on the new page during
    // the brief render gap, which looks buggy)
    drawer.querySelectorAll('a[href]').forEach(function (link) {
      link.addEventListener('click', function () {
        closeDrawer();
      });
    });
  }

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------

  function init() {
    initScrollState();
    initMegaMenu();
    initDrawer();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
