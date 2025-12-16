const express = require('express');
const { auth } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const Store = require('../models/Store');

const router = express.Router();

// List stores (public)

// Public list (used by admin UI selects too)
router.get('/', async (req, res) => {
  try {
    const stores = await Store.find({ isActive: true }).sort({ name: 1 }).lean();
    res.json({ success: true, data: { stores } });
  } catch (err) {
    console.error('List stores error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

module.exports = router;

// Get store by id (public)
router.get('/:id', async (req, res) => {
  try {
    const store = await Store.findById(req.params.id);
    if (!store) return res.status(404).json({ success:false, message:'Not found' });
    res.json({ success:true, data: { store } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success:false, message:'Server error' });
  }
});

// Create store (admin)
router.post('/', auth, requireRole('admin'), async (req, res) => {
  try {
    const store = await Store.create(req.body);
    res.status(201).json({ success:true, data: { store } });
  } catch (err) {
    console.error(err);
    res.status(400).json({ success:false, message:'Bad request', error: err.message });
  }
});

// Update store (admin)
router.put('/:id', auth, requireRole('admin'), async (req, res) => {
  try {
    const store = await Store.findByIdAndUpdate(req.params.id, req.body, { new:true });
    if (!store) return res.status(404).json({ success:false, message:'Not found' });
    res.json({ success:true, data: { store } });
  } catch (err) {
    console.error(err);
    res.status(400).json({ success:false, message:'Bad request', error: err.message });
  }
});

module.exports = router;