const express = require('express');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const Click = require('../models/Click');
const WebhookEvent = require('../models/WebhookEvent');
const Product = require('../models/Product');

const router = express.Router();

const MAX_COMMISSION = 50000; // ₹50,000 sanity cap — same limit used in routes/webhooks/{cuelinks,extrape,realcash,trackier}.js

function parseStrictNumber(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const webhookRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests' }
});

/**
 * Generic conversion webhook
 * Accepts: userId, orderId, amount, commission, storeId?, productId?, clickId?
 * If productId present, prefer product.store as storeId, and store productId/categoryKey in trackingData.
 *
 * Security controls:
 *  - commission capped at MAX_COMMISSION; negative values rejected
 *  - userId must reference an existing, non-blocked user
 *  - clickId (required) must exist in the Click collection and belong to that userId
 */
router.post('/conversion', webhookRateLimit, async (req, res) => {
  const event = await WebhookEvent.create({
    source: req.query.source || 'generic',
    eventType: 'conversion',
    headers: req.headers,
    payload: req.body,
    status: 'received'
  });

  try {
    let { userId, orderId, amount, commission, storeId, productId, clickId } = req.body;

    if (!userId || !orderId) {
      await WebhookEvent.findByIdAndUpdate(event._id, { status: 'error', error: 'Missing params' });
      return res.status(400).json({ success: false, message: 'Missing params' });
    }

    // clickId is required to prevent transactions being injected without a real click trail
    if (!clickId) {
      await WebhookEvent.findByIdAndUpdate(event._id, { status: 'error', error: 'clickId is required' });
      return res.status(400).json({ success: false, message: 'clickId is required' });
    }

    // Validate userId is a well-formed ObjectId before any DB lookup
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      await WebhookEvent.findByIdAndUpdate(event._id, { status: 'error', error: 'Invalid userId' });
      return res.status(400).json({ success: false, message: 'Invalid userId' });
    }

    const commissionNum = parseStrictNumber(commission);
    const amountNum = parseStrictNumber(amount);

    if (commissionNum === null || amountNum === null) {
      await WebhookEvent.findByIdAndUpdate(event._id, { status: 'error', error: 'amount and commission must be numeric' });
      return res.status(400).json({ success: false, message: 'amount and commission must be numeric' });
    }

    // Validate commission amount
    if (commissionNum < 0 || commissionNum > MAX_COMMISSION) {
      await WebhookEvent.findByIdAndUpdate(event._id, { status: 'error', error: 'Commission amount out of allowed range' });
      return res.status(400).json({ success: false, message: 'Commission amount out of allowed range' });
    }

    // Validate that userId refers to a real, active user
    const user = await User.findById(userId).select('_id accountStatus').lean();
    if (!user) {
      await WebhookEvent.findByIdAndUpdate(event._id, { status: 'error', error: 'User not found' });
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    if (user.accountStatus === 'blocked') {
      await WebhookEvent.findByIdAndUpdate(event._id, { status: 'error', error: 'User account is blocked' });
      return res.status(403).json({ success: false, message: 'User account is blocked' });
    }

    // Validate that clickId exists and belongs to this user
    const click = await Click.findOne({ clickId: String(clickId) }).select('user').lean();
    if (!click) {
      await WebhookEvent.findByIdAndUpdate(event._id, { status: 'error', error: 'clickId not found' });
      return res.status(404).json({ success: false, message: 'clickId not found' });
    }
    // click.user must be present and match the provided userId
    if (!click.user || String(click.user) !== String(user._id)) {
      await WebhookEvent.findByIdAndUpdate(event._id, { status: 'error', error: 'clickId does not belong to this user' });
      return res.status(403).json({ success: false, message: 'clickId does not belong to this user' });
    }

    let product = null;
    if (productId) {
      product = await Product.findById(productId).lean();
      if (product && product.store) {
        storeId = storeId || product.store.toString();
      }
    }

    const tx = await Transaction.create({
      user: userId,
      orderId,
      amount: amountNum,
      commissionAmount: commissionNum,
      store: storeId || null,
      clickId,
      status: 'pending',
      trackingData: {
        productId: product?._id || null,
        categoryKey: product?.categoryKey || null
      }
    });

    if (commissionNum > 0) {
      await User.updateOne({ _id: userId }, { $inc: { 'wallet.pendingCashback': commissionNum } });
    }

    await WebhookEvent.findByIdAndUpdate(event._id, {
      status: 'processed',
      processedAt: new Date(),
      transaction: tx._id
    });

    res.status(201).json({ success: true, data: { conversion: tx } });
  } catch (err) {
    console.error(err);
    await WebhookEvent.findByIdAndUpdate(event._id, { status: 'error', error: err.message || 'Server error' });
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
