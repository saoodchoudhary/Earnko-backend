const express = require('express');
const HomepageBanner = require('../../models/HomepageBanner');

const router = express.Router();

function isWithinWindow(b, now = new Date()) {
  const s = b.startsAt ? new Date(b.startsAt) : null;
  const e = b.endsAt ? new Date(b.endsAt) : null;
  if (s && now < s) return false;
  if (e && now > e) return false;
  return true;
}

// GET /api/public/banners
router.get('/', async (_req, res) => {
  try {
    const now = new Date();
    const rows = await HomepageBanner.find({ isActive: true })
      .sort({ sortOrder: 1, updatedAt: -1 })
      .lean();

    const items = rows
      .filter(r => isWithinWindow(r, now))
      .map(r => ({
        _id: r._id,
        title: r.title,
        subtitle: r.subtitle,
        imageUrl: r.imageUrl,
        linkUrl: r.linkUrl,
        buttonText: r.buttonText,
        platform: r.platform,
        sortOrder: r.sortOrder
      }));

    res.json({ success: true, data: { items } });
  } catch (err) {
    console.error('public banners error', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;