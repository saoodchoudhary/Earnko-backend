const express = require('express');
const { auth } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const User = require('../models/User');
const Commission = require('../models/Commission');
const Store = require('../models/Store');
const Product = require('../models/Product');
const Click = require('../models/Click');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { buildDeeplink, getCampaigns } = require('../services/cuelinks');

const router = express.Router();

/**
 * Generate a trackable link for an offer
 * Restrict to affiliates (optional)
 */
router.post('/generate', auth, requireRole('affiliate'), async (req, res) => {
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
 * Generate a trackable link for a product
 * Restrict to affiliates (optional)
 */
router.post('/generate-product', auth, requireRole('affiliate'), async (req, res) => {
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
 * Restrict to affiliates (optional)
 */
router.post('/generate-cuelinks-product', auth, requireRole('affiliate'), async (req, res) => {
  try {
    const { productId, channel_id, subid2, subid3, subid4, subid5 } = req.body || {};
    const product = await Product.findById(productId).populate('store');
    if (!product || !product.isActive) return res.status(404).json({ success:false, message:'Product not found' });

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

/**
 * Cuelinks share wrapper: /api/links/open-cuelinks/:subid
 * Records a Click (clickId = subid) attributed to the user derived from subid (u<userId>-<rand>),
 * increments user's uniqueLinks clicks count, and redirects to the stored Cuelinks URL.
 */
router.get('/open-cuelinks/:subid', async (req, res) => {
  try {
    const subid = req.params.subid;
    if (!subid) return res.redirect(process.env.FRONTEND_URL || 'http://localhost:3000');

    // Parse userId from subid pattern u<userId>-<rand>
    let userId = null;
    const m = /^u([a-f0-9]{24})-/i.exec(subid);
    if (m && mongoose.Types.ObjectId.isValid(m[1])) {
      userId = new mongoose.Types.ObjectId(m[1]);
    }

    // Find the user and the unique link entry corresponding to this subid
    let destination = null;
    if (userId) {
      const user = await User.findById(userId).lean();
      if (user && Array.isArray(user.affiliateInfo?.uniqueLinks)) {
        const entry = user.affiliateInfo.uniqueLinks.find(l => l?.metadata?.cuelinks?.subid === subid);
        destination = entry?.metadata?.cuelinks?.url || null;

        // Increment clicks count for the entry
        if (entry) {
          await User.updateOne(
            { _id: userId, 'affiliateInfo.uniqueLinks.metadata.cuelinks.subid': subid },
            { $inc: { 'affiliateInfo.uniqueLinks.$.clicks': 1 } }
          );
        }

        // Record a Click (generic)
        await Click.create({
          clickId: subid,
          user: userId,
          store: entry?.store || null,
          product: entry?.metadata?.productId || null,
          slug: entry?.customSlug || null,
          userAgent: req.get('user-agent'),
          ip: req.ip,
          referer: req.get('referer') || null
        });
      }
    }

    // Fallback: if destination unknown, go to frontend
    const target = destination || (process.env.FRONTEND_URL || 'http://localhost:3000');
    return res.redirect(target);
  } catch (err) {
    console.warn('open-cuelinks error', err);
    return res.redirect(process.env.FRONTEND_URL || 'http://localhost:3000');
  }
});

module.exports = router;