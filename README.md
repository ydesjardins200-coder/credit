# iBoost

A subscription-based credit-improvement platform serving customers in Canada and the USA.

## Stack

- **Frontend:** Plain HTML/CSS/JS → deployed on Netlify
- **Backend:** Node.js + Express → deployed on Railway
- **Database & Auth:** Supabase (Postgres + Auth)

## Documentation

Architectural specs and product vision live in [`docs/`](./docs/README.md).

- [BRAIN architecture](./docs/brain-architecture.md) — the monthly intelligence pipeline (rules engine + LLM polish)
- [Budget app vision](./docs/budget-app-vision.md) — QuickBooks-style ledger model for the Budget tab
- [Credit bureau integration](./docs/credit-bureau-integration.md) — reading + reporting paths with each bureau
- [Tier feature matrix](./docs/tier-feature-matrix.md) — per-tab, per-feature gating decisions for Free / Essential / Complete

See [`docs/README.md`](./docs/README.md) for an index and reading order.

## Repository Structure

```
/
├── public/                 # Static frontend (Netlify root)
│   ├── index.html
│   ├── assets/
│   │   ├── css/
│   │   ├── js/
│   │   └── img/
│   └── ...
├── server/                 # Node/Express API (Railway)
│   ├── src/
│   │   ├── index.js        # Server entry point
│   │   ├── routes/         # Route handlers
│   │   ├── middleware/     # Express middleware
│   │   └── lib/            # Supabase client, helpers
│   ├── package.json
│   └── .env.example
├── supabase/               # Database schema and migrations
│   └── migrations/
├── docs/                   # Internal documentation
├── netlify.toml            # Netlify config
└── README.md
```

## Local Development

### Frontend

The frontend is static. Serve `/public` with any static server:

```bash
cd public
npx serve .
```

Or open `public/index.html` directly in a browser for quick checks.

### Backend

```bash
cd server
cp .env.example .env        # fill in your Supabase and other secrets
npm install
npm run dev
```

The API runs on `http://localhost:3000` by default.

### Database

Supabase migrations live in `/supabase/migrations`. Apply them via the Supabase dashboard SQL editor, or with the Supabase CLI once configured.

## Deployment

- **Frontend → Netlify:** auto-deploys from `main` branch, publish directory `public`.
- **Backend → Railway:** auto-deploys from `main` branch, root directory `server`.
- **Database → Supabase:** managed in the Supabase dashboard.

See `docs/DEPLOYMENT.md` for environment variable setup on each platform.

## Environment Variables

Never commit `.env` files. See `server/.env.example` and `public/assets/js/config.example.js` for the required variables.

## Contributing

Commits follow conventional commit format:

```
<type>(<scope>): <description>

Types: feat | fix | perf | a11y | security | style | refactor | chore
```
