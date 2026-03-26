const express = require('express');
const mongoose = require('mongoose');
const { adminAuth } = require('../../middleware/auth');

const ShortUrl = require('../../models/ShortUrl');

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

function publicBase() {
  return (process.env.PUBLIC_SITE_URL || process.env.FRONTEND_URL || 'https://earnko.com').replace(/\/+$/, '');
}

/**
 * GET /api/admin/short-urls/performance
 *
 * Query:
 *  - range=all|7d|30d|90d (default 30d)
 *  - from,to (ISO) optional override
 *  - sort=new|clicks|earnings (default new)  ✅ GLOBAL TOP
 *  - page (default 1)
 *  - limit (default 20, max 100)
 *  - q (search by code, slug, provider, user email/name)
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

    const dateMatch = parseDateRange({ ...req.query, range }); // applies to clicks + tx

    // Base ShortUrl filter (code/slug/provider)
    const baseFilter = {};
    if (q) {
      baseFilter.$or = [
        { code: new RegExp(q, 'i') },
        { slug: new RegExp(q, 'i') },
        { provider: new RegExp(q, 'i') }
      ];
    }

    // We also support searching user.name/email:
    // Do $lookup to users and then apply an OR match on user fields.
    const userSearch = q ? String(q).trim() : '';
    const userRegex = userSearch ? new RegExp(userSearch, 'i') : null;

    // Sorting key
    const sortKey =
      String(sort) === 'clicks' ? { clicks: -1, createdAt: -1 } :
      String(sort) === 'earnings' ? { commissionTotal: -1, createdAt: -1 } :
      { createdAt: -1 };

    const base = publicBase();

    /**
     * Pipeline explanation:
     * - ShortUrl -> lookup user
     * - compute clicks per slug (Click.customSlug) in date range
     * - compute clickIds per slug in date range
     * - compute tx metrics for those clickIds in date range
     * - add fields + sort globally + paginate
     */
    const pipeline = [];

    // 1) ShortUrl base filter
    if (Object.keys(baseFilter).length) pipeline.push({ $match: baseFilter });

    // 2) join user
    pipeline.push(
      {
        $lookup: {
          from: 'users',
          localField: 'user',
          foreignField: '_id',
          as: 'userObj'
        }
      },
      { $unwind: { path: '$userObj', preserveNullAndEmptyArrays: true } }
    );

    // 3) user search (optional) - OR with existing q on code/slug/provider already handled above
    // If q exists, we allow match where (shortUrl fields OR user fields).
    // Since baseFilter already applied, we need to re-include user matches too.
    if (userRegex) {
      // If baseFilter was applied, this would exclude pure user matches.
      // So instead: rebuild OR in a single $match if q exists.
      // Easiest: if q exists, DO NOT apply baseFilter earlier; apply combined match here.
      // We'll handle this by injecting a combined match now and removing earlier match if needed.
    }

    // Rebuild combined match for q (code/slug/provider/user)
    if (q) {
      // Remove earlier $match (if any) and use a combined match here
      // (Mongo doesn't let us "remove", but we can just not add the earlier match; implemented by moving logic here)
    }

    // To keep file simple and correct, we’ll build a combined match stage now:
    // If q exists, match if ANY of:
    // - code/slug/provider matches
    // - userObj.name/email matches
    if (q) {
      // If we already pushed a baseFilter $match, it might filter too hard.
      // So: only push baseFilter when q is empty. When q exists, use combined match.
      // (Hence, we need to fix earlier part:)
    }

    // --- FIX: rebuild pipeline from scratch correctly ---
    const pipeline2 = [];

    // always join user first, then combined q match (so user search works)
    pipeline2.push(
      { $match: baseFilter && !q ? baseFilter : {} },
      {
        $lookup: {
          from: 'users',
          localField: 'user',
          foreignField: '_id',
          as: 'userObj'
        }
      },
      { $unwind: { path: '$userObj', preserveNullAndEmptyArrays: true } }
    );

    if (q) {
      const rx = new RegExp(String(q), 'i');
      pipeline2.push({
        $match: {
          $or: [
            { code: rx },
            { slug: rx },
            { provider: rx },
            { 'userObj.name': rx },
            { 'userObj.email': rx }
          ]
        }
      });
    }

    // 4) Lookup clicks stats for this slug (clicks count + clickIds list) within date range
    const clickMatchExpr = [{ $eq: ['$customSlug', '$$slug'] }];
    if (Object.keys(dateMatch).length) {
      const c = dateMatch.createdAt || {};
      if (c.$gte) clickMatchExpr.push({ $gte: ['$createdAt', c.$gte] });
      if (c.$lte) clickMatchExpr.push({ $lte: ['$createdAt', c.$lte] });
    }

    pipeline2.push({
      $lookup: {
        from: 'clicks',
        let: { slug: '$slug' },
        pipeline: [
          { $match: { $expr: { $and: clickMatchExpr } } },
          {
            $group: {
              _id: '$customSlug',
              clicks: { $sum: 1 },
              clickIds: { $addToSet: '$clickId' }
            }
          },
          { $project: { _id: 0, clicks: 1, clickIds: 1 } }
        ],
        as: 'clickAgg'
      }
    });

    pipeline2.push({
      $addFields: {
        clicks: { $ifNull: [{ $arrayElemAt: ['$clickAgg.clicks', 0] }, 0] },
        clickIds: { $ifNull: [{ $arrayElemAt: ['$clickAgg.clickIds', 0] }, []] }
      }
    });

    // 5) Lookup transactions metrics by clickIds within date range
    const txMatchExpr = [{ $in: ['$clickId', '$$clickIds'] }];
    if (Object.keys(dateMatch).length) {
      const t = dateMatch.createdAt || {};
      if (t.$gte) txMatchExpr.push({ $gte: ['$createdAt', t.$gte] });
      if (t.$lte) txMatchExpr.push({ $lte: ['$createdAt', t.$lte] });
    }

    pipeline2.push({
      $lookup: {
        from: 'transactions',
        let: { clickIds: '$clickIds' },
        pipeline: [
          { $match: { $expr: { $and: txMatchExpr } } },
          {
            $group: {
              _id: '$status',
              conversions: { $sum: 1 },
              commission: { $sum: { $ifNull: ['$commissionAmount', 0] } }
            }
          }
        ],
        as: 'txByStatus'
      }
    });

    // fold status groups into totals
    pipeline2.push({
      $addFields: {
        conversions: {
          $sum: '$txByStatus.conversions'
        },
        commissionTotal: {
          $sum: '$txByStatus.commission'
        },
        approvedCommission: {
          $sum: {
            $map: {
              input: {
                $filter: {
                  input: '$txByStatus',
                  as: 'r',
                  cond: { $in: ['$$r._id', ['approved', 'confirmed']] }
                }
              },
              as: 'x',
              in: '$$x.commission'
            }
          }
        },
        pendingCommission: {
          $sum: {
            $map: {
              input: {
                $filter: {
                  input: '$txByStatus',
                  as: 'r',
                  cond: { $in: ['$$r._id', ['pending', 'under_review']] }
                }
              },
              as: 'x',
              in: '$$x.commission'
            }
          }
        }
      }
    });

    // 6) Project final shape
    pipeline2.push({
      $project: {
        _id: 0,
        code: 1,
        slug: 1,
        provider: 1,
        createdAt: 1,
        user: {
          _id: '$userObj._id',
          name: '$userObj.name',
          email: '$userObj.email'
        },
        clicks: 1,
        conversions: 1,
        commissionTotal: { $round: ['$commissionTotal', 2] },
        approvedCommission: { $round: ['$approvedCommission', 2] },
        pendingCommission: { $round: ['$pendingCommission', 2] }
      }
    });

    // 7) Global sort (THIS is the main fix)
    pipeline2.push({ $sort: sortKey });

    // 8) pagination using $facet so total matches same filters
    pipeline2.push({
      $facet: {
        meta: [{ $count: 'total' }],
        items: [
          { $skip: (pageNum - 1) * limitNum },
          { $limit: limitNum }
        ]
      }
    });

    const [out] = await ShortUrl.aggregate(pipeline2);
    const total = out?.meta?.[0]?.total || 0;
    const rows = Array.isArray(out?.items) ? out.items : [];

    const items = rows.map(r => ({
      ...r,
      shortUrl: `${base}/${r.code}`
    }));

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