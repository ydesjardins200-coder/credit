/**
 * Bank-format presets for CSV import (Phase 5f).
 *
 * A preset is a fingerprint + a config that lets us auto-detect a
 * specific bank's export format and skip the manual-mapping step.
 *
 *   fingerprint(rawRows, headerlessParseRows, decoded) -> boolean
 *     Inspects the parsed CSV and returns true if it looks like
 *     this bank's format. Should be CHEAP and CONFIDENT — false
 *     positives are worse than false negatives (a missed preset
 *     just means the user does manual mapping; a wrong preset
 *     means data lands in wrong columns and the user might not
 *     notice).
 *
 *   config:
 *     name              — human-readable label shown in the UI
 *     hasHeader         — false for headerless exports (Desjardins)
 *     mapping           — { date, amount, description, amount_in? }
 *                         column indices (0-based)
 *     skipBeforeRows    — optional, number of rows to skip before
 *                         data begins (some banks have a few
 *                         metadata rows before the transactions).
 *                         Not yet used; reserved for RBC etc.
 *
 * Adding a new preset:
 *   1. Get a real export file from the bank
 *   2. Confirm column layout, header row, encoding
 *   3. Write a fingerprint that matches THIS bank specifically
 *      (ideally checking 2+ distinguishing properties — column
 *      count alone is not enough)
 *   4. Add the preset to PRESETS array, in priority order
 *   5. Add a fixture test
 *
 * Why not bake this into csv-import.js: presets are a config concern,
 * not a parsing concern. Keeping them separate means csv-import.js
 * stays a pure parser library and the presets list can grow without
 * the parser file growing with it.
 */
