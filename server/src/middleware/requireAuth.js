// Express middleware that verifies a Supabase JWT from the Authorization header.
//
// Usage:
//   const requireAuth = require('../middleware/requireAuth');
//   router.get('/protected', requireAuth, (req, res) => {
//     res.json({ user: req.user });
//   });

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token) {
      return res.status(401).json({ error: 'Missing bearer token' });
    }

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return res.status(500).json({ error: 'Server auth not configured' });
    }

    // A fresh client bound to the incoming user's JWT
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    req.user = data.user;
    req.supabase = supabase; // user-scoped client; RLS applies
    return next();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[requireAuth] error', err);
    return res.status(500).json({ error: 'Auth check failed' });
  }
}

module.exports = requireAuth;
