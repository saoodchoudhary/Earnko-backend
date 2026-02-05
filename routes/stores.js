const express = require('express');
const { auth } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const Store = require('../models/Store');

const router = express.Router();

// Public list
router.get('/', async (_req, res) => {
  try {
    const stores = await Store.find({ isActive: true }).sort({ name: 1 }).lean();
    res.json({ success: true, data: { stores } });
  } catch (err) {
    console.error('List stores error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Public get by id
router.get('/:id', async (req, res) => {
  try {
    const store = await Store.findById(req.params.id).lean();
    if (!store) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: { store } });
  } catch (err) {
    console.error('Get store error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Admin create
router.post('/', auth, requireRole('admin'), async (req, res) => {
  try {
    const store = await Store.create(req.body);
    res.status(201).json({ success: true, data: { store } });
  } catch (err) {
    console.error('Create store error:', err);
    res.status(400).json({ success: false, message: 'Bad request', error: err.message });
  }
});

// Admin update
router.put('/:id', auth, requireRole('admin'), async (req, res) => {
  try {
    const store = await Store.findByIdAndUpdate(req.params.id, req.body, { new: true }).lean();
    if (!store) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: { store } });
  } catch (err) {
    console.error('Update store error:', err);
    res.status(400).json({ success: false, message: 'Bad request', error: err.message });
  }
});

module.exports = router;