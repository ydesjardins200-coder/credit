// Partner intake webhook (credit backend) — Slice 2.
//
// PUBLIC endpoint the partner's CRM POSTs leads to. Authenticated per
// partner with an API key + HMAC signature over the RAW body (so this
// router is mounted with express.raw() BEFORE the global express.json(),
// exactly like the Stripe webhook — see index.js).
//
//   Headers:
//     X-Partner-Key        the partner's raw api_key (we hash + look up)
//     X-Partner-Signature  hex HMAC-SHA256(rawBody, partner.hmac_secret)
//   Body: a single lead object, or { "leads": [ ... ] } for a batch.
//
// Per lead the partner sends (at minimum) an email + their own lead id:
//   { partner_lead_id, email, full_name, phone, address, idempotency_key }
//
// Behavior:
//   - Idempotent: dedupe on (partner_id, idempotency_key). Re-POSTing the
//     same key returns the existing lead, never a duplicate.
//   - Existing-customer suppression: if the email already belongs to an
//     iBoost account, the lead is stored with status 'suppressed' (we
//     don't pay a partner to "acquire" someone who's already a customer).
//   - Each lead gets a unique referral_code (the attribution token).
//   - Accept fast: validate + persist, return 202. No outreach here
//     (that's the email platform, later). No accrual here.
//   - Disabled/paused partners are rejected.
//
// NOTE: no real partner should hit this until the core features are live
// and the compliance gate clears. Until then it's exercised by the $0
// test partner with synthetic leads.

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { supabaseAdmin } = require('../lib/supabase');

const MAX_BATCH = 500;          // max leads per POST
const MAX_FIELD = 300;          // generic field length cap

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function looksLikeEmail(s) { return typeof s === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s); }
function genReferralCode() {
  // Short, URL-safe, collision-resistant enough with a unique constraint
  // backstop. e.g. "ib_9f3a2c8e1b".
  return 'ib_' + crypto.randomBytes(6).toString('hex');
}

// Timing-safe hex compare.
function safeEqual(a, b) {
  try {
    const ba = Buffer.from(String(a), 'hex');
    const bb = Buffer.from(String(b), 'hex');
    if (ba.length !== bb.length || ba.length === 0) return false;
    return crypto.timingSafeEqual(ba, bb);
  } catch (e) { return false; }
}

// Simple in-memory per-partner rate limiter (no dep). Generous — protects
// against a runaway CRM loop, not a security boundary.
const hits = new Map(); // partnerId -> [timestamps]
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 2000;    // very generous: 10k/wk is ~bursty hundreds/min
function rateLimited(partnerId) {
  const now = Date.now();
  const arr = (hits.get(partnerId) || []).filter(function (t) { return now - t < WINDOW_MS; });
  if (arr.length >= MAX_PER_WINDOW) { hits.set(partnerId, arr); return true; }
  arr.push(now);
  hits.set(partnerId, arr);
  return false;
}

router.post('/', async function (req, res) {
  try {
    // req.body is a raw Buffer (express.raw mounted on this path).
    const rawBuf = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
    const raw = rawBuf.toString('utf8');

    // ---- authenticate the partner ----
    const apiKey = req.headers['x-partner-key'];
    const signature = req.headers['x-partner-signature'];
    if (!apiKey || !signature) {
      return res.status(401).json({ error: 'Missing partner credentials.' });
    }

    const { data: partner } = await supabaseAdmin
      .from('partners')
      .select('id, status, hmac_secret, is_test')
      .eq('api_key_hash', sha256(apiKey))
      .single();

    if (!partner) return res.status(401).json({ error: 'Invalid partner key.' });
    if (partner.status !== 'active') return res.status(403).json({ error: 'Partner is not active.' });

    // ---- verify the signature over the raw body ----
    const expected = crypto.createHmac('sha256', partner.hmac_secret).update(rawBuf).digest('hex');
    if (!safeEqual(signature, expected)) {
      return res.status(401).json({ error: 'Bad signature.' });
    }

    // ---- rate limit ----
    if (rateLimited(partner.id)) {
      return res.status(429).json({ error: 'Rate limit exceeded.' });
    }

    // ---- parse the (now trusted) body ----
    let parsed;
    try { parsed = JSON.parse(raw || '{}'); } catch (e) {
      return res.status(400).json({ error: 'Body is not valid JSON.' });
    }
    const items = Array.isArray(parsed.leads) ? parsed.leads
                : (parsed && parsed.email !== undefined) ? [parsed]
                : null;
    if (!items || !items.length) {
      return res.status(400).json({ error: 'No leads in payload. Send a lead object or { leads: [...] }.' });
    }
    if (items.length > MAX_BATCH) {
      return res.status(400).json({ error: 'Batch too large (max ' + MAX_BATCH + ').' });
    }

    const results = [];
    for (let i = 0; i < items.length; i++) {
      results.push(await ingestOne(partner, items[i], i));
    }

    const accepted = results.filter(function (r) { return r.ok; }).length;
    const rejected = results.length - accepted;
    // 202: accepted for processing. Per-item statuses returned so the
    // partner's CRM can reconcile (and so dupes are visibly idempotent).
    return res.status(202).json({ accepted: accepted, rejected: rejected, results: results });
  } catch (err) {
    return res.status(500).json({ error: 'Intake failed.' });
  }
});

