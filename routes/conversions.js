const express = require('express');
const { auth } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const Transaction = require('../models/Transaction');
const User = require('../models/User');

const router = express.Router();

// My conversions (user)
router.get('/me', auth, async (req, res) => {
  try {
    // Populate only valid refs; Transaction schema has 'store' (no 'offer')
    const tx = await Transaction.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .populate('store'); // removed: 'offer'
    res.json({ success: true, data: { conversions: tx } });
  } catch (err) {
    console.error('user conversions error', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Admin view all
router.get('/', auth, requireRole('admin'), async (req, res) => {
  try {
    const { status } = req.query;
    const query = status ? { status } : {};
    // Populate valid refs only
    const tx = await Transaction.find(query)
      .sort({ createdAt: -1 })
      .populate('user store'); // removed: 'offer'
    res.json({ success: true, data: { conversions: tx } });
  } catch (err) {
    console.error('admin conversions list error', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Admin: approve/reject conversion
router.put('/:id/status', auth, requireRole('admin'), async (req, res) => {
  try {
    const { status } = req.body; // 'approved' | 'rejected'
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const tx = await Transaction.findById(req.params.id);
    if (!tx) return res.status(404).json({ success: false, message: 'Not found' });

    tx.status = status;
    await tx.save();

    // Wallet adjustments on approval/rejection
    const delta = Math.abs(Number(tx.commissionAmount || 0));
    if (delta && tx.user) {
      if (status === 'approved') {
        await User.updateOne(
          { _id: tx.user },
          {
            $inc: {
              'wallet.pendingCashback': -delta,
              'wallet.confirmedCashback': delta,
              'wallet.availableBalance': delta
            }
          }
        );
      } else if (status === 'rejected') {
        await User.updateOne(
          { _id: tx.user },
          { $inc: { 'wallet.pendingCashback': -delta } }
        );
      }
    }

    res.json({ success: true, data: { conversion: tx } });
  } catch (err) {
    console.error('admin set conversion status error', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /api/conversions/:id (user-specific transaction detail)
router.get('/:id', auth, async (req, res) => {
  try {
    const id = String(req.params.id);

    // Accept either ObjectId (_id) or orderId lookup, scope to current user
    const byId = await Transaction.findOne({ _id: id, user: req.user._id })
      .populate('store', 'name category')
      .lean();

    const byOrderId = byId
      ? null
      : await Transaction.findOne({ orderId: id, user: req.user._id })
          .populate('store', 'name category')
          .lean();

    const tx = byId || byOrderId;
    if (!tx) return res.status(404).json({ success: false, message: 'Not found' });
    return res.json({ success: true, data: { transaction: tx } });
  } catch (err) {
    console.error('user transaction detail error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;