const express = require('express');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { auth } = require('../../middleware/auth');
const User = require('../../models/User');
const { buildDeeplink, getCampaigns } = require('../../services/cuelinks');

const router = express.Router();

// Limit deeplink generation to prevent abuse
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * POST /api/affiliate/cuelinks/deeplink
 * Minimal: body { url }
 * Auto-subid: u<userId>-<random> if not provided
 * Returns: { link, subid, shareUrl } where:
 *  - link: Cuelinks short/affiliate URL
 *  - subid: attribution id tied to user
 *  - shareUrl: backend wrapper to record clicks, then redirect to Cuelinks (recommended to share)
 */
router.post('/deeplink', auth, limiter, async (req, res) => {
  try {
    const { url, subid, channel_id, subid2, subid3, subid4, subid5 } = req.body || {};
    if (!url) return res.status(400).json({ success: false, message: 'url required' });

    // Auto-generate subid if not passed
    const rand = crypto.randomBytes(4).toString('hex');
    const finalSubid = subid || `u${req.user._id.toString()}-${rand}`;

    try {
      const link = await buildDeeplink({
        url,
        subid: finalSubid,
        channel_id,
        subid2, subid3, subid4, subid5
      });

      // Log into user's uniqueLinks for basic analytics (optional)
      await User.updateOne(
        { _id: req.user._id },
        { $push: { 'affiliateInfo.uniqueLinks': {
          store: null,
          customSlug: `cue-${rand}`,
          clicks: 0,
          conversions: 0,
          metadata: { cuelinks: { subid: finalSubid, url: link, rawUrl: url } },
          createdAt: new Date()
        } } }
      );

      const base = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 8080}`;
      const shareUrl = `${base}/api/links/open-cuelinks/${finalSubid}`;

      return res.json({ success: true, data: { link, subid: finalSubid, shareUrl } });
    } catch (err) {
      const msg = String(err.message || '').toLowerCase();
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
      return res.status(500).json({ success: false, message: err.message || 'Server error', body: err.body || undefined });
    }
  } catch (err) {
    console.error('cuelinks deeplink error', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
});

module.exports = router;