// Ingest a single lead. Returns a per-item result (never throws).
async function ingestOne(partner, lead, index) {
  try {
    if (!lead || typeof lead !== 'object') {
      return { ok: false, index: index, error: 'Not an object.' };
    }
    const email = (lead.email ? String(lead.email) : '').trim();
    if (!looksLikeEmail(email)) {
      return { ok: false, index: index, error: 'Invalid or missing email.' };
    }
    const idemKey = (lead.idempotency_key ? String(lead.idempotency_key)
                   : lead.partner_lead_id ? String(lead.partner_lead_id)
                   : '').trim();
    if (!idemKey) {
      return { ok: false, index: index, error: 'Missing idempotency_key (or partner_lead_id).' };
    }

    // Idempotency: if this (partner, key) already exists, return it.
    const { data: existing } = await supabaseAdmin
      .from('leads')
      .select('id, status, referral_code')
      .eq('partner_id', partner.id)
      .eq('idempotency_key', idemKey)
      .maybeSingle();
    if (existing) {
      return { ok: true, index: index, lead_id: existing.id, referral_code: existing.referral_code, status: existing.status, duplicate: true };
    }

    // Existing-customer suppression: if the email is already an iBoost
    // account, store but mark suppressed (don't "acquire" a current user).
    let status = 'ingested';
    try {
      const { data: prof } = await supabaseAdmin
        .from('profiles').select('id').ilike('email', email).limit(1);
      if (prof && prof[0]) status = 'suppressed';
    } catch (e) { /* suppression check is best-effort */ }

    const referralCode = genReferralCode();

    const insertRow = {
      partner_id: partner.id,
      partner_lead_id: (lead.partner_lead_id ? String(lead.partner_lead_id).slice(0, MAX_FIELD) : null),
      email: email.slice(0, MAX_FIELD),
      full_name: (lead.full_name ? String(lead.full_name).slice(0, MAX_FIELD) : null),
      phone: (lead.phone ? String(lead.phone).slice(0, MAX_FIELD) : null),
      address: (lead.address && typeof lead.address === 'object') ? lead.address : null,
      referral_code: referralCode,
      status: status,
      idempotency_key: idemKey.slice(0, MAX_FIELD),
      raw_payload: lead,
    };

    const { data: inserted, error } = await supabaseAdmin
      .from('leads').insert(insertRow).select('id, referral_code, status').single();

    if (error) {
      // Unique-violation race on (partner_id, idempotency_key): another
      // concurrent POST won. Re-read and return it as a duplicate.
      if (error.code === '23505') {
        const { data: raced } = await supabaseAdmin
          .from('leads').select('id, status, referral_code')
          .eq('partner_id', partner.id).eq('idempotency_key', idemKey).maybeSingle();
        if (raced) return { ok: true, index: index, lead_id: raced.id, referral_code: raced.referral_code, status: raced.status, duplicate: true };
      }
      return { ok: false, index: index, error: 'Insert failed.' };
    }

    return { ok: true, index: index, lead_id: inserted.id, referral_code: inserted.referral_code, status: inserted.status, duplicate: false };
  } catch (err) {
    return { ok: false, index: index, error: 'Item error.' };
  }
}

module.exports = router;
