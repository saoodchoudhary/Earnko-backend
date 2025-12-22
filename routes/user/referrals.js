const express = require('express');
const mongoose = require('mongoose');
const { auth } = require('../../middleware/auth');
const User = require('../../models/User');
const ReferralReward = require('../../models/ReferralReward');

const router = express.Router();

/**
 * GET /api/user/referrals
 * Returns referral link, referred users, rewards, totals
 */
router.get('/', auth, async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user._id);

    const referralLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/register?ref=${req.user._id}`;

    const referred = await User.find({ referredBy: userId }).select('name email createdAt').lean();

    const rewards = await ReferralReward.find({ referrer: userId })
      .populate('referred', 'name email')
      .populate('transaction', 'orderId commissionAmount status')
      .sort({ createdAt: -1 })
      .lean();

    const totals = rewards.reduce((acc, r) => {
      acc.totalRewards += 1;
      acc.totalAmount += Number(r.amount || 0);
      return acc;
    }, { totalRewards: 0, totalAmount: 0 });

    res.json({
      success: true,
      data: {
        referralLink,
        referred,
        rewards,
        totals,
        wallet: req.user.wallet
      }
    });
  } catch (err) {
    console.error('user referrals error', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;