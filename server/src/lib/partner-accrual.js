// Partner attribution + accrual engine — the money engine.
//
// Two responsibilities, both append-only and idempotent:
//
//   attributeUser(userId, email, refCode)
//     Link a newly-signed-up account to the lead that referred it.
//     Precedence: referral code -> email match (within the partner's
//     attribution window). Writes a 'signed_up' attribution_ledger row
//     and stamps the lead. Tracking only — NEVER pays anything.
//
//   accrueOnCollectedPayment({ userId, invoiceId, eventId, amountCents,
//                              currency, plan })
//     Called from the Stripe invoice.payment_succeeded webhook. If the
//     user is attributed to a partner lead, compute what the partner is
//     owed from their ACTIVE deal and write a rev_share_events row +
//     a 'paid_collected' attribution_ledger row. THIS is the only place
//     money ever accrues (the anchor rule).
//
// SAFETY PRINCIPLES (this is money + the critical Stripe path):
//   - Best-effort: every public fn swallows its own errors and returns a
//     result object. It must NEVER throw into signup or the webhook.
//   - Idempotent: unique dedupe keys on both ledgers; re-delivery of the
//     same Stripe event cannot double-accrue.
//   - Anchor rule: accrual happens ONLY here, ONLY on a collected payment.
//   - Deal snapshot: the deal terms are frozen onto the accrual row.
//   - Recurring window: recurring deals only accrue while within their
//     configured duration (one_time / n_months / lifetime).

const { supabaseAdmin } = require('./supabase');

// Compute the accrual (in cents) for a collected payment under a deal.
// Returns 0 for bases/durations that don't apply. Pure function.
function computeAccrualCents(deal, collectedCents, opts) {
  if (!deal) return 0;
  const o = opts || {};
  const isFirstPayment = !!o.isFirstPayment;

  // Recurring duration gate (applies to every basis): if this is NOT the
  // first payment, only 'lifetime' / 'n_months' (within range) keep paying.
  if (!isFirstPayment) {
    if (deal.recurring_duration === 'one_time') return 0;
    if (deal.recurring_duration === 'n_months') {
      const n = Number(deal.recurring_months) || 0;
      // o.paymentIndex is 1-based (1 = first payment). Pay for the first n.
      if (o.paymentIndex && o.paymentIndex > n) return 0;
    }
    // 'lifetime' keeps paying — fall through.
  }

  const rateValue = Number(deal.rate_value) || 0;
  let cents = 0;

  if (deal.rate_type === 'percent') {
    // Percent of the collected amount, regardless of basis (the only
    // sensible reading of a % deal is "% of revenue we collected").
    cents = Math.round(collectedCents * (rateValue / 100));
  } else {
    // Flat amount. rate_value is stored in cents (admin enters dollars,
    // server stored cents). A flat deal pays its fixed amount per
    // qualifying collected payment.
    cents = Math.round(rateValue);
  }

  // Optional per-event cap.
  if (deal.payout_cap_cents != null) {
    cents = Math.min(cents, Number(deal.payout_cap_cents));
  }
  if (!isFinite(cents) || cents < 0) cents = 0;
  return cents;
}

