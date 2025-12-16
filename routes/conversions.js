const express = require('express');
const { auth } = require('../middleware/auth');
const { requireRole, requireAnyRole } = require('../middleware/roles');
const Transaction = require('../models/Transaction');
const User = require('../models/User');

const router = express.Router();

// My conversions (user)
router.get('/me', auth, async (req, res) => {
  try {
    const tx = await Transaction.find({ user: req.user._id }).sort({ createdAt: -1 }).populate('store offer');
    res.json({ success:true, data: { conversions: tx } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success:false, message:'Server error' });
  }
});

// Admin view all
router.get('/', auth, requireRole('admin'), async (req, res) => {
  try {
    const { status } = req.query;
    const query = status ? { status } : {};
    const tx = await Transaction.find(query).sort({ createdAt: -1 }).populate('user store offer');
    res.json({ success:true, data: { conversions: tx } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success:false, message:'Server error' });
  }
});

// Admin: approve/reject conversion
router.put('/:id/status', auth, requireRole('admin'), async (req, res) => {
  try {
    const { status } = req.body; // 'approved' | 'rejected'
    if (!['approved','rejected'].includes(status)) return res.status(400).json({ success:false, message:'Invalid status' });

    const tx = await Transaction.findById(req.params.id);
    if (!tx) return res.status(404).json({ success:false, message:'Not found' });

    tx.status = status;
    await tx.save();

    // Wallet adjustments on approval
    if (status === 'approved') {
      await User.updateOne(
        { _id: tx.user },
        {
          $inc: {
            'wallet.pendingCashback': -tx.commission,
            'wallet.confirmedCashback': tx.commission,
            'wallet.availableBalance': tx.commission
          }
        }
      );
    } else if (status === 'rejected') {
      await User.updateOne(
        { _id: tx.user },
        { $inc: { 'wallet.pendingCashback': -tx.commission } }
      );
    }

    res.json({ success:true, data: { conversion: tx } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success:false, message:'Server error' });
  }
});

module.exports = router;