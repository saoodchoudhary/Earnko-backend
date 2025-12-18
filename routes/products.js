const express = require('express');
const mongoose = require('mongoose');
const Product = require('../models/Product');

const router = express.Router();

/**
 * GET /api/products
 * Public product listing (active only)
 * Query: storeId?, q?, page?, limit?
 */
router.get('/', async (req, res) => {
  try {
    const { storeId = '', q = '', page = 1, limit = 24 } = req.query;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 24, 1), 100);

    const filter = { isActive: true };
    if (storeId && mongoose.isValidObjectId(storeId)) filter.store = storeId;
    if (q) filter.$or = [{ title: new RegExp(q, 'i') }, { description: new RegExp(q, 'i') }];

    const [items, total] = await Promise.all([
      Product.find(filter).populate('store', 'name').sort('-updatedAt').skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
      Product.countDocuments(filter),
    ]);

    res.json({ success: true, data: { items, total, currentPage: pageNum, totalPages: Math.ceil(total / limitNum) } });
  } catch (err) {
    console.error('public products error', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;