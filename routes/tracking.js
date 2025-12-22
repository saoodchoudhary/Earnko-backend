const express = require('express');
const crypto = require('crypto');
const User = require('../models/User');
const Click = require('../models/Click');
const Store = require('../models/Store');
const Product = require('../models/Product');
const { buildDeeplink } = require('../services/cuelinks');

const router = express.Router();

/**
 * Redirect handler: /api/tracking/redirect/:slug
 * - Finds user unique link by slug
 * - Records a click with a required clickId
 * - Builds a Cuelinks deeplink with subid=clickId and redirects
 * - Falls back to product/store URL if Cuelinks returns error
 */
router.get('/redirect/:slug', async (req, res) => {
  try {
    const slug = req.params.slug;
    const user = await User.findOne({ 'affiliateInfo.uniqueLinks.customSlug': slug }).lean();
    if (!user) return res.status(404).json({ success:false, message:'Link not found' });

    const link = user.affiliateInfo.uniqueLinks.find(l => l.customSlug === slug);
    const store = await Store.findById(link.store);
    const productId = link.metadata?.productId;

    const product = productId ? await Product.findById(productId).lean() : null;

    // required clickId
    const clickId = crypto.randomBytes(8).toString('hex');

    await Click.create({
      clickId,
      user: user._id,
      store: store?._id || null,
      product: product?._id || null,
      slug,
      userAgent: req.get('user-agent'),
      ip: req.ip,
      referer: req.get('referer') || null
    });

    // increment user link clicks
    await User.updateOne(
      { _id: user._id, 'affiliateInfo.uniqueLinks.customSlug': slug },
      { $inc: { 'affiliateInfo.uniqueLinks.$.clicks': 1 } }
    );

    // set cookie for debugging/local attribution
    res.cookie('ek_click', clickId, { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: false, sameSite: 'lax' });

    // destination fallback
    const destination = (product && product.deeplink) || store?.baseUrl || (process.env.FRONTEND_URL || 'http://localhost:3000');

    // try Cuelinks deeplink with subid = clickId
    let affiliateUrl = destination;
    try {
      affiliateUrl = await buildDeeplink({ url: destination, subid: clickId });
    } catch (e) {
      console.warn('Cuelinks deeplink failed, fallback to destination:', e.message);
    }

    return res.redirect(affiliateUrl);
  } catch (err) {
    console.warn('tracking redirect error', err);
    res.status(500).json({ success:false, message:'Server error' });
  }
});

module.exports = router;