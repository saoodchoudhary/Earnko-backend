const express = require('express');
const mongoose = require('mongoose');
const { adminAuth } = require('../../middleware/auth');
const CategoryCommission = require('../../models/CategoryCommission');

const router = express.Router();

/**
 * GET /api/admin/category-commissions
 * Query: page, limit, q (label/categoryKey), storeId, isActive
 */
router.get('/', adminAuth, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      q = '',
      storeId = '',
      isActive = '',
      sort = '-updatedAt'
    } = req.query;

    const filter = {};
    if (q) filter.$or = [{ label: new RegExp(q, 'i') }, { categoryKey: new RegExp(q, 'i') }];
    if (storeId && mongoose.isValidObjectId(storeId)) filter.store = storeId;
    if (isActive === 'true') filter.isActive = true;
    if (isActive === 'false') filter.isActive = false;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

    const [items, total] = await Promise.all([
      CategoryCommission.find(filter).populate('store', 'name').sort(sort).skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
      CategoryCommission.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: { items, total, totalPages: Math.ceil(total / limitNum), currentPage: pageNum }
    });
  } catch (err) {
    console.error('List category-commissions error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * POST /api/admin/category-commissions
 * body: { store, categoryKey, label, commissionRate, commissionType, maxCap, isActive, metadata }
 */
router.post('/', adminAuth, async (req, res) => {
  try {
    const cc = await CategoryCommission.create(req.body);
    const populated = await CategoryCommission.findById(cc._id).populate('store', 'name');
    res.status(201).json({ success: true, data: { item: populated } });
  } catch (err) {
    console.error('Create category-commission error:', err);
    res.status(400).json({ success: false, message: err.message || 'Bad request' });
  }
});

/**
 * GET /api/admin/category-commissions/:id
 */
router.get('/:id', adminAuth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    const item = await CategoryCommission.findById(req.params.id).populate('store', 'name');
    if (!item) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: { item } });
  } catch (err) {
    console.error('Get category-commission error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * PATCH /api/admin/category-commissions/:id
 */
router.patch('/:id', adminAuth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    const item = await CategoryCommission.findByIdAndUpdate(req.params.id, req.body, { new: true }).populate('store', 'name');
    if (!item) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: { item } });
  } catch (err) {
    console.error('Update category-commission error:', err);
    res.status(400).json({ success: false, message: err.message || 'Bad request' });
  }
});

/**
 * DELETE /api/admin/category-commissions/:id
 */
router.delete('/:id', adminAuth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    await CategoryCommission.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    console.error('Delete category-commission error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

module.exports = router;