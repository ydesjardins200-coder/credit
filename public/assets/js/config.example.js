// iBoost frontend configuration template.
//
// Copy this file to `config.js` and fill in the real values.
// `config.js` is gitignored and must NOT be committed.
//
// Only PUBLIC values go here — the Supabase anon key is safe to expose
// because Row Level Security policies protect the data.
// Never put the service_role key or any server secret in this file.

window.IBOOST_CONFIG = {
  // Supabase project URL, e.g. https://xxxxxxxx.supabase.co
  SUPABASE_URL: 'REPLACE_ME',

  // Supabase anon/public key
  SUPABASE_ANON_KEY: 'REPLACE_ME',

  // Backend API base URL (Railway deployment, or http://localhost:3000 in dev)
  API_BASE_URL: 'REPLACE_ME',
};
