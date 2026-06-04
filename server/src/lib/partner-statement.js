// Partner monthly statement — one PDF combining the financial statement
// and the lead/funnel report for a billing period (calendar month, UTC).
//
// Generated from the append-only ledgers, so re-generating a month always
// yields the same numbers; a refund of a prior-month payment appears as a
// clawback in the month it occurred (standard accounting, no retroactive
// edits).
//
// Contains NO consumer PII — pure aggregates. Per-lead matching, if a
// partner's finance team ever needs it, is a separate (CSV) concern.

const PDFDocument = require('pdfkit');
const { supabaseAdmin } = require('./supabase');

// ---- data ------------------------------------------------------------

function monthBounds(year, month) {
  // month: 1-12. Returns [startIso, endIso) in UTC.
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return [start.toISOString(), end.toISOString()];
}

async function gatherStatementData(partnerId, year, month) {
  const [startIso, endIso] = monthBounds(year, month);

  const [partnerR, dealR, leadsR, eventsR, clicksR] = await Promise.all([
    supabaseAdmin.from('partners').select('*').eq('id', partnerId).single(),
    supabaseAdmin.from('partner_deals').select('*').eq('partner_id', partnerId).eq('is_active', true).maybeSingle(),
    supabaseAdmin.from('leads').select('status, ingested_at, attributed_at').eq('partner_id', partnerId),
    supabaseAdmin.from('rev_share_events').select('collected_cents, accrued_cents, currency, status, basis_snapshot, created_at').eq('partner_id', partnerId),
    supabaseAdmin.from('referral_clicks').select('clicked_at').eq('partner_id', partnerId),
  ]);

  if (partnerR.error || !partnerR.data) throw new Error('partner not found');
  const partner = partnerR.data;
  const deal = dealR.data || null;
  const leads = leadsR.data || [];
  const events = eventsR.data || [];
  const clicks = clicksR.data || [];

  const inPeriod = function (iso) { return iso && iso >= startIso && iso < endIso; };

  // ---- financial (per currency; never summed across) ----
  function emptyCur() { return { collected: 0, accrued: 0, clawback: 0, net: 0 }; }
  const fin = {}; // currency -> sums (cents)
  let convPeriod = 0, recurringPeriod = 0, convLife = 0;
  events.forEach(function (e) {
    const cur = (e.currency || 'cad').toLowerCase();
    if (!fin[cur]) fin[cur] = emptyCur();
    const acc = Number(e.accrued_cents) || 0;
    const col = Number(e.collected_cents) || 0;
    const idx = e.basis_snapshot && Number(e.basis_snapshot.payment_index);
    const isReversal = acc < 0 || e.status === 'reversed';

    if (!isReversal && idx === 1) convLife += 1;

    if (inPeriod(e.created_at)) {
      if (isReversal) {
        fin[cur].clawback += acc;            // negative
        fin[cur].collected += col;           // negative refund amount nets collected
      } else {
        fin[cur].accrued += acc;
        fin[cur].collected += col;
        if (idx === 1) convPeriod += 1; else recurringPeriod += 1;
      }
    }
  });
  Object.keys(fin).forEach(function (c) { fin[c].net = fin[c].accrued + fin[c].clawback; });

  // ---- funnel (period + lifetime) ----
  function leadCounts(filterFn) {
    const out = { ingested: 0, free: 0, converted: 0, suppressed: 0, expired: 0 };
    leads.forEach(function (l) {
      if (filterFn && !filterFn(l)) return;
      out.ingested += 1;
      if (l.status === 'signed_up_free') out.free += 1;
      else if (l.status === 'converted_collected' || l.status === 'signed_up_paid') out.converted += 1;
      else if (l.status === 'suppressed') out.suppressed += 1;
      else if (l.status === 'expired') out.expired += 1;
    });
    return out;
  }
  const lifeLeads = leadCounts(null);
  const periodLeads = leadCounts(function (l) { return inPeriod(l.ingested_at); });
  const clicksLife = clicks.length;
  const clicksPeriod = clicks.filter(function (c) { return inPeriod(c.clicked_at); }).length;

  return {
    partner: partner,
    deal: deal,
    period: { year: year, month: month, startIso: startIso, endIso: endIso },
    financial: { byCurrency: fin, conversionsPeriod: convPeriod, recurringPeriod: recurringPeriod },
    funnel: {
      period: { clicks: clicksPeriod, leads: periodLeads.ingested, free: periodLeads.free, converted: convPeriod },
      lifetime: { clicks: clicksLife, leads: lifeLeads.ingested, free: lifeLeads.free, converted: convLife },
      statusLifetime: lifeLeads,
    },
  };
}

