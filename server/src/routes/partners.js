// Partner platform — admin endpoints (credit backend).
//
// These manage partners + their deals + read their leads, for the admin
// "Partners" tab (cross-service: admin -> shared-secret -> here). All
// admin-secret gated, service-role writes. The PUBLIC intake webhook
// (POST /api/partners/leads) will be added to THIS router in a later slice;
// it lives here too because it verifies against the credentials generated
// below and writes the same tables.
//
// Credential model (like Stripe/GitHub tokens):
//   - api_key   : a random token. Shown to the operator ONCE on create/
//                 rotate. Stored only as a SHA-256 hash (api_key_hash).
//   - hmac_secret: a separate random secret for webhook signature checks.
//                 Also shown once. (Stored as-is — the server needs it to
//                 recompute the HMAC of inbound payloads.)
//   Neither raw value is retrievable later. Lost -> rotate.
//
// Test partners (is_test) get test-prefixed keys (pk_test_…) so it's
// obvious which environment a key belongs to.

const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const requireAdminSharedSecret = require('../middleware/requireAdminSharedSecret');
const requireAuth = require('../middleware/requireAuth');
const { supabaseAdmin } = require('../lib/supabase');
const { ingestOne } = require('../lib/lead-ingest');
const { attributeUser } = require('../lib/partner-accrual');

// ---- credential helpers ----
function genApiKey(isTest) {
  const prefix = isTest ? 'pk_test_' : 'pk_live_';
  return prefix + crypto.randomBytes(24).toString('hex');
}

