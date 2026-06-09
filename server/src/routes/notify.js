// notify.js — internal, server-to-server messaging endpoints called by the
// ADMIN service (shared-secret auth, NOT requireAuth). This funnels admin-
// originated Customer.io sends through the single client that lives in the
// credit backend, so the integration has exactly ONE Customer.io entry point
// (single source of truth) rather than a second client in the admin repo.

const express = require('express');

const router = express.Router();

const requireAdminSharedSecret = require('../middleware/requireAdminSharedSecret');
const cio = require('../lib/customerio');

function acctUrl(path) {
  const base = (process.env.FRONTEND_URL || 'https://www.iboost.ca').replace(/\/+$/, '');
  return base + (path || '/account/profile');
}

// ---- POST /api/notify/cs-reply -----------------------------------------
// Fired when a CS agent replies to a case in the admin app. The customer
// gets the agent's reply inline PLUS a button back into their account; the
// do-not-reply notice and the "please answer inside your account" wording
// live in the Customer.io template (CIO_TX_CS_REPLY), which should also be
// configured with a no-reply From address.
//
// Body: { email (required), user_id?, case_id?, case_number?, case_subject?,
//         reply_text (required), agent_name?, case_url? }
//
// Returns 200 even when the send no-ops (keys/template not configured yet):
// the agent's reply itself already succeeded in the admin app — the email is
// a side-effect and must never make the admin action look failed.
router.post('/cs-reply', requireAdminSharedSecret, async function (req, res) {
  try {
    const b = req.body || {};
    const email = b.email ? String(b.email).trim() : '';
    const replyText = b.reply_text ? String(b.reply_text) : '';

    if (!email || !replyText) {
      return res.status(400).json({ ok: false, error: 'email and reply_text are required' });
    }

    const identifiers = b.user_id ? { id: String(b.user_id), email: email } : { email: email };

    const result = await cio.sendTransactional('cs_reply', {
      to: email,
      identifiers: identifiers,
      message_data: {
        reply_text: replyText,
        agent_name: b.agent_name || 'iBoost Support',
        case_number: b.case_number != null ? b.case_number : null,
        case_subject: b.case_subject || null,
        // TODO(admin-wire-up): if a per-case frontend route exists, pass it
        // as case_url from the admin side; until then the account inbox
        // (where the support widget lives) is the safe landing point.
        case_url: b.case_url || acctUrl('/account/profile'),
      },
    });

    return res.json({ ok: true, sent: !!(result && result.ok), detail: result });
  } catch (err) {
    // Never 500 the admin caller over a messaging side-effect.
    return res.status(200).json({ ok: false, error: err && err.message });
  }
});

// ---- GET /api/notify/status --------------------------------------------
// Tiny introspection so the admin (or a smoke test) can confirm which parts
// of the integration are live without sending anything.
router.get('/status', requireAdminSharedSecret, function (req, res) {
  return res.json({ ok: true, customerio: cio.status() });
});

module.exports = router;
