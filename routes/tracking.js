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
 * - If link already has metadata.generatedLink (provider), redirect to it (recommended)
 * - Else builds a Cuelinks deeplink with subid=clickId and redirects
 * - Falls back to product/store URL if Cuelinks returns error
 */
router.get('/redirect/:slug', async (req, res) => {
  try {
    const slug = req.params.slug;
    const user = await User.findOne({ 'affiliateInfo.uniqueLinks.customSlug': slug }).lean();
    if (!user) return res.status(404).json({ success:false, message:'Link not found' });

    const link = user.affiliateInfo.uniqueLinks.find(l => l.customSlug === slug);
    const store = link?.store ? await Store.findById(link.store).lean() : null;

    const clickId = crypto.randomBytes(6).toString('hex');

    // record click
    await Click.create({
      clickId,
      user: user._id,
      store: link?.store || null,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      referrer: req.get('referer') || null,
      customSlug: slug,
      affiliateLink: link?.metadata?.generatedLink || null,
      metadata: {
        provider: link?.metadata?.provider || null
      }
    });

    // Prefer stored provider-generated link (works for vcommission/cuelinks/internal)
    const storedProviderLink = link?.metadata?.generatedLink;
    if (storedProviderLink) return res.redirect(storedProviderLink);

    // fallback destination
    const product = link?.metadata?.productId ? await Product.findById(link.metadata.productId).lean() : null;
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