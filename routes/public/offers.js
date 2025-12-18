const express = require('express');
const mongoose = require('mongoose');
const CategoryCommission = require('../../models/CategoryCommission');
const Store = require('../../models/Store');

/**
 * Public offers listing based on CategoryCommission rules
 * Query: storeId? -> filters offers for a specific store
 */
const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { storeId } = req.query;
    const filter = { isActive: true };
    if (storeId && mongoose.isValidObjectId(storeId)) filter.store = storeId;

    const offers = await CategoryCommission.find(filter)
      .populate('store', 'name')
      .sort({ updatedAt: -1 })
      .lean();

    res.json({ success: true, data: { offers } });
  } catch (err) {
    console.error('public offers error', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;