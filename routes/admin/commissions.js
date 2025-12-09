const express = require('express');
const { adminAuth } = require('../../middleware/auth');
const Commission = require('../../models/Commission');
const User = require('../../models/User');
const commissionService = require('../../services/commissionService');
const { body, validationResult } = require('express-validator');

const router = express.Router();

/**
 * GET /api/admin/commissions
 * Query: page, limit, status, affiliateId
 */
router.get('/', adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20, status, affiliateId } = req.query;
    const filter = {};
    if (status && status !== 'all') filter.status = status;
    if (affiliateId) filter.affiliate = affiliateId;

    const commissions = await Commission.find(filter)
      .populate('affiliate', 'name email')
      .populate('store', 'name')
      .populate('transaction', 'orderId')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();

    const total = await Commission.countDocuments(filter);

    res.json({
      success: true,
      data: {
        commissions,
        totalPages: Math.ceil(total / limit),
        currentPage: parseInt(page),
        total
      }
    });
  } catch (err) {
    console.error('Admin get commissions error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * PUT /api/admin/commissions/:id/approve
 * Approve a pending commission (moves pending -> approved)
 */
router.put('/:id/approve', adminAuth, async (req, res) => {
  try {
    const commission = await Commission.findById(req.params.id);
    if (!commission) return res.status(404).json({ success: false, message: 'Commission not found' });

    await commissionService.confirmCommission(commission._id);

    const updated = await Commission.findById(commission._id).populate('affiliate', 'name email');
    res.json({ success: true, message: 'Commission approved', data: updated });
  } catch (err) {
    console.error('Approve commission error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * PUT /api/admin/commissions/:id/reverse
 * Reverse commission (refund/chargeback)
 */
router.put('/:id/reverse', adminAuth, [
  body('reason').optional().isString()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    const commission = await Commission.findById(req.params.id);
    if (!commission) return res.status(404).json({ success: false, message: 'Commission not found' });

    // Use service reversal by transaction if available
    const reversed = await commissionService.reverseCommissionByTransaction(commission.transaction, req.body.reason || 'admin_reversal');

    res.json({ success: true, message: 'Commission reversed', data: reversed });
  } catch (err) {
    console.error('Reverse commission error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

module.exports = router;