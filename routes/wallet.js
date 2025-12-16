const express = require('express');
const { auth } = require('../middleware/auth');
const AffiliatePayout = require('../models/AffiliatePayout');
const User = require('../models/User');

const router = express.Router();

// Wallet summary
router.get('/me', auth, async (req, res) => {
  try {
    const payouts = await AffiliatePayout.find({ user: req.user._id }).sort({ createdAt: -1 });
    res.json({ success:true, data: { wallet: req.user.wallet, payouts } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success:false, message:'Server error' });
  }
});

// Request withdrawal
router.post('/withdraw', auth, async (req, res) => {
  try {
    const { amount, method = 'upi', upiId, bank } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ success:false, message:'Invalid amount' });

    // Check balance
    if (req.user.wallet.availableBalance < amount) {
      return res.status(400).json({ success:false, message:'Insufficient balance' });
    }

    const payout = await AffiliatePayout.create({
      user: req.user._id,
      amount,
      method,
      upiId: upiId || null,
      bank: bank || null,
      status: 'requested'
    });

    // Lock balance
    await User.updateOne(
      { _id: req.user._id },
      { $inc: { 'wallet.availableBalance': -amount, 'wallet.totalWithdrawn': 0 } }
    );

    res.status(201).json({ success:true, data: { payout } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success:false, message:'Server error' });
  }
});

module.exports = router;