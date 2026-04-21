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

  async function signUpWithPassword({ email, password, fullName }) {
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName || null },
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
  async function requireSession(loginPath) {
    const { session } = await getSession();
    if (!session) {
      window.location.replace(loginPath || '/login.html');
      return null;
    }
    return session;
  }

  window.iboostAuth = {
    client,
    signUpWithPassword,
    signInWithPassword,
    signInWithOAuth,
    signOut,
    getSession,
    getUser,
    onAuthChange,
    requireSession,
  };
})();
