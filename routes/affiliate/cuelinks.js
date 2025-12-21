const express = require('express');
const { auth } = require('../../middleware/auth');
const { buildDeeplink, getCampaigns } = require('../../services/cuelinks');
const urlLib = require('url');

const router = express.Router();

/**
 * POST /api/affiliate/cuelinks/deeplink
 * body: { url, subid?, channel_id?, subid2?, subid3?, subid4?, subid5? }
 */
router.post('/deeplink', auth, async (req, res) => {
  try {
    const { url, subid, channel_id, subid2, subid3, subid4, subid5 } = req.body || {};
    if (!url) return res.status(400).json({ success: false, message: 'url required' });

    try {
      const link = await buildDeeplink({ url, subid, channel_id, subid2, subid3, subid4, subid5 });
      return res.json({ success: true, data: { link } });
    } catch (err) {
      const msg = String(err.message || '').toLowerCase();
      // If campaign needs approval, try to help with suggestions
      if (msg.includes('campaign needs approval')) {
        // Extract hostname to use as search_term
        let host = '';
        try {
          const u = new URL(url);
          host = u.hostname.replace(/^www\./, '');
        } catch {}
        let suggestions = [];
        try {
          if (host) {
            const camp = await getCampaigns({ search_term: host, per_page: 30 });
            // Respond raw; UI can read fields like name/id/status/application_status
            suggestions = camp?.campaigns || camp?.data || [];
          }
        } catch (e) {
          // ignore suggestion failures
        }
        return res.status(409).json({
          success: false,
          code: 'campaign_approval_required',
          message: 'Campaign needs approval. Apply for this merchant in your Cuelinks dashboard.',
          data: { suggestions, host }
        });
      }
      // Other Cuelinks errors
      return res.status(500).json({ success: false, message: err.message || 'Server error', body: err.body || undefined });
    }
  } catch (err) {
    console.error('cuelinks deeplink route error', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
});

module.exports = router;