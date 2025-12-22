const express = require('express');
const mongoose = require('mongoose');
const { auth } = require('../../middleware/auth');
const User = require('../../models/User');
const Transaction = require('../../models/Transaction');

const router = express.Router();

/**
 * GET /api/user/links
 * Returns user's Cuelinks-generated links and stats:
 *  - subid, original Cuelinks URL
 *  - shareUrl (our wrapper)
 *  - clicks (tracked on wrapper)
 *  - approvedConversions (count)
 *  - approvedCommissionSum (₹)
 */
router.get('/', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).lean();
    const items = [];

    const base = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 8080}`;

    if (user && Array.isArray(user.affiliateInfo?.uniqueLinks)) {
      const cueLinks = user.affiliateInfo.uniqueLinks
        .filter(l => l?.metadata?.cuelinks?.subid)
        .map(l => ({
          subid: l.metadata.cuelinks.subid,
          cuelinksUrl: l.metadata.cuelinks.url,
          shareUrl: `${base}/api/links/open-cuelinks/${l.metadata.cuelinks.subid}`,
          clicks: Number(l.clicks || 0),
          createdAt: l.createdAt || null,
          productId: l.metadata?.productId || null,
          storeId: l.store || null
        }));

      // Compute approved conversion counts and commission sums per subid
      for (const it of cueLinks) {
        const agg = await Transaction.aggregate([
          { $match: {
            user: new mongoose.Types.ObjectId(req.user._id),
            clickId: it.subid,
            status: 'approved'
          } },
          { $group: {
            _id: '$clickId',
            count: { $sum: 1 },
            sumCommission: { $sum: { $ifNull: ['$commissionAmount', 0] } }
          } }
        ]);
        const row = agg[0] || { count: 0, sumCommission: 0 };
        items.push({
          ...it,
          approvedConversions: row.count || 0,
          approvedCommissionSum: Math.round(Number(row.sumCommission || 0))
        });
      }
    }

    res.json({ success: true, data: { items } });
  } catch (err) {
    console.error('user links error', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;