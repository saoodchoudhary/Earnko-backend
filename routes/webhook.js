const express = require('express');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const WebhookEvent = require('../models/WebhookEvent');

const router = express.Router();

/**
 * Generic conversion webhook
 * Accepts: userId, orderId, amount, commission
 * Creates pending transaction and moves amount to pendingCashback
 */
router.post('/conversion', async (req, res) => {
  // Create event log first
  const event = await WebhookEvent.create({
    source: req.query.source || 'generic',
    eventType: 'conversion',
    headers: req.headers,
    payload: req.body,
    status: 'received'
  });

  try {
    const { userId, orderId, amount, commission, storeId, offerId } = req.body;
    if (!userId || !orderId) {
      await WebhookEvent.findByIdAndUpdate(event._id, { status: 'error', error: 'Missing params' });
      return res.status(400).json({ success:false, message:'Missing params' });
    }

    const tx = await Transaction.create({
      user: userId,
      orderId,
      amount: amount || 0,
      commissionAmount: commission || 0,
      store: storeId || null,
      // offerId mapping optional if your model supports
      status: 'pending'
    });

    await User.updateOne(
      { _id: userId },
      { $inc: { 'wallet.pendingCashback': commission || 0 } }
    );

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