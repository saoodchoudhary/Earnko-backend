const express = require('express');
const { auth } = require('../middleware/auth');
const User = require('../models/User');
const Store = require('../models/Store');
const Click = require('../models/Click');
const { createAffiliateLinkStrict } = require('../services/linkifyService');
const shortid = require('shortid');

const router = express.Router();

// UNIVERSAL: Create affiliate link from pasted URL (STRICT)
router.post('/link-from-url', auth, async (req, res) => {
  try {
    const { url, storeId } = req.body;
    if (!url) return res.status(400).json({ success: false, message: 'URL required' });

    const user = await User.findById(req.user?._id);
    if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const result = await createAffiliateLinkStrict({ user, url, storeId });
    return res.json({ success: true, data: result });
  } catch (err) {
    const code = err.code || 'error';

    if (code === 'campaign_approval_required') {
      return res.status(409).json({ success: false, code, message: err.message || 'Campaign approval required' });
    }
    if (code === 'trackier_invalid_key') {
      return res.status(401).json({ success: false, code, message: 'Trackier API key invalid' });
    }
    if (code === 'trackier_forbidden') {
      return res.status(403).json({ success: false, code, message: 'Trackier forbidden / no permission' });
    }
    if (code === 'missing_campaign_id') {
      return res.status(400).json({ success: false, code, message: err.message || 'Missing campaign id' });
    }
    if (code === 'missing_extrape_affid') {
      return res.status(400).json({ success: false, code, message: 'Missing EXTRAPE_AFFID' });
    }
    if (code === 'missing_subid') {
      return res.status(400).json({ success: false, code, message: 'Missing subid' });
    }

    return res.status(500).json({ success: false, code, message: err.message || 'Server error' });
  }
});

// UNIVERSAL BULK: Create multiple links (STRICT, max 25)
router.post('/link-from-url/bulk', auth, async (req, res) => {
  try {
    const urls = Array.isArray(req.body?.urls) ? req.body.urls : [];
    const MAX = 25;
    const slice = urls.slice(0, MAX);

    const user = await User.findById(req.user?._id);
    if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const results = [];
    for (const inputUrl of slice) {
      try {
        const data = await createAffiliateLinkStrict({ user, url: inputUrl, storeId: null });
        results.push({ inputUrl, success: true, data });
      } catch (err) {
        results.push({
          inputUrl,
          success: false,
          code: err.code || 'error',
          message: err.message || 'Failed'
        });
      }
    }

    return res.json({ success: true, data: { results } });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Redirect by slug — when visitor clicks affiliate link
router.get('/redirect/:slug', async (req, res) => {
  try {
    const slug = req.params.slug;
    const user = await User.findOne({ 'affiliateInfo.uniqueLinks.customSlug': slug });
    if (!user) return res.redirect(process.env.FRONTEND_URL || '/');

    const linkInfo = user.affiliateInfo.uniqueLinks.find(l => l.customSlug === slug);
    if (!linkInfo) return res.redirect(process.env.FRONTEND_URL || '/');

    // record click
    const clickId = shortid.generate();
    await Click.create({
      clickId,
      user: user._id,
      store: linkInfo.store || null,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      referrer: req.get('referer') || null,
      customSlug: slug,
      affiliateLink: linkInfo.metadata?.generatedLink || null
    });

    // set cookie for attribution
    const store = linkInfo.store ? await Store.findById(linkInfo.store) : null;
    const cookieDays = store?.cookieDuration || 30;
    res.cookie('earnko_clickId', clickId, { maxAge: cookieDays * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'Lax' });

    const target = linkInfo.metadata?.generatedLink;
    if (!target) return res.redirect(process.env.FRONTEND_URL || '/');

    return res.redirect(target);
  } catch (err) {
    console.error('redirect error', err);
    return res.redirect(process.env.FRONTEND_URL || '/');
  }
});

module.exports = router;