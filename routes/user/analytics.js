const express = require('express');
const mongoose = require('mongoose');
const { auth } = require('../../middleware/auth');
const Click = require('../../models/Click');
const Transaction = require('../../models/Transaction');

const router = express.Router();

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
 * GET /api/user/analytics
 * Query: range=7d|30d|90d or from,to
 * Returns:
 *  - summary: { clicksTotal, conversionsTotal, commissionTotal, pendingAmount, approvedAmount }
 *  - daily: [{ date, clicks, conversions, commission }]
 */
router.get('/', auth, async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user._id);
    const dateMatch = buildDateMatch(req.query);

    // Summary counts
    const [clicksTotal, txAggAll, txAggPending, txAggApproved] = await Promise.all([
      Click.countDocuments({ user: userId }),
      Transaction.aggregate([
        { $match: { user: userId } },
        { $group: {
          _id: null,
          conversionsTotal: { $sum: 1 },
          commissionTotal: { $sum: { $ifNull: ['$commissionAmount', 0] } }
        } }
      ]),
      Transaction.aggregate([
        { $match: { user: userId, status: 'pending' } },
        { $group: { _id: null, pendingAmount: { $sum: { $ifNull: ['$commissionAmount', 0] } } } }
      ]),
      Transaction.aggregate([
        { $match: { user: userId, status: 'approved' } },
        { $group: { _id: null, approvedAmount: { $sum: { $ifNull: ['$commissionAmount', 0] } } } }
      ]),
    ]);

    const summary = {
      clicksTotal: clicksTotal || 0,
      conversionsTotal: txAggAll?.[0]?.conversionsTotal || 0,
      commissionTotal: txAggAll?.[0]?.commissionTotal || 0,
      pendingAmount: txAggPending?.[0]?.pendingAmount || 0,
      approvedAmount: txAggApproved?.[0]?.approvedAmount || 0,
    };

    // Daily series for selected range
    const [clicksDaily, txDaily] = await Promise.all([
      Click.aggregate([
        { $match: { user: userId, ...(Object.keys(dateMatch).length ? dateMatch : {}) } },
        { $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          clicks: { $sum: 1 }
        } },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, date: '$_id', clicks: 1 } }
      ]),
      Transaction.aggregate([
        { $match: { user: userId, ...(Object.keys(dateMatch).length ? dateMatch : {}) } },
        { $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          conversions: { $sum: 1 },
          commission: { $sum: { $ifNull: ['$commissionAmount', 0] } }
        } },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, date: '$_id', conversions: 1, commission: 1 } }
      ]),
    ]);

    // Merge by date
    const map = new Map();
    clicksDaily.forEach(c => map.set(c.date, { date: c.date, clicks: c.clicks, conversions: 0, commission: 0 }));
    txDaily.forEach(t => {
      const cur = map.get(t.date) || { date: t.date, clicks: 0, conversions: 0, commission: 0 };
      cur.conversions = t.conversions;
      cur.commission = t.commission;
      map.set(t.date, cur);
    });
    const daily = Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));

    res.json({ success: true, data: { summary, daily } });
  } catch (err) {
    console.error('user analytics error', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;