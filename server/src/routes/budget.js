// Budget API.
//
// The customer budget UI reads budget_* tables directly from the browser
// via Supabase RLS, so there's no customer-facing budget endpoint here.
// This route exists only for the ADMIN: a read of a given user's budget
// goals (admin-secret-gated, service-role), surfaced on the admin
// user-detail page. Mirrors the cross-service pattern used elsewhere.

const express = require('express');
const router = express.Router();
const requireAdminSharedSecret = require('../middleware/requireAdminSharedSecret');
const { supabaseAdmin } = require('../lib/supabase');

// GET /api/budget/admin/goals/:userId — a user's budget goals, with the
// category name joined, newest month first. For the admin user-detail
// "Budget goal" card.
router.get('/admin/goals/:userId', requireAdminSharedSecret, async function (req, res) {
  try {
    const userId = req.params.userId;

    const { data, error } = await supabaseAdmin
      .from('budget_goals')
      .select('id, month_start, target_cents, goal_type, category_id, created_at, budget_categories(name)')
      .eq('user_id', userId)
      .order('month_start', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    const goals = (data || []).map(function (g) {
      return {
        id: g.id,
        month_start: g.month_start,
        target_cents: g.target_cents,
        goal_type: g.goal_type,
        category_id: g.category_id,
        category_name: (g.budget_categories && g.budget_categories.name) || 'Unknown category',
      };
    });

    return res.json({ goals: goals });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
