const express = require('express');
const mongoose = require('mongoose');
const { auth } = require('../../middleware/auth');
const Click = require('../../models/Click');

const router = express.Router();

/**
 * GET /api/user/clicks
 * Query: page, limit
 */
router.get('/', auth, async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const filter = { user: req.user._id };

    const [items, total] = await Promise.all([
      Click.find(filter).populate('store', 'name').sort('-createdAt').skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
      Click.countDocuments(filter),
    ]);

    res.json({ success: true, data: { items, total, currentPage: pageNum, totalPages: Math.ceil(total / limitNum) } });
  } catch (err) {
    console.error('user clicks error', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;