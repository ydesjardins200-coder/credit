/**
 * iBoost locale module — single source of truth for country-derived logic.
 *
 * iBoost serves Canada and the United States. A user's `country` (stored on
 * profiles.country, constrained to 'CA' | 'US') determines:
 *
 *   - Their billing currency (CAD or USD)
 *   - Which credit bureaus apply to them
 *   - Address form labels (Province vs State, Postal code vs ZIP code)
 *   - Display formatting (flag, country name)
 *
 * Before this module existed, these mappings were scattered as inline
 * `country === 'US'` branches across multiple files. That's brittle: adding
 * a new country, or fixing a bureau mapping, required hunting through the
 * codebase. This module centralizes the rules.
 *
 * Convention: when country is null/undefined/unknown, fall back to CA
 * defaults. This matches the historical behavior of account.js
 * (line 305 comment: "CA is the default") and signup.js, and is appropriate
 * because iBoost launched Quebec-first.
 *
 * Exports a global `window.iboostLocale` for use by other scripts.
 * Mirrors lib/locale.js on the admin side — keep these in sync if rules
 * change. (TODO: extract to a shared package if/when the codebases merge.)
 */

(function () {
  'use strict';

  // ----- The rule table -----
  // Single place to add/edit country-specific logic.
  const COUNTRY_RULES = {
    CA: {
      currency: 'cad',
      bureaus: ['equifax', 'transunion'],
      addressLabels: { region: 'Province', postal: 'Postal code' },
      addressPlaceholders: { region: 'QC', postal: 'H3Z 2Y7' },
      flag: '🇨🇦',
      name: 'Canada',
    },
    US: {
      currency: 'usd',
      bureaus: ['equifax', 'transunion', 'experian'],
      addressLabels: { region: 'State', postal: 'ZIP code' },
      addressPlaceholders: { region: 'NY', postal: '10001' },
      flag: '🇺🇸',
      name: 'United States',
    },
  };

  const DEFAULT_COUNTRY = 'CA';

  // ----- Helpers -----

  function normalize(country) {
    if (!country) return DEFAULT_COUNTRY;
    var upper = String(country).toUpperCase();
    return COUNTRY_RULES[upper] ? upper : DEFAULT_COUNTRY;
  }

  function getRules(country) {
    return COUNTRY_RULES[normalize(country)];
  }

  // ----- Public API -----

  /**
   * Returns the supported country codes ['CA', 'US'].
   */
  function getSupportedCountries() {
    return Object.keys(COUNTRY_RULES);
  }

  /**
   * Returns 'cad' or 'usd' for the given country. Falls back to CA default
   * if country is null/unknown.
   */
  function getCurrencyForCountry(country) {
    return getRules(country).currency;
  }

  /**
   * Returns the array of bureau identifiers applicable to the given country.
   * Identifiers match the bureau provider keys in admin/src/routes/settings.js
   * ('equifax', 'transunion', 'experian').
   */
  function getBureausForCountry(country) {
    // Return a copy so callers can't mutate the rule table.
    return getRules(country).bureaus.slice();
  }

  /**
   * Returns true if the given bureau (e.g. 'experian') is applicable to a
   * user in the given country (e.g. 'CA' returns false for 'experian').
   */
  function isBureauApplicable(country, bureau) {
    return getRules(country).bureaus.indexOf(bureau) !== -1;
  }

  /**
   * Returns { region, postal } labels for the address form. CA uses
   * 'Province'/'Postal code'; US uses 'State'/'ZIP code'.
   */
  function getAddressLabels(country) {
    return Object.assign({}, getRules(country).addressLabels);
  }

  /**
   * Returns { region, postal } example placeholders for the address form.
   */
  function getAddressPlaceholders(country) {
    return Object.assign({}, getRules(country).addressPlaceholders);
  }

  /**
   * Returns the flag emoji for the country (display only).
   */
  function getFlag(country) {
    return getRules(country).flag;
  }

  /**
   * Returns the human-readable country name (display only).
   */
  function getCountryName(country) {
    return getRules(country).name;
  }

  /**
   * Returns "🇨🇦 Canada" or "🇺🇸 United States" for display in account UI.
   * If country is null/unset, returns 'Not set' so the UI can show that
   * the user hasn't completed onboarding.
   */
  function getDisplayLabel(country) {
    if (!country) return 'Not set';
    var upper = String(country).toUpperCase();
    if (!COUNTRY_RULES[upper]) return 'Not set';
    return COUNTRY_RULES[upper].flag + ' ' + COUNTRY_RULES[upper].name;
  }

  // ----- Expose globally -----

  window.iboostLocale = {
    getSupportedCountries: getSupportedCountries,
    getCurrencyForCountry: getCurrencyForCountry,
    getBureausForCountry: getBureausForCountry,
    isBureauApplicable: isBureauApplicable,
    getAddressLabels: getAddressLabels,
    getAddressPlaceholders: getAddressPlaceholders,
    getFlag: getFlag,
    getCountryName: getCountryName,
    getDisplayLabel: getDisplayLabel,
  };
})();
