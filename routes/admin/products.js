const express = require('express');
const mongoose = require('mongoose');
const { adminAuth } = require('../../middleware/auth');
const Product = require('../../models/Product');

const router = express.Router();

/**
 * GET /api/admin/products
 * Query: page, limit, q, storeId, isActive
 */
router.get('/', adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20, q = '', storeId = '', isActive = '' } = req.query;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const filter = {};
    if (q) filter.$or = [{ title: new RegExp(q, 'i') }, { description: new RegExp(q, 'i') }];
    if (storeId && mongoose.isValidObjectId(storeId)) filter.store = storeId;
    if (isActive === 'true') filter.isActive = true;
    if (isActive === 'false') filter.isActive = false;

    const [items, total] = await Promise.all([
      Product.find(filter).populate('store', 'name').sort('-updatedAt').skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
      Product.countDocuments(filter),
    ]);

    res.json({ success: true, data: { items, total, totalPages: Math.ceil(total / limitNum), currentPage: pageNum } });
  } catch (err) {
    console.error('admin products list error', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * POST /api/admin/products
 */
router.post('/', adminAuth, async (req, res) => {
  try {
    const item = await Product.create(req.body);
    const populated = await Product.findById(item._id).populate('store', 'name');
    res.status(201).json({ success: true, data: { item: populated } });
  } catch (err) {
    console.error('admin create product error', err);
    res.status(400).json({ success: false, message: err.message || 'Bad request' });
  }
});

/**
 * GET /api/admin/products/:id
 */
router.get('/:id', adminAuth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    const item = await Product.findById(req.params.id).populate('store', 'name').lean();
    if (!item) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: { item } });
  } catch (err) {
    console.error('admin get product error', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * PATCH /api/admin/products/:id
 */
router.patch('/:id', adminAuth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    const item = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true }).populate('store', 'name');
    if (!item) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: { item } });
  } catch (err) {
    console.error('admin update product error', err);
    res.status(400).json({ success: false, message: err.message || 'Bad request' });
  }
});

/**
 * DELETE /api/admin/products/:id
 */
router.delete('/:id', adminAuth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    await Product.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    console.error('admin delete product error', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

module.exports = router;