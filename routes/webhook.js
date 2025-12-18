const express = require('express');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const WebhookEvent = require('../models/WebhookEvent');
const Product = require('../models/Product');

const router = express.Router();

/**
 * Generic conversion webhook
 * Accepts: userId, orderId, amount, commission, storeId?, productId?, clickId?
 * If productId present, prefer product.store as storeId, and store productId/categoryKey in trackingData.
 */
router.post('/conversion', async (req, res) => {
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
      return res.status(400).json({ success:false, message:'Missing params' });
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
      amount: amount || 0,
      commissionAmount: commission || 0, // can be recomputed by service
      store: storeId || null,
      clickId: clickId || null,          // store clickId to attribute affiliate later
      status: 'pending',
      trackingData: {
        productId: product?._id || null,
        categoryKey: product?.categoryKey || null
      }
    });

    if (commission) {
      await User.updateOne({ _id: userId }, { $inc: { 'wallet.pendingCashback': commission } });
    }

    await WebhookEvent.findByIdAndUpdate(event._id, {
      status: 'processed',
      processedAt: new Date(),
      transaction: tx._id
    });

    res.status(201).json({ success:true, data: { conversion: tx } });
  } catch (err) {
    console.error(err);
    await WebhookEvent.findByIdAndUpdate(event._id, { status: 'error', error: err.message || 'Server error' });
    res.status(500).json({ success:false, message: 'Server error' });
  }
});

module.exports = router;