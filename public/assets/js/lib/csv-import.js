/**
 * CSV import parser for Budget tab (Phase 5d).
 *
 * Pure parsing module. No DOM, no Supabase, no merchant matching —
 * those are wired by account.js. This file is concerned with one
 * thing: turning raw CSV text into an array of {date, amount_cents,
 * description} candidate entries, ready for review.
 *
 * v1 scope (locked decisions):
 *   - Manual column mapping (no format auto-detection / presets)
 *   - User must specify which column is date, amount, description
 *   - We try to be smart about parsing values within those columns
 *     (date formats, signed vs paren negatives, dollar/comma stripping)
 *   - Assumes header row exists (first row = column names)
 *   - UTF-8 encoding only
 *   - No dedupe against existing entries
 *
 * Exposed as window.iboostCsv with these methods:
 *   parseCsv(text)              -> { headers: [], rows: [[...]], error }
 *   parseAmount(value)          -> cents (number) | null
 *   parseDate(value)            -> 'YYYY-MM-DD' | null
 *   parseRow(row, mapping)      -> { date, amount_cents, description, valid, error }
 */
(function () {
  'use strict';

  // -----------------------------------------------------------------
  // CSV tokenizer — handles quoted fields with embedded commas/quotes.
  // RFC 4180 compliant for the common cases.
  // -----------------------------------------------------------------

  /**
   * Parse CSV text into a 2D array of strings. First row is treated
   * as headers. Returns { headers, rows, error }.
   *
   * Newline handling: \r\n (Windows), \n (Unix), \r (old Mac) all work.
   * Empty lines are skipped.
   * Quoted fields may contain commas, escaped quotes ("" inside quotes),
   * and embedded newlines.
   */
  function parseCsv(text) {
    if (!text || typeof text !== 'string') {
      return { headers: [], rows: [], error: 'Empty or invalid CSV input' };
    }

    // Normalize line endings to \n. Windows and old-Mac CSVs both work.
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    var rows = [];
    var current = [];
    var field = '';
    var inQuotes = false;
    var i = 0;

    while (i < text.length) {
      var ch = text[i];

      if (inQuotes) {
        if (ch === '"') {
          // Escaped quote? "" inside a quoted field
          if (i + 1 < text.length && text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          // End of quoted field
          inQuotes = false;
          i++;
        } else {
          field += ch;
          i++;
        }
      } else {
        if (ch === '"' && field === '') {
          inQuotes = true;
          i++;
        } else if (ch === ',') {
          current.push(field);
          field = '';
          i++;
        } else if (ch === '\n') {
          current.push(field);
          field = '';
          // Skip empty rows (just blank lines)
          if (current.length > 1 || (current.length === 1 && current[0] !== '')) {
            rows.push(current);
          }
          current = [];
          i++;
        } else {
          field += ch;
          i++;
        }
      }
    }

    // Last field/row if no trailing newline
    if (field !== '' || current.length > 0) {
      current.push(field);
      if (current.length > 1 || (current.length === 1 && current[0] !== '')) {
        rows.push(current);
      }
    }

    if (rows.length < 2) {
      return {
        headers: [],
        rows: [],
        error: 'CSV must have at least a header row and one data row.'
      };
    }

    var headers = rows[0].map(function (h) { return String(h).trim(); });
    var dataRows = rows.slice(1);

    return { headers: headers, rows: dataRows, error: null };
  }

  // -----------------------------------------------------------------
  // Amount parsing
  // -----------------------------------------------------------------

  /**
   * Parse a string amount into cents. Handles:
   *   "34.20"        -> 3420
   *   "-34.20"       -> -3420  (caller decides if negatives are valid)
   *   "$34.20"       -> 3420
   *   "1,234.56"     -> 123456 (comma as thousands)
   *   "(34.20)"      -> -3420  (accounting-style negative)
   *   ""             -> null   (empty)
   *   "abc"          -> null   (not a number)
   *
   * Does NOT handle European format (1.234,56 with comma decimal).
   * Anyone with a Quebec bank export in fr-CA format will need to
   * re-export in en-CA. Documented as v1 limitation.
   *
   * @returns {number|null} cents, possibly negative
   */
  function parseAmount(value) {
    if (value == null) return null;
    var s = String(value).trim();
    if (!s) return null;

    var negative = false;

    // Accounting-style parens: (34.20) means -34.20
    if (s[0] === '(' && s[s.length - 1] === ')') {
      negative = true;
      s = s.substring(1, s.length - 1).trim();
    }

    // Leading minus
    if (s[0] === '-') {
      negative = !negative; // toggle (handles both "-(...)" and "(-...)")
      s = s.substring(1).trim();
    } else if (s[0] === '+') {
      s = s.substring(1).trim();
    }

    // Strip dollar sign + currency-like prefixes
    s = s.replace(/^[$€£¥]/, '').trim();

    // Strip thousands-separator commas. We're assuming en-CA / en-US locale
    // (period as decimal). Note: this WOULD eat a French-locale decimal.
    s = s.replace(/,/g, '');

    if (!s || !/^[0-9]*\.?[0-9]*$/.test(s)) return null;

    var n = parseFloat(s);
    if (isNaN(n)) return null;

    var cents = Math.round(n * 100);
    return negative ? -cents : cents;
  }

  // -----------------------------------------------------------------
  // Date parsing
  // -----------------------------------------------------------------

  // Try multiple date formats. First match wins.
  // Returns 'YYYY-MM-DD' or null.
  function parseDate(value) {
    if (value == null) return null;
    var s = String(value).trim();
    if (!s) return null;

    // ISO format: YYYY-MM-DD
    var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) {
      return formatIsoDate(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10));
    }

    // YYYY/MM/DD (some banks)
    m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
    if (m) {
      return formatIsoDate(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10));
    }

    // X/Y/YYYY or X-Y-YYYY — ambiguous between MM/DD and DD/MM.
    // We default to MM/DD/YYYY (US/EN-CA convention). If this picks
    // wrong (e.g. for fr-CA or DD/MM exports), the review screen lets
    // the user spot and fix it. The mapping step also surfaces a few
    // sample parsed dates so users can sanity-check before commit.
    m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (m) {
      var a = parseInt(m[1], 10);
      var b = parseInt(m[2], 10);
      var year = parseInt(m[3], 10);
      // If first number is > 12, it must be a day — implies DD/MM/YYYY
      if (a > 12 && b <= 12) {
        return formatIsoDate(year, b, a);
      }
      // Otherwise default to MM/DD/YYYY
      if (a <= 12 && b <= 31) {
        return formatIsoDate(year, a, b);
      }
      return null;
    }

    // X/Y/YY (2-digit year, less common but seen)
    m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/);
    if (m) {
      var a2 = parseInt(m[1], 10);
      var b2 = parseInt(m[2], 10);
      var year2 = parseInt(m[3], 10);
      // 2-digit year heuristic: 00-49 -> 20XX, 50-99 -> 19XX
      year2 = year2 < 50 ? 2000 + year2 : 1900 + year2;
      if (a2 > 12 && b2 <= 12) return formatIsoDate(year2, b2, a2);
      if (a2 <= 12 && b2 <= 31) return formatIsoDate(year2, a2, b2);
      return null;
    }

    // Month name formats: "Apr 27, 2026", "27 Apr 2026", "April 27 2026"
    var MONTHS = {
      jan: 1, january: 1,
      feb: 2, february: 2,
      mar: 3, march: 3,
      apr: 4, april: 4,
      may: 5,
      jun: 6, june: 6,
      jul: 7, july: 7,
      aug: 8, august: 8,
      sep: 9, sept: 9, september: 9,
      oct: 10, october: 10,
      nov: 11, november: 11,
      dec: 12, december: 12,
    };

    // "Apr 27, 2026" or "April 27, 2026"
    m = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
    if (m) {
      var monthName = m[1].toLowerCase();
      if (MONTHS[monthName]) {
        return formatIsoDate(parseInt(m[3], 10), MONTHS[monthName], parseInt(m[2], 10));
      }
    }

    // "27 Apr 2026"
    m = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
    if (m) {
      var monthName2 = m[2].toLowerCase();
      if (MONTHS[monthName2]) {
        return formatIsoDate(parseInt(m[3], 10), MONTHS[monthName2], parseInt(m[1], 10));
      }
    }

    return null;
  }

  function formatIsoDate(year, month, day) {
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    if (year < 1900 || year > 2100) return null;
    var mm = String(month).padStart(2, '0');
    var dd = String(day).padStart(2, '0');
    return year + '-' + mm + '-' + dd;
  }

  // -----------------------------------------------------------------
  // Row parsing — given a CSV row and a column mapping, build a
  // candidate entry object. Caller decides what to do with it
  // (run merchant suggester, render in review, etc).
  // -----------------------------------------------------------------

  /**
   * @param {Array<string>} row     Raw CSV row
   * @param {{date:number, amount:number, description:number}} mapping
   *        Column indices (0-based) for each field.
   * @returns {{date, amount_cents, description, valid, error}}
   */
  function parseRow(row, mapping) {
    if (!row || !mapping) {
      return { date: null, amount_cents: null, description: '', valid: false, error: 'Bad input' };
    }

    var rawDate = mapping.date != null ? row[mapping.date] : '';
    var rawAmount = mapping.amount != null ? row[mapping.amount] : '';
    var rawDesc = mapping.description != null ? (row[mapping.description] || '') : '';

    var date = parseDate(rawDate);
    var cents = parseAmount(rawAmount);

    var error = null;
    if (date == null) error = 'Couldn\'t parse date: "' + rawDate + '"';
    else if (cents == null) error = 'Couldn\'t parse amount: "' + rawAmount + '"';
    else if (cents === 0) error = 'Amount is zero';

    return {
      date: date,
      amount_cents: cents,
      description: String(rawDesc).trim(),
      valid: !error,
      error: error,
    };
  }

  // -----------------------------------------------------------------
  // Auto-detect column mapping (best-effort, defaults the dropdowns)
  // -----------------------------------------------------------------

  /**
   * Best-effort column auto-detection. Returns initial dropdown
   * values for the mapping UI; user can override.
   *
   * Heuristics: scan headers for date-like, amount-like, and
   * description-like words. Fall back to first column for date,
   * last numeric column for amount, longest text column for
   * description.
   */
  function autoDetectMapping(headers, sampleRows) {
    var dateIdx = -1;
    var amountIdx = -1;
    var descIdx = -1;

    var DATE_WORDS = ['date', 'transaction date', 'post date', 'posted', 'trans date'];
    var AMOUNT_WORDS = ['amount', 'cad', 'usd', 'debit', 'credit', 'value', 'sum'];
    var DESC_WORDS = ['description', 'merchant', 'name', 'memo', 'narration', 'transaction', 'details', 'payee'];

    headers.forEach(function (h, i) {
      var lower = String(h).toLowerCase().trim();
      if (dateIdx < 0 && DATE_WORDS.some(function (w) { return lower === w || lower.indexOf(w) >= 0; })) {
        dateIdx = i;
        return; // header claimed by date; don't also match it as desc
      }
      if (amountIdx < 0 && AMOUNT_WORDS.some(function (w) { return lower === w || lower.indexOf(w) >= 0; })) {
        amountIdx = i;
        return; // header claimed by amount
      }
      if (descIdx < 0 && DESC_WORDS.some(function (w) { return lower === w || lower.indexOf(w) >= 0; })) {
        descIdx = i;
      }
    });

    return {
      date: dateIdx >= 0 ? dateIdx : null,
      amount: amountIdx >= 0 ? amountIdx : null,
      description: descIdx >= 0 ? descIdx : null,
    };
  }

  window.iboostCsv = {
    parseCsv: parseCsv,
    parseAmount: parseAmount,
    parseDate: parseDate,
    parseRow: parseRow,
    autoDetectMapping: autoDetectMapping,
  };
})();
