const express = require('express');
const ShortUrl = require('../models/ShortUrl');

const router = express.Router();

/**
 * GET /r/:code
 * Redirect to destination url saved in ShortUrl.
 */
router.get('/:code', async (req, res) => {
  try {
    const code = String(req.params.code || '').trim();
    if (!code) return res.redirect(process.env.FRONTEND_URL || '/');

    const row = await ShortUrl.findOne({ code }).lean();
    if (!row?.url) return res.redirect(process.env.FRONTEND_URL || '/');

    return res.redirect(row.url);
  } catch {
    return res.redirect(process.env.FRONTEND_URL || '/');
  }
});

module.exports = router;