const express = require('express');
const CategoryCommission = require('../models/CategoryCommission');
const Store = require('../models/Store');

const router = express.Router();

/**
 * Public/Logged-in: Get category-wise profit/commission rates for a store.
 * GET /api/stores/:storeId/profit-rates
 */
router.get('/:storeId/profit-rates', async (req, res) => {
  try {
    const storeId = req.params.storeId;
    if (!storeId) return res.status(400).json({ success: false, message: 'storeId required' });

    const store = await Store.findById(storeId).lean();
    if (!store) return res.status(404).json({ success: false, message: 'Store not found' });

    // store-specific rules
    const storeRules = await CategoryCommission.find({ store: store._id, isActive: true })
      .sort({ categoryKey: 1 })
      .lean();

    // global rules (fallback)
    const globalRules = await CategoryCommission.find({ store: null, isActive: true })
      .sort({ categoryKey: 1 })
      .lean();

    // We will return both so UI can show clearly:
    // - store overrides
    // - global defaults
    return res.json({
      success: true,
      data: {
        store: { _id: store._id, name: store.name },
        storeRules: storeRules.map(r => ({
          _id: r._id,
          categoryKey: r.categoryKey,
          label: r.label || r.categoryKey,
          commissionRate: r.commissionRate,
          commissionType: r.commissionType,
          maxCap: r.maxCap ?? null
        })),
        globalRules: globalRules.map(r => ({
          _id: r._id,
          categoryKey: r.categoryKey,
          label: r.label || r.categoryKey,
          commissionRate: r.commissionRate,
          commissionType: r.commissionType,
          maxCap: r.maxCap ?? null
        }))
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err?.message || 'Server error' });
  }
});

module.exports = router;