// ---- render ----------------------------------------------------------

const NAVY = '#0A2540';
const GREEN = '#1ea75c';
const MUTED = '#5b6b7c';
const LIGHT = '#eef2f6';
const RED = '#c0392b';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function fmtMoney(cents, cur) {
  const v = (Number(cents) || 0) / 100;
  const sign = v < 0 ? '-' : '';
  return sign + '$' + Math.abs(v).toFixed(2) + ' ' + String(cur || 'cad').toUpperCase();
}

function dealSummary(deal) {
  if (!deal) return 'No active deal on file for this period.';
  const rate = deal.rate_type === 'percent'
    ? (Number(deal.rate_value) || 0) + '% of collected revenue'
    : '$' + ((Number(deal.rate_value) || 0) / 100).toFixed(2) + ' flat';
  const basis = String(deal.payout_basis || '').replace(/_/g, ' ');
  let recurring = 'one-time (first payment only)';
  if (deal.recurring_duration === 'lifetime') recurring = 'recurring, lifetime';
  if (deal.recurring_duration === 'n_months') recurring = 'recurring, first ' + (deal.recurring_months || 0) + ' months';
  return rate + ' per ' + basis + ' \u00b7 ' + recurring + ' \u00b7 ' + (deal.attribution_window_days || 60) + '-day attribution window';
}