// Non-secret identifier for a key: its prefix + last 4 chars. Safe to
// store and display (cannot help reconstruct the key).
function keyHint(apiKey) {
  const k = String(apiKey || '');
  const us = k.indexOf('_', 3); // end of 'pk_live'/'pk_test' before the hex
  const prefix = us !== -1 ? k.slice(0, us + 1) : k.slice(0, 8);
  return { prefix: prefix, last4: k.slice(-4) };
}
function genHmacSecret() {
  return 'whsec_' + crypto.randomBytes(32).toString('hex');
}
function hashKey(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// Shape a partner row for the client (never leak credential material).
function publicPartner(p) {
  if (!p) return null;
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    status: p.status,
    is_test: p.is_test,
    contact_name: p.contact_name,
    contact_email: p.contact_email,
    notes: p.notes,
    api_key_prefix: p.api_key_prefix || null,
    api_key_last4: p.api_key_last4 || null,
    created_at: p.created_at,
  };
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// ============ GET /api/partners/admin/all ============
// List partners with a lead count and a one-line active-deal summary.
router.get('/admin/all', requireAdminSharedSecret, async function (req, res) {
  try {
    const { data: partners, error } = await supabaseAdmin
      .from('partners')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });

    const ids = (partners || []).map(function (p) { return p.id; });
    // Lead counts per partner (one grouped query).
    const counts = {};
    if (ids.length) {
      const { data: leadRows } = await supabaseAdmin
        .from('leads')
        .select('partner_id')
        .in('partner_id', ids);
      (leadRows || []).forEach(function (r) {
        counts[r.partner_id] = (counts[r.partner_id] || 0) + 1;
      });
    }
    // Active deals per partner.
    const deals = {};
    if (ids.length) {
      const { data: dealRows } = await supabaseAdmin
        .from('partner_deals')
        .select('partner_id, payout_basis, rate_type, rate_value')
        .in('partner_id', ids)
        .eq('is_active', true);
      (dealRows || []).forEach(function (d) { deals[d.partner_id] = d; });
    }

    const out = (partners || []).map(function (p) {
      return Object.assign(publicPartner(p), {
        lead_count: counts[p.id] || 0,
        active_deal: deals[p.id] || null,
      });
    });
    return res.json({ partners: out });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ============ GET /api/partners/admin/:id ============
// One partner + its current (active) deal.
router.get('/admin/:id', requireAdminSharedSecret, async function (req, res) {
  try {
    const { data: partner, error } = await supabaseAdmin
      .from('partners').select('*').eq('id', req.params.id).single();
    if (error || !partner) return res.status(404).json({ error: 'Partner not found' });

    const { data: deal } = await supabaseAdmin
      .from('partner_deals')
      .select('*')
      .eq('partner_id', partner.id)
      .eq('is_active', true)
      .maybeSingle();

    // Accrual + funnel summary (best-effort; never fails the detail load).
    let summary = { leads: 0, free: 0, converted: 0, accrued_cents: 0, currencies: {} };
    try {
      // Select lead statuses and count in JS. (A head:true exact-count
      // query was returning 0 here; selecting rows is reliable and the
      // per-partner volume is modest.)
      const { data: leadRows } = await supabaseAdmin
        .from('leads').select('status').eq('partner_id', partner.id);
      const leadCount = (leadRows || []).length;
      const convCount = (leadRows || []).filter(function (l) {
        return l.status === 'converted_collected' || l.status === 'signed_up_paid';
      }).length;
      // Free-plan signups: referred leads who signed up but are still on the
      // free plan (not yet converted to paid). The middle of the funnel.
      const freeCount = (leadRows || []).filter(function (l) {
        return l.status === 'signed_up_free';
      }).length;
      // Sum accrued by currency (never sum across currencies).
      const { data: events } = await supabaseAdmin
        .from('rev_share_events')
        .select('accrued_cents, currency, status')
        .eq('partner_id', partner.id);
      const byCur = {};
      let totalAccrued = 0;
      (events || []).forEach(function (e) {
        const cur = (e.currency || 'cad').toLowerCase();
        byCur[cur] = (byCur[cur] || 0) + (Number(e.accrued_cents) || 0);
        totalAccrued += (Number(e.accrued_cents) || 0);
      });
      summary = { leads: leadCount, free: freeCount, converted: convCount, accrued_cents: totalAccrued, currencies: byCur };
    } catch (e) { /* summary is best-effort */ }

    return res.json({ partner: publicPartner(partner), deal: deal || null, summary: summary });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ============ POST /api/partners/admin ============
// Create a partner. Generates api_key + hmac_secret, stores only the hash
// of the key, returns BOTH raw values ONCE.
router.post('/admin', requireAdminSharedSecret, async function (req, res) {
  try {
    const b = req.body || {};
    const name = (b.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Name is required.' });
    const isTest = b.is_test === true;

    let slug = slugify(b.slug || name);
    if (!slug) slug = 'partner-' + crypto.randomBytes(3).toString('hex');

    const apiKey = genApiKey(isTest);
    const hmacSecret = genHmacSecret();

    const { data: partner, error } = await supabaseAdmin
      .from('partners')
      .insert({
        name: name,
        slug: slug,
        status: b.status && ['active', 'paused', 'disabled'].includes(b.status) ? b.status : 'active',
        is_test: isTest,
        contact_name: (b.contact_name || '').trim() || null,
        contact_email: (b.contact_email || '').trim() || null,
        notes: (b.notes || '').trim() || null,
        api_key_hash: hashKey(apiKey),
        api_key_prefix: keyHint(apiKey).prefix,
        api_key_last4: keyHint(apiKey).last4,
        hmac_secret: hmacSecret,
      })
      .select('*')
      .single();

    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'A partner with that slug already exists.' });
      return res.status(500).json({ error: error.message });
    }

    // Raw credentials returned ONCE — never retrievable again.
    return res.json({
      partner: publicPartner(partner),
      api_key: apiKey,
      hmac_secret: hmacSecret,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ============ PATCH /api/partners/admin/:id ============
// Update mutable fields. Never touches credentials (use rotate-key).
router.patch('/admin/:id', requireAdminSharedSecret, async function (req, res) {
  try {
    const b = req.body || {};
    const patch = {};
    if (typeof b.name === 'string' && b.name.trim()) patch.name = b.name.trim();
    if (typeof b.contact_name === 'string') patch.contact_name = b.contact_name.trim() || null;
    if (typeof b.contact_email === 'string') patch.contact_email = b.contact_email.trim() || null;
    if (typeof b.notes === 'string') patch.notes = b.notes.trim() || null;
    if (b.status && ['active', 'paused', 'disabled'].includes(b.status)) patch.status = b.status;
    if (typeof b.is_test === 'boolean') patch.is_test = b.is_test;

    if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update.' });

    const { data: partner, error } = await supabaseAdmin
      .from('partners').update(patch).eq('id', req.params.id).select('*').single();
    if (error || !partner) return res.status(404).json({ error: 'Partner not found' });

    return res.json({ partner: publicPartner(partner) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ============ POST /api/partners/admin/:id/rotate-key ============
// Regenerate api_key + hmac_secret. Returns new raw values ONCE.
router.post('/admin/:id/rotate-key', requireAdminSharedSecret, async function (req, res) {
  try {
    const { data: existing } = await supabaseAdmin
      .from('partners').select('id, is_test').eq('id', req.params.id).single();
    if (!existing) return res.status(404).json({ error: 'Partner not found' });

    const apiKey = genApiKey(existing.is_test);
    const hmacSecret = genHmacSecret();

    const { error } = await supabaseAdmin
      .from('partners')
      .update({
        api_key_hash: hashKey(apiKey),
        api_key_prefix: keyHint(apiKey).prefix,
        api_key_last4: keyHint(apiKey).last4,
        hmac_secret: hmacSecret,
      })
      .eq('id', existing.id);
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ api_key: apiKey, hmac_secret: hmacSecret });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ============ PUT /api/partners/admin/:id/deal ============
// Set/replace the partner's deal. Versioned: closes the current active deal
// (effective_to=now, is_active=false) and opens a new active one.
router.put('/admin/:id/deal', requireAdminSharedSecret, async function (req, res) {
  try {
    const partnerId = req.params.id;
    const b = req.body || {};

    const BASES = ['qualified_lead', 'signup', 'paid_conversion', 'recurring_pct'];
    const RATE_TYPES = ['flat', 'percent'];
    const DURATIONS = ['one_time', 'n_months', 'lifetime'];

    if (!BASES.includes(b.payout_basis)) return res.status(400).json({ error: 'Invalid payout_basis.' });
    if (!RATE_TYPES.includes(b.rate_type)) return res.status(400).json({ error: 'Invalid rate_type.' });
    if (!DURATIONS.includes(b.recurring_duration)) return res.status(400).json({ error: 'Invalid recurring_duration.' });
    const rateValue = Number(b.rate_value);
    if (!isFinite(rateValue) || rateValue < 0) return res.status(400).json({ error: 'Invalid rate_value.' });
    if (b.recurring_duration === 'n_months' && !(Number(b.recurring_months) > 0)) {
      return res.status(400).json({ error: 'recurring_months required when duration is n_months.' });
    }

    // Confirm the partner exists.
    const { data: partner } = await supabaseAdmin
      .from('partners').select('id').eq('id', partnerId).single();
    if (!partner) return res.status(404).json({ error: 'Partner not found' });

    // Close any current active deal.
    await supabaseAdmin
      .from('partner_deals')
      .update({ is_active: false, effective_to: new Date().toISOString() })
      .eq('partner_id', partnerId)
      .eq('is_active', true);

    // Open the new active deal.
    const { data: deal, error } = await supabaseAdmin
      .from('partner_deals')
      .insert({
        partner_id: partnerId,
        payout_basis: b.payout_basis,
        rate_type: b.rate_type,
        rate_value: rateValue,
        tiers: b.tiers || null,
        min_volume_threshold: Number.isInteger(b.min_volume_threshold) ? b.min_volume_threshold : null,
        payout_cap_cents: Number.isInteger(b.payout_cap_cents) ? b.payout_cap_cents : null,
        qualifying_criteria: b.qualifying_criteria || null,
        attribution_window_days: Number.isInteger(b.attribution_window_days) ? b.attribution_window_days : 60,
        recurring_duration: b.recurring_duration,
        recurring_months: b.recurring_duration === 'n_months' ? Number(b.recurring_months) : null,
        is_active: true,
      })
      .select('*')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ deal: deal });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ============ GET /api/partners/admin/:id/leads ============
// A partner's leads, newest first, paginated. For the lead inspector.
router.get('/admin/:id/leads', requireAdminSharedSecret, async function (req, res) {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = parseInt(req.query.offset, 10) || 0;

    const { data: leads, error } = await supabaseAdmin
      .from('leads')
      .select('id, partner_lead_id, email, full_name, phone, status, referral_code, attribution_method, attributed_user_id, ingested_at')
      .eq('partner_id', req.params.id)
      .order('ingested_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ leads: leads || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ============ POST /api/partners/admin/:id/test-lead ============
// Fire a synthetic lead through the real ingestion path so the operator can
// verify the pipeline end-to-end and watch it land in the leads inspector.
// ONLY allowed for is_test partners — you can never inject synthetic data
// into a real partner's leads/reconciliation. Each call uses a fresh
// idempotency key so repeated clicks create distinct leads.
router.post('/admin/:id/test-lead', requireAdminSharedSecret, async function (req, res) {
  try {
    const { data: partner } = await supabaseAdmin
      .from('partners').select('id, is_test, status').eq('id', req.params.id).single();
    if (!partner) return res.status(404).json({ error: 'Partner not found' });
    if (!partner.is_test) {
      return res.status(403).json({ error: 'Test leads can only be sent to a TEST partner.' });
    }

    const stamp = Date.now();
    const synthetic = {
      email: 'test+' + stamp + '@iboost.test',
      full_name: 'Synthetic Test Lead',
      phone: '(555) 010-' + String(stamp).slice(-4),
      partner_lead_id: 'TEST-' + stamp,
      idempotency_key: 'TEST-' + stamp,
      address: { line1: '123 Test St', city: 'Montreal', province: 'QC', postal: 'H0H 0H0' },
    };

    const result = await ingestOne(partner, synthetic, 0);
    if (!result.ok) return res.status(500).json({ error: result.error || 'Ingestion failed.' });
    return res.json({ ok: true, lead: result });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ============ GET /api/partners/prefill?ref=ib_... ============
// Public, used by the signup page to pre-fill the email/name for a visitor
// who arrived via a partner referral link. The referral code is an
// unguessable random token (acts as the capability). Returns minimal PII
// and ONLY for a fresh lead (not yet attributed, not suppressed) — once the
// lead has signed up or been suppressed, returns nothing.
router.get('/prefill', async function (req, res) {
  try {
    const ref = (req.query.ref ? String(req.query.ref) : '').trim();
    // Guard: only well-formed referral codes (ib_ + hex) are even looked up.
    if (!/^ib_[a-f0-9]{6,}$/.test(ref)) return res.json({});

    const { data: lead } = await supabaseAdmin
      .from('leads')
      .select('email, full_name, phone, status, attributed_user_id')
      .eq('referral_code', ref)
      .maybeSingle();

    if (!lead) return res.json({});
    if (lead.attributed_user_id) return res.json({});          // already signed up
    if (lead.status === 'suppressed') return res.json({});     // existing customer

    return res.json({ email: lead.email || null, full_name: lead.full_name || null, phone: lead.phone || null });
  } catch (err) {
    return res.json({});
  }
});

// ============ POST /api/partners/attribute ============
// Called by the signup flow right after an account is created, to link the
// new account to the lead that referred it (referral code, falling back to
// email match). Authenticated as the new user; best-effort; never errors
// the signup flow. Body: { ref?: "ib_..." }.
router.post('/attribute', requireAuth, async function (req, res) {
  try {
    const ref = req.body && req.body.ref ? String(req.body.ref) : null;
    const result = await attributeUser(req.user.id, req.user.email, ref);
    // Always 200 — attribution is best-effort and must not surface as a
    // signup error. The client ignores the body.
    return res.json({ ok: true, attributed: !!(result && result.attributed) });
  } catch (err) {
    return res.json({ ok: false, attributed: false });
  }
});

module.exports = router;
