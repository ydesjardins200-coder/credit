/**
 * iBoost merchant categories — Level-1 auto-categorization for the
 * Free-tier Budget tab.
 *
 * When a user types a note in the Add Entry modal (e.g., "Maxi" or
 * "Amazon Prime"), this module checks the text against ~150 known
 * Canadian and US merchant patterns and suggests the appropriate
 * category. The suggestion pre-selects the category dropdown; user
 * can override.
 *
 * Architecture context (from free-budget-analysis.md Q6):
 *
 *   Free tier uses this static table.
 *   Paid tier will use a fuller rules engine (Layer 2: regex patterns
 *   on cleaned merchant strings; Layer 3: Anthropic LLM for the
 *   stragglers). This table IS Layer 1 of that future engine — built
 *   once for free, reused for paid.
 *
 * Categories must match the seed list (lib/budget-seed.js) exactly.
 * Adding a merchant for a category that doesn't exist in the seed
 * means the suggestion will fail to match user's actual category list.
 *
 * Match strategy: case-insensitive substring. The user's note
 * "MAXI #4502 PLATEAU" matches the pattern "maxi". The pattern table
 * is iterated in insertion order, so MORE SPECIFIC patterns must come
 * BEFORE less specific ones (e.g., "amazon prime" before "amazon").
 *
 * Country coverage: Canadian merchants first (iBoost launched Quebec-
 * first), US merchants second. Comments group them. Both pulled from
 * common credit card statement patterns.
 *
 * Exports a global `window.iboostMerchants` for use by the Add Entry
 * modal in account.js.
 */

