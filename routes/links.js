const express = require('express');
const { auth } = require('../middleware/auth');
const User = require('../models/User');
const Commission = require('../models/Commission');
const Store = require('../models/Store');
const crypto = require('crypto');

const router = express.Router();

/**
 * Generate a trackable link for a user and offer (commission)
 * Expects: offerId
 * Returns: url with unique code (shortCode)
 */
router.post('/generate', auth, async (req, res) => {
  try {
    const { offerId } = req.body;
    const offer = await Commission.findById(offerId).populate('store');
    if (!offer) return res.status(404).json({ success:false, message:'Offer not found' });

    const shortCode = crypto.randomBytes(4).toString('hex'); // 8-char code
    const customSlug = `${req.user._id.toString().slice(-6)}-${shortCode}`;
    // Save into user.affiliateInfo.uniqueLinks
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

    // Construct redirect URL where backend will record click and redirect to store/offer destination
    const trackingBase = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 8080}`;
    const redirectUrl = `${trackingBase}/api/tracking/redirect/${customSlug}`;

    res.status(201).json({ success:true, data: { link: { code: customSlug, url: redirectUrl, offer, store: offer.store } } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success:false, message:'Server error' });
  }
});

module.exports = router;