const express = require('express');
const mongoose = require('mongoose');
const { adminAuth } = require('../../middleware/auth');
const Commission = require('../../models/Commission');
const Transaction = require('../../models/Transaction');
const User = require('../../models/User');
const { body, validationResult } = require('express-validator');

/**
 * This version adds:
 * - Robust filtering: q (orderId/email), status, affiliateId
 * - Pagination: page, limit
 * - Safe error handling with clear messages
 * - Approve pending commission: sets status=approved, approvedAt
 * - Reverse commission: sets status=reversed, reversedAt, reason
 */

const router = express.Router();

/**
 * GET /api/admin/commissions
 * Query:
 *  - page, limit
 *  - status: pending|approved|paid|rejected|reversed|under_review
 *  - affiliateId: ObjectId
 *  - q: orderId or affiliate email (partial, case-insensitive)
 */
router.get('/', adminAuth, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status = '',
      affiliateId = '',
      q = '',
      sort = '-createdAt',
    } = req.query;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

    const filter = {};
    if (status && status !== 'all') filter.status = status;
    if (affiliateId && mongoose.isValidObjectId(affiliateId)) filter.affiliate = affiliateId;

    // Build q search by orderId or affiliate email
    // If q is present, we first try to resolve affiliate emails to IDs, and match orderId in transaction
    let transactionIds = null;
    let affiliateIds = null;
    if (q) {
      const emailRegex = new RegExp(q, 'i');
      const orderRegex = new RegExp(q, 'i');

      // find affiliates by email
      const affList = await User.find({ email: emailRegex }, { _id: 1 }).lean();
      affiliateIds = affList.map(a => a._id);

      // find transactions by orderId
      const txList = await Transaction.find({ orderId: orderRegex }, { _id: 1 }).lean();
      transactionIds = txList.map(t => t._id);
    }

    // Apply q matches to filter
    if (q) {
      filter.$or = [];
      if (affiliateIds && affiliateIds.length) {
        filter.$or.push({ affiliate: { $in: affiliateIds } });
      }
      if (transactionIds && transactionIds.length) {
        filter.$or.push({ transaction: { $in: transactionIds } });
      }
      // If no matches found above, still allow future expansions by label/metadata, but no-op otherwise.
      if (filter.$or.length === 0) {
        // add a no-op that won't match anything to maintain structure
        filter.$or.push({ _id: null });
      }
    }

    const [commissions, total] = await Promise.all([
      Commission.find(filter)
        .populate('affiliate', 'name email')
        .populate('store', 'name')
        .populate('transaction', 'orderId')
        .sort(sort)
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      Commission.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: {
        commissions,
        totalPages: Math.ceil(total / limitNum),
        currentPage: pageNum,
        total,
      },
    });
  } catch (err) {
    console.error('Admin get commissions error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * PUT /api/admin/commissions/:id/approve
 * Approve a pending commission
 */
router.put('/:id/approve', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid commission id' });
    }

    const commission = await Commission.findById(id);
    if (!commission) return res.status(404).json({ success: false, message: 'Commission not found' });

    if (commission.status !== 'pending' && commission.status !== 'under_review') {
      return res.status(400).json({ success: false, message: `Cannot approve commission with status '${commission.status}'` });
    }

    commission.status = 'approved';
    commission.approvedAt = new Date();
    await commission.save();

    const updated = await Commission.findById(id)
      .populate('affiliate', 'name email')
      .populate('store', 'name')
      .populate('transaction', 'orderId');

    res.json({ success: true, message: 'Commission approved', data: updated });
  } catch (err) {
    console.error('Approve commission error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * PUT /api/admin/commissions/:id/reverse
 * Reverse commission (refund/chargeback)
 * body: { reason?: string }
 */
router.put('/:id/reverse', adminAuth, [
  body('reason').optional().isString()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    const { id } = req.params;
    const { reason = 'admin_reversal' } = req.body || {};
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid commission id' });
    }

    const commission = await Commission.findById(id);
    if (!commission) return res.status(404).json({ success: false, message: 'Commission not found' });

    // Allow reversing approved/paid/pending/under_review but block if already reversed/rejected
    if (['reversed', 'rejected'].includes(commission.status)) {
      return res.status(400).json({ success: false, message: `Cannot reverse commission with status '${commission.status}'` });
    }

    commission.status = 'reversed';
    commission.reversedAt = new Date();
    commission.reason = reason;
    await commission.save();

    const reversed = await Commission.findById(id)
      .populate('affiliate', 'name email')
      .populate('store', 'name')
      .populate('transaction', 'orderId');

    res.json({ success: true, message: 'Commission reversed', data: reversed });
  } catch (err) {
    console.error('Reverse commission error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

module.exports = router;