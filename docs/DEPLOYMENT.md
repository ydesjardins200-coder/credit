# Deployment

This doc covers how to deploy each piece of iBoost.

## Frontend — Netlify

1. In Netlify, **Add new site → Import from Git** and point it at this repo.
2. Build settings (already defined in `netlify.toml`):
   - Publish directory: `public`
   - Build command: none
3. Environment variables: not needed on Netlify itself — the frontend reads config from `public/assets/js/config.js`, which you generate per-deploy.

Since `config.js` is gitignored, you have two options for production:

**Option A — commit a production config.** Create `public/assets/js/config.js` with production values and remove it from `.gitignore`. Safe because only public values live there (Supabase URL, anon key, API URL).

**Option B — generate at build time.** Add a small build step in `netlify.toml` that writes `config.js` from Netlify environment variables. Example:

```toml
[build]
  publish = "public"
  command = "echo \"window.IBOOST_CONFIG = { SUPABASE_URL: '$SUPABASE_URL', SUPABASE_ANON_KEY: '$SUPABASE_ANON_KEY', API_BASE_URL: '$API_BASE_URL' };\" > public/assets/js/config.js"
```

Then set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `API_BASE_URL` in Netlify's environment variables UI.

## Backend — Railway

1. In Railway, **New project → Deploy from GitHub repo** and pick this repo.
2. Set the **Root directory** to `server`.
3. Railway will auto-detect Node via Nixpacks and run `npm install` + `npm start` (configured in `railway.json`).
4. Add environment variables in the Railway dashboard — mirror `server/.env.example`:
   - `NODE_ENV=production`
   - `PORT` — Railway sets this automatically, don't override
   - `ALLOWED_ORIGINS` — your Netlify URL
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
5. Railway gives you a public URL like `iboost-api.up.railway.app`. Plug that into the frontend's `API_BASE_URL`.

## Database — Supabase

1. Create a new Supabase project.
2. Run the migrations in `supabase/migrations/` in order, via the SQL editor, until the Supabase CLI is wired in.
3. In **Project Settings → API**, copy:
   - Project URL → `SUPABASE_URL`
   - `anon` / `public` key → `SUPABASE_ANON_KEY` (public, fine for frontend)
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (server only, never expose)
4. In **Authentication → URL Configuration**, set the site URL to your Netlify domain and add any additional redirect URLs you need.

## Smoke tests after deploy

- `GET https://<railway-url>/api/health` → `{ "status": "ok", ... }`
- Load the Netlify site in a browser — no console errors, footer year renders.
- Sign up flow (once built) creates a row in `public.profiles`.