// ---- attribution at signup -------------------------------------------
// Best-effort. Returns { ok, attributed, method, lead_id } — never throws.
async function attributeUser(userId, email, refCode) {
  try {
    if (!userId) return { ok: false, attributed: false, reason: 'no user id' };

    // If this user is already attributed to a lead, do nothing.
    const { data: already } = await supabaseAdmin
      .from('leads').select('id').eq('attributed_user_id', userId).limit(1);
    if (already && already[0]) return { ok: true, attributed: true, method: 'existing' };

    let lead = null;
    let method = null;

    // 1) Referral code — deterministic, strongest signal.
    if (refCode) {
      const code = String(refCode).trim();
      if (code) {
        const { data } = await supabaseAdmin
          .from('leads').select('id, partner_id, status, attributed_user_id, ingested_at')
          .eq('referral_code', code).maybeSingle();
        if (data && !data.attributed_user_id) { lead = data; method = 'referral_code'; }
      }
    }

    // 2) Email match within the partner's attribution window.
    if (!lead && email) {
      const em = String(email).trim().toLowerCase();
      if (em) {
        const { data: cands } = await supabaseAdmin
          .from('leads')
          .select('id, partner_id, status, attributed_user_id, ingested_at')
          .ilike('email', em)
          .is('attributed_user_id', null)
          .order('ingested_at', { ascending: false })
          .limit(5);
        for (const c of (cands || [])) {
          const inWindow = await withinWindow(c);
          if (inWindow) { lead = c; method = 'email_match'; break; }
        }
      }
    }

    if (!lead) return { ok: true, attributed: false };

    // Suppressed leads (already an existing customer at ingest) are not
    // attributable acquisitions.
    if (lead.status === 'suppressed') return { ok: true, attributed: false, reason: 'suppressed' };

    const now = new Date().toISOString();
    // Stamp the lead.
    await supabaseAdmin
      .from('leads')
      .update({ attributed_user_id: userId, attributed_at: now, attribution_method: method, status: 'signed_up_free' })
      .eq('id', lead.id)
      .is('attributed_user_id', null); // guard against a race

    // Tracking-only ledger row (idempotent on the lead id).
    await supabaseAdmin
      .from('attribution_ledger')
      .insert({
        lead_id: lead.id, partner_id: lead.partner_id, user_id: userId,
        event: 'signed_up', dedupe_key: lead.id,
      })
      .select('id')
      .maybeSingle()
      .then(function () {}, function () {}); // ignore dup-key races

    return { ok: true, attributed: true, method: method, lead_id: lead.id };
  } catch (err) {
    return { ok: false, attributed: false, error: err.message };
  }
}

// Is a lead within its partner's attribution window (days)?
async function withinWindow(lead) {
  try {
    const { data: deal } = await supabaseAdmin
      .from('partner_deals')
      .select('attribution_window_days')
      .eq('partner_id', lead.partner_id)
      .eq('is_active', true)
      .maybeSingle();
    const days = (deal && Number(deal.attribution_window_days)) || 60;
    const ingested = new Date(lead.ingested_at).getTime();
    return (Date.now() - ingested) <= days * 24 * 60 * 60 * 1000;
  } catch (e) {
    return true; // best-effort: don't drop attribution on a lookup error
  }
}

