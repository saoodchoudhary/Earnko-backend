const express = require('express');
const jwt = require('jsonwebtoken');
const { auth } = require('../middleware/auth');
const User = require('../models/User');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';
const TELEGRAM_BOT_API_KEY = process.env.TELEGRAM_BOT_API_KEY || '';

function requireApiKey(req, res, next) {
  const key = req.get('x-api-key') || '';
  if (!TELEGRAM_BOT_API_KEY || key !== TELEGRAM_BOT_API_KEY) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  return next();
}

// 1) Website user connects telegram
router.post('/telegram/connect', auth, async (req, res) => {
  try {
    const telegramUserId = String(req.body?.telegramUserId || '').trim();
    const telegramUsername = String(req.body?.telegramUsername || '').trim();

    if (!telegramUserId) {
      return res.status(400).json({ success: false, message: 'telegramUserId required' });
    }

    // prevent same telegram being linked to multiple accounts
    const already = await User.findOne({ 'telegram.userId': telegramUserId }).select('_id').lean();
    if (already && String(already._id) !== String(req.user._id)) {
      return res.status(409).json({ success: false, message: 'This Telegram account is already connected to another user' });
    }

    await User.updateOne(
      { _id: req.user._id },
      {
        $set: {
          'telegram.userId': telegramUserId,
          'telegram.username': telegramUsername,
          'telegram.connectedAt': new Date()
        }
      }
    );

    return res.json({ success: true, data: { telegramUserId } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err?.message || 'Server error' });
  }
});

// 2) Make.com asks for a short-lived token for a telegram user
router.post('/telegram/bot-token', requireApiKey, async (req, res) => {
  try {
    const telegramUserId = String(req.body?.telegramUserId || '').trim();
    if (!telegramUserId) return res.status(400).json({ success: false, message: 'telegramUserId required' });

    const user = await User.findOne({ 'telegram.userId': telegramUserId }).select('_id accountStatus').lean();
    if (!user) return res.status(404).json({ success: false, message: 'User not connected. Ask them to /connect' });
    if (user.accountStatus && user.accountStatus !== 'active') {
      return res.status(403).json({ success: false, message: 'User account is not active' });
    }

    // token compatible with middleware/auth.js which expects decoded.userId
    const token = jwt.sign({ userId: String(user._id) }, JWT_SECRET, { expiresIn: '10m' });

    return res.json({ success: true, data: { token, expiresIn: 600 } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err?.message || 'Server error' });
  }
});

module.exports = router;