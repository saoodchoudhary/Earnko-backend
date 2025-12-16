const express = require('express');
const User = require('../models/User');
const Click = require('../models/Click');
const Commission = require('../models/Commission');
const Store = require('../models/Store');

const router = express.Router();

/**
 * Redirect handler: /api/tracking/redirect/:slug
 * - Finds user unique link by slug
 * - Records a click
 * - Redirects to store baseUrl with any deeplink rules (simplified)
 */
router.get('/redirect/:slug', async (req, res) => {
  try {
    const slug = req.params.slug;
    const user = await User.findOne({ 'affiliateInfo.uniqueLinks.customSlug': slug }).lean();
    if (!user) return res.status(404).json({ success:false, message:'Link not found' });

    const link = user.affiliateInfo.uniqueLinks.find(l => l.customSlug === slug);
    const store = await Store.findById(link.store);
    const offerId = link.metadata?.offerId;
    const offer = offerId ? await Commission.findById(offerId) : null;

    // Record click
    await Click.create({
      user: user._id,
      store: store?._id,
      offer: offer?._id || null,
      slug,
      userAgent: req.get('user-agent'),
      ip: req.ip,
      referer: req.get('referer') || null
    });

    // Increment click counter
    await User.updateOne(
      { _id: user._id, 'affiliateInfo.uniqueLinks.customSlug': slug },
      { $inc: { 'affiliateInfo.uniqueLinks.$.clicks': 1 } }
    );

    // Construct destination URL (simplified: use store.baseUrl; in real scenario use deeplink template)
    const destination = store?.baseUrl || offer?.deeplinkTemplate || (process.env.FRONTEND_URL || 'http://localhost:3000');

    return res.redirect(destination);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success:false, message:'Server error' });
  }
});

module.exports = router;