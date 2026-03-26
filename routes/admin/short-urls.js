const express = require('express');
const mongoose = require('mongoose');
const { adminAuth } = require('../../middleware/auth');

const ShortUrl = require('../../models/ShortUrl');
const Click = require('../../models/Click');
const Transaction = require('../../models/Transaction');

const router = express.Router();

function parseDateRange(query) {
  const now = new Date();
  let from = null;
  let to = null;

  const range = String(query?.range || '').trim().toLowerCase();
  if (range && range !== 'all') {
    const n = parseInt(range, 10);
    if (range.endsWith('d') && Number.isFinite(n)) {
      from = new Date(now);
      from.setDate(from.getDate() - n);
      to = now;
    }
  }

  if (query?.from) {
    const d = new Date(String(query.from));
    if (!Number.isNaN(d.getTime())) from = d;
  }
  if (query?.to) {
    const d = new Date(String(query.to));
    if (!Number.isNaN(d.getTime())) to = d;
  }

  const match = {};
  if (from || to) {
    match.createdAt = {};
    if (from) match.createdAt.$gte = from;
    if (to) match.createdAt.$lte = to;
  }
  return match;
}

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function publicBase() {
  return (process.env.PUBLIC_SITE_URL || process.env.FRONTEND_URL || 'https://earnko.com').replace(/\/+$/, '');
}

/**
 * GET /api/admin/short-urls/performance
 *
 * Query:
 *  - range=all|7d|30d|90d (default 30d)
 *  - from,to (ISO) optional override
 *  - sort=new|clicks|earnings (default new)
 *  - page (default 1)
 *  - limit (default 20, max 100)
 *  - q (search by code, slug, user email/name)
 *
 * Returns:
 *  items: [{
 *    code, shortUrl, slug, provider, createdAt,
 *    user: { _id, name, email },
 *    clicks,
 *    conversions,
 *    commissionTotal,
 *    approvedCommission,
 *    pendingCommission
 *  }]
 */
router.get('/performance', adminAuth, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      sort = 'new', // new|clicks|earnings
      q = '',
      range = '30d'
    } = req.query;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

    const dateMatch = parseDateRange({ ...req.query, range });

    // 1) fetch ShortUrls (platform-wide)
    // Search: code/slug/provider OR populated user fields (done in-memory filter after populate)
    const baseFilter = {};
    if (q) {
      baseFilter.$or = [
        { code: new RegExp(q, 'i') },
        { slug: new RegExp(q, 'i') },
        { provider: new RegExp(q, 'i') },
      ];
    }

    const total = await ShortUrl.countDocuments(baseFilter);

    const shortRows = await ShortUrl.find(baseFilter)
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .populate('user', 'name email')
      .lean();

    // optional: if q is user email/name, filter after populate
    let rows = shortRows;
    if (q) {
      const qq = String(q).trim().toLowerCase();
      rows = rows.filter(r => {
        const u = r.user;
        const name = String(u?.name || '').toLowerCase();
        const email = String(u?.email || '').toLowerCase();
        return (
          String(r.code || '').toLowerCase().includes(qq) ||
          String(r.slug || '').toLowerCase().includes(qq) ||
          String(r.provider || '').toLowerCase().includes(qq) ||
          name.includes(qq) ||
          email.includes(qq)
        );
      });
    }

    const slugs = rows.map(r => r.slug).filter(Boolean);

    if (!slugs.length) {
      return res.json({
        success: true,
        data: { items: [], total, totalPages: Math.ceil(total / limitNum), currentPage: pageNum }
      });
    }

    // 2) clicks aggregate by slug (Click.customSlug)
    const clicksAgg = await Click.aggregate([
      {
        $match: {
          customSlug: { $in: slugs },
          ...(Object.keys(dateMatch).length ? dateMatch : {})
        }
      },
      {
        $group: {
          _id: '$customSlug',
          clicks: { $sum: 1 },
          clickIds: { $addToSet: '$clickId' }
        }
      },
      { $project: { _id: 0, slug: '$_id', clicks: 1, clickIds: 1 } }
    ]);

    const clickInfoBySlug = new Map();
    clicksAgg.forEach(r => {
      clickInfoBySlug.set(r.slug, {
        clicks: n(r.clicks),
        clickIds: Array.isArray(r.clickIds) ? r.clickIds : []
      });
    });

    // 3) map clickId -> slug for tx folding
    const allClickIds = [];
    const slugByClickId = new Map();
    clicksAgg.forEach(r => {
      (r.clickIds || []).forEach(cid => {
        allClickIds.push(cid);
        slugByClickId.set(cid, r.slug);
      });
    });

    let txAgg = [];
    if (allClickIds.length) {
      txAgg = await Transaction.aggregate([
        {
          $match: {
            clickId: { $in: allClickIds },
            ...(Object.keys(dateMatch).length ? dateMatch : {})
          }
        },
        {
          $group: {
            _id: { clickId: '$clickId', status: '$status' },
            count: { $sum: 1 },
            commission: { $sum: { $ifNull: ['$commissionAmount', 0] } }
          }
        }
      ]);
    }

    const perfBySlug = new Map();
    for (const row of txAgg) {
      const clickId = row?._id?.clickId;
      const status = String(row?._id?.status || '').toLowerCase();
      const slug = clickId ? slugByClickId.get(clickId) : null;
      if (!slug) continue;

      const cur = perfBySlug.get(slug) || {
        conversions: 0,
        commissionTotal: 0,
        approvedCommission: 0,
        pendingCommission: 0
      };

      const cnt = n(row.count);
      const comm = n(row.commission);

      cur.conversions += cnt;
      cur.commissionTotal += comm;

      if (status === 'approved' || status === 'confirmed') cur.approvedCommission += comm;
      if (status === 'pending' || status === 'under_review') cur.pendingCommission += comm;

      perfBySlug.set(slug, cur);
    }

    const base = publicBase();

    let items = rows.map(r => {
      const slug = r.slug || '';
      const clickInfo = clickInfoBySlug.get(slug) || { clicks: 0 };
      const perf = perfBySlug.get(slug) || { conversions: 0, commissionTotal: 0, approvedCommission: 0, pendingCommission: 0 };

      return {
        code: r.code,
        shortUrl: `${base}/${r.code}`, // ✅ Option 1
        slug,
        provider: r.provider || '',
        createdAt: r.createdAt,

        user: r.user ? { _id: r.user._id, name: r.user.name || '', email: r.user.email || '' } : null,

        clicks: clickInfo.clicks,
        conversions: perf.conversions,
        commissionTotal: Math.round(perf.commissionTotal * 100) / 100,
        approvedCommission: Math.round(perf.approvedCommission * 100) / 100,
        pendingCommission: Math.round(perf.pendingCommission * 100) / 100
      };
    });

    // 4) sorting
    if (String(sort) === 'clicks') items.sort((a, b) => (b.clicks || 0) - (a.clicks || 0));
    else if (String(sort) === 'earnings') items.sort((a, b) => (b.commissionTotal || 0) - (a.commissionTotal || 0));
    else items.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    return res.json({
      success: true,
      data: {
        items,
        total,
        totalPages: Math.ceil(total / limitNum),
        currentPage: pageNum
      }
    });
  } catch (err) {
    console.error('admin short-urls performance error', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

module.exports = router;