const express = require('express');
const mongoose = require('mongoose');
const { auth } = require('../../middleware/auth');
const ShortUrl = require('../../models/ShortUrl');
const Click = require('../../models/Click');
const Transaction = require('../../models/Transaction');

const router = express.Router();

function buildDateMatch(query) {
  // same spirit as routes/user/analytics.js: supports from,to ISO
  const out = {};
  const from = query?.from ? new Date(String(query.from)) : null;
  const to = query?.to ? new Date(String(query.to)) : null;

  if (from && !Number.isNaN(from.getTime()) && to && !Number.isNaN(to.getTime()) && from.getTime() <= to.getTime()) {
    out.createdAt = { $gte: from, $lte: to };
  }
  return out;
}

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

/**
 * GET /api/user/short-urls/performance
 *
 * Query (optional):
 *  - from, to (ISO) => filter clicks + transactions within this range
 *  - limit (default 200, max 500)
 *
 * Returns:
 *  items: [{
 *    code, shortUrl, slug, provider, createdAt,
 *    clicks,
 *    conversionsTotal,
 *    approvedConversions,
 *    pendingConversions,
 *    commissionTotal,
 *    approvedCommission,
 *    pendingCommission
 *  }]
 */
router.get('/performance', auth, async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const limitNum = Math.min(Math.max(parseInt(req.query?.limit, 10) || 200, 1), 500);
    const dateMatch = buildDateMatch(req.query);

    const base =
      (process.env.PUBLIC_SITE_URL || process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');

    // 1) user's short urls
    const shortRows = await ShortUrl.find({ user: userId })
      .sort({ createdAt: -1 })
      .limit(limitNum)
      .lean();

    if (!shortRows.length) {
      return res.json({ success: true, data: { items: [] } });
    }

    const slugs = shortRows.map(r => r.slug).filter(Boolean);

    // 2) clicks per slug (customSlug)
    const clicksAgg = await Click.aggregate([
      { $match: { user: new mongoose.Types.ObjectId(userId), customSlug: { $in: slugs }, ...(Object.keys(dateMatch).length ? dateMatch : {}) } },
      { $group: { _id: '$customSlug', clicks: { $sum: 1 }, clickIds: { $addToSet: '$clickId' } } },
      { $project: { _id: 0, slug: '$_id', clicks: 1, clickIds: 1 } }
    ]);

    const clickInfoBySlug = new Map();
    clicksAgg.forEach(r => clickInfoBySlug.set(r.slug, { clicks: n(r.clicks), clickIds: Array.isArray(r.clickIds) ? r.clickIds : [] }));

    // 3) build (slug -> clickIds) flat for tx aggregation
    const allClickIds = [];
    const slugByClickId = new Map();
    clicksAgg.forEach(r => {
      const slug = r.slug;
      (r.clickIds || []).forEach(cid => {
        allClickIds.push(cid);
        slugByClickId.set(cid, slug);
      });
    });

    let txAgg = [];
    if (allClickIds.length) {
      // aggregate tx by clickId, then we will fold into slug
      txAgg = await Transaction.aggregate([
        { $match: { user: new mongoose.Types.ObjectId(userId), clickId: { $in: allClickIds }, ...(Object.keys(dateMatch).length ? dateMatch : {}) } },
        {
          $group: {
            _id: { clickId: '$clickId', status: '$status' },
            count: { $sum: 1 },
            commission: { $sum: { $ifNull: ['$commissionAmount', 0] } }
          }
        }
      ]);
    }

    const perfBySlug = new Map(); // slug -> perf
    for (const row of txAgg) {
      const clickId = row?._id?.clickId;
      const status = String(row?._id?.status || '').toLowerCase();
      const slug = clickId ? slugByClickId.get(clickId) : null;
      if (!slug) continue;

      const cur = perfBySlug.get(slug) || {
        conversionsTotal: 0,
        approvedConversions: 0,
        pendingConversions: 0,
        commissionTotal: 0,
        approvedCommission: 0,
        pendingCommission: 0
      };

      const cnt = n(row.count);
      const comm = n(row.commission);

      cur.conversionsTotal += cnt;
      cur.commissionTotal += comm;

      if (status === 'approved' || status === 'confirmed') {
        cur.approvedConversions += cnt;
        cur.approvedCommission += comm;
      } else if (status === 'pending' || status === 'under_review') {
        cur.pendingConversions += cnt;
        cur.pendingCommission += comm;
      } else {
        // cancelled/rejected etc -> counts are in total but not in approved/pending
      }

      perfBySlug.set(slug, cur);
    }

    const items = shortRows.map(r => {
      const slug = r.slug || '';
      const clicksInfo = clickInfoBySlug.get(slug) || { clicks: 0, clickIds: [] };
      const perf = perfBySlug.get(slug) || {
        conversionsTotal: 0,
        approvedConversions: 0,
        pendingConversions: 0,
        commissionTotal: 0,
        approvedCommission: 0,
        pendingCommission: 0
      };

      return {
        code: r.code,
        shortUrl: `${base}/${r.code}`, // ✅ Option 1
        slug,
        provider: r.provider || '',
        clickId: r.clickId || '',
        createdAt: r.createdAt,

        clicks: clicksInfo.clicks,

        conversionsTotal: perf.conversionsTotal,
        approvedConversions: perf.approvedConversions,
        pendingConversions: perf.pendingConversions,

        commissionTotal: Math.round(perf.commissionTotal * 100) / 100,
        approvedCommission: Math.round(perf.approvedCommission * 100) / 100,
        pendingCommission: Math.round(perf.pendingCommission * 100) / 100
      };
    });

    return res.json({ success: true, data: { items } });
  } catch (err) {
    console.error('short-urls performance error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;