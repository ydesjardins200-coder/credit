// Shared lead-ingestion logic — the single source of truth for turning an
// inbound lead object into a `leads` row. Used by BOTH the public webhook
// (after it verifies the partner's HMAC) and the admin "send test lead"
// endpoint. Keeping this in one place avoids the logic drift that bites
// when the same behavior is copied into two routes.

const crypto = require('crypto');
const { supabaseAdmin } = require('./supabase');
const cio = require('./customerio');

const MAX_FIELD = 300;

// A partner's leads sync to Customer.io only when consent is confirmed for
// that partner — or when it's a TEST partner (synthetic leads, for exercising
// the pipeline). Mirrors the gate documented in migration 0042.
function partnerSyncEnabled(partner) {
  return !!(partner && (partner.is_test === true || partner.leads_consent_confirmed === true));
}

function looksLikeEmail(s) {
  return typeof s === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
}

function genReferralCode() {
  return 'ib_' + crypto.randomBytes(6).toString('hex');
}

// Ingest a single lead for a partner. Returns a per-item result object and
// never throws. `partner` must have at least { id }.
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

    // Idempotency: existing (partner, key) -> return it.
    const { data: existing } = await supabaseAdmin
      .from('leads')
      .select('id, status, referral_code')
      .eq('partner_id', partner.id)
      .eq('idempotency_key', idemKey)
      .maybeSingle();
    if (existing) {
      return { ok: true, index: index, lead_id: existing.id, referral_code: existing.referral_code, status: existing.status, duplicate: true };
    }

    // Existing-customer suppression.
    let status = 'ingested';
    try {
      const { data: prof } = await supabaseAdmin
        .from('profiles').select('id').ilike('email', email).limit(1);
      if (prof && prof[0]) status = 'suppressed';
    } catch (e) { /* best-effort */ }

    const insertRow = {
      partner_id: partner.id,
      partner_lead_id: (lead.partner_lead_id ? String(lead.partner_lead_id).slice(0, MAX_FIELD) : null),
      email: email.slice(0, MAX_FIELD),
      full_name: (lead.full_name ? String(lead.full_name).slice(0, MAX_FIELD) : null),
      phone: (lead.phone ? String(lead.phone).slice(0, MAX_FIELD) : null),
      address: (lead.address && typeof lead.address === 'object') ? lead.address : null,
      referral_code: genReferralCode(),
      status: status,
      idempotency_key: idemKey.slice(0, MAX_FIELD),
      raw_payload: lead,
    };

    const { data: inserted, error } = await supabaseAdmin
      .from('leads').insert(insertRow).select('id, referral_code, status').single();

    if (error) {
      if (error.code === '23505') {
        const { data: raced } = await supabaseAdmin
          .from('leads').select('id, status, referral_code')
          .eq('partner_id', partner.id).eq('idempotency_key', idemKey).maybeSingle();
        if (raced) return { ok: true, index: index, lead_id: raced.id, referral_code: raced.referral_code, status: raced.status, duplicate: true };
      }
      return { ok: false, index: index, error: 'Insert failed.' };
    }

    // Sync a NEW (non-suppressed) lead into Customer.io — keyed by email,
    // so it merges onto the id profile at signup. Gated: only consent-cleared
    // (or TEST) partners. Fire-and-forget + fail-safe: a sync failure must
    // never affect the ingestion result (we already returned the lead to the
    // partner's CRM). Suppressed leads (already an iBoost customer) are not
    // synced — they're not acquirable leads.
    if (inserted.status === 'ingested' && partnerSyncEnabled(partner)) {
      const firstName = (insertRow.full_name || '').trim().split(/\s+/)[0] || null;
      cio.identifyByEmail(email, {
        lead_status: 'lead',
        has_account: false,
        source_partner_id: partner.id,
        referral_code: inserted.referral_code,
        referred_at: Math.floor(Date.now() / 1000),
        phone: insertRow.phone || null,
        first_name: firstName,
      }).then(function () {}, function () {});
    }

    return { ok: true, index: index, lead_id: inserted.id, referral_code: inserted.referral_code, status: inserted.status, duplicate: false };
  } catch (err) {
    return { ok: false, index: index, error: 'Item error.' };
  }
}

module.exports = { ingestOne, looksLikeEmail, genReferralCode, MAX_FIELD };
