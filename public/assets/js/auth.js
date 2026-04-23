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
        detectSessionInUrl: true,
      },
    }
  );

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
    console.log('[iboost]', 'requireSession: href =', window.location.href);
    // Fast path: getSession() returns instantly if the session is already
    // persisted in localStorage (returning user, no OAuth in progress).
    let { session } = await getSession();
    console.log('[iboost]', 'requireSession: first getSession →', session ? 'SESSION' : 'null');

    // Slow path: no session yet, but an OAuth return might be in progress.
    // Wait for INITIAL_SESSION (captured by the module-level subscription
    // above) which fires once Supabase finishes parsing the hash.
    if (!session) {
      console.log('[iboost]', 'requireSession: no session yet, awaiting INITIAL_SESSION…');
      session = await initialSessionReady;
      console.log('[iboost]', 'requireSession: after wait →', session ? 'SESSION' : 'null');
    }

    if (!session) {
      console.log('[iboost]', 'requireSession: redirecting to', loginPath || '/login.html');
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
      .select('id, email, full_name, phone, country, created_at, updated_at')
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
  // (gated by the profiles_update_own RLS policy, so users can only
  // update their OWN row) AND mirrors a subset of fields into
  // auth.users.user_metadata via updateUser(), so pages that read from
  // session.user.user_metadata (like /account.html for the top-bar
  // display name) pick up the new values without a re-login.
  //
  // Accepts any subset of: firstName, lastName, phone, country.
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

    // Upsert public.profiles. If the row exists (normal case: trigger
    // fired on signup), this does an UPDATE and only touches the keys
    // we supplied. If the row is missing (observed failure mode: OAuth
    // signups where handle_new_user didn't fire), this INSERTs a new
    // row — which needs the NOT NULL 'email' column populated from the
    // session. The profiles_insert_own RLS policy (migration 0004)
    // allows this INSERT as long as id = auth.uid().
    //
    // Note: for the UPDATE path we previously only supplied the changed
    // keys to preserve untouched fields. With upsert we have to include
    // id + email unconditionally (so a fresh insert has the required
    // columns), and we rely on onConflict='id' + ignoreDuplicates=false
    // to turn that into an UPDATE when the row already exists. PostgREST
    // upsert semantics will only update the columns we send, so the
    // preserve-untouched-fields behavior is intact.
    const upsertRow = {
      id: session.user.id,
      email: session.user.email,
    };
    if (fullName !== null) upsertRow.full_name = fullName;
    if (fields.phone) upsertRow.phone = fields.phone;
    if (country !== null) upsertRow.country = country;

    const { error: profileError } = await client
      .from('profiles')
      .upsert(upsertRow, { onConflict: 'id' });
    if (profileError) {
      console.error('[iboost-auth] updateProfile profiles upsert error:', profileError);
      return { data: null, error: profileError };
    }

    // Mirror to user_metadata. This is best-effort — if it fails, the
    // profiles row is already updated and the app will still work;
    // we just log it. Metadata is what account.js uses for personalization.
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
    let { session } = await getSession();
    if (!session) {
      session = await initialSessionReady;
    }
    return { session };
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
    requireCompleteProfile,
    updateProfile,
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
