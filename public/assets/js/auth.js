// iBoost — auth module.
//
// Wraps the Supabase JS client with the specific auth flows this app uses.
// Exposed globally as window.iboostAuth so non-module scripts can call it.
//
// Requires:
//   - window.IBOOST_CONFIG with SUPABASE_URL and SUPABASE_ANON_KEY
//     (loaded from /assets/js/config.js, generated at build time)
//   - @supabase/supabase-js v2, loaded via CDN on each page before this script

(function () {
  'use strict';

  const cfg = window.IBOOST_CONFIG;
  if (!cfg || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
    console.error(
      '[iboost-auth] Missing window.IBOOST_CONFIG. Did config.js load before auth.js?'
    );
    return;
  }

  if (!window.supabase || !window.supabase.createClient) {
    console.error(
      '[iboost-auth] supabase-js not found. Include the CDN script before auth.js.'
    );
    return;
  }

  const client = window.supabase.createClient(
    cfg.SUPABASE_URL,
    cfg.SUPABASE_ANON_KEY,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // NOTE: we explicitly disable detectSessionInUrl because we're
        // parsing the hash manually below. Observed: with it enabled,
        // the client silently fails to extract the session from
        // #access_token=... even though the hash IS present and the JWT
        // is valid. Rather than fight that, we take over the hash parse
        // ourselves — simpler, fully deterministic, and works regardless
        // of which flowType/version the client defaults to.
        detectSessionInUrl: false,
      },
    }
  );

  // Manual OAuth hash ingestion.
  // If the URL has #access_token=<jwt>&refresh_token=<rt>, extract them
  // and call setSession() — this is what detectSessionInUrl is supposed
  // to do but doesn't work in our environment. Blocking at module load
  // via an immediately-invoked async function whose promise is exposed
  // as `sessionBootReady`; requireSession etc. await this promise before
  // doing anything else.
  var sessionBootReady = (async function bootSessionFromHash() {
    try {
      var hash = window.location.hash || '';
      if (hash.length < 2) return; // nothing to do

      // Parse the fragment. Format: #k1=v1&k2=v2&... (standard URL-encoded).
      var params = new URLSearchParams(hash.substring(1));
      var access_token = params.get('access_token');
      var refresh_token = params.get('refresh_token');

      if (!access_token || !refresh_token) return; // not an OAuth return

      // Tell Supabase: here's the session. This writes it to storage,
      // emits SIGNED_IN, and makes getSession() return it immediately.
      var { error } = await client.auth.setSession({
        access_token: access_token,
        refresh_token: refresh_token,
      });
      if (error) {
        console.error('[iboost-auth] setSession rejected the OAuth tokens:', error);
        return;
      }

      // Clean the hash from the URL (security — same thing
      // detectSessionInUrl would have done).
      if (window.history && window.history.replaceState) {
        var clean = window.location.pathname + window.location.search;
        window.history.replaceState({}, '', clean);
      }
    } catch (e) {
      console.error('[iboost-auth] bootSessionFromHash threw:', e);
    }
  })();

  // ----- Public API -----

  async function signUpWithPassword({ email, password, fullName, phone, country }) {
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        // These land in auth.users.raw_user_meta_data. The handle_new_user
        // trigger (migration 0002) reads them into public.profiles.
        // NOTE: phone is NOT YET in the profiles table — it lands in
        // raw_user_meta_data and can be read from there. A future
        // migration should add `phone text` to public.profiles and
        // update the trigger to copy it across.
        data: {
          full_name: fullName || null,
          phone: phone || null,
          country: country || null,
        },
        emailRedirectTo: window.location.origin + '/account.html',
      },
    });
    return { data, error };
  }

  async function signInWithPassword({ email, password }) {
    const { data, error } = await client.auth.signInWithPassword({
      email,
      password,
    });
    return { data, error };
  }

  async function signInWithOAuth(provider) {
    // provider: 'google' | 'facebook' | 'github' | ...
    const { data, error } = await client.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: window.location.origin + '/account.html',
      },
    });
    return { data, error };
  }

  async function signOut() {
    const { error } = await client.auth.signOut();
    return { error };
  }

  async function getSession() {
    const { data, error } = await client.auth.getSession();
    return { session: data?.session || null, error };
  }

  async function getUser() {
    const { data, error } = await client.auth.getUser();
    return { user: data?.user || null, error };
  }

  function onAuthChange(callback) {
    return client.auth.onAuthStateChange((event, session) => {
      callback(event, session);
    });
  }

  // Redirect to login if not signed in. Returns the session when present.
  //
  // Handles the OAuth-return race: when a user lands on a gated page with
  // a URL fragment like #access_token=... (after Google/Facebook/etc.
  // redirects them back), Supabase parses the hash and writes the session
  // to storage asynchronously. getSession() can return null for a few
  // hundred ms while this happens. If we redirect to /login.html during
  // that window, the user sees a bewildering "logged out" state even
  // though they just successfully authenticated.
  //
  // Strategy: if the first getSession() returns null AND the URL has an
  // OAuth fragment or PKCE code, wait for the SIGNED_IN event (with a
  // short timeout) before deciding there's no session. If no fragment
  // is present, skip the wait — normal page loads aren't racing anything.

  // ----- OAuth race handling -----
  // When Supabase returns from OAuth, the browser lands on a URL with
  // #access_token=... The Supabase client (configured with
  // detectSessionInUrl: true) parses the hash SYNCHRONOUSLY and calls
  // history.replaceState() to strip it for security. Then it asynchronously
  // persists the session to localStorage.
  //
  // Consequence: by the time page code runs requireSession() on
  // DOMContentLoaded, window.location.hash is already EMPTY even though
  // an OAuth return is in progress. We can't use the URL as a signal.
  //
  // Instead, we subscribe to onAuthStateChange at module load (before any
  // page code runs) and cache the first session we see. requireSession
  // races getSession() against this cache — if either finds a session
  // within a short window, we're authenticated.
  //
  // The 'initialSessionReady' promise resolves when Supabase has emitted
  // its first auth event. Resolves with the session (may be null if
  // truly logged out). Always resolves, never rejects.
  var initialSessionReady = new Promise(function (resolve) {
    var resolved = false;
    function settle(session) {
      if (resolved) return;
      resolved = true;
      resolve(session);
    }
    try {
      client.auth.onAuthStateChange(function (event, session) {
        // Supabase emits INITIAL_SESSION once on client init. If the
        // OAuth hash was present, session will be truthy here. If the
        // user was logged out with no OAuth return, session will be
        // null — also the right answer, we just don't have a session
        // to hand back.
        if (event === 'INITIAL_SESSION' || session) {
          settle(session);
        }
      });
    } catch (e) { /* subscribe failed — fall through to the timeout */ }

    // Safety timeout: if INITIAL_SESSION never fires (edge case), resolve
    // with whatever getSession() currently returns. 3s is long enough
    // for any reasonable network + storage read.
    setTimeout(async function () {
      if (resolved) return;
      var { data } = await client.auth.getSession();
      settle((data && data.session) || null);
    }, 3000);
  });

  async function requireSession(loginPath) {
    // Wait for the manual OAuth hash parse to complete (no-op on pages
    // without a hash). This ensures setSession() has been called if
    // we're coming back from OAuth.
    await sessionBootReady;

    let { session } = await getSession();

    // Fallback for edge cases: if still null after the bootSession
    // step, wait briefly for INITIAL_SESSION in case the session is
    // landing from elsewhere (storage hydration, multi-tab sync).
    if (!session) {
      session = await initialSessionReady;
    }

    if (!session) {
      window.location.replace(loginPath || '/login.html');
      return null;
    }
    return session;
  }


  // ----- Profile helpers (public.profiles row for the current user) -----
  //
  // Phase 1.5 (OAuth gate): signups that went through /signup.html fill
  // phone + country + consent in the form. OAuth signups don't — Google
  // only gives us email and (sometimes) full_name. So we need to check
  // if a user's profile is complete before letting them into the app.
  // If it isn't, /complete-profile.html captures the missing fields.

  // Fetch the current user's profile row. Returns null on: no session,
  // no profile row (shouldn't happen — trigger creates it), or any
  // Supabase error. Caller is expected to treat null as "something went
  // wrong, don't render the page".
  async function getProfile() {
    const { session } = await getSession();
    if (!session || !session.user) return null;

    const { data, error } = await client
      .from('profiles')
      .select('id, email, full_name, phone, country, date_of_birth, address_line1, address_line2, address_city, address_region, address_postal, credit_goal_kind, credit_goal_detail, plan, plan_activated_at, plan_currency, stripe_customer_id, stripe_subscription_id, card_last_four, card_brand, next_billing_date, created_at, updated_at')
      .eq('id', session.user.id)
      .single();

    if (error) {
      console.error('[iboost-auth] getProfile error:', error);
      return null;
    }
    return data;
  }

  // Pure check: does this profile row have everything the app requires?
  // Today that's phone + country. If we add more required fields later
  // (e.g., SSN/SIN during bureau onboarding), they'd go here.
  //
  // Intentionally returns false for a null/undefined profile — callers
  // should treat "no profile" the same as "incomplete profile" and route
  // to /complete-profile.html, which is safe to re-render even if the
  // row already exists (the form is idempotent).
  function isProfileComplete(profile) {
    if (!profile) return false;
    if (!profile.phone) return false;
    if (!profile.country) return false;
    return true;
  }

  // Stricter check used by the Welcome tab's KYC form card: returns
  // true only when the user has filled ALL 7 required bureau-prep
  // fields (DOB + 4 address fields + credit goal). Phone and country
  // are already required by isProfileComplete — so by the time any
  // page runs this check, those are guaranteed present.
  //
  // credit_goal_detail is intentionally NOT required — it's optional
  // unless the user picked 'other' as their kind, and even then we
  // enforce that client-side, not here. The DB allows null.
  function isProfileKycComplete(profile) {
    if (!profile) return false;
    if (!profile.date_of_birth) return false;
    if (!profile.address_line1) return false;
    if (!profile.address_city) return false;
    if (!profile.address_region) return false;
    if (!profile.address_postal) return false;
    if (!profile.credit_goal_kind) return false;
    return true;
  }

  // Combined gate: require session AND complete profile. Used on
  // /account.html (and any other page that needs both). Options:
  //   loginPath: where unauthenticated users go (default /login.html)
  //   completePath: where authenticated-but-incomplete users go
  //                 (default /complete-profile.html)
  // Returns the session on success, null if a redirect was issued.
  //
  // Two redirects possible:
  //   1. No session -> loginPath
  //   2. Session but incomplete profile -> completePath
  // Both use location.replace so the back button doesn't loop.
  async function requireCompleteProfile(options) {
    options = options || {};
    const loginPath = options.loginPath || '/login.html';
    const completePath = options.completePath || '/complete-profile.html';

    const session = await requireSession(loginPath);
    if (!session) return null; // redirect already issued by requireSession

    const profile = await getProfile();
    if (!isProfileComplete(profile)) {
      window.location.replace(completePath);
      return null;
    }
    return session;
  }

  // Update the current user's profile row. Writes to public.profiles
  // (gated by RLS — users can only update their own row) and mirrors
  // a subset of name/phone/country into auth.users.user_metadata so
  // the top bar picks them up without a re-login.
  //
  // Accepts any subset of:
  //   firstName, lastName, phone, country
  //   dateOfBirth           YYYY-MM-DD string or null
  //   addressLine1, addressLine2, addressCity, addressRegion, addressPostal
  //   creditGoalKind        'buy_home'|'buy_car'|'rebuild'|'lower_rates'
  //                         |'business_loan'|'learning'|'other' or null
  //   creditGoalDetail      string or null
  //
  // Returns { data, error } shaped like Supabase responses.
  async function updateProfile(fields) {
    fields = fields || {};
    const { session } = await getSession();
    if (!session || !session.user) {
      return { data: null, error: { message: 'Not signed in' } };
    }

    // Build full_name from first + last if either was provided. If
    // neither, leave full_name untouched (not the caller's concern).
    var fullName = null;
    if (fields.firstName != null || fields.lastName != null) {
      fullName = ((fields.firstName || '') + ' ' + (fields.lastName || '')).trim();
      if (!fullName) fullName = null;
    }

    // Country: uppercase + whitelist, matching the trigger's logic so
    // manual updates produce the same shape as trigger-populated ones.
    var country = null;
    if (fields.country) {
      const upper = String(fields.country).toUpperCase();
      country = (upper === 'CA' || upper === 'US') ? upper : null;
    }

    // Region: 2-letter uppercase. DB has a CHECK that mirrors this.
    var region = null;
    if (fields.addressRegion) {
      const upR = String(fields.addressRegion).toUpperCase().trim();
      if (/^[A-Z]{2}$/.test(upR)) region = upR;
    }

    // Credit goal kind: whitelist (matches DB CHECK constraint)
    var goalKind = null;
    const GOAL_KINDS = [
      'buy_home', 'buy_car', 'rebuild', 'lower_rates',
      'business_loan', 'learning', 'other'
    ];
    if (fields.creditGoalKind && GOAL_KINDS.indexOf(fields.creditGoalKind) !== -1) {
      goalKind = fields.creditGoalKind;
    }

    // Plan: whitelist (matches DB CHECK: free|essential|complete).
    // Separate var so it can be null-blocked cleanly later; pattern
    // matches goalKind/country.
    var plan = null;
    const PLAN_KINDS = ['free', 'essential', 'complete'];
    if (fields.plan && PLAN_KINDS.indexOf(fields.plan) !== -1) {
      plan = fields.plan;
    }

    // Plan currency: whitelist (matches DB CHECK: cad|usd).
    var planCurrency = null;
    if (fields.planCurrency) {
      const pc = String(fields.planCurrency).toLowerCase();
      if (pc === 'cad' || pc === 'usd') planCurrency = pc;
    }

    // Upsert public.profiles. Preserves untouched columns because
    // PostgREST upsert only writes the fields we include in the row
    // object — plus id + email which are always set so a fresh INSERT
    // (missing-row fallback) satisfies the NOT NULL email constraint.
    const upsertRow = {
      id: session.user.id,
      email: session.user.email,
    };
    if (fullName !== null) upsertRow.full_name = fullName;
    if (fields.phone) upsertRow.phone = fields.phone;
    if (country !== null) upsertRow.country = country;

    // KYC fields — all nullable. Include only if the caller supplied them
    // so we don't wipe existing values with undefined coming from a
    // partial update.
    if (fields.dateOfBirth !== undefined) upsertRow.date_of_birth = fields.dateOfBirth || null;
    if (fields.addressLine1 !== undefined) upsertRow.address_line1 = fields.addressLine1 || null;
    if (fields.addressLine2 !== undefined) upsertRow.address_line2 = fields.addressLine2 || null;
    if (fields.addressCity !== undefined) upsertRow.address_city = fields.addressCity || null;
    if (fields.addressRegion !== undefined) upsertRow.address_region = region;
    if (fields.addressPostal !== undefined) upsertRow.address_postal = fields.addressPostal || null;
    if (fields.creditGoalKind !== undefined) upsertRow.credit_goal_kind = goalKind;
    if (fields.creditGoalDetail !== undefined) upsertRow.credit_goal_detail = fields.creditGoalDetail || null;

    // Plan fields. `plan` presence triggers setting activation timestamp
    // on the server side (now()) — cleaner than letting the caller
    // decide what "now" means. Plan currency is independent — could be
    // set without a plan change (e.g. user toggled USD/CAD on the
    // checkout page without switching tiers).
    if (fields.plan !== undefined) {
      upsertRow.plan = plan;
      upsertRow.plan_activated_at = plan ? new Date().toISOString() : null;
    }
    if (fields.planCurrency !== undefined) {
      upsertRow.plan_currency = planCurrency;
    }

    const { error: profileError } = await client
      .from('profiles')
      .upsert(upsertRow, { onConflict: 'id' });
    if (profileError) {
      console.error('[iboost-auth] updateProfile profiles upsert error:', profileError);

      // Zombie-session detection: profiles.id has an FK to auth.users.id.
      // If the FK violates, it means the session's user_id doesn't exist
      // in auth.users — either the user was deleted server-side or the
      // session token is stale from a wiped DB. Either way, the only
      // recovery is to log out + send them to login.
      //
      // Postgres returns error code 23503 for foreign_key_violation;
      // Supabase surfaces this in both `code` and `message`. Check both
      // so we're resilient to error-shape changes.
      var isFkViolation =
        (profileError.code === '23503') ||
        (typeof profileError.message === 'string' &&
         profileError.message.indexOf('profiles_id_fkey') !== -1);

      if (isFkViolation) {
        return {
          data: null,
          error: {
            code: 'session_zombie',
            message: 'Your session is no longer valid. Please log in again.',
            original: profileError,
          },
        };
      }
      return { data: null, error: profileError };
    }

    // Mirror to user_metadata. This is best-effort — if it fails, the
    // profiles row is already updated and the app will still work;
    // we just log it. Metadata is what account.js uses for personalization.
    // KYC fields (DOB, address, goal) are NOT mirrored — metadata is for
    // display-layer personalization, not PII storage.
    const metadataUpdates = {};
    if (fullName !== null) metadataUpdates.full_name = fullName;
    if (fields.firstName) metadataUpdates.first_name = fields.firstName;
    if (fields.lastName) metadataUpdates.last_name = fields.lastName;
    if (fields.phone) metadataUpdates.phone = fields.phone;
    if (country !== null) metadataUpdates.country = country;

    if (Object.keys(metadataUpdates).length > 0) {
      const { error: metaError } = await client.auth.updateUser({
        data: metadataUpdates
      });
      if (metaError) {
        console.error('[iboost-auth] updateProfile metadata error (non-fatal):', metaError);
      }
    }

    return { data: { updated: true }, error: null };
  }

  // Public helper for pages that want to check "is the user signed in?"
  // without redirecting. Same OAuth-race handling as requireSession:
  // if getSession() returns null, waits for the module-level
  // INITIAL_SESSION event before giving up.
  async function getSessionSettled() {
    await sessionBootReady;
    let { session } = await getSession();
    if (!session) {
      session = await initialSessionReady;
    }
    return { session };
  }

  // Insert a row into public.plan_changes. Append-only history table.
  // Called after a successful profile update with a plan change so
  // we keep a record of "user moved from X to Y on this date."
  //
  // Returns { error } like other auth helpers.
  async function recordPlanChange(fromPlan, toPlan, source) {
    const { session } = await getSession();
    if (!session || !session.user) {
      return { error: { message: 'Not signed in' } };
    }
    // Don't insert a no-op row. If the user "changed" to the same plan
    // they already have, skip — keeps history meaningful.
    if (fromPlan === toPlan) {
      return { error: null, skipped: true };
    }
    const { error } = await client.from('plan_changes').insert({
      user_id: session.user.id,
      from_plan: fromPlan || null,
      to_plan: toPlan,
      source: source || 'self_change',
    });
    if (error) {
      console.error('[iboost-auth] recordPlanChange insert error:', error);
    }
    return { error };
  }

  // Read back the plan change history for the current user, newest first.
  // Limit 10 by default — matches the Profile tab "View plan history" UX.
  async function getPlanHistory(limit) {
    const { session } = await getSession();
    if (!session || !session.user) {
      return { data: [], error: { message: 'Not signed in' } };
    }
    const { data, error } = await client
      .from('plan_changes')
      .select('id, from_plan, to_plan, changed_at, source')
      .eq('user_id', session.user.id)
      .order('changed_at', { ascending: false })
      .limit(limit || 10);
    if (error) {
      console.error('[iboost-auth] getPlanHistory error:', error);
      return { data: [], error };
    }
    return { data: data || [], error: null };
  }

  window.iboostAuth = {
    client,
    signUpWithPassword,
    signInWithPassword,
    signInWithOAuth,
    signOut,
    getSession,
    getSessionSettled,
    getUser,
    onAuthChange,
    requireSession,
    getProfile,
    isProfileComplete,
    isProfileKycComplete,
    requireCompleteProfile,
    updateProfile,
    recordPlanChange,
    getPlanHistory,
  };

  // Global handler: any button with data-oauth="<provider>" that is NOT
  // disabled triggers the OAuth flow for that provider. This lets signup
  // and login pages share the exact same button markup with no per-page JS.
  document.addEventListener('click', async function (event) {
    const btn = event.target.closest('button[data-oauth]');
    if (!btn) return;
    if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') return;

    const provider = btn.getAttribute('data-oauth');
    if (!provider) return;

    event.preventDefault();
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Redirecting…';

    const { error } = await signInWithOAuth(provider);

    // On success, the browser leaves this page for the provider's consent
    // screen, so we won't reach this code. On error (network, config, etc.)
    // we re-enable the button and show a console error — the user can retry.
    if (error) {
      console.error('[iboost-auth] OAuth error:', error);
      btn.disabled = false;
      btn.textContent = originalText;
      // If an alert box exists on the page, surface the error there.
      const alertEl = document.getElementById('alert');
      if (alertEl) {
        alertEl.className = 'alert alert-error';
        alertEl.textContent = error.message || 'Sign-in failed. Please try again.';
        alertEl.hidden = false;
      }
    }
  });
})();
