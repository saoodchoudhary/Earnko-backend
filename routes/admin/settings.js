const express = require('express');
const { adminAuth } = require('../../middleware/auth');
const Setting = require('../../models/Setting');

const router = express.Router();

// List all settings (optionally by group)
router.get('/', adminAuth, async (req, res) => {
  try {
    const { group } = req.query;
    const filter = group ? { group } : {};
    const items = await Setting.find(filter).lean();
    res.json({ success: true, data: { items } });
  } catch (err) {
    console.error('List settings error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Get single key
router.get('/:key', adminAuth, async (req, res) => {
  try {
    const item = await Setting.findOne({ key: req.params.key }).lean();
    res.json({ success: true, data: { item } });
  } catch (err) {
    console.error('Get setting error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Upsert multiple settings
router.patch('/', adminAuth, async (req, res) => {
  try {
    const updates = req.body || {};
    const keys = Object.keys(updates);
    const results = [];
    for (const key of keys) {
      const { value, group = 'general', description = '' } = updates[key];
      const doc = await Setting.findOneAndUpdate(
        { key },
        { $set: { value, group, description } },
        { upsert: true, new: true }
      );
      results.push(doc);
    }
    res.json({ success: true, data: { items: results } });
  } catch (err) {
    console.error('Patch settings error:', err);
    res.status(400).json({ success: false, message: err.message || 'Bad request' });
  }
});

module.exports = router;