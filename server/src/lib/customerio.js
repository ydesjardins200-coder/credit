// customerio.js — thin, fail-safe wrapper over the Customer.io APIs.
//
// PHASE 1 scope (decided 2026-06): transactional email + CS notifications +
// identify/track. Lifecycle/marketing journeys are PHASE 2 and are NOT built
// here. Region is hard-pinned to US (the workspace's data region).
//
// HARD RULE — this module must NEVER throw into a caller. Signup and the
// Stripe webhook both call it, and neither may break because a messaging
// side-effect failed. Every public function is wrapped and returns a small
// status object instead of throwing. Same discipline as partner-accrual.js.
//
// GATING — if the env keys aren't set yet (account/keys still being wired),
// every function no-ops with a debug log. So this ships safe and inert; it
// only starts doing anything once the three vars exist on the service:
//   CUSTOMERIO_SITE_ID      — Tracking API "Site ID"   (identify/track)
//   CUSTOMERIO_TRACK_KEY    — Tracking API "API Key"    (identify/track)
//   CUSTOMERIO_APP_API_KEY  — App API key               (transactional sends)
//
// Transactional template IDs are also read from env (one per message), so a
// send no-ops cleanly until its template exists in Customer.io:
//   CIO_TX_WELCOME, CIO_TX_PAYMENT_FAILED, CIO_TX_RECEIPT,
//   CIO_TX_CANCELED, CIO_TX_CS_REPLY

let TrackClient = null;
let APIClient = null;
let SendEmailRequest = null;
let RegionUS = null;
try {
  // Wrapped so a missing/broken package can't crash boot — wrapper just
  // stays in no-op mode if the dependency isn't present.
  // eslint-disable-next-line global-require
  ({ TrackClient, APIClient, SendEmailRequest, RegionUS } = require('customerio-node'));
} catch (e) {
  // eslint-disable-next-line no-console
  console.warn('[customerio] SDK not loadable — running in no-op mode:', e && e.message);
}

const SITE_ID = process.env.CUSTOMERIO_SITE_ID || '';
const TRACK_KEY = process.env.CUSTOMERIO_TRACK_KEY || '';
const APP_KEY = process.env.CUSTOMERIO_APP_API_KEY || '';

const TRACK_ENABLED = !!(TrackClient && SITE_ID && TRACK_KEY);
const APP_ENABLED = !!(APIClient && SendEmailRequest && APP_KEY);

// Map a logical message key -> the env var holding its transactional_message_id.
// Resolved lazily (read at call time) so adding a template later needs only an
// env change + redeploy, never a code change.
const TX_ENV = {
  welcome: 'CIO_TX_WELCOME',
  payment_failed: 'CIO_TX_PAYMENT_FAILED',
  receipt: 'CIO_TX_RECEIPT',
  canceled: 'CIO_TX_CANCELED',
  cs_reply: 'CIO_TX_CS_REPLY',
};

let _track = null;
let _api = null;
function trackClient() {
  if (!_track && TRACK_ENABLED) {
    _track = new TrackClient(SITE_ID, TRACK_KEY, { region: RegionUS });
  }
  return _track;
}
function apiClient() {
  if (!_api && APP_ENABLED) {
    _api = new APIClient(APP_KEY, { region: RegionUS });
  }
  return _api;
}

function dbg(msg) {
  // Opt-in debug logging; off by default to keep webhook logs quiet.
  if (process.env.CIO_DEBUG === '1') {
    // eslint-disable-next-line no-console
    console.log('[customerio] ' + msg);
  }
}

// Identify (create/update) a person. id is the Supabase user id.
async function identify(id, traits) {
  if (!id) return { ok: false, skipped: 'no-id' };
  if (!TRACK_ENABLED) { dbg('identify skipped (track disabled): ' + id); return { ok: false, skipped: 'disabled' }; }
  try {
    await trackClient().identify(String(id), traits || {});
    dbg('identify ok: ' + id);
    return { ok: true };
  } catch (e) {
    dbg('identify error: ' + (e && e.message));
    return { ok: false, error: e && e.message };
  }
}

// Emit a behavioural event for a known person.
async function track(id, name, data) {
  if (!id || !name) return { ok: false, skipped: 'missing-args' };
  if (!TRACK_ENABLED) { dbg('track skipped (disabled): ' + name); return { ok: false, skipped: 'disabled' }; }
  try {
    await trackClient().track(String(id), { name: String(name), data: data || {} });
    dbg('track ok: ' + name + ' for ' + id);
    return { ok: true };
  } catch (e) {
    dbg('track error: ' + (e && e.message));
    return { ok: false, error: e && e.message };
  }
}

// Send a transactional message by logical key. `to` is the recipient email;
// `identifiers` ties it to a known person (id or email — Customer.io creates
// the profile if absent). `message_data` populates the template's Liquid vars.
// `from` optionally overrides the template's sender (e.g. a no-reply address).
async function sendTransactional(txKey, opts) {
  const o = opts || {};
  const envName = TX_ENV[txKey];
  if (!envName) { dbg('tx unknown key: ' + txKey); return { ok: false, skipped: 'unknown-key' }; }
  if (!APP_ENABLED) { dbg('tx skipped (app disabled): ' + txKey); return { ok: false, skipped: 'disabled' }; }
  const messageId = process.env[envName];
  if (!messageId) { dbg('tx skipped (no template id ' + envName + '): ' + txKey); return { ok: false, skipped: 'no-template' }; }

  const to = o.to || (o.identifiers && o.identifiers.email) || null;
  // Customer.io requires EXACTLY ONE identifier (id, email, OR cio_id) —
  // sending more than one 400s. We identify people by the Supabase user id
  // at signup, so prefer id; fall back to email (which every Phase-1 send
  // also has). NOTE: this assumes the workspace identifies people by id —
  // confirm "identify people by" in Workspace Settings matches.
  let identifiers = null;
  if (o.identifiers) {
    if (o.identifiers.id) identifiers = { id: String(o.identifiers.id) };
    else if (o.identifiers.email) identifiers = { email: o.identifiers.email };
    else if (o.identifiers.cio_id) identifiers = { cio_id: String(o.identifiers.cio_id) };
  }
  if (!identifiers && to) identifiers = { email: to };
  if (!to && !identifiers) {
    dbg('tx skipped (no recipient): ' + txKey);
    return { ok: false, skipped: 'no-recipient' };
  }

  try {
    const payload = {
      transactional_message_id: String(messageId),
      message_data: o.message_data || {},
    };
    if (to) payload.to = to;
    if (identifiers) payload.identifiers = identifiers;
    if (o.from) payload.from = o.from;

    const req = new SendEmailRequest(payload);
    const res = await apiClient().sendEmail(req);
    dbg('tx sent: ' + txKey + ' -> ' + (to || (identifiers && identifiers.id)));
    return { ok: true, res };
  } catch (e) {
    dbg('tx error (' + txKey + '): ' + (e && e.message));
    return { ok: false, error: e && e.message };
  }
}

// Lightweight introspection for a health/status endpoint or tests.
function status() {
  return {
    region: 'us',
    trackEnabled: TRACK_ENABLED,
    appEnabled: APP_ENABLED,
    templates: Object.keys(TX_ENV).reduce(function (acc, k) {
      acc[k] = !!process.env[TX_ENV[k]];
      return acc;
    }, {}),
  };
}

module.exports = { identify, track, sendTransactional, status };
