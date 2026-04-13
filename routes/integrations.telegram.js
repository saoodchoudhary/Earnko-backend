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
 * Used by frontend page: /telegram/connect?tgId=...
 */
router.post('/telegram/connect', auth, async (req, res) => {
  try {
    const telegramUserId = String(req.body?.telegramUserId || '').trim();
    if (!telegramUserId) return res.status(400).json({ success: false, message: 'telegramUserId required' });

    await User.updateOne(
      { _id: req.user._id },
      { $set: { 'telegram.userId': telegramUserId, 'telegram.connectedAt': new Date() } }
    );

    return res.json({ success: true, message: 'Connected' });
  } catch (err) {
    console.error('telegram connect error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

function safeUrlList(urls) {
  const list = Array.isArray(urls) ? urls : [];
  return list
    .map(u => String(u || '').trim())
    .filter(Boolean)
    .filter(u => {
      try { new URL(u); return true; } catch { return false; }
    });
}

function mapErrorToStatus(err) {
  const code = err?.code || '';
  if (code === 'bad_request') return 400;
  if (code === 'store_not_found_for_url') return 400;
  if (code === 'store_network_missing') return 400;
  if (code === 'realcash_missing_base') return 400;
  if (code === 'ajio_app_link_not_supported') return 400;
  return 500;
}

/**
 * POST /api/integrations/telegram/link-from-url
 * body: { telegramUserId, url, storeId? }
 * returns: { shareUrl, slug }
 */
router.post('/telegram/link-from-url', async (req, res) => {
  try {
    const telegramUserId = String(req.body?.telegramUserId || '').trim();
    const url = String(req.body?.url || '').trim();
    const storeId = req.body?.storeId || null;

    if (!telegramUserId) return res.status(400).json({ success: false, message: 'telegramUserId required' });
    if (!url) return res.status(400).json({ success: false, message: 'url required' });

    if (storeId && !mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ success: false, message: 'Invalid storeId' });
    }

    const user = await User.findOne({ 'telegram.userId': telegramUserId });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Telegram not connected. Please run /connect.' });
    }

    const result = await createAffiliateLinkStrict({ user, url, storeId: storeId || null });

    return res.json({
      success: true,
      data: { shareUrl: result.shareUrl, slug: result.slug }
    });
  } catch (err) {
    console.error('telegram link-from-url error', err);
    return res.status(mapErrorToStatus(err)).json({ success: false, message: err?.message || 'Server error' });
  }
});

/**
 * POST /api/integrations/telegram/link-from-url/bulk
 * body: { telegramUserId, urls: [ ... ], storeId? }
 *
 * returns:
 * { results: [{ inputUrl, success, shareUrl?, slug?, message? }] }
 */
router.post('/telegram/link-from-url/bulk', async (req, res) => {
  try {
    const telegramUserId = String(req.body?.telegramUserId || '').trim();
    const storeId = req.body?.storeId || null;

    if (!telegramUserId) return res.status(400).json({ success: false, message: 'telegramUserId required' });
    if (storeId && !mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ success: false, message: 'Invalid storeId' });
    }

    const urls = safeUrlList(req.body?.urls);
    if (!urls.length) return res.status(400).json({ success: false, message: 'urls array required' });

    const MAX = 25;
    const slice = urls.slice(0, MAX);

    const user = await User.findOne({ 'telegram.userId': telegramUserId });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Telegram not connected. Please run /connect.' });
    }

    // Sequential to avoid provider rate limits; can be parallel later if needed
    const results = [];
    for (const inputUrl of slice) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const out = await createAffiliateLinkStrict({ user, url: inputUrl, storeId: storeId || null });
        results.push({
          inputUrl,
          success: true,
          shareUrl: out.shareUrl,
          slug: out.slug
        });
      } catch (err) {
        results.push({
          inputUrl,
          success: false,
          message: err?.message || 'Failed'
        });
      }
    }

    return res.json({ success: true, data: { results } });
  } catch (err) {
    console.error('telegram bulk link-from-url error', err);
    return res.status(500).json({ success: false, message: err?.message || 'Server error' });
  }
});

module.exports = router;