// Renders the statement to a Buffer. Pure (no DB) — testable with mocks.
function renderStatementPdf(data) {
  return new Promise(function (resolve, reject) {
    const doc = new PDFDocument({ size: 'LETTER', margin: 54 }); // 0.75in margins
    const chunks = [];
    doc.on('data', function (c) { chunks.push(c); });
    doc.on('end', function () { resolve(Buffer.concat(chunks)); });
    doc.on('error', reject);

    const p = data.partner;
    const period = data.period;
    const monthName = MONTHS[period.month - 1] + ' ' + period.year;
    const statementId = period.year + '-' + String(period.month).padStart(2, '0') + '-' + (p.slug || p.id);
    const W = doc.page.width - 108; // content width
    const X = 54;
    let y;

    // ---- header ----
    doc.rect(0, 0, doc.page.width, 96).fill(NAVY);
    doc.fill('#ffffff').font('Helvetica-Bold').fontSize(18).text('iBoost', X, 26);
    doc.font('Helvetica').fontSize(10).fillColor('#bcd0e0')
      .text('Partner statement \u2014 ' + monthName, X, 50);
    doc.fontSize(9)
      .text('Partner: ' + p.name + (p.is_test ? '  (TEST PARTNER \u2014 not a real settlement)' : ''), X, 64);
    doc.text('Statement ID: ' + statementId + '   \u00b7   Generated: ' + new Date().toISOString().slice(0, 10), X, 78);

    y = 120;

    // ---- net owed hero ----
    const curKeys = Object.keys(data.financial.byCurrency);
    doc.fillColor(MUTED).font('Helvetica').fontSize(9).text('NET REVENUE SHARE OWED \u2014 ' + monthName.toUpperCase(), X, y);
    y += 14;
    if (curKeys.length === 0) {
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(22).text('$0.00', X, y);
      y += 30;
    } else {
      curKeys.forEach(function (cur) {
        const net = data.financial.byCurrency[cur].net;
        doc.fillColor(net < 0 ? RED : GREEN).font('Helvetica-Bold').fontSize(22)
          .text(fmtMoney(net, cur), X, y);
        y += 28;
      });
    }
    y += 6;

    // ---- financial breakdown table (one block per currency) ----
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(12).text('Financial summary', X, y);
    y += 18;

    function row(label, value, opts) {
      opts = opts || {};
      if (opts.zebra) { doc.rect(X, y - 3, W, 16).fill(LIGHT); }
      doc.fillColor(opts.strong ? NAVY : MUTED).font(opts.strong ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.5)
        .text(label, X + 8, y);
      doc.fillColor(opts.color || (opts.strong ? NAVY : '#1f2d3a')).font(opts.strong ? 'Helvetica-Bold' : 'Helvetica')
        .text(value, X + 8, y, { width: W - 16, align: 'right' });
      y += 16;
    }

    if (curKeys.length === 0) {
      doc.fillColor(MUTED).font('Helvetica').fontSize(9.5)
        .text('No collected payments from this partner\u2019s leads in ' + monthName + '.', X + 8, y);
      y += 16;
    }
    curKeys.forEach(function (cur) {
      const f = data.financial.byCurrency[cur];
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(10).text(cur.toUpperCase(), X + 8, y); y += 15;
      row('Collected revenue from referred customers', fmtMoney(f.collected, cur), { zebra: true });
      row('Revenue share accrued', fmtMoney(f.accrued, cur));
      row('Clawbacks (refunds)', fmtMoney(f.clawback, cur), { zebra: true, color: f.clawback < 0 ? RED : undefined });
      row('Net owed', fmtMoney(f.net, cur), { strong: true, color: f.net < 0 ? RED : GREEN });
      y += 6;
    });

    row('Paid conversions this period', String(data.financial.conversionsPeriod), { zebra: true });
    row('Recurring payments collected this period', String(data.financial.recurringPeriod));
    y += 10;

    // ---- deal terms box ----
    doc.rect(X, y, W, 40).fill('#f4f8fb');
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8.5).text('DEAL TERMS APPLIED', X + 10, y + 8);
    doc.fillColor(NAVY).font('Helvetica').fontSize(9.5).text(dealSummary(data.deal), X + 10, y + 21, { width: W - 20 });
    y += 54;

    // ---- funnel ----
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(12).text('Lead funnel', X, y);
    doc.fillColor(MUTED).font('Helvetica').fontSize(9)
      .text(monthName + '  \u00b7  lifetime', X, y + 2, { width: W, align: 'right' });
    y += 20;

    const fp = data.funnel.period, fl = data.funnel.lifetime;
    const stages = [
      { label: 'Link clicks', p: fp.clicks, l: fl.clicks },
      { label: 'Leads ingested', p: fp.leads, l: fl.leads },
      { label: 'Free-plan signups', p: fp.free, l: fl.free },
      { label: 'Paid conversions', p: fp.converted, l: fl.converted },
    ];
    const maxLife = stages.reduce(function (m, s) { return Math.max(m, s.l); }, 0) || 1;
    const barMax = W - 230;
    stages.forEach(function (s, i) {
      if (i % 2 === 0) { doc.rect(X, y - 3, W, 18).fill(LIGHT); }
      doc.fillColor(NAVY).font('Helvetica').fontSize(9.5).text(s.label, X + 8, y);
      const bw = Math.max(2, Math.round((s.l / maxLife) * barMax));
      doc.rect(X + 130, y + 1, bw, 8).fill(i === 3 ? GREEN : '#7fb3d8');
      doc.fillColor('#1f2d3a').font('Helvetica-Bold').fontSize(9.5)
        .text(String(s.p) + '  \u00b7  ' + String(s.l), X + 8, y, { width: W - 16, align: 'right' });
      y += 18;
    });
    y += 4;

    // Conversion rates (lifetime).
    const leadToPaid = fl.leads > 0 ? Math.round((fl.converted / fl.leads) * 100) : 0;
    const clickToPaid = fl.clicks > 0 ? Math.round((fl.converted / fl.clicks) * 100) : null;
    let rates = 'Lead-to-paid: ' + leadToPaid + '% (lifetime)';
    if (clickToPaid != null) rates += '   \u00b7   Click-to-paid: ' + clickToPaid + '% (lifetime)';
    doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(rates, X + 8, y);
    y += 16;

    // Status breakdown (lifetime).
    const st = data.funnel.statusLifetime;
    doc.fillColor(MUTED).font('Helvetica').fontSize(9)
      .text('Lifetime lead status: ' + st.ingested + ' ingested \u00b7 ' + st.free + ' on free plan \u00b7 ' +
            st.converted + ' converted \u00b7 ' + st.suppressed + ' suppressed (existing customers) \u00b7 ' +
            st.expired + ' expired', X + 8, y, { width: W - 16 });
    y += 26;

    // ---- footer ----
    doc.fillColor(MUTED).font('Helvetica').fontSize(8)
      .text('Generated from iBoost\u2019s append-only revenue ledgers. Refunds appear as clawbacks in the month they occur; ' +
            'prior statements are never restated. Revenue share accrues only on collected payments. ' +
            'Amounts are reported per currency and are never combined across currencies. ' +
            'This statement contains aggregate figures only and no consumer personal information.',
        X, doc.page.height - 100, { width: W });

    doc.end();
  });
}

module.exports = { gatherStatementData, renderStatementPdf, monthBounds };
