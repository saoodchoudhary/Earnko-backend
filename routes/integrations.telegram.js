const express = require('express');
const mongoose = require('mongoose');
const { auth } = require('../middleware/auth');
const User = require('../models/User');
const { createAffiliateLinkStrict } = require('../services/linkifyService');

const router = express.Router();

/**
 * POST /api/integrations/telegram/connect
 * body: { telegramUserId }
 *
 * Frontend page: /telegram/connect already calls this with Bearer token from localStorage. citeturn9search0
 */
router.post('/telegram/connect', auth, async (req, res) => {
  try {
    const telegramUserId = String(req.body?.telegramUserId || '').trim();
    if (!telegramUserId) return res.status(400).json({ success: false, message: 'telegramUserId required' });

    // Save mapping on the logged-in user
    await User.updateOne(
      { _id: req.user._id },
      {
        $set: {
          'telegram.userId': telegramUserId,
          'telegram.connectedAt': new Date()
        }
      }
    );

    return res.json({ success: true, message: 'Connected' });
  } catch (err) {
    console.error('telegram connect error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * POST /api/integrations/telegram/link-from-url
 * body: { telegramUserId, url, storeId? }
 *
 * This is the key fix:
 * - Bot sends telegramUserId + url
 * - Backend finds linked user
 * - Runs the same link generation as website (createAffiliateLinkStrict)
 * - Returns only shareUrl (short link)
 */
router.post('/telegram/link-from-url', async (req, res) => {
  try {
    const telegramUserId = String(req.body?.telegramUserId || '').trim();
    const url = String(req.body?.url || '').trim();
    const storeId = req.body?.storeId || null;

    if (!telegramUserId) return res.status(400).json({ success: false, message: 'telegramUserId required' });
    if (!url) return res.status(400).json({ success: false, message: 'url required' });

    // find user linked to this telegram id
    const user = await User.findOne({ 'telegram.userId': telegramUserId });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Telegram not connected. Please run /connect.' });
    }

    // validate storeId if provided
    if (storeId && !mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ success: false, message: 'Invalid storeId' });
    }

    const result = await createAffiliateLinkStrict({ user, url, storeId: storeId || null });

    // Return only short link for Telegram
    return res.json({
      success: true,
      data: {
        shareUrl: result.shareUrl,
        slug: result.slug
      }
    });
  } catch (err) {
    console.error('telegram link-from-url error', err);
    const code = err?.code || '';
    const msg = err?.message || 'Server error';

    // Keep consistent client-facing statuses
    if (code === 'bad_request') return res.status(400).json({ success: false, message: msg });
    if (code === 'store_not_found_for_url') return res.status(400).json({ success: false, message: msg });
    if (code === 'store_network_missing') return res.status(400).json({ success: false, message: msg });
    if (code === 'realcash_missing_base') return res.status(400).json({ success: false, message: msg });

    return res.status(500).json({ success: false, message: msg });
  }
});

module.exports = router;