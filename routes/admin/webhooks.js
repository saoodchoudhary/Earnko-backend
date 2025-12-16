const express = require('express');
const mongoose = require('mongoose');
const { adminAuth } = require('../../middleware/auth');
const WebhookEvent = require('../../models/WebhookEvent');

const router = express.Router();

// List webhook events with filters
router.get('/', adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20, status = '', source = '', q = '' } = req.query;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

    const filter = {};
    if (status) filter.status = status;
    if (source) filter.source = source;
    if (q) filter.eventType = new RegExp(q, 'i');

    const [items, total] = await Promise.all([
      WebhookEvent.find(filter).sort('-createdAt').skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
      WebhookEvent.countDocuments(filter),
    ]);

    res.json({ success: true, data: { items, total, totalPages: Math.ceil(total / limitNum), currentPage: pageNum } });
  } catch (err) {
    console.error('List webhook events error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Detail
router.get('/:id', adminAuth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success:false, message:'Invalid id' });
    const item = await WebhookEvent.findById(req.params.id).populate('transaction').lean();
    if (!item) return res.status(404).json({ success:false, message:'Not found' });
    res.json({ success: true, data: { item } });
  } catch (err) {
    console.error('Get webhook event error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Mark processed or error
router.patch('/:id/mark', adminAuth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success:false, message:'Invalid id' });
    const { status, error } = req.body || {};
    if (!['processed','error','received'].includes(status)) return res.status(400).json({ success:false, message:'Invalid status' });
    const item = await WebhookEvent.findByIdAndUpdate(req.params.id, {
      status, error: status === 'error' ? (error || 'manual') : null,
      processedAt: status === 'processed' ? new Date() : null,
    }, { new: true });
    if (!item) return res.status(404).json({ success:false, message:'Not found' });
    res.json({ success: true, data: { item } });
  } catch (err) {
    console.error('Mark webhook event error:', err);
    res.status(400).json({ success: false, message: err.message || 'Bad request' });
  }
});

module.exports = router;