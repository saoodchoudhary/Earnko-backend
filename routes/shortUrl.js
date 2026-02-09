const express = require('express');
const ShortUrl = require('../models/ShortUrl');

const router = express.Router();

/**
 * GET /r/:code
 * Commission-safe: redirect to internal affiliate redirect pipeline using slug.
 */
router.get('/:code', async (req, res) => {
  try {
    const code = String(req.params.code || '').trim();
    if (!code) return res.redirect(process.env.FRONTEND_URL || '/');

    const row = await ShortUrl.findOne({ code }).lean();
    if (!row) return res.redirect(process.env.FRONTEND_URL || '/');

    // NEW preferred path: go via /api/affiliate/redirect/:slug so clickId is created + embedded
    if (row.slug) {
      return res.redirect(`/api/affiliate/redirect/${row.slug}`);
    }

    // legacy fallback
    if (row.url) return res.redirect(row.url);

    return res.redirect(process.env.FRONTEND_URL || '/');
  } catch {
    return res.redirect(process.env.FRONTEND_URL || '/');
  }
});

module.exports = router;