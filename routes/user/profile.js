const express = require('express');
const { auth } = require('../../middleware/auth');
const User = require('../../models/User');

const router = express.Router();

/**
 * GET /api/user/profile
 */
router.get('/', auth, async (req, res) => {
  const u = await User.findById(req.user._id).lean();
  if (!u) return res.status(404).json({ success: false, message: 'User not found' });
  res.json({
    success: true,
    data: {
      profile: {
        name: u.name,
        phone: u.phone || '',
        payout: u.payout || { upiId: '', bank: { holderName: '', accountNumber: '', ifsc: '', bankName: '' } }
      }
    }
  });
});

/**
 * PUT /api/user/profile
 * body: { name, phone, payout: { upiId, bank: { holderName, accountNumber, ifsc, bankName } } }
 */
router.put('/', auth, async (req, res) => {
  try {
    const update = {};
    if (req.body.name != null) update.name = String(req.body.name);
    if (req.body.phone != null) update.phone = String(req.body.phone);
    if (req.body.payout != null) update.payout = req.body.payout;

    const user = await User.findByIdAndUpdate(req.user._id, update, { new: true });
    res.json({ success: true, data: { user: { id: user._id, name: user.name, phone: user.phone, payout: user.payout } } });
  } catch (err) {
    console.error('update profile error', err);
    res.status(400).json({ success: false, message: err.message || 'Bad request' });
  }
});

module.exports = router;