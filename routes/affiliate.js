const express = require('express');
const { auth } = require('../middleware/auth');
const User = require('../models/User');
const Store = require('../models/Store');
const Click = require('../models/Click');
const { createAffiliateLink } = require('../services/linkifyService');
const shortid = require('shortid');

const router = express.Router();

// Create affiliate link from pasted URL
router.post('/link-from-url', auth, async (req, res) => {
  try {
    const { url, storeId } = req.body;
    if (!url) return res.status(400).json({ success:false, message: 'URL required' });
    const result = await createAffiliateLink({ user: req.user, url, storeId });
    res.json({ success:true, data: result });
  } catch (err) {
    console.error('link-from-url error', err);
    res.status(500).json({ success:false, message: 'Server error' });
  }
});

// Redirect by slug — when visitor clicks affiliate link
router.get('/redirect/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const userAgent = req.get('User-Agent');
    const ip = req.ip || req.connection.remoteAddress;

    const user = await User.findOne({ 'affiliateInfo.uniqueLinks.customSlug': slug });
    if (!user) return res.redirect(process.env.FRONTEND_URL || '/');

    const linkInfo = user.affiliateInfo.uniqueLinks.find(l => l.customSlug === slug);
    if (!linkInfo) return res.redirect(process.env.FRONTEND_URL || '/');

    // create click record
    const clickId = shortid.generate();
    const click = new Click({
      user: user._id,
      store: linkInfo.store || null,
      clickId,
      ipAddress: ip,
      userAgent,
      referrer: req.get('Referer'),
      customSlug: slug,
      affiliateLink: linkInfo.metadata?.generatedLink || linkInfo.metadata?.originalUrl || `${process.env.FRONTEND_URL}/redirect/${slug}`
    });
    await click.save();

    // increment stats
    user.affiliateInfo.uniqueLinks.id(linkInfo._id).clicks += 1;
    await user.save();
    if (linkInfo.store) await Store.findByIdAndUpdate(linkInfo.store, { $inc: { 'stats.totalClicks': 1 } });

    // set cookie for attribution
    const store = linkInfo.store ? await Store.findById(linkInfo.store) : null;
    const cookieDays = store?.cookieDuration || 30;
    res.cookie('earnko_clickId', clickId, { maxAge: cookieDays * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'Lax' });

    // If provider link exists (e.g., Cuelinks) redirect to provider's tracked link, else internal redirect to original product
    const target = linkInfo.metadata?.generatedLink || linkInfo.metadata?.originalUrl || `${process.env.FRONTEND_URL}/`;
    return res.redirect(target);
  } catch (err) {
    console.error('redirect error', err);
    return res.redirect(process.env.FRONTEND_URL || '/');
  }
});

module.exports = router;