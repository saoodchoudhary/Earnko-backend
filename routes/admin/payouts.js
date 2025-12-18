const express = require('express');
const { auth } = require('../../middleware/auth');
const { requireRole } = require('../../middleware/roles');
const mongoose = require('mongoose');
const AffiliatePayout = require('../../models/AffiliatePayout');
const User = require('../../models/User');
const Commission = require('../../models/Commission');
const Transaction = require('../../models/Transaction');
const Click = require('../../models/Click');

const router = express.Router();

/**
 * GET /api/admin/payouts
 * Query: status? (pending|approved|processed|rejected)
 */
router.get('/', auth, requireRole('admin'), async (req, res) => {
  try {
    const { status } = req.query;
    const filter = {};
    if (status) filter.status = status;

    const payouts = await AffiliatePayout.find(filter)
      .sort({ createdAt: -1 })
      .populate('affiliate', 'name email')
      .lean();

    res.json({ success: true, data: { payouts } });
  } catch (err) {
    console.error('Admin list payouts error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * GET /api/admin/payouts/:id
 * Returns payout details + affiliate metrics:
 * - linkPerformance: [{ slug, storeName, clicks, conversions, commission }]
 * - referrals: [{ _id, name, email, createdAt }]
 * - referralEarnings: number (from wallet.referralEarnings if tracked)
 */
router.get('/:id', auth, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ success: false, message: 'Invalid id' });

    const payout = await AffiliatePayout.findById(id)
      .populate('affiliate', 'name email wallet')
      .lean();
    if (!payout) return res.status(404).json({ success: false, message: 'Not found' });

    const affiliateId = payout.affiliate?._id;
    if (!affiliateId) {
      return res.json({ success: true, data: { payout, linkPerformance: [], referrals: [], referralEarnings: 0 } });
    }

    // Aggregate commissions by transaction.clickId -> Click.slug/customSlug
    const commissions = await Commission.find({ affiliate: affiliateId }).populate('transaction', 'clickId').lean();
    const clickIds = Array.from(new Set(commissions.map(c => c.transaction?.clickId).filter(Boolean)));
    const clicks = clickIds.length
      ? await Click.find({ clickId: { $in: clickIds } }).select('clickId customSlug slug store').populate('store', 'name').lean()
      : [];

    const clickById = new Map();
    clicks.forEach(cl => clickById.set(cl.clickId, cl));

    // conversions and commission grouped by slug
    const perfMap = new Map(); // slug -> { slug, storeName, conversions, commission }
    commissions.forEach(c => {
      const cl = c.transaction?.clickId ? clickById.get(c.transaction.clickId) : null;
      const slug = cl?.customSlug || cl?.slug || 'unknown';
      const storeName = cl?.store?.name || '-';
      const cur = perfMap.get(slug) || { slug, storeName, conversions: 0, commission: 0 };
      cur.conversions += 1;
      cur.commission += Number(c.amount || c.commissionAmount || 0);
      perfMap.set(slug, cur);
    });

    // clicks count per slug for this affiliate
    const clicksAgg = await Click.aggregate([
      { $match: { user: new mongoose.Types.ObjectId(affiliateId) } },
      { $group: {
        _id: { $ifNull: ['$customSlug', '$slug'] },
        clicks: { $sum: 1 }
      } },
      { $project: { _id: 0, slug: '$_id', clicks: 1 } }
    ]);
    const clicksBySlug = new Map();
    clicksAgg.forEach(c => clicksBySlug.set(c.slug, c.clicks));

    const linkPerformance = Array.from(perfMap.values()).map(x => ({
      ...x,
      clicks: clicksBySlug.get(x.slug) || 0,
      commission: Math.round(Number(x.commission || 0)),
    })).sort((a, b) => b.commission - a.commission);

    // Referrals (if tracked via User.referredBy)
    const referrals = await User.find({ referredBy: affiliateId }).select('name email createdAt').lean();
    const referralEarnings = Number(payout.affiliate?.wallet?.referralEarnings || 0);

    res.json({
      success: true,
      data: { payout, linkPerformance, referrals, referralEarnings }
    });
  } catch (err) {
    console.error('Admin payout detail error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * PUT /api/admin/payouts/:id/status
 * body: { status, transactionReference?, adminNotes? }
 * Allowed statuses: pending|approved|processed|rejected
 * Effects:
 *  - processed: add amount to user's wallet.totalWithdrawn
 *  - rejected: return amount to user's wallet.availableBalance
 */
router.put('/:id/status', auth, requireRole('admin'), async (req, res) => {
  try {
    const { status, transactionReference, adminNotes } = req.body;
    const allowed = ['pending', 'approved', 'processed', 'rejected'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const payout = await AffiliatePayout.findById(req.params.id);
    if (!payout) return res.status(404).json({ success: false, message: 'Not found' });

    const oldStatus = payout.status;
    payout.status = status;
    if (transactionReference) payout.transactionReference = transactionReference;
    if (adminNotes) payout.adminNotes = adminNotes;
    if (status === 'processed') payout.processedAt = new Date();

    await payout.save();

    // Wallet side-effects
    if (oldStatus !== 'processed' && status === 'processed') {
      await User.updateOne(
        { _id: payout.affiliate },
        { $inc: { 'wallet.totalWithdrawn': payout.amount } }
      );
    } else if (oldStatus !== 'rejected' && status === 'rejected') {
      await User.updateOne(
        { _id: payout.affiliate },
        { $inc: { 'wallet.availableBalance': payout.amount } }
      );
    }

    res.json({ success: true, data: { payout } });
  } catch (err) {
    console.error('Admin update payout error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;