// ---- accrual on a collected payment ----------------------------------
// Best-effort. Returns { ok, accrued, amount_cents } — never throws.
async function accrueOnCollectedPayment(args) {
  const a = args || {};
  try {
    if (!a.userId || !a.invoiceId) return { ok: false, accrued: false, reason: 'missing user/invoice' };

    // Late attribution: if the user signed up without a referral link, try
    // an email match now (within window) before accruing.
    if (a.email) {
      await attributeUser(a.userId, a.email, null);
    }

    // Find the lead this user is attributed to.
    const { data: leadRows } = await supabaseAdmin
      .from('leads')
      .select('id, partner_id, status, ingested_at')
      .eq('attributed_user_id', a.userId)
      .limit(1);
    const lead = leadRows && leadRows[0];
    if (!lead) {
      console.log('[accrual] no lead attributed to user=' + a.userId + ' (invoice=' + a.invoiceId + ')');
      return { ok: true, accrued: false, reason: 'not attributed' };
    }
    if (lead.status === 'suppressed') return { ok: true, accrued: false, reason: 'suppressed' };

    // The partner's active deal.
    const { data: deal } = await supabaseAdmin
      .from('partner_deals')
      .select('*')
      .eq('partner_id', lead.partner_id)
      .eq('is_active', true)
      .maybeSingle();
    if (!deal) {
      console.log('[accrual] lead ' + lead.id + ' has no active deal (partner=' + lead.partner_id + ')');
      return { ok: true, accrued: false, reason: 'no active deal' };
    }

    // How many prior collected payments has this lead produced? (Determines
    // first-payment vs recurring, and the 1-based payment index.) Select
    // rows and count in JS — an exact head-count was returning 0 here,
    // which would make every payment look like the first.
    const { data: priorRows } = await supabaseAdmin
      .from('rev_share_events')
      .select('id')
      .eq('lead_id', lead.id);
    const priorCount = (priorRows || []).length;
    const paymentIndex = priorCount + 1;
    const isFirstPayment = paymentIndex === 1;

    const accruedCents = computeAccrualCents(deal, Number(a.amountCents) || 0, {
      isFirstPayment: isFirstPayment,
      paymentIndex: paymentIndex,
    });

    // Write the immutable 'paid_collected' attribution row (idempotent on
    // the invoice id). If it already exists, this event was processed.
    const { data: attrRow, error: attrErr } = await supabaseAdmin
      .from('attribution_ledger')
      .insert({
        lead_id: lead.id, partner_id: lead.partner_id, user_id: a.userId,
        event: 'paid_collected',
        stripe_event_id: a.eventId || null,
        invoice_id: a.invoiceId,
        amount_cents: Number(a.amountCents) || 0,
        currency: a.currency || null,
        dedupe_key: a.invoiceId,
      })
      .select('id')
      .single();

    if (attrErr) {
      // 23505 = already processed this invoice. Idempotent no-op.
      if (attrErr.code === '23505') return { ok: true, accrued: false, reason: 'duplicate (already processed)' };
      return { ok: false, accrued: false, error: attrErr.message };
    }

    // Advance the lead lifecycle to converted on first collected payment.
    if (isFirstPayment) {
      await supabaseAdmin
        .from('leads')
        .update({ status: 'converted_collected' })
        .eq('id', lead.id);
    }

    // Write the accrual (idempotent on the invoice id). A $0 accrual (e.g.
    // a test partner / $0 deal) is still recorded for the funnel, with 0
    // owed.
    const { error: revErr } = await supabaseAdmin
      .from('rev_share_events')
      .insert({
        partner_id: lead.partner_id, lead_id: lead.id, user_id: a.userId,
        deal_id: deal.id, attribution_ledger_id: attrRow.id,
        collected_cents: Number(a.amountCents) || 0,
        currency: a.currency || null,
        accrued_cents: accruedCents,
        basis_snapshot: {
          payout_basis: deal.payout_basis, rate_type: deal.rate_type,
          rate_value: deal.rate_value, recurring_duration: deal.recurring_duration,
          recurring_months: deal.recurring_months, payment_index: paymentIndex,
        },
        status: 'accrued',
        dedupe_key: a.invoiceId,
      });
    if (revErr && revErr.code !== '23505') {
      return { ok: false, accrued: false, error: revErr.message };
    }

    return { ok: true, accrued: true, amount_cents: accruedCents, partner_id: lead.partner_id, lead_id: lead.id };
  } catch (err) {
    return { ok: false, accrued: false, error: err.message };
  }
}

