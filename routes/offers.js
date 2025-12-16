const express = require('express');
const { auth } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const Commission = require('../models/Commission');

const router = express.Router();

// List offers (commissions) — public
router.get('/', async (req, res) => {
  try {
    const { storeId } = req.query;
    const query = storeId ? { store: storeId, active: true } : { active: true };
    const offers = await Commission.find(query).populate('store').sort({ updatedAt: -1 });
    res.json({ success:true, data: { offers } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success:false, message:'Server error' });
  }
});

// Offer by id — public
router.get('/:id', async (req, res) => {
  try {
    const offer = await Commission.findById(req.params.id).populate('store');
    if (!offer) return res.status(404).json({ success:false, message:'Not found' });
    res.json({ success:true, data: { offer } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success:false, message:'Server error' });
  }
});

// Create offer (admin)
router.post('/', auth, requireRole('admin'), async (req, res) => {
  try {
    const offer = await Commission.create(req.body);
    res.status(201).json({ success:true, data: { offer } });
  } catch (err) {
    console.error(err);
    res.status(400).json({ success:false, message:'Bad request', error: err.message });
  }
});

// Update offer (admin)
router.put('/:id', auth, requireRole('admin'), async (req, res) => {
  try {
    const offer = await Commission.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!offer) return res.status(404).json({ success:false, message:'Not found' });
    res.json({ success:true, data: { offer } });
  } catch (err) {
    console.error(err);
    res.status(400).json({ success:false, message:'Bad request', error: err.message });
  }
});

module.exports = router;