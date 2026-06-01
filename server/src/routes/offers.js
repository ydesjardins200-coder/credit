// Offers API.
//
// Public read (members): GET /api/offers — published offers grouped for
// the customer Offers page. min_score is returned but NOT used to filter
// yet (no bureau score in the product); when the bureau lands, filtering
// can switch on here.
//
// Admin (admin-secret-gated, service-role writes): list/create/update/
// delete/reorder, for the admin Offers CMS tab. Mirrors education.js.

const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/requireAuth');
const requireAdminSharedSecret = require('../middleware/requireAdminSharedSecret');
const { supabaseAdmin } = require('../lib/supabase');

const CATEGORIES = ['credit_card', 'personal_loan', 'bank_account', 'insurance'];

function isSpecsArray(v) {
  if (!Array.isArray(v)) return false;
  return v.every(function (s) {
    return s && typeof s === 'object' &&
      typeof s.label === 'string' && typeof s.val === 'string';
  });
}

// Shape a DB row for the client (drop internal columns, keep what renders).
function publicShape(o) {
  return {
    id: o.id,
    category: o.category,
    lender: o.lender,
    name: o.name,
    highlight: o.highlight || null,
    hook: o.hook || null,
    logo_text: o.logo_text,
    logo_class: o.logo_class || null,
    logo_color: o.logo_color || null,
    specs: o.specs || [],
    affiliate_link: o.affiliate_link || null,
    is_featured: !!o.is_featured,
    // min_score intentionally omitted from the public payload for now —
    // it isn't used client-side until bureau gating exists.
  };
}

// GET /api/offers — published offers for the customer page.
router.get('/', requireAuth, async function (req, res, next) {
  try {
    const { data, error } = await req.supabase
      .from('offers')
      .select('id, category, lender, name, highlight, hook, logo_text, logo_class, logo_color, specs, affiliate_link, is_featured, sort_order')
      .eq('is_published', true)
      .order('sort_order', { ascending: true });
    if (error) return res.status(500).json({ error: 'Could not load offers: ' + error.message });

    const all = (data || []).map(publicShape);
    const featured = all.filter(function (o) { return o.is_featured; });
    const byCategory = {};
    CATEGORIES.forEach(function (c) { byCategory[c] = []; });
    all.forEach(function (o) {
      if (!byCategory[o.category]) byCategory[o.category] = [];
      byCategory[o.category].push(o);
    });

    return res.json({ featured: featured, byCategory: byCategory, categories: CATEGORIES });
  } catch (err) {
    return next(err);
  }
});

// =====================================================================
// ADMIN (admin-secret-gated, service-role writes).
// =====================================================================

// GET /api/offers/admin/all — every offer incl. unpublished.
router.get('/admin/all', requireAdminSharedSecret, async function (req, res) {
  try {
    const { data, error } = await supabaseAdmin
      .from('offers')
      .select('*')
      .order('category', { ascending: true })
      .order('sort_order', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ offers: data || [], categories: CATEGORIES });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/offers/admin — create.
router.post('/admin', requireAdminSharedSecret, async function (req, res) {
  try {
    const b = req.body || {};
    const category = String(b.category || '').trim();
    if (CATEGORIES.indexOf(category) === -1) return res.status(400).json({ error: 'Invalid category.' });
    if (!String(b.lender || '').trim()) return res.status(400).json({ error: 'lender required.' });
    if (!String(b.name || '').trim()) return res.status(400).json({ error: 'name required.' });
    if (!String(b.logo_text || '').trim()) return res.status(400).json({ error: 'logo_text required.' });
    if (b.specs != null && !isSpecsArray(b.specs)) return res.status(400).json({ error: 'specs must be an array of {label, val}.' });

    let sortOrder = parseInt(b.sort_order, 10);
    if (isNaN(sortOrder)) {
      const { data: last } = await supabaseAdmin
        .from('offers').select('sort_order')
        .eq('category', category).order('sort_order', { ascending: false }).limit(1);
      sortOrder = (last && last[0] ? last[0].sort_order + 1 : 0);
    }

    const row = {
      category: category,
      lender: String(b.lender).trim(),
      name: String(b.name).trim(),
      highlight: b.highlight ? String(b.highlight) : null,
      hook: b.hook ? String(b.hook) : null,
      logo_text: String(b.logo_text).trim(),
      logo_class: b.logo_class ? String(b.logo_class).trim() : null,
      logo_color: b.logo_color ? String(b.logo_color).trim() : null,
      specs: Array.isArray(b.specs) ? b.specs : [],
      affiliate_link: b.affiliate_link ? String(b.affiliate_link).trim() : null,
      min_score: (b.min_score === '' || b.min_score == null) ? null : (parseInt(b.min_score, 10) || null),
      is_featured: !!b.is_featured,
      is_published: b.is_published !== false,
      sort_order: sortOrder,
    };
    const { data, error } = await supabaseAdmin.from('offers').insert(row).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true, offer: data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /api/offers/admin/:id — update.
router.patch('/admin/:id', requireAdminSharedSecret, async function (req, res) {
  try {
    const b = req.body || {};
    const update = { updated_at: new Date().toISOString() };
    if (b.category != null) {
      if (CATEGORIES.indexOf(String(b.category)) === -1) return res.status(400).json({ error: 'Invalid category.' });
      update.category = String(b.category);
    }
    if (b.lender != null) update.lender = String(b.lender).trim();
    if (b.name != null) update.name = String(b.name).trim();
    if (b.highlight != null) update.highlight = b.highlight ? String(b.highlight) : null;
    if (b.hook != null) update.hook = b.hook ? String(b.hook) : null;
    if (b.logo_text != null) update.logo_text = String(b.logo_text).trim();
    if (b.logo_class != null) update.logo_class = b.logo_class ? String(b.logo_class).trim() : null;
    if (b.logo_color != null) update.logo_color = b.logo_color ? String(b.logo_color).trim() : null;
    if (b.affiliate_link != null) update.affiliate_link = b.affiliate_link ? String(b.affiliate_link).trim() : null;
    if (b.min_score != null) update.min_score = (b.min_score === '') ? null : (parseInt(b.min_score, 10) || null);
    if (b.is_featured != null) update.is_featured = !!b.is_featured;
    if (b.is_published != null) update.is_published = !!b.is_published;
    if (b.sort_order != null) update.sort_order = parseInt(b.sort_order, 10) || 0;
    if (b.specs != null) {
      if (!isSpecsArray(b.specs)) return res.status(400).json({ error: 'specs must be an array of {label, val}.' });
      update.specs = b.specs;
    }
    const { data, error } = await supabaseAdmin.from('offers').update(update).eq('id', req.params.id).select('*').single();
    if (error) {
      if (error.code === 'PGRST116') return res.status(404).json({ error: 'Offer not found.' });
      return res.status(500).json({ error: error.message });
    }
    return res.json({ ok: true, offer: data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /api/offers/admin/:id — delete.
router.delete('/admin/:id', requireAdminSharedSecret, async function (req, res) {
  try {
    const { error } = await supabaseAdmin.from('offers').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/offers/admin/reorder — set sort_order from an id list.
router.post('/admin/reorder', requireAdminSharedSecret, async function (req, res) {
  try {
    const ids = (req.body && req.body.offer_ids) || [];
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'offer_ids array required.' });
    for (let i = 0; i < ids.length; i++) {
      const { error } = await supabaseAdmin
        .from('offers').update({ sort_order: i, updated_at: new Date().toISOString() }).eq('id', ids[i]);
      if (error) return res.status(500).json({ error: 'Reorder failed at index ' + i + ': ' + error.message });
    }
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
