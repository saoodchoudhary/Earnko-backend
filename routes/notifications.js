const express = require('express');
const { auth } = require('../middleware/auth');
const Notification = require('../models/Notification');

const router = express.Router();

/**
 * GET /api/notifications
 */
router.get('/', auth, async (req, res) => {
  try {
    const items = await Notification.find({ user: req.user._id }).sort('-createdAt').lean();
    res.json({ success: true, data: { items } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;