(function () {
  'use strict';

  // The lookup table. Order matters — more specific patterns FIRST.
  // Object insertion order is preserved in JS, so we can use a plain
  // object instead of a Map.
  const MERCHANT_HINTS = {
    // ============================================================
    // SUBSCRIPTIONS / FITNESS — most specific first
    // ============================================================
    // App stores: tricky because they don't say what was sold. Best
    // guess is "subscription/personal" since that's the most common
    // small recurring charge. Users override if they bought a one-time
    // app or media item.
    'amazon prime':     'Fitness & Subscriptions',
    'amazon music':     'Fitness & Subscriptions',
    'apple.com/bill':   'Fitness & Subscriptions',
    'apple services':   'Fitness & Subscriptions',
    'google *':         'Fitness & Subscriptions',
    'google play':      'Fitness & Subscriptions',

    // Streaming / media
    'netflix':          'Fitness & Subscriptions',
    'spotify':          'Fitness & Subscriptions',
    'disney plus':      'Fitness & Subscriptions',
    'disney+':          'Fitness & Subscriptions',
    'crave':            'Fitness & Subscriptions',
    'youtube premium':  'Fitness & Subscriptions',
    'apple music':      'Fitness & Subscriptions',
    'apple tv':         'Fitness & Subscriptions',
    'hulu':             'Fitness & Subscriptions',
    'hbo':              'Fitness & Subscriptions',
    'peacock':          'Fitness & Subscriptions',
    'paramount':        'Fitness & Subscriptions',

    // Productivity / SaaS subscriptions
    'iboost':           'Fitness & Subscriptions',
    'dropbox':          'Fitness & Subscriptions',
    'icloud':           'Fitness & Subscriptions',
    'github':           'Fitness & Subscriptions',
    'notion':           'Fitness & Subscriptions',
    'chatgpt':          'Fitness & Subscriptions',
    'anthropic':        'Fitness & Subscriptions',
    'claude.ai':        'Fitness & Subscriptions',

    // Gym / fitness
    'goodlife':         'Fitness & Subscriptions',
    'energie cardio':   'Fitness & Subscriptions',
    'planet fitness':   'Fitness & Subscriptions',
    'la fitness':       'Fitness & Subscriptions',
    'equinox':          'Fitness & Subscriptions',
    'crossfit':         'Fitness & Subscriptions',
    'peloton':          'Fitness & Subscriptions',

    // ============================================================
    // GROCERIES (Canadian)
    // ============================================================
    'maxi':             'Groceries',
    'iga':              'Groceries',
    'metro':            'Groceries',
    'loblaws':          'Groceries',
    'provigo':          'Groceries',
    'super c':          'Groceries',
    'no frills':        'Groceries',
    'sobeys':           'Groceries',
    'safeway':          'Groceries',
    'fortinos':         'Groceries',
    'longo':            'Groceries',
    'farm boy':         'Groceries',
    'adonis':           'Groceries',

    // ============================================================
    // GROCERIES (US)
    // ============================================================
    'whole foods':      'Groceries',
    'trader joe':       'Groceries',
    'kroger':           'Groceries',
    'publix':           'Groceries',
    'wegmans':          'Groceries',
    'food lion':        'Groceries',
    'h-e-b':            'Groceries',
    'aldi':             'Groceries',
    'sprouts':          'Groceries',
    'meijer':           'Groceries',

    // Cross-border bulk retail (groceries by default, may also sell
    // electronics/furniture; user overrides if needed)
    'costco':           'Groceries',
    'walmart':          'Groceries',
    'sam':              'Groceries', // Sam's Club. Lossy but common.

    // ============================================================
    // DINING (fast food + restaurants + delivery)
    // ============================================================
    // Coffee
    'starbucks':        'Dining',
    'tim hortons':      'Dining',
    'second cup':       'Dining',
    'dunkin':           'Dining',

    // Fast food chains
    'mcdonald':         'Dining',
    'subway':           'Dining',
    'burger king':      'Dining',
    'wendy':            'Dining',
    'kfc':              'Dining',
    'taco bell':        'Dining',
    'chipotle':         'Dining',
    'a&w':              'Dining',
    'harvey':           'Dining',
    'pizza hut':        'Dining',
    'domino':           'Dining',
    'pizza pizza':      'Dining',
    'st-hubert':        'Dining',
    'st hubert':        'Dining',

    // Delivery apps (Canadian + US)
    'doordash':         'Dining',
    'door dash':        'Dining',
    'uber eats':        'Dining',
    'ubereats':         'Dining',
    'skipthedishes':    'Dining',
    'skip the dishes':  'Dining',
    'grubhub':          'Dining',
    'foodora':          'Dining',
    'instacart':        'Groceries', // technically delivery but for groceries

    // Generic dining keywords (catch-all for restaurants whose name
    // doesn't match a chain). Words pulled from common merchant patterns.
    'restaurant':       'Dining',
    'cafe':             'Dining',
    'bistro':           'Dining',
    'pub ':             'Dining',
    'diner':            'Dining',

    // ============================================================
    // TRANSPORT (gas + ride share + transit)
    // ============================================================
    // Gas (Canadian)
    'shell':            'Transport',
    'esso':             'Transport',
    'petro-canada':     'Transport',
    'petro canada':     'Transport',
    'ultramar':         'Transport',
    'irving':           'Transport',
    'husky':            'Transport',
    'pioneer':          'Transport',
    'couche-tard':      'Transport', // gas + convenience, primarily fuel

    // Gas (US)
    'chevron':          'Transport',
    'exxon':            'Transport',
    'mobil':            'Transport',
    'bp ':              'Transport',
    '7-eleven':         'Transport', // gas+convenience; primarily transport here
    'wawa':             'Transport',

    // Ride share / taxi
    'uber':             'Transport', // catches "uber" but NOT "uber eats" because order matters
    'lyft':             'Transport',
    'taxi':             'Transport',

    // Transit (urban — Canadian + major US)
    'stm':              'Transport', // Société de transport de Montréal
    'ttc':              'Transport', // Toronto
    'opus':             'Transport', // Montreal transit card
    'presto':           'Transport', // Ontario transit card
    'translink':        'Transport', // Vancouver
    'mta':              'Transport', // NYC
    'bart':             'Transport', // San Francisco

    // EV / charging
    'electrify':        'Transport',
    'chargepoint':      'Transport',
    'tesla supercharger': 'Transport',

    // ============================================================
    // TELECOM (phone + internet)
    // ============================================================
    // Canadian
    'fido':             'Telecom',
    'rogers':           'Telecom',
    'bell':             'Telecom',
    'videotron':        'Telecom',
    'telus':            'Telecom',
    'koodo':            'Telecom',
    'public mobile':    'Telecom',
    'freedom mobile':   'Telecom',
    'virgin plus':      'Telecom',
    'chatr':            'Telecom',

    // US
    'verizon':          'Telecom',
    'at&t':             'Telecom',
    't-mobile':         'Telecom',
    'tmobile':          'Telecom',
    'sprint':           'Telecom',
    'xfinity':          'Telecom',
    'comcast':          'Telecom',
    'spectrum':         'Telecom',

    // ============================================================
    // UTILITIES (electric, gas, water)
    // ============================================================
    'hydro':            'Utilities', // catches "hydro-québec", "hydro one", "bc hydro"
    'enbridge':         'Utilities',
    'energir':          'Utilities',
    'gaz métro':        'Utilities',
    'gaz metro':        'Utilities',
    'fortis':           'Utilities',
    'duke energy':      'Utilities',
    'pg&e':             'Utilities',
    'con edison':       'Utilities',
    'national grid':    'Utilities',

    // ============================================================
    // HEALTHCARE (pharmacy + medical)
    // ============================================================
    // Canadian pharmacies
    'pharmaprix':       'Healthcare',
    'jean coutu':       'Healthcare',
    'shoppers drug':    'Healthcare',
    'rexall':           'Healthcare',
    'familiprix':       'Healthcare',
    'uniprix':          'Healthcare',
    'london drugs':     'Healthcare',

    // US pharmacies
    'cvs':              'Healthcare',
    'walgreens':        'Healthcare',
    'rite aid':         'Healthcare',

    // Medical generic
    'clinique':         'Healthcare',
    'clinic':           'Healthcare',
    'dental':           'Healthcare',
    'dentist':          'Healthcare',
    'optometr':         'Healthcare',
    'physio':           'Healthcare',

    // ============================================================
    // ENTERTAINMENT (movies, events, recreation)
    // ============================================================
    'cineplex':         'Entertainment',
    'cinema':           'Entertainment',
    'amc theatres':     'Entertainment',
    'amc theaters':     'Entertainment',
    'imax':             'Entertainment',
    'ticketmaster':     'Entertainment',
    'stubhub':          'Entertainment',
    'eventbrite':       'Entertainment',
    'steam games':      'Entertainment',
    'steampowered':     'Entertainment',
    'playstation':      'Entertainment',
    'nintendo':         'Entertainment',
    'xbox':             'Entertainment',

    // ============================================================
    // HOUSING (rent, mortgage payments — note: most of these are
    // user-specific landlords, hard to detect from merchant string.
    // We catch the obvious cases.)
    // ============================================================
    'condo':            'Housing',
    'rent ':            'Housing',
    'mortgage':         'Housing',

    // ============================================================
    // INSURANCE
    // ============================================================
    'desjardins assur': 'Insurance',
    'intact':           'Insurance',
    'belairdirect':     'Insurance',
    'la capitale':      'Insurance',
    'sun life':         'Insurance',
    'manulife':         'Insurance',
    'state farm':       'Insurance',
    'allstate':         'Insurance',
    'geico':            'Insurance',
    'progressive':      'Insurance',
    'liberty mutual':   'Insurance',
    'insurance':        'Insurance',
    'assurance':        'Insurance',

    // ============================================================
    // HOME IMPROVEMENT
    // ============================================================
    'home depot':       'Home improvement',
    'rona':             'Home improvement',
    'reno-depot':       'Home improvement',
    'reno depot':       'Home improvement',
    'lowes':            'Home improvement',
    "lowe's":           'Home improvement',
    'canadian tire':    'Home improvement', // also general-purpose; primarily DIY here
    'ace hardware':     'Home improvement',
    'ikea':             'Home improvement',

    // ============================================================
    // PERSONAL (clothing, salon, generic shopping)
    // ============================================================
    'amazon':           'Personal', // generic Amazon (catches "amazon" but NOT "amazon prime"/"amazon music" thanks to ordering above)
    'amzn':             'Personal',
    'aritzia':          'Personal',
    'h&m':              'Personal',
    'zara':             'Personal',
    'uniqlo':           'Personal',
    'lululemon':        'Personal',
    'nike':             'Personal',
    'adidas':           'Personal',
    'sephora':          'Personal',
    'shoppers':         'Healthcare', // disambiguates from "shoppers drug" above (already matched)
    'salon':            'Personal',
    'barber':           'Personal',
  };

  /**
   * Given a free-text note (typically a merchant name or brief
   * description), suggest the best-matching category name. Returns
   * null if no match.
   *
   * The match is case-insensitive substring. First match wins (so
   * the ordering of MERCHANT_HINTS matters — see top-of-file note).
   *
   * @param {string} note - The user's note text from the Add Entry modal
   * @returns {string | null} The suggested category name, or null
   */
  function suggestCategory(note) {
    if (!note || typeof note !== 'string') return null;

    const normalized = note.toLowerCase();

    // Iterate in insertion order. JS preserves it for plain objects.
    for (const merchant of Object.keys(MERCHANT_HINTS)) {
      if (normalized.includes(merchant)) {
        return MERCHANT_HINTS[merchant];
      }
    }

    return null;
  }

  /**
   * Returns the count of merchants in the lookup table. Useful for
   * tests / sanity checks (we want this in the ~150-200 range).
   */
  function getMerchantCount() {
    return Object.keys(MERCHANT_HINTS).length;
  }

  // Sanity check: warn at load time if the table is unexpectedly small
  // (would indicate a regression that broke the lookup table). The
  // threshold is intentionally permissive — adding more is fine, but
  // dropping below 100 means something's wrong.
  if (Object.keys(MERCHANT_HINTS).length < 100) {
    console.warn(
      '[merchant-categories] lookup table has only ' +
      Object.keys(MERCHANT_HINTS).length +
      ' entries (expected 150+). Smart suggestions will be sparse.'
    );
  }

  window.iboostMerchants = {
    suggestCategory: suggestCategory,
    getMerchantCount: getMerchantCount,
  };
})();
