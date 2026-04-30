/**
 * iBoost — retry.js
 *
 * Lightweight retry wrapper for transient Supabase failures.
 *
 * WHY THIS EXISTS
 *   Pre-launch users will be on flaky mobile networks (transit, cafes,
 *   weak WiFi). A single dropped packet during getMonthSummary() leaves
 *   the user staring at an error screen and forced to manually refresh.
 *   This wrapper catches transient errors and retries with exponential
 *   backoff, turning recoverable failures into no-op recoveries.
 *
 * WHAT IT WRAPS (and what it does NOT)
 *   This module wraps READ and IDEMPOTENT operations only:
 *     - SELECT queries (always safe to retry)
 *     - UPDATE with same WHERE (re-applies same patch — idempotent)
 *     - DELETE (already-deleted = no-op)
 *     - UPSERT with unique constraint (the database handles dedup)
 *
 *   This module does NOT wrap raw INSERT operations because retry on
 *   a write whose response was lost (server committed but reply dropped)
 *   would cause double-inserts. Those operations stay one-shot.
 *
 *   Phase F-2 (future, only if real users report double-inserts) will
 *   add idempotency keys to inserts. Don't speculate — wait for
 *   evidence.
 *
 * RETRY POLICY
 *   - Up to 2 retries (3 total attempts)
 *   - Exponential backoff: 200ms, 400ms (with jitter)
 *   - Total worst-case extra wait: ~700ms
 *
 *   Why these numbers: most transient blips clear in <500ms. If 3
 *   attempts can't get a response, the network is genuinely down and
 *   more retries just frustrate the user. Trading ~700ms for typical
 *   transient-error recovery is the right balance.
 *
 * WHAT'S RETRIABLE
 *   - Network errors (no HTTP status, fetch threw)
 *   - 5xx responses
 *   - Postgres timeout (PGRST301)
 *
 * WHAT'S NOT RETRIABLE
 *   - 401/403 (auth issues — log out, don't retry)
 *   - Other 4xx (validation, constraint violation — won't fix on retry)
 *   - PostgrestError with non-network code
 *
 * USAGE
 *   const result = await window.iboostRetry.withRetry(async () => {
 *     const { data, error } = await supabase.from('table').select('*');
 *     return { data, error };
 *   });
 *
 *   The wrapped function returns { data, error } the same as Supabase
 *   does. Callers don't need to know retry happened.
 *
 * EXPOSES
 *   window.iboostRetry.withRetry(fn, opts)
 */
(function () {
  'use strict';

  /**
   * Decide if an error came from a transient condition that's worth
   * retrying. Returns true for network/server errors, false for client
   * errors (auth, validation) and unknown errors.
   *
   * Two error shapes to handle:
   *   - Thrown errors (e.g. fetch network failure) — instances of Error
   *   - Returned errors (e.g. PostgrestError in { data, error })
   */
  function isRetriable(err) {
    if (!err) return false;

    // Thrown network error: Failed to fetch, NetworkError, AbortError
    // (we treat AbortError as not-retriable — user navigated away)
    if (err.name === 'AbortError') return false;
    if (err.name === 'TypeError' && /fetch/i.test(err.message || '')) return true;
    if (/network|fetch/i.test(err.message || '')) return true;

    // PostgrestError shape: { message, details, hint, code }
    // Postgres timeout — server overloaded, retry usually helps
    if (err.code === 'PGRST301') return true;

    // Postgres connection lost — same family as PGRST301
    if (err.code === 'PGRST302') return true;

    // HTTP status if surfaced (Supabase usually doesn't surface raw status,
    // but some wrappers do)
    if (err.status) {
      if (err.status >= 500 && err.status < 600) return true;
      if (err.status === 408) return true; // Request Timeout
      if (err.status === 429) return true; // Rate limited — retry with backoff
      // 4xx other than 408/429 = not retriable
      return false;
    }

    // Unknown error shape — don't retry. Surfacing the original error
    // to the caller is safer than silently retrying something we don't
    // understand.
    return false;
  }

  /**
   * Sleep with jitter to avoid thundering-herd if multiple clients
   * retry simultaneously after a transient outage.
   */
  function sleep(ms) {
    var jitter = Math.random() * 100; // 0-100ms jitter
    return new Promise(function (resolve) {
      setTimeout(resolve, ms + jitter);
    });
  }

  /**
   * The main retry wrapper. fn must be an async function that returns
   * { data, error } (the Supabase shape) OR throws on network failure.
   *
   * @param {() => Promise<{data, error}>} fn
   * @param {{retries?: number, baseDelay?: number}} opts
   */
  async function withRetry(fn, opts) {
    opts = opts || {};
    var retries = typeof opts.retries === 'number' ? opts.retries : 2;
    var baseDelay = typeof opts.baseDelay === 'number' ? opts.baseDelay : 200;

    var lastErr = null;

    for (var attempt = 0; attempt <= retries; attempt++) {
      try {
        var result = await fn();

        // Supabase result with error field
        if (result && result.error) {
          if (!isRetriable(result.error)) {
            // Permanent error — return immediately, no retry
            return result;
          }
          lastErr = result.error;
        } else {
          // Success
          if (attempt > 0) {
            // Quietly note the recovery for ops awareness. Not user-visible.
            console.info('[iboostRetry] recovered after ' + (attempt + 1) + ' attempts');
          }
          return result;
        }
      } catch (e) {
        // Thrown error — usually network failure
        if (!isRetriable(e)) {
          // Re-throw permanent errors so callers can handle them
          throw e;
        }
        lastErr = e;
      }

      // If this wasn't the last attempt, wait before retry
      if (attempt < retries) {
        var delay = baseDelay * Math.pow(2, attempt); // 200, 400, 800
        await sleep(delay);
      }
    }

    // Exhausted all attempts — return the last error in Supabase shape
    console.warn('[iboostRetry] exhausted ' + (retries + 1) + ' attempts:', lastErr);
    return { data: null, error: lastErr };
  }

  window.iboostRetry = {
    withRetry: withRetry,
    // Exposed for testing — callers shouldn't typically use directly
    _isRetriable: isRetriable,
  };
})();
