const express = require('express');
const mongoose = require('mongoose');
const { adminAuth } = require('../../middleware/auth');
const Store = require('../../models/Store');
const Transaction = require('../../models/Transaction');
const Click = require('../../models/Click');

const router = express.Router();

/**
 * Utility: parse date range from query.
 * Supports: range=7d|30d|90d or explicit from, to ISO dates.
 */
function buildDateMatch(query) {
  const now = new Date();
  let from, to;

  if (query.range) {
    const str = String(query.range);
    if (/^\d+d$/.test(str)) {
      const n = parseInt(str, 10);
      from = new Date(now);
      from.setDate(from.getDate() - n);
      to = now;
    }
  }
  if (query.from) from = new Date(query.from);
  if (query.to) to = new Date(query.to);

  const m = {};
  if (from || to) {
    m.createdAt = {};
    if (from) m.createdAt.$gte = from;
    if (to) m.createdAt.$lte = to;
  }
  return m;
}

/**
 * GET /api/admin/stores
 * Query: page, limit, q (name), isActive ('true'|'false'|'')
 */
router.get('/', adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20, q = '', isActive = '', sort = 'name' } = req.query;

    const filter = {};
    if (q) filter.name = new RegExp(q, 'i');
    if (isActive === 'true') filter.isActive = true;
    if (isActive === 'false') filter.isActive = false;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

    const [items, total] = await Promise.all([
      Store.find(filter).sort(sort).skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
      Store.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: { items, total, totalPages: Math.ceil(total / limitNum), currentPage: pageNum },
    });
  } catch (err) {
    console.error('Admin list stores error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * GET /api/admin/stores/:id
 */
router.get('/:id', adminAuth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    const item = await Store.findById(req.params.id).lean();
    if (!item) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: { item } });
  } catch (err) {
    console.error('Admin get store error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * POST /api/admin/stores
 */
router.post('/', adminAuth, async (req, res) => {
  try {
    const item = await Store.create(req.body);
    res.status(201).json({ success: true, data: { item } });
  } catch (err) {
    console.error('Admin create store error:', err);
    res.status(400).json({ success: false, message: err.message || 'Bad request' });
  }
});

/**
 * PATCH /api/admin/stores/:id
 */
router.patch('/:id', adminAuth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    const item = await Store.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!item) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: { item } });
  } catch (err) {
    console.error('Admin update store error:', err);
    res.status(400).json({ success: false, message: err.message || 'Bad request' });
  }
});

/**
 * DELETE /api/admin/stores/:id
 */
router.delete('/:id', adminAuth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    await Store.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    console.error('Admin delete store error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * GET /api/admin/stores/:id/stats
 * Summary stats for a store
 */
router.get('/:id/stats', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ success: false, message: 'Invalid id' });

    const [clicksTotal, txAgg] = await Promise.all([
      Click.countDocuments({ store: new mongoose.Types.ObjectId(id) }),
      Transaction.aggregate([
        { $match: { store: new mongoose.Types.ObjectId(id) } },
        {
          $group: {
            _id: null,
            transactions: { $sum: 1 },
            commissionTotal: { $sum: { $ifNull: ['$commissionAmount', 0] } },
            pendingAmount: {
              $sum: {
                $cond: [
                  { $in: ['$status', ['pending', 'under_review']] },
                  { $ifNull: ['$commissionAmount', 0] },
                  0
                ]
              }
            }
          }
        }
      ])
    ]);

    res.json({
      success: true,
      data: {
        clicksTotal,
        transactions: txAgg?.[0]?.transactions || 0,
        commissionTotal: txAgg?.[0]?.commissionTotal || 0,
        pendingAmount: txAgg?.[0]?.pendingAmount || 0
      }
    });
  } catch (err) {
    console.error('Admin store stats error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * GET /api/admin/stores/:id/trend
 * Query: range=7d|30d|90d or from,to
 * Returns daily series: { date, clicks, transactions, commission }
 */
router.get('/:id/trend', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    const dateMatch = buildDateMatch(req.query);
    const storeId = new mongoose.Types.ObjectId(id);

    // Clicks daily
    const clicks = await Click.aggregate([
      { $match: { store: storeId, ...(Object.keys(dateMatch).length ? dateMatch : {}) } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          clicks: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, date: '$_id', clicks: 1 } }
    ]);

    // Transactions daily
    const tx = await Transaction.aggregate([
      { $match: { store: storeId, ...(Object.keys(dateMatch).length ? dateMatch : {}) } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          transactions: { $sum: 1 },
          commission: { $sum: { $ifNull: ['$commissionAmount', 0] } }
        }
      },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, date: '$_id', transactions: 1, commission: 1 } }
    ]);

    // Merge by date
    const map = new Map();
    clicks.forEach(c => map.set(c.date, { date: c.date, clicks: c.clicks, transactions: 0, commission: 0 }));
    tx.forEach(t => {
      const cur = map.get(t.date) || { date: t.date, clicks: 0, transactions: 0, commission: 0 };
      cur.transactions = t.transactions;
      cur.commission = t.commission;
      map.set(t.date, cur);
    });

    const daily = Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));

    res.json({ success: true, data: { daily } });
  } catch (err) {
    console.error('Admin store trend error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * GET /api/admin/stores/:id/recent
 * Query: limit (default 10)
 */
router.get('/:id/recent', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 10 } = req.query;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
    const storeId = new mongoose.Types.ObjectId(id);

    const [recentTransactions, recentClicks] = await Promise.all([
      Transaction.find({ store: storeId }).populate('user', 'email name').sort('-createdAt').limit(limitNum).lean(),
      Click.find({ store: storeId }).sort('-createdAt').limit(limitNum).lean(),
    ]);

    res.json({ success: true, data: { recentTransactions, recentClicks } });
  } catch (err) {
    console.error('Admin store recent error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

module.exports = router;