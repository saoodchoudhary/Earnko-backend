const express = require('express');
const router = express.Router();
const commissionService = require('../services/commissionService');
const Transaction = require('../models/Transaction');

// POST /api/webhooks/cuelinks
router.post('/cuelinks', express.json({ type: '*/*' }), async (req, res) => {
  try {
    // TODO: verify signature if Cuelinks sends one
    const payload = req.body;
    // Map payload fields to your Transaction model
    // Example mapping (adjust per real payload)
    const orderId = payload.order_id || payload.orderId || payload.id;
    const status = payload.status || 'pending';
    const amount = parseFloat(payload.order_value || payload.amount || 0);
    const commissionAmount = parseFloat(payload.commission || payload.commission_amount || 0);

    if (!orderId) return res.status(400).json({ success:false, message: 'No order id' });

    // Upsert transaction
    let tx = await Transaction.findOne({ orderId });
    if (!tx) {
      tx = new Transaction({
        orderId,
        orderDate: payload.order_date ? new Date(payload.order_date) : new Date(),
        productAmount: amount,
        commissionAmount: commissionAmount || undefined,
        status,
        trackingData: payload
      });
      await tx.save();
    } else {
      tx.status = status;
      tx.productAmount = amount;
      tx.trackingData = payload;
      await tx.save();
    }

    // If confirmed -> process commission
    if (status === 'confirmed') {
      await commissionService.processTransaction(tx._id);
    }

    res.json({ success:true });
  } catch (err) {
    console.error('webhook error', err);
    res.status(500).json({ success:false, message: 'Server error' });
  }
});

module.exports = router;