const express = require('express');
const { auth } = require('../middleware/auth');
const AffiliatePayout = require('../models/AffiliatePayout');
const User = require('../models/User');

const router = express.Router();

// Wallet summary (now includes requestedAmount = sum of pending/approved)
router.get('/me', auth, async (req, res) => {
  try {
    const payouts = await AffiliatePayout.find({ affiliate: req.user._id }).sort({ createdAt: -1 }).lean();
    const requestedAmount = payouts
      .filter(p => p.status === 'pending' || p.status === 'approved')
      .reduce((sum, p) => sum + (p.amount || 0), 0);

    res.json({
      success: true,
      data: {
        wallet: req.user.wallet,
        payouts,
        requestedAmount
      }
    });
  } catch (err) {
    console.error('Wallet summary error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Request withdrawal (bank/upi) — consistent with AffiliatePayout schema
router.post('/withdraw', auth, async (req, res) => {
  try {
    const { amount, method = 'bank', upiId, bank } = req.body;
    const amt = Number(amount);
    if (!amt || amt <= 0) return res.status(400).json({ success: false, message: 'Invalid amount' });

    const minAmount = Number(process.env.MIN_PAYOUT_AMOUNT || 1);
    if (amt < minAmount) return res.status(400).json({ success: false, message: `Minimum withdrawal is ₹${minAmount}` });

    const available = req.user.wallet?.availableBalance || 0;
    if (available < amt) return res.status(400).json({ success: false, message: 'Insufficient balance' });

    let methodDetails = null;
    if (method === 'upi') {
      if (!upiId) return res.status(400).json({ success: false, message: 'UPI ID required' });
      methodDetails = { upiId };
    } else if (method === 'bank') {
      const b = bank || {};
      if (!b.holderName || !b.accountNumber || !b.ifsc || !b.bankName) {
        return res.status(400).json({ success: false, message: 'Complete bank details required' });
      }
      methodDetails = { bank: b };
    } else {
      methodDetails = req.body.methodDetails || null;
    }

    const payout = await AffiliatePayout.create({
      affiliate: req.user._id,  // FIX: field name
      amount: amt,
      method,
      methodDetails,
      status: 'pending'          // FIX: valid enum
    });

    // Lock funds
    await User.updateOne(
      { _id: req.user._id },
      { $inc: { 'wallet.availableBalance': -amt } }
    );

    res.status(201).json({ success: true, data: { payout } });
  } catch (err) {
    console.error('Withdraw request error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;