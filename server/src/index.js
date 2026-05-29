// iBoost API server entry point.

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const healthRouter = require('./routes/health');
const checkoutRouter = require('./routes/checkout');
const stripeWebhookRouter = require('./routes/stripe-webhook');
const integrationsRouter = require('./routes/integrations');
const invoicesRouter = require('./routes/invoices');
const subscriptionRouter = require('./routes/subscription');
const billingRouter = require('./routes/billing');
const supportRouter = require('./routes/support');

const app = express();

// --- Config from environment ---
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// --- Middleware ---
app.use(helmet());

// CRITICAL: the Stripe webhook must receive the RAW (unparsed) body so
// its signature can be verified. It is therefore mounted with
// express.raw() BEFORE the global express.json() parser below. If
// express.json() ran first, it would consume/transform the body and
// signature verification would always fail (the classic Stripe bug).
//
// Only this exact path gets raw treatment; everything else is JSON.
app.use(
  '/api/stripe/webhook',
  express.raw({ type: 'application/json' }),
  stripeWebhookRouter
);

// Global JSON parser for every other route.
app.use(express.json({ limit: '1mb' }));
app.use(morgan(NODE_ENV === 'production' ? 'combined' : 'dev'));

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow same-origin / server-to-server requests with no Origin header
      if (!origin) return callback(null, true);
      if (ALLOWED_ORIGINS.length === 0) return callback(null, true); // dev default
      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      return callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
  })
);

// --- Routes ---
app.use('/api/health', healthRouter);
app.use('/api/checkout', checkoutRouter);
app.use('/api/integrations', integrationsRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/subscription', subscriptionRouter);
app.use('/api/billing', billingRouter);
app.use('/api/support', supportRouter);

app.get('/', (req, res) => {
  res.json({ service: 'iboost-api', status: 'ok' });
});

// --- 404 ---
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// --- Error handler ---
app.use((err, req, res, next) => {
  // eslint-disable-next-line no-console
  console.error('[error]', err);
  res.status(err.status || 500).json({
    error: NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[iboost-api] listening on port ${PORT} (${NODE_ENV})`);
});
