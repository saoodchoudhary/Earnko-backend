const express = require('express');
const crypto = require('crypto');
const User = require('../models/User');
const Click = require('../models/Click');
const Commission = require('../models/Commission');
const Store = require('../models/Store');
const Product = require('../models/Product');

const router = express.Router();

/**
 * Redirect handler: /api/tracking/redirect/:slug
 * - Finds user unique link by slug
 * - Records a click (with required clickId)
 * - Redirects to product.deeplink (if present) otherwise store baseUrl
 */
router.get('/redirect/:slug', async (req, res) => {
  try {
    const slug = req.params.slug;
    const user = await User.findOne({ 'affiliateInfo.uniqueLinks.customSlug': slug }).lean();
    if (!user) return res.status(404).json({ success:false, message:'Link not found' });

    const link = user.affiliateInfo.uniqueLinks.find(l => l.customSlug === slug);
    const store = await Store.findById(link.store);
    const offerId = link.metadata?.offerId;
    const productId = link.metadata?.productId;

    let product = null;
    if (productId) product = await Product.findById(productId).lean();
    const offer = offerId ? await Commission.findById(offerId) : null;

    // Generate a required clickId for the Click document
    const clickId = crypto.randomBytes(8).toString('hex');

    // Record click
    await Click.create({
      clickId,                      // REQUIRED by your schema
      user: user._id,
      store: store?._id,
      offer: offer?._id || null,
      product: product?._id || null, // If your schema has 'product'; if not, Mongoose will ignore
      slug,
      userAgent: req.get('user-agent'),
      ip: req.ip,
      referer: req.get('referer') || null
    });

    // Increment click counter on the user link
    await User.updateOne(
      { _id: user._id, 'affiliateInfo.uniqueLinks.customSlug': slug },
      { $inc: { 'affiliateInfo.uniqueLinks.$.clicks': 1 } }
    );

    // Make clickId available to your frontend or affiliate network (optional)
    // 1) Set a cookie for your domain so later you can attach it in webhook:
    res.cookie('ek_click', clickId, {
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      httpOnly: false,
      sameSite: 'lax'
    });

    // 2) If you use an affiliate network deeplink, you should append the clickId as a subId parameter there.

    // Destination: prefer product.deeplink, else store.baseUrl, else frontend home
    const destination =
      (product && product.deeplink) ||
      store?.baseUrl ||
      (process.env.FRONTEND_URL || 'http://localhost:3000');

    return res.redirect(destination);
  } catch (err) {
    console.warn(err);
    res.status(500).json({ success:false, message:'Server error' });
  }
});

module.exports = router;