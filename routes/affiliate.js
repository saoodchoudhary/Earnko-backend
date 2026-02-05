const express = require('express');
const { auth } = require('../middleware/auth');
const User = require('../models/User');
const Store = require('../models/Store');
const Click = require('../models/Click');
const { createAffiliateLinkStrict } = require('../services/linkifyService');
const shortid = require('shortid');

const trackier = require('../services/affiliateNetwork/trackier');
const extrape = require('../services/affiliateNetwork/extrape');
const { buildDeeplink: buildCuelinksDeeplink } = require('../services/cuelinks');

const router = express.Router();

// UNIVERSAL: Create affiliate link from pasted URL (STRICT)
// Returns shareUrl (Earnko redirect)
router.post('/link-from-url', auth, async (req, res) => {
  try {
    const { url, storeId } = req.body;
    if (!url) return res.status(400).json({ success: false, message: 'URL required' });

    const user = await User.findById(req.user?._id);
    if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const result = await createAffiliateLinkStrict({ user, url, storeId });
    return res.json({ success: true, data: result });
  } catch (err) {
    return res.status(500).json({ success: false, code: err.code || 'error', message: err.message || 'Server error' });
  }
});

// UNIVERSAL BULK: Create multiple shareUrls (STRICT)
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
        results.push({ inputUrl, success: false, code: err.code || 'error', message: err.message || 'Failed' });
      }
    }

    return res.json({ success: true, data: { results } });
  } catch {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Redirect by slug — creates ClickId and embeds into provider link
router.get('/redirect/:slug', async (req, res) => {
  try {
    const slug = req.params.slug;

    const user = await User.findOne({ 'affiliateInfo.uniqueLinks.customSlug': slug });
    if (!user) return res.redirect(process.env.FRONTEND_URL || '/');

    const linkInfo = user.affiliateInfo.uniqueLinks.find(l => l.customSlug === slug);
    if (!linkInfo) return res.redirect(process.env.FRONTEND_URL || '/');

    const provider = linkInfo.metadata?.provider || 'cuelinks';
    const destinationUrl =
      linkInfo.metadata?.providerSafeUrl ||
      linkInfo.metadata?.resolvedUrl ||
      linkInfo.metadata?.originalUrl;

    if (!destinationUrl) return res.redirect(process.env.FRONTEND_URL || '/');

    // Create click id
    const clickId = shortid.generate();

    // Record click
    await Click.create({
      clickId,
      user: user._id,
      store: linkInfo.store || null,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      referrer: req.get('referer') || null,
      customSlug: slug,
      affiliateLink: null,
      metadata: { provider, destinationUrl }
    });

    // Cookie (optional)
    const store = linkInfo.store ? await Store.findById(linkInfo.store) : null;
    const cookieDays = store?.cookieDuration || 30;
    res.cookie('earnko_clickId', clickId, {
      maxAge: cookieDays * 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: 'Lax'
    });

    // Build provider deeplink with clickId embedded (CRITICAL)
    let target = destinationUrl;

    if (provider === 'extrape') {
      const affid = process.env.EXTRAPE_AFFID || 'adminnxtify';
      const affExtParam1 = process.env.EXTRAPE_AFF_EXT_PARAM1 || 'EPTG2738645';

      target = extrape.buildAffiliateLink({
        originalUrl: destinationUrl,
        affid,
        affExtParam1,
        subid: clickId
      }).url;
    } else if (provider === 'trackier') {
      const campaignId = linkInfo.metadata?.campaignId || '';
      const adnParams = { click_id: clickId, p1: clickId, p2: slug };

      target = (await trackier.buildDeeplink({
        url: destinationUrl,
        campaignId,
        adnParams,
        encodeURL: false
      })).url;
    } else {
      // cuelinks default
      target = await buildCuelinksDeeplink({ url: destinationUrl, subid: clickId });
    }

    await Click.updateOne({ clickId }, { $set: { affiliateLink: target } });

    return res.redirect(target);
  } catch (err) {
    console.error('redirect error', err);
    return res.redirect(process.env.FRONTEND_URL || '/');
  }
});

module.exports = router;