const express = require('express');
const mongoose = require('mongoose');
const Transaction = require('../../models/Transaction');

let adminAuth, auth;
try {
  // Prefer an existing adminAuth (as used in other admin routes)
  ({ adminAuth, auth } = require('../../middleware/auth'));
} catch (_) {
  // noop
}

// Fallback admin guard if adminAuth is not available
const ensureAdmin = (req, res, next) => {
  if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
  if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Forbidden' });
  next();
};

// Build the middleware chain to protect admin routes
const adminMiddlewares = adminAuth ? [adminAuth] : (auth ? [auth, ensureAdmin] : [ensureAdmin]);

const router = express.Router();

/**
 * Helper: parse date range from query
 * Supports:
 * - range=7d|30d|90d
 * - from=ISODate, to=ISODate
 */
function parseDateRange(query) {
  const now = new Date();
  let from, to;

  if (query.range) {
    const n = parseInt(query.range, 10);
    if (query.range.endsWith('d') && !Number.isNaN(n)) {
      from = new Date(now);
      from.setDate(from.getDate() - n);
      to = now;
    }
  }

  if (query.from) from = new Date(query.from);
  if (query.to) to = new Date(query.to);

  const match = {};
  if (from || to) {
    match.createdAt = {};
    if (from) match.createdAt.$gte = from;
    if (to) match.createdAt.$lte = to;
  }
  return match;
}

/**
 * GET /api/admin/transactions
 * List transactions (filters + pagination)
 * Query: page, limit, status, q (orderId), userId, storeId, from, to, range, sort
 */
router.get('/', ...adminMiddlewares, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      q,
      userId,
      storeId,
      sort = '-createdAt',
    } = req.query;

    const filter = {};
    if (status && status !== 'all') filter.status = status;
    if (q) {
      filter.$or = [{ orderId: new RegExp(q, 'i') }];
    }
    if (userId && mongoose.isValidObjectId(userId)) filter.user = userId;
    if (storeId && mongoose.isValidObjectId(storeId)) filter.store = storeId;

    Object.assign(filter, parseDateRange(req.query));

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

    const [items, total] = await Promise.all([
      Transaction.find(filter)
        .populate('user', 'name email')
        .populate('store', 'name')
        .sort(sort)
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      Transaction.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: {
        items,
        total,
        totalPages: Math.ceil(total / limitNum),
        currentPage: pageNum,
      },
    });
  } catch (err) {
    console.error('Admin list transactions error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * GET /api/admin/transactions/:id
 * Transaction detail
 */
router.get('/:id', ...adminMiddlewares, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid id' });
    }
    const tx = await Transaction.findById(req.params.id)
      .populate('user', 'name email')
      .populate('store', 'name')
      .lean();
    if (!tx) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: { transaction: tx } });
  } catch (err) {
    console.error('Admin get transaction error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * PATCH /api/admin/transactions/:id/status
 * body: { status }
 * Allowed: pending | confirmed | cancelled | under_review
 */
router.patch('/:id/status', ...adminMiddlewares, async (req, res) => {
  try {
    const allowed = ['pending', 'confirmed', 'cancelled', 'under_review'];
    const { status } = req.body || {};
    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid id' });
    }
    const tx = await Transaction.findById(req.params.id);
    if (!tx) return res.status(404).json({ success: false, message: 'Not found' });

    tx.status = status;
    await tx.save();

    res.json({ success: true, message: 'Status updated', data: { transaction: tx } });
  } catch (err) {
    console.error('Admin update transaction status error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * GET /api/admin/transactions/stats/overview
 * Query: range=7d|30d|90d or from, to
 * Returns: { overview: { totalTransactions, totalCommission, pendingAmount } }
 */
router.get('/stats/overview', ...adminMiddlewares, async (req, res) => {
  try {
    const dateMatch = parseDateRange(req.query);

    const matchStage = Object.keys(dateMatch).length ? { $match: dateMatch } : { $match: {} };

    const [agg] = await Transaction.aggregate([
      matchStage,
      {
        $group: {
          _id: null,
          totalTransactions: { $sum: 1 },
          totalCommission: { $sum: { $ifNull: ['$commissionAmount', 0] } },
          pendingAmount: {
            $sum: {
              $cond: [
                { $in: ['$status', ['pending', 'under_review']] },
                { $ifNull: ['$commissionAmount', 0] },
                0,
              ],
            },
          },
        },
      },
    ]);

    res.json({
      success: true,
      data: {
        overview: {
          totalTransactions: agg?.totalTransactions || 0,
          totalCommission: agg?.totalCommission || 0,
          pendingAmount: agg?.pendingAmount || 0,
        },
      },
    });
  } catch (err) {
    console.error('Admin stats overview error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * GET /api/admin/transactions/stats/trend
 * Query: range=7d|30d|90d or from, to
 * Groups by day: { date, transactions, commission, pending }
 */
router.get('/stats/trend', ...adminMiddlewares, async (req, res) => {
  try {
    const dateMatch = parseDateRange(req.query);
    const matchStage = Object.keys(dateMatch).length ? { $match: dateMatch } : { $match: {} };

    const series = await Transaction.aggregate([
      matchStage,
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          transactions: { $sum: 1 },
          commission: { $sum: { $ifNull: ['$commissionAmount', 0] } },
          pending: {
            $sum: {
              $cond: [
                { $in: ['$status', ['pending', 'under_review']] },
                { $ifNull: ['$commissionAmount', 0] },
                0,
              ],
            },
          },
        },
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          date: '$_id',
          transactions: 1,
          commission: 1,
          pending: 1,
        },
      },
    ]);

    res.json({ success: true, data: { trend: { daily: series } } });
  } catch (err) {
    console.error('Admin stats trend error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * GET /api/admin/transactions/top-stores
 * Query: range, from, to, limit
 */
router.get('/top-stores', ...adminMiddlewares, async (req, res) => {
  try {
    const { limit = 5 } = req.query;
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 5, 1), 50);

    const dateMatch = parseDateRange(req.query);
    const matchStage = Object.keys(dateMatch).length ? { $match: dateMatch } : { $match: {} };

    const rows = await Transaction.aggregate([
      matchStage,
      { $match: { store: { $ne: null } } },
      {
        $group: {
          _id: '$store',
          transactions: { $sum: 1 },
          commission: { $sum: { $ifNull: ['$commissionAmount', 0] } },
        },
      },
      { $sort: { commission: -1 } },
      { $limit: limitNum },
      {
        $lookup: {
          from: 'stores',
          localField: '_id',
          foreignField: '_id',
          as: 'store',
        },
      },
      { $unwind: { path: '$store', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          storeId: '$store._id',
          name: '$store.name',
          transactions: 1,
          commission: 1,
        },
      },
    ]);

    res.json({ success: true, data: { topStores: rows } });
  } catch (err) {
    console.error('Admin top stores error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * GET /api/admin/transactions/recent
 * Query: limit
 */
router.get('/recent', ...adminMiddlewares, async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);

    const items = await Transaction.find({})
      .populate('user', 'email name')
      .populate('store', 'name')
      .sort('-createdAt')
      .limit(limitNum)
      .lean();

    res.json({ success: true, data: { recentTransactions: items } });
  } catch (err) {
    console.error('Admin recent transactions error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

module.exports = router;