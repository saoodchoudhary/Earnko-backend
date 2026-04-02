const express = require('express');
const mongoose = require('mongoose');
const { auth } = require('../../middleware/auth');

const Transaction = require('../../models/Transaction');
const Click = require('../../models/Click');
const ShortUrl = require('../../models/ShortUrl');

const router = express.Router();

function publicSiteBase() {
  return (process.env.PUBLIC_SITE_URL || process.env.FRONTEND_URL || 'https://earnko.com').replace(/\/+$/, '');
}
function buildPublicShortUrl(code) {
  return `${publicSiteBase()}/${code}`;
}

function safeDate(v) {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

function bestEffortProductTitle(tx) {
  const t = tx?.trackingData || {};
  return (
    t.productTitle ||
    t.title ||
    t.product_name ||
    t.productName ||
    t.offer_name || // common in some postbacks
    tx?.notes ||
    null
  );
}

function bestEffortProductUrl(tx) {
  const t = tx?.trackingData || {};
  return t.productUrl || t.url || t.destinationUrl || t.lp || null;
}

// GET /api/user/reports/orders
router.get('/orders', auth, async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const {
      status = '',
      storeId = '',
      from = '',
      to = '',
      q = '',
      page = '1',
      limit = '20'
    } = req.query;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

    const query = { user: new mongoose.Types.ObjectId(userId) };

    // status filter (allow pending/confirmed/cancelled/under_review + also legacy approved/rejected)
    if (status && status !== 'all') {
      query.status = String(status);
    }

    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
      query.store = new mongoose.Types.ObjectId(storeId);
    }

    const fromD = safeDate(from);
    const toD = safeDate(to);
    if (fromD || toD) {
      query.createdAt = {};
      if (fromD) query.createdAt.$gte = fromD;
      if (toD) query.createdAt.$lte = toD;
    }

    // We’ll do best-effort q filtering after fetch (because product title is in trackingData mixed)
    const skip = (pageNum - 1) * limitNum;

    const [rows, totalRaw] = await Promise.all([
      Transaction.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .populate('store', 'name affiliateNetwork baseUrl trackingUrl')
        .lean(),
      Transaction.countDocuments(query)
    ]);

    // Build clickId set for source mapping
    const clickIds = Array.from(new Set(rows.map(r => r.clickId).filter(Boolean).map(String)));

    const clicks = clickIds.length
      ? await Click.find({ user: userId, clickId: { $in: clickIds } })
          .select('clickId customSlug')
          .lean()
      : [];

    const slugByClickId = new Map();
    clicks.forEach(c => {
      if (c?.clickId && c?.customSlug) slugByClickId.set(String(c.clickId), String(c.customSlug));
    });

    const slugs = Array.from(new Set(Array.from(slugByClickId.values()).filter(Boolean)));

    const shortUrls = slugs.length
      ? await ShortUrl.find({ user: userId, slug: { $in: slugs } })
          .select('code slug')
          .lean()
      : [];

    const codeBySlug = new Map();
    shortUrls.forEach(su => {
      if (su?.slug && su?.code) codeBySlug.set(String(su.slug), String(su.code));
    });

    let items = rows.map(tx => {
      const clickId = tx.clickId ? String(tx.clickId) : '';
      const slug = clickId ? (slugByClickId.get(clickId) || '') : '';
      const code = slug ? (codeBySlug.get(slug) || '') : '';

      return {
        id: String(tx._id),

        store: tx.store
          ? { _id: String(tx.store._id), name: tx.store.name || '' }
          : null,

        status: String(tx.status || ''),
        orderId: String(tx.orderId || ''),
        orderDate: tx.orderDate || tx.createdAt || null,

        amount: Number(tx.productAmount || 0),
        commission: Number(tx.commissionAmount || 0),

        clickId: clickId || null,

        source: {
          slug: slug || null,
          shortCode: code || null,
          shortUrl: code ? buildPublicShortUrl(code) : null
        },

        product: {
          title: bestEffortProductTitle(tx),
          url: bestEffortProductUrl(tx)
        },

        raw: {
          trackingData: tx.trackingData || null,
          affiliateData: tx.affiliateData || null
        }
      };
    });

    // Apply q filtering (client search)
    const qStr = String(q || '').trim().toLowerCase();
    if (qStr) {
      items = items.filter(it => {
        const a = (it.orderId || '').toLowerCase();
        const b = (it.product?.title || '').toLowerCase();
        const c = (it.store?.name || '').toLowerCase();
        return a.includes(qStr) || b.includes(qStr) || c.includes(qStr);
      });
    }

    // NOTE: totalRaw is total before q filter. If you want total after q, you need another query/aggregation.
    // For now, keep it simple.
    return res.json({
      success: true,
      data: {
        items,
        total: totalRaw,
        page: pageNum,
        totalPages: Math.ceil(totalRaw / limitNum)
      }
    });
  } catch (err) {
    console.error('user reports/orders error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;