const express = require('express');
const { auth } = require('../../middleware/auth');
const { requireRole } = require('../../middleware/roles');
const AffiliatePayout = require('../../models/AffiliatePayout');
const User = require('../../models/User');

const router = express.Router();

/**
 * GET /api/admin/payouts
 * Query: status? (pending|approved|processed|rejected)
 */
router.get('/', auth, requireRole('admin'), async (req, res) => {
  try {
    const { status } = req.query;
    const filter = {};
    if (status) filter.status = status;

    const payouts = await AffiliatePayout.find(filter)
      .sort({ createdAt: -1 })
      .populate('affiliate', 'name email') // FIX: populate affiliate, not user
      .lean();

    res.json({ success: true, data: { payouts } });
  } catch (err) {
    console.error('Admin list payouts error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * PUT /api/admin/payouts/:id/status
 * body: { status, transactionReference?, adminNotes? }
 * Allowed statuses per model: pending|approved|processed|rejected
 * Effects:
 *  - processed: add amount to user's wallet.totalWithdrawn
 *  - rejected: return amount to user's wallet.availableBalance
 */
router.put('/:id/status', auth, requireRole('admin'), async (req, res) => {
  try {
    const { status, transactionReference, adminNotes } = req.body;
    const allowed = ['pending', 'approved', 'processed', 'rejected'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const payout = await AffiliatePayout.findById(req.params.id);
    if (!payout) return res.status(404).json({ success: false, message: 'Not found' });

    const oldStatus = payout.status;
    payout.status = status;
    if (transactionReference) payout.transactionReference = transactionReference;
    if (adminNotes) payout.adminNotes = adminNotes;
    if (status === 'processed') payout.processedAt = new Date();

    await payout.save();

    // Wallet side-effects
    if (oldStatus !== 'processed' && status === 'processed') {
      await User.updateOne(
        { _id: payout.affiliate }, // FIX: use affiliate
        { $inc: { 'wallet.totalWithdrawn': payout.amount } }
      );
    } else if (oldStatus !== 'rejected' && status === 'rejected') {
      // Return the locked amount back
      await User.updateOne(
        { _id: payout.affiliate }, // FIX: use affiliate
        { $inc: { 'wallet.availableBalance': payout.amount } }
      );
    }

    res.json({ success: true, data: { payout } });
  } catch (err) {
    console.error('Admin update payout error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;