const express = require('express');
const mongoose = require('mongoose');
const { adminAuth } = require('../../middleware/auth');
const Click = require('../../models/Click');

const router = express.Router();

/**
 * GET /api/admin/clicks
 * Query: page, limit, q (slug/ip/ua), userId, storeId
 */
router.get('/', adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20, q = '', userId = '', storeId = '' } = req.query;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

    const filter = {};
    if (q) {
      filter.$or = [
        { customSlug: new RegExp(q, 'i') },
        { ipAddress: new RegExp(q, 'i') },
        { userAgent: new RegExp(q, 'i') },
      ];
    }
    if (userId && mongoose.isValidObjectId(userId)) filter.user = userId;
    if (storeId && mongoose.isValidObjectId(storeId)) filter.store = storeId;

    const [items, total] = await Promise.all([
      Click.find(filter).populate('user', 'email name').populate('store', 'name').sort('-createdAt').skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
      Click.countDocuments(filter),
    ]);

    res.json({ success: true, data: { items, total, totalPages: Math.ceil(total / limitNum), currentPage: pageNum } });
  } catch (err) {
    console.error('List clicks error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

module.exports = router;