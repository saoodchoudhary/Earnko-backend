const express = require('express');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const WebhookEvent = require('../models/WebhookEvent');
const Product = require('../models/Product');

const router = express.Router();

/**
 * Middleware: verify shared webhook secret.
 * Callers must supply the secret via:
 *   - HTTP header:  X-Webhook-Secret: <secret>
 *   - Query param:  ?secret=<secret>
 * Set WEBHOOK_SECRET in your environment variables.
 */
function requireWebhookSecret(req, res, next) {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) {
    // If no secret is configured, block all requests to prevent accidental exposure.
    console.error('[webhook] WEBHOOK_SECRET env variable is not set – refusing request');
    return res.status(503).json({ success: false, message: 'Webhook not configured' });
  }
  const provided = req.headers['x-webhook-secret'] || req.query.secret;
  if (!provided || provided !== secret) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  next();
}

/**
 * Generic conversion webhook
 * Accepts: userId, orderId, amount, commission, storeId?, productId?, clickId?
 * If productId present, prefer product.store as storeId, and store productId/categoryKey in trackingData.
 * Requires header: X-Webhook-Secret or query param: secret
 */
router.post('/conversion', requireWebhookSecret, async (req, res) => {
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