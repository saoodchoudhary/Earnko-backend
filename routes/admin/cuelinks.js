const express = require('express');
const { auth } = require('../../middleware/auth');
const { requireRole } = require('../../middleware/roles');
const { buildDeeplink, getCampaigns } = require('../../services/cuelinks');

const router = express.Router();

/**
 * GET /api/admin/cuelinks/campaigns?search_term=nykaa&per_page=30
 * Proxy for campaign lookup (shows status, application_status)
 */
router.get('/campaigns', auth, requireRole('admin'), async (req, res) => {
  try {
    const { search_term = '', page = 1, per_page = 30, country_id, categories } = req.query;
    const data = await getCampaigns({ search_term, page: Number(page), per_page: Number(per_page), country_id, categories });
    res.json({ success: true, data });
  } catch (err) {
    console.error('admin cuelinks campaigns error', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
});

/**
 * POST /api/admin/cuelinks/validate-link
 * body: { url, channel_id?, subid? }
 * Validates a single URL with Cuelinks and returns short/affiliate link, or approval-needed code.
 */
router.post('/validate-link', auth, requireRole('admin'), async (req, res) => {
  try {
    const { url, channel_id, subid } = req.body || {};
    if (!url) return res.status(400).json({ success: false, message: 'url required' });
    try {
      const link = await buildDeeplink({ url, channel_id, subid });
      return res.json({ success: true, data: { link } });
    } catch (error) {
      const msg = String(error.message || '').toLowerCase();
      if (msg.includes('campaign needs approval')) {
        let host = '';
        try { host = new URL(url).hostname.replace(/^www\./, ''); } catch {}
        let suggestions = [];
        try {
          if (host) {
            const camp = await getCampaigns({ search_term: host, per_page: 30 });
            suggestions = camp?.campaigns || camp?.data || [];
          }
        } catch {}
        return res.status(409).json({
          success: false,
          code: 'campaign_approval_required',
          message: 'Campaign needs approval. Apply in Cuelinks.',
          data: { host, suggestions }
        });
      }
      return res.status(500).json({ success: false, message: error.message || 'Server error', body: error.body || undefined });
    }
  } catch (err) {
    console.error('admin cuelinks validate-link error', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
});

module.exports = router;