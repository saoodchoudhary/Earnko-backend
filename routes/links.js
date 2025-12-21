const express = require('express');
const { auth } = require('../middleware/auth');
const User = require('../models/User');
const Commission = require('../models/Commission');
const Store = require('../models/Store');
const Product = require('../models/Product');
const crypto = require('crypto');
const { buildDeeplink, getCampaigns } = require('../services/cuelinks');

const router = express.Router();

/**
 * Generate a trackable link for an offer (existing)
 * Expects: offerId
 */
router.post('/generate', auth, async (req, res) => {
  try {
    const { offerId } = req.body;
    const offer = await Commission.findById(offerId).populate('store');
    if (!offer) return res.status(404).json({ success:false, message:'Offer not found' });

    const shortCode = crypto.randomBytes(4).toString('hex'); // 8-char code
    const customSlug = `${req.user._id.toString().slice(-6)}-${shortCode}`;

    await User.updateOne(
      { _id: req.user._id },
      { $push: { 'affiliateInfo.uniqueLinks': {
        store: offer.store._id,
        customSlug,
        clicks: 0,
        conversions: 0,
        metadata: { offerId },
        createdAt: new Date()
      } } }
    );

    const trackingBase = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 8080}`;
    const redirectUrl = `${trackingBase}/api/tracking/redirect/${customSlug}`;

    res.status(201).json({ success:true, data: { link: { code: customSlug, url: redirectUrl, offer, store: offer.store } } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success:false, message:'Server error' });
  }
});

/**
 * Generate a trackable link for a product (existing from earlier work)
 * Expects: productId
 */
router.post('/generate-product', auth, async (req, res) => {
  try {
    const { productId } = req.body;
    const product = await Product.findById(productId).populate('store');
    if (!product || !product.isActive) return res.status(404).json({ success:false, message:'Product not found' });

    const shortCode = crypto.randomBytes(4).toString('hex');
    const customSlug = `${req.user._id.toString().slice(-6)}-${shortCode}`;

    await User.updateOne(
      { _id: req.user._id },
      { $push: { 'affiliateInfo.uniqueLinks': {
        store: product.store._id,
        customSlug,
        clicks: 0,
        conversions: 0,
        metadata: { productId: product._id, storeId: product.store._id },
        createdAt: new Date()
      } } }
    );

    const trackingBase = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 8080}`;
    const redirectUrl = `${trackingBase}/api/tracking/redirect/${customSlug}`;

    res.status(201).json({ success:true, data: { link: { code: customSlug, url: redirectUrl, product, store: product.store } } });
  } catch (err) {
    console.error('generate-product error', err);
    res.status(500).json({ success:false, message:'Server error' });
  }
});

/**
 * Generate a Cuelinks deeplink for a product
 * Expects: productId, optional channel_id
 * Returns: short (or affiliate) URL from Cuelinks.
 * - Uses subid 'u<userId>-<random>' so conversions attribute to the user.
 * - If campaign needs approval, returns 409 with suggestions for that host.
 */
router.post('/generate-cuelinks-product', auth, async (req, res) => {
  try {
    const { productId, channel_id, subid2, subid3, subid4, subid5 } = req.body || {};
    const product = await Product.findById(productId).populate('store');
    if (!product || !product.isActive) return res.status(404).json({ success:false, message:'Product not found' });

    // Build subid: u<userId>-<random>
    const rand = crypto.randomBytes(4).toString('hex');
    const subid = `u${req.user._id.toString()}-${rand}`;

    let link;
    try {
      link = await buildDeeplink({
        url: product.deeplink,
        subid,
        channel_id,
        subid2, subid3, subid4, subid5
      });
    } catch (err) {
      const msg = String(err.message || '').toLowerCase();
      if (msg.includes('campaign needs approval')) {
        // Suggest campaigns matching the product host
        let host = '';
        try { host = new URL(product.deeplink).hostname.replace(/^www\./, ''); } catch {}
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
          message: 'Campaign needs approval. Apply in Cuelinks dashboard.',
          data: { suggestions, host }
        });
      }
      throw err;
    }

    // Optionally store a record in uniqueLinks for analytics
    await User.updateOne(
      { _id: req.user._id },
      { $push: { 'affiliateInfo.uniqueLinks': {
        store: product.store?._id || null,
        customSlug: `cue-${rand}`,
        clicks: 0,
        conversions: 0,
        metadata: { productId: product._id, cuelinks: { subid, url: link } },
        createdAt: new Date()
      } } }
    );

    return res.json({ success: true, data: { link, subid } });
  } catch (err) {
    console.error('generate-cuelinks-product error', err);
    return res.status(500).json({ success:false, message: err.message || 'Server error' });
  }
});

module.exports = router;