const express = require('express');
const mongoose = require('mongoose');
const { adminAuth } = require('../../middleware/auth');
const User = require('../../models/User');
const Transaction = require('../../models/Transaction');
const AffiliatePayout = require('../../models/AffiliatePayout');

const router = express.Router();

/**
 * GET /api/admin/users
 * Query: page, limit, q (name/email), role, status
 */
router.get('/', adminAuth, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      q = '',
      role = '',
      status = '',
      sort = '-createdAt'
    } = req.query;

    const filter = {};
    if (q) {
      filter.$or = [
        { name: new RegExp(q, 'i') },
        { email: new RegExp(q, 'i') },
      ];
    }
    if (role && role !== 'all') filter.role = role;
    if (status && status !== 'all') filter.accountStatus = status;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

    const [items, total] = await Promise.all([
      User.find(filter)
        .sort(sort)
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      User.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: {
        items,
        total,
        totalPages: Math.ceil(total / limitNum),
        currentPage: pageNum,
      }
    });
  } catch (err) {
    console.error('Admin list users error:', err);
    res.status(500).json({ success:false, message:'Internal server error' });
  }
});

/**
 * GET /api/admin/users/:id
 * Returns user and quick stats
 */
router.get('/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ success:false, message:'Invalid id' });

    const user = await User.findById(id).lean();
    if (!user) return res.status(404).json({ success:false, message:'User not found' });

    const [txAgg] = await Transaction.aggregate([
      { $match: { user: new mongoose.Types.ObjectId(id) } },
      {
        $group: {
          _id: null,
          txCount: { $sum: 1 },
          commissionTotal: { $sum: { $ifNull: ['$commissionAmount', 0] } },
          pendingAmount: {
            $sum: {
              $cond: [
                { $in: ['$status', ['pending','under_review']] },
                { $ifNull: ['$commissionAmount', 0] },
                0
              ]
            }
          }
        }
      }
    ]);
    const payoutsCount = await AffiliatePayout.countDocuments({ affiliate: id });

    res.json({
      success: true,
      data: {
        user,
        stats: {
          transactions: txAgg?.txCount || 0,
          commissionTotal: txAgg?.commissionTotal || 0,
          pendingAmount: txAgg?.pendingAmount || 0,
          payouts: payoutsCount || 0
        }
      }
    });
  } catch (err) {
    console.error('Admin get user error:', err);
    res.status(500).json({ success:false, message:'Internal server error' });
  }
});

/**
 * PATCH /api/admin/users/:id/status
 * body: { accountStatus: 'active'|'hold'|'blocked', isApproved?: boolean }
 */
router.patch('/:id/status', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { accountStatus, isApproved } = req.body || {};
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ success:false, message:'Invalid id' });
    const allowed = ['active','hold','blocked'];
    if (accountStatus && !allowed.includes(accountStatus)) {
      return res.status(400).json({ success:false, message:'Invalid status' });
    }
    const update = {};
    if (accountStatus) update.accountStatus = accountStatus;
    if (typeof isApproved === 'boolean') update.isApproved = isApproved;

    const user = await User.findByIdAndUpdate(id, update, { new: true });
    if (!user) return res.status(404).json({ success:false, message:'User not found' });
    res.json({ success:true, message:'Status updated', data: { user } });
  } catch (err) {
    console.error('Admin user status error:', err);
    res.status(500).json({ success:false, message:'Internal server error' });
  }
});

/**
 * POST /api/admin/users/:id/approve
 */
router.post('/:id/approve', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ success:false, message:'Invalid id' });
    const user = await User.findByIdAndUpdate(id, { isApproved: true, accountStatus: 'active' }, { new: true });
    if (!user) return res.status(404).json({ success:false, message:'User not found' });
    res.json({ success:true, message:'User approved', data: { user } });
  } catch (err) {
    console.error('Admin approve user error:', err);
    res.status(500).json({ success:false, message:'Internal server error' });
  }
});

/**
 * POST /api/admin/users/:id/hold
 */
router.post('/:id/hold', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ success:false, message:'Invalid id' });
    const user = await User.findByIdAndUpdate(id, { accountStatus: 'hold' }, { new: true });
    if (!user) return res.status(404).json({ success:false, message:'User not found' });
    res.json({ success:true, message:'User put on hold', data: { user } });
  } catch (err) {
    console.error('Admin hold user error:', err);
    res.status(500).json({ success:false, message:'Internal server error' });
  }
});

/**
 * POST /api/admin/users/:id/block
 */
router.post('/:id/block', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ success:false, message:'Invalid id' });
    const user = await User.findByIdAndUpdate(id, { accountStatus: 'blocked' }, { new: true });
    if (!user) return res.status(404).json({ success:false, message:'User not found' });
    res.json({ success:true, message:'User blocked', data: { user } });
  } catch (err) {
    console.error('Admin block user error:', err);
    res.status(500).json({ success:false, message:'Internal server error' });
  }
});

/**
 * PATCH /api/admin/users/:id/role
 * body: { role: 'user'|'admin'|'affiliate' }
 */
router.patch('/:id/role', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body || {};
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ success:false, message:'Invalid id' });
    const allowed = ['user','admin','affiliate'];
    if (!allowed.includes(role)) return res.status(400).json({ success:false, message:'Invalid role' });
    const user = await User.findByIdAndUpdate(id, { role }, { new: true });
    if (!user) return res.status(404).json({ success:false, message:'User not found' });
    res.json({ success:true, message:'Role updated', data: { user } });
  } catch (err) {
    console.error('Admin role update error:', err);
    res.status(500).json({ success:false, message:'Internal server error' });
  }
});

module.exports = router;