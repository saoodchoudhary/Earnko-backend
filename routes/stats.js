const express  = require('express');
const router   = express.Router();
const User         = require('../models/User');
const ShortUrl     = require('../models/ShortUrl');
const Commission   = require('../models/Commission');
const Transaction  = require('../models/Transaction');
const Store        = require('../models/Store');

/* ─────────────────────────────────────────
   In-memory cache — DB pe baar baar hit
   na ho, 5 minute mein refresh
───────────────────────────────────────── */
let statsCache = null;
let cacheSetAt = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function computeStats() {
  const now = Date.now();

  // Cache valid hai toh wahi return karo
  if (statsCache && now - cacheSetAt < CACHE_TTL) {
    return statsCache;
  }

  // Last 30 days ka date
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
  const sixtyDaysAgo  = new Date(now - 60 * 24 * 60 * 60 * 1000);

  // Parallel queries — sab ek saath chalega
  const [
    totalUsers,
    prevMonthUsers,
    totalLinks,
    prevMonthLinks,
    totalStores,
    prevMonthStores,
    payoutAgg,
    prevPayoutAgg,
  ] = await Promise.all([

    // Current users
    User.countDocuments({ isActive: true }),

    // Previous month users (trend ke liye)
    User.countDocuments({
      isActive: true,
      createdAt: { $lte: thirtyDaysAgo },
    }),

    // Total short links generated
    ShortUrl.countDocuments({}),

    // Previous month links
    ShortUrl.countDocuments({
      createdAt: { $lte: thirtyDaysAgo },
    }),

    // Active stores
    Store.countDocuments({ isActive: true }),

    // Prev month stores
    Store.countDocuments({
      isActive: true,
      createdAt: { $lte: thirtyDaysAgo },
    }),

    // Total payout — confirmed commissions sum
    Commission.aggregate([
      { $match: { status: 'confirmed' } },
      { $group: { _id: null, total: { $sum: '$commissionAmount' } } },
    ]),

    // Prev month payout (trend ke liye)
    Commission.aggregate([
      {
        $match: {
          status: 'confirmed',
          createdAt: { $lte: thirtyDaysAgo },
        },
      },
      { $group: { _id: null, total: { $sum: '$commissionAmount' } } },
    ]),
  ]);

  /* ── Trend calculate karo ── */
  function calcTrend(current, previous) {
    if (!previous || previous === 0) return '+100%';
    const diff = ((current - previous) / previous) * 100;
    const sign = diff >= 0 ? '+' : '';
    return `${sign}${Math.round(diff)}%`;
  }

  const currentPayout  = payoutAgg[0]?.total  ?? 0;
  const previousPayout = prevPayoutAgg[0]?.total ?? 0;

  const stats = {
    payout: Math.round(currentPayout),
    payoutTrend: calcTrend(currentPayout, previousPayout),

    users: totalUsers,
    usersTrend: calcTrend(totalUsers, prevMonthUsers),

    links: totalLinks,
    linksTrend: calcTrend(totalLinks, prevMonthLinks),

    stores: totalStores,
    storesTrend: calcTrend(totalStores, prevMonthStores),

    _cachedAt: new Date().toISOString(),
  };

  // Cache set karo
  statsCache = stats;
  cacheSetAt = now;

  return stats;
}

/* ─────────────────────────────────────────
   GET /api/stats/public
   Public route — no auth required
   CORS allow for Next.js frontend
───────────────────────────────────────── */
router.get('/public', async (req, res) => {
  try {
    const stats = await computeStats();

    // Cache-Control header — CDN/browser bhi cache karega
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');

    return res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (err) {
    console.error('[stats/public] Error:', err.message);

    // Error pe bhi fallback data do — frontend crash na ho
    return res.status(200).json({
      success: false,
      data: {
        payout:      24_00_00_000,
        payoutTrend: '+18%',
        users:       1_20_000,
        usersTrend:  '+32%',
        links:       85_00_000,
        linksTrend:  '+41%',
        stores:      200,
        storesTrend: '+12%',
        _fallback:   true,
      },
    });
  }
});

/* ─────────────────────────────────────────
   POST /api/stats/cache/clear
   Admin only — manually cache clear karne ke liye
───────────────────────────────────────── */
router.post('/cache/clear', async (req, res) => {
  // Simple secret key check
  const secret = req.headers['x-admin-secret'];
  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  statsCache = null;
  cacheSetAt = 0;
  return res.status(200).json({ success: true, message: 'Cache cleared' });
});

module.exports = router;