# Auth setup

End-to-end checklist for wiring up email/password, Google, and Facebook sign-in on iBoost.

## 1. Netlify environment variables

The frontend reads its Supabase config from `public/assets/js/config.js`, which is **generated at deploy time** by the build command in `netlify.toml`. You need to set three env vars in Netlify so the build command has real values to write.

In the Netlify dashboard:

1. **Site settings → Environment variables → Add a variable**
2. Add these three (values come from the Supabase dashboard and your Railway deployment):

| Variable | Value |
|---|---|
| `SUPABASE_URL` | `https://wwsnywzeorisuvolvbjh.supabase.co` |
| `SUPABASE_ANON_KEY` | `sb_publishable_...` (your publishable key) |
| `API_BASE_URL` | Your Railway URL once the backend is deployed, e.g. `https://iboost-api.up.railway.app`. For now, any placeholder string works — the frontend doesn't call the backend yet. |

3. **Deploys → Trigger deploy → Deploy site** to rebuild with the new env vars.

After deploy, verify by opening `https://iboostcredit.netlify.app/assets/js/config.js` in a browser — you should see the actual values, not `REPLACE_ME`.

## 2. Supabase URL configuration

Supabase needs to know which URLs are allowed to receive auth redirects (email confirmation links, OAuth callbacks, password reset).

In the Supabase dashboard:

1. **Authentication → URL Configuration**
2. **Site URL:** `https://iboostcredit.netlify.app`
3. **Redirect URLs:** add each of these (one per line):
   - `https://iboostcredit.netlify.app/**`
   - `http://localhost:3000/**` (for local dev later)
   - `http://localhost:5173/**` (for local dev later)

Save.

## 3. Email/password — test it

With steps 1 and 2 done, email/password already works. Go to `https://iboostcredit.netlify.app/signup.html`, create an account, and check:

- You should get a confirmation email from Supabase
- Clicking the link should log you in and land on `/account.html`
- In the Supabase dashboard, **Authentication → Users** should show the new user
- **Table Editor → profiles** should show a new row created by the signup trigger

If the confirmation email doesn't arrive, check **Authentication → Email Templates** in Supabase, or temporarily disable email confirmation under **Authentication → Providers → Email** while developing (remember to re-enable for production).

## 4. Google OAuth

### 4a. Create the Google OAuth client

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (or pick an existing one) for iBoost
3. **APIs & Services → OAuth consent screen**
   - User Type: External
   - App name: `iBoost`
   - User support email: your email
   - Developer contact: your email
   - Save and continue through the scopes screen (no extra scopes needed; `email` and `profile` are default)
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application**
   - Name: `iBoost Web`
   - **Authorized redirect URIs:** add the Supabase callback URL — you'll find the exact value in Supabase under Authentication → Providers → Google. It looks like:
     ```
     https://wwsnywzeorisuvolvbjh.supabase.co/auth/v1/callback
     ```
5. Save. Google gives you a **Client ID** and **Client secret**.

### 4b. Paste into Supabase

1. Supabase dashboard → **Authentication → Providers → Google**
2. Toggle **Enable**
3. Paste the Client ID and Client Secret
4. Save

### 4c. Enable the button in iBoost

Once Google is enabled, edit `public/signup.html` and `public/login.html` — remove the `disabled` and `aria-disabled="true"` attributes from the `data-oauth="google"` button, and add the handler in the corresponding page script:

```js
document.querySelector('[data-oauth="google"]').addEventListener('click', async () => {
  await window.iboostAuth.signInWithOAuth('google');
});
```

(Or ask Claude to do it — it's a 2-minute change once the provider is live.)

## 5. Facebook Login

### 5a. Create the Facebook app

1. Go to [developers.facebook.com](https://developers.facebook.com) → My Apps → Create App
2. Use case: **Authenticate and request data from users with Facebook Login**
3. App type: **Consumer**
4. Fill in the app name and contact email

### 5b. Add Facebook Login to the app

1. In the app dashboard, find the **Facebook Login** product and click **Set up**
2. Platform: **Web**
3. **Facebook Login → Settings**
4. **Valid OAuth Redirect URIs:** add the Supabase callback:
   ```
   https://wwsnywzeorisuvolvbjh.supabase.co/auth/v1/callback
   ```
5. Save

### 5c. Paste into Supabase

1. In the Facebook app dashboard, **Settings → Basic** — copy **App ID** and **App Secret**
2. Supabase → **Authentication → Providers → Facebook**
3. Toggle **Enable**, paste App ID and App Secret, save

### 5d. App Review (IMPORTANT)

While the Facebook app is in **Development mode**, only users listed as **App roles → Roles → Administrators / Developers / Testers** can log in. To allow public signups, you must submit the app for **App Review** requesting the `email` permission.

For iBoost's development phase, add yourself as a Tester and it works immediately. Before public launch, plan ~1 week for Facebook's review process.

### 5e. Enable the button in iBoost

Same pattern as Google — remove the `disabled` attributes from `data-oauth="facebook"` buttons and wire the click handler to `signInWithOAuth('facebook')`.

## 6. Account linking behavior

Supabase links accounts by email by default. If a user signs up with Google using `jane@gmail.com` and later tries email/password on the same email, they land in the same account. This is usually desirable for a consumer app — but be aware it means someone with access to that email address can reset the password on the account regardless of which provider was used to create it.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `config.js` returns 404 | Netlify build command didn't run or failed | Check the deploy log; confirm env vars are set; trigger redeploy |
| `config.js` contains empty strings | Env vars aren't set in Netlify | Set them, then trigger a new deploy (env var changes don't auto-rebuild) |
| "Invalid login credentials" on a fresh signup | User hasn't confirmed email | Click the confirmation link, or disable email confirmation in Supabase while developing |
| OAuth redirect lands on `/` instead of `/account.html` | Redirect URL not allowed-listed in Supabase | Add the URL under Authentication → URL Configuration |
| Facebook login works for you but no one else | App in Development mode | Submit for App Review requesting `email` permission |