// ---- clawback on a refund --------------------------------------------
// Called from the Stripe charge.refunded webhook. If the refunded charge
// maps to an attributed conversion we accrued on, claw back the accrual
// PROPORTIONALLY to the refunded amount (a refund un-collects revenue, so
// the anchor rule says we shouldn't keep paying commission on it).
//
// Append-only + idempotent: writes a 'refunded' attribution_ledger row and
// a NEGATIVE 'reversed' rev_share_events row (never mutates the original).
// Handles full + multiple partial refunds + event re-delivery by keying on
// (invoice, cumulative-refunded-amount) and only writing the delta.
// Best-effort — never throws into the webhook.
async function reverseOnRefund(args) {
  const a = args || {};
  try {
    const invoiceId = a.invoiceId;
    if (!invoiceId) {
      console.log('[clawback] refund had no invoice id (charge=' + a.chargeId + ') — cannot map to an accrual');
      return { ok: true, reversed: false, reason: 'no invoice id' };
    }
    const amountRefunded = Number(a.amountRefundedCents) || 0;
    const originalCharge = Number(a.originalChargeCents) || 0;
    if (amountRefunded <= 0 || originalCharge <= 0) {
      return { ok: true, reversed: false, reason: 'nothing refunded' };
    }

    // The original positive accrual for this invoice.
    const { data: originals } = await supabaseAdmin
      .from('rev_share_events')
      .select('*')
      .eq('dedupe_key', invoiceId);
    const original = (originals || []).find(function (r) { return Number(r.accrued_cents) > 0; });
    if (!original) {
      console.log('[clawback] no original accrual for invoice=' + invoiceId + ' — not an attributed conversion (or accrued $0)');
      return { ok: true, reversed: false, reason: 'no original accrual' };
    }

    const originalAccrued = Number(original.accrued_cents) || 0;
    // Proportional target: how much of the accrual SHOULD be reversed given
    // the cumulative refunded fraction. Capped at the original accrual.
    let targetReversal = Math.round(originalAccrued * (amountRefunded / originalCharge));
    if (targetReversal > originalAccrued) targetReversal = originalAccrued;
    if (targetReversal <= 0) return { ok: true, reversed: false, reason: 'zero target' };

    // How much has already been reversed for this invoice? (Reversal rows
    // are keyed 'refund:<invoiceId>:<cumulativeRefunded>'.)
    const { data: priorReversals } = await supabaseAdmin
      .from('rev_share_events')
      .select('accrued_cents')
      .like('dedupe_key', 'refund:' + invoiceId + ':%');
    let alreadyReversed = 0;
    (priorReversals || []).forEach(function (r) { alreadyReversed += Math.abs(Number(r.accrued_cents) || 0); });

    const delta = targetReversal - alreadyReversed;
    if (delta <= 0) {
      return { ok: true, reversed: false, reason: 'already reversed' };
    }

    const dedupe = 'refund:' + invoiceId + ':' + amountRefunded;

    // Immutable fact in the attribution ledger (idempotent on event+dedupe).
    const { error: attrErr } = await supabaseAdmin
      .from('attribution_ledger')
      .insert({
        lead_id: original.lead_id, partner_id: original.partner_id, user_id: original.user_id,
        event: 'refunded',
        stripe_event_id: a.eventId || null,
        invoice_id: invoiceId,
        amount_cents: amountRefunded,
        currency: a.currency || original.currency || null,
        dedupe_key: dedupe,
      });
    if (attrErr && attrErr.code === '23505') {
      return { ok: true, reversed: false, reason: 'duplicate (already processed)' };
    }

    // Negative accrual = clawback. Idempotent on dedupe_key.
    const { error: revErr } = await supabaseAdmin
      .from('rev_share_events')
      .insert({
        partner_id: original.partner_id, lead_id: original.lead_id, user_id: original.user_id,
        deal_id: original.deal_id,
        collected_cents: -amountRefunded,
        currency: a.currency || original.currency || null,
        accrued_cents: -delta,
        basis_snapshot: {
          kind: 'refund_clawback', reversed_invoice: invoiceId,
          original_accrued_cents: originalAccrued, cumulative_refunded_cents: amountRefunded,
          original_charge_cents: originalCharge,
        },
        status: 'reversed',
        dedupe_key: dedupe,
      });
    if (revErr && revErr.code !== '23505') {
      return { ok: false, reversed: false, error: revErr.message };
    }

    return { ok: true, reversed: true, clawback_cents: delta, partner_id: original.partner_id };
  } catch (err) {
    return { ok: false, reversed: false, error: err.message };
  }
}

module.exports = { attributeUser, accrueOnCollectedPayment, computeAccrualCents, reverseOnRefund };