(function () {
  'use strict';

  // -----------------------------------------------------------------
  // Desjardins (Caisse Desjardins) — Quebec credit union, dominant
  // bank in fr-CA market.
  //
  // Format observed (April 2026 export, encoding ISO-8859/Windows-1252):
  //   - Headerless. First row is a transaction.
  //   - 14 columns, all rows consistent:
  //       0: Branch name        ("Deux-Rivières de Sherbrooke")
  //       1: Account number     ("414138")
  //       2: Account type code  ("EOP", "ET2")
  //       3: Date               ("2026/03/02")
  //       4: Sequence number    (00001, 00002, …)
  //       5: Description        ("Paiement /PAYPAL")
  //       6: empty
  //       7: Debit amount       (1839.89 or empty)
  //       8: Credit amount      (1779.94 or empty)
  //       9-12: empty
  //       13: Running balance   (46170.63)
  //
  // Fingerprint logic: 14 columns, no header (because the file IS
  // headerless we feed it through parseCsv with hasHeader:false and
  // check the first row), and the date column has a YYYY/MM/DD value
  // in column 3. We deliberately don't rely on the branch name or
  // account type code because those vary per user and per region.
  // -----------------------------------------------------------------
  var desjardinsPreset = {
    id: 'desjardins',
    name: 'Desjardins (Quebec)',
    hasHeader: false,

    fingerprint: function (rawRows) {
      if (!rawRows || rawRows.length < 1) return false;
      var first = rawRows[0];
      // Column count: every Desjardins row has exactly 14 columns.
      if (!first || first.length !== 14) return false;
      // Date in column 3, format YYYY/MM/DD.
      if (!/^\d{4}\/\d{2}\/\d{2}$/.test(String(first[3] || '').trim())) return false;
      // Column 7 OR column 8 must be a positive numeric string (the
      // debit or credit). The other should be empty. This is the key
      // disambiguator vs e.g. a single-amount-column 14-col bank.
      var col7 = String(first[7] || '').trim();
      var col8 = String(first[8] || '').trim();
      var col7num = col7 !== '' && /^\d+(\.\d+)?$/.test(col7);
      var col8num = col8 !== '' && /^\d+(\.\d+)?$/.test(col8);
      // Exactly one must be numeric (XOR). If both are numeric or
      // neither is, this isn't Desjardins.
      if (col7num === col8num) return false;
      return true;
    },

    mapping: {
      date: 3,
      amount: 7,         // debit / outflow
      amount_in: 8,      // credit / inflow
      description: 5,
    },
  };

  // -----------------------------------------------------------------
  // RBC (Royal Bank of Canada) — major Canadian bank.
  //
  // Format observed (April 2026 export, encoding UTF-8 with BOM):
  //   - Has header row.
  //   - 8 columns:
  //       0: Account Type        ("Chequing", "Savings", "Visa", ...)
  //       1: Account Number      ("01651-5229737")
  //       2: Transaction Date    ("4/13/2026" — M/D/YYYY, NOT zero-padded)
  //       3: Cheque Number       (mostly empty, populated for cheques)
  //       4: Description 1       ("VISA DIRECT DEPOSIT STRIPE")
  //       5: Description 2       (mostly empty, used for transfer/foreign details)
  //       6: CAD$                (signed: negative=outflow, positive=inflow)
  //       7: USD$                (mostly empty; only populated on foreign txns)
  //
  // Sign convention: signed amounts in a single CAD$ column. This is
  // a SINGLE-amount-column format (Phase 5d original path), unlike
  // Desjardins which is two-column XOR debit/credit. The existing
  // parser handles signed amounts — no parser changes needed for the
  // amount logic.
  //
  // Description handling: we concatenate Description 1 + Description 2
  // via the array form of mapping.description (parser extension, this
  // commit). Most rows only populate Description 1, but transfers
  // sometimes use both. " · " separator keeps the parts visually
  // distinct without looking like noise.
  //
  // KNOWN LIMITATIONS (v1):
  //   - USD-only rows (CAD$ empty, USD$ populated) will show up in
  //     the review queue as "Couldn't parse amount". User skips or
  //     manually fixes. Acceptable trade-off for v1: zero USD rows
  //     in our sample data, no way to test a fallback safely. If/when
  //     real users hit this, we add mapping.amount_fallback support.
  //   - Multi-account exports (one CSV containing rows from chequing
  //     AND credit card AND savings) are imported as a flat list. We
  //     don't parse the Account Type column — all rows go into the
  //     same Budget app, same month, no per-account separation. This
  //     matches Phase 5j's deliberate single-account model. When paid-
  //     tier multi-account ships, we revisit.
  //   - Cheque numbers are dropped entirely. Rebuilding-credit users
  //     rarely write cheques, and the description usually conveys
  //     "CHEQUE #1234" anyway.
  //
  // Fingerprint logic: when parsed with hasHeader:false, the FIRST
  // row contains the header strings. We check for the literal header
  // names since they're stable across RBC accounts. Belt-and-suspenders:
  // also verify column count.
  // -----------------------------------------------------------------
  var rbcPreset = {
    id: 'rbc',
    name: 'RBC (Royal Bank of Canada)',
    hasHeader: true,

    fingerprint: function (rawRows) {
      // Need at least the header row + one data row.
      if (!rawRows || rawRows.length < 2) return false;
      var header = rawRows[0];
      if (!header || header.length !== 8) return false;

      // Normalize and check the header column names. Trim each cell
      // because the BOM-stripping has already happened (decodeBytes)
      // but spaces inside header cells should be preserved.
      var normalize = function (s) { return String(s || '').trim().toLowerCase(); };
      var expected = [
        'account type',
        'account number',
        'transaction date',
        'cheque number',
        'description 1',
        'description 2',
        'cad$',
        'usd$',
      ];
      for (var i = 0; i < expected.length; i++) {
        if (normalize(header[i]) !== expected[i]) return false;
      }

      // Belt-and-suspenders: confirm the first DATA row (index 1) has
      // a date in column 2 that looks like M/D/YYYY or MM/DD/YYYY.
      // This guards against the unlikely case of a CSV from a
      // different bank that happens to have identical headers.
      var firstData = rawRows[1];
      if (!firstData) return false;
      var dateCell = String(firstData[2] || '').trim();
      if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateCell)) return false;

      return true;
    },

    mapping: {
      date: 2,
      amount: 6,                  // CAD$ signed
      description: [4, 5],        // concatenate Description 1 + 2
    },
  };

  // -----------------------------------------------------------------
  // Preset registry. Order matters: the first matching fingerprint
  // wins. Put more specific presets earlier and more permissive ones
  // later.
  // -----------------------------------------------------------------
  var PRESETS = [
    desjardinsPreset,
    rbcPreset,
  ];

  /**
   * Try every preset's fingerprint against the parsed rows. Returns
   * the first match, or null if none match.
   *
   * Caller is expected to have parsed the CSV with hasHeader:false
   * (since presets that DO have a header will still fingerprint fine
   * against the rows including the header row at index 0). This is
   * the most flexible approach — header-having presets just inspect
   * different columns.
   *
   * @param {Array<Array<string>>} rawRows  All rows from parseCsv with hasHeader:false
   * @returns {object|null} the matched preset, or null
   */
  function detectPreset(rawRows) {
    for (var i = 0; i < PRESETS.length; i++) {
      var p = PRESETS[i];
      try {
        if (p.fingerprint(rawRows)) return p;
      } catch (e) {
        // A buggy fingerprint should not crash the import. Log and
        // keep checking the next preset.
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[csv-presets] fingerprint error in preset:', p.id, e);
        }
      }
    }
    return null;
  }

  window.iboostCsvPresets = {
    detectPreset: detectPreset,
    PRESETS: PRESETS,
  